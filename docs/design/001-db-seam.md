# ADR 001 — The database seam

**Status:** Proposed · **Date:** 3 August 2026 · **Author:** Desktop architect (Claude Code)
**Context:** Build brief §3 (ADAPT: Neon → embedded PGlite), §8 (one codebase, two deployments), §10 (sequence step 2: port the DB seam first — everything layers on it).

One codebase must run against **embedded PGlite** (desktop solo mode, localhost, single user) and **real Postgres** (team mode, shared server). Local vs team is a deployment target, never a fork. This ADR defines the interface, the PGlite specifics, the migration strategy, the desktop schema policy, the team-mode swap, the first files to build, and the risks.

Findings from the SaaS codebase that shape this design:

- `server/db.ts` is the only file that touches `@neondatabase/serverless` (websocket config, `Pool`). The seam replaces exactly one file's exports: `db` and `pool`.
- Five modules import from `./db` directly: `storage.ts`, `routes.ts`, `scheduler.ts`, `index.ts`, `lib/feedbackPoller.ts` (plus `billingRoutes.ts`/`stripeWebhookHandler.ts`, which are cut). Everything else goes through `storage.ts` (`IStorage` / `DatabaseStorage`, ~5,800 lines) — the seam therefore sits **below** storage, and storage ports with near-zero churn.
- The schema uses only plain Postgres: `varchar`/`text`/`jsonb`/`timestamp`/`integer`/`real`/`boolean`/`text[]`, `gen_random_uuid()` defaults, ordinary and partial unique indexes. **No pgvector, no tsvector/full-text, no LISTEN/NOTIFY, no extensions.** All of it runs on PGlite unmodified.
- Three `db.transaction()` call sites in storage; raw `pool.query()` SQL in `routes.ts`, `scheduler.ts`, `feedbackPoller.ts` (mostly ad-hoc DDL and cross-org sweeps).
- Schema management today is a mess we must not port: `drizzle-kit push` **plus** a 600-line `ensureSchemaColumns()` of idempotent `ALTER TABLE IF NOT EXISTS` statements **plus** `runOneTimeMigrations()` with customer-specific data repairs baked into source. The desktop repo starts clean.
- Sessions are `connect-pg-simple` over the shared `pool` (`server/index.ts:244–267`) with a `sessions` table in `shared/schema.ts`. Desktop has no sessions at all.

---

## 1. Interface shape

### Decision

A **provider module** with two concrete implementations, selected once at process start. The seam's public surface is deliberately tiny:

```ts
// server/db/types.ts
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@shared/schema";

/** The one database type the rest of the codebase is allowed to name. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// server/db/provider.ts
export interface DatabaseProvider {
  readonly kind: "pglite" | "postgres";   // for logging/diagnostics only — never for branching in app code
  readonly db: Db;
  migrate(): Promise<void>;               // apply bundled migrations (see §3)
  close(): Promise<void>;                 // flush + release; must be safe to call twice
}
```

The type trick is load-bearing: `drizzle-orm/pglite` returns `PgliteDatabase<TSchema>` and `drizzle-orm/node-postgres` returns `NodePgDatabase<TSchema>`, but **both extend `PgDatabase<PgQueryResultHKT, TSchema>`**, which carries the full query builder, `execute()`, and `transaction()`. Typing the seam as the common base class means storage code compiles identically against either driver, and `tsc` enforces that nothing driver-specific leaks.

### Construction and injection

```ts
// server/db/index.ts
export async function initDatabase(config: DbConfig): Promise<void>;  // constructs provider, runs migrate(), seeds local rows
export function getDb(): Db;                                          // throws a clear error if initDatabase() hasn't run
export const db: Db;                                                  // lazy Proxy delegating to getDb() — port-compatibility export
export async function closeDatabase(): Promise<void>;
```

`DbConfig` is `{ target: "pglite"; dataDir: string } | { target: "postgres"; connectionString: string }`, resolved by the deployment entry point (desktop shell, headless CLI, or team server bootstrap) — **not** read from `process.env` deep inside the seam. Each entry point owns its config source (desktop: app-data path; CLI: same path resolution; team: `DATABASE_URL`).

The `db` Proxy export exists so the 5,800-line `storage.ts` ports with its `import { db } from "../db"` lines intact — every method call (`db.select()`, `db.transaction()`, `db.execute()`) forwards to the initialised instance. New code should prefer `getDb()`; the Proxy is a port-cost decision, not a style endorsement.

**`pool` is not exported.** Raw SQL call sites in ported code (`scheduler.ts`, `feedbackPoller.ts`, the few surviving ones in routes) are rewritten to `db.execute(sql\`...\`)`, which works on both drivers. Most of the raw SQL in `routes.ts` is ad-hoc DDL or multi-org sweeps that die with the modules that own them.

### Where the seam sits

```
routes / agents / MCP server / scheduler
        │  (never import db directly — storage only; scheduler's raw SQL moves behind storage methods during port)
        ▼
server/storage.ts  (IStorage — ported nearly intact)
        │  import { db } from "./db"
        ▼
server/db/index.ts (the seam: init/getDb/db/close)
   ┌────┴────┐
   ▼         ▼
pglite.ts  postgres.ts
```

### Rejected alternatives

- **Repository-pattern rewrite (hand-rolled query interface per entity, no ORM at the seam).** Maximum insulation, but throws away a working 5,800-line storage layer and the Drizzle schema that `drizzle-zod` types flow from. The brief says the schema ports "nearly intact"; the seam should too.
- **Constructor injection of `Db` into `DatabaseStorage` and every agent.** Cleaner in principle; in practice it forces signature churn through storage, scheduler, and every agent runner for zero behavioural benefit in a single-process app. The module-level provider with an explicit async `initDatabase()` gives the same testability (tests call `initDatabase` with an in-memory PGlite) without the churn. Revisit only if the team server ever needs per-request DBs (it does not — one shared DB per deployment).
- **Top-level `await` creating the DB at import time (current SaaS pattern).** Breaks the headless CLI (which must decide *whether* to open the DB or proxy — see §2 locking) and makes test ordering miserable. Initialisation must be an explicit call.
- **Keeping `@neondatabase/serverless` as the team driver.** It is Neon-specific (websocket transport, `neonConfig`). Team mode's decided target includes self-hosted Docker Postgres; `pg` (node-postgres) over TCP works against vanilla Postgres *and* Neon. Neon-serverless has no place in the new repo.

---

## 2. PGlite specifics

### Driver

`@electric-sql/pglite` + Drizzle's first-party `drizzle-orm/pglite` driver:

```ts
// server/db/pglite.ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@shared/schema";

const client = new PGlite(dataDir);            // e.g. ".../Discoveree/db"
const db = drizzle(client, { schema });
```

Pin `drizzle-orm`, `drizzle-kit`, `drizzle-zod`, and `@electric-sql/pglite` at current latest in the fresh repo (do **not** inherit the SaaS pins: drizzle-orm 0.39 / drizzle-zod 0.7 predate current PGlite support). Verify the drizzle-orm ↔ pglite compat matrix at install time — this is the first thing the seam's smoke test proves.

### Database location

- `server/db/dataDir.ts` exposes `resolveDataDir()`: `DISCOVEREE_DATA_DIR` env override, else the platform app-data convention (`~/Library/Application Support/Discoveree` on macOS, `%APPDATA%\Discoveree` on Windows, `$XDG_DATA_HOME/discoveree` on Linux — use the `env-paths` package rather than hand-rolling). The PGlite data directory is `<dataDir>/db/`.
- **This function must be plain Node** — no Electron `app.getPath("userData")`, no Tauri API — because the headless CLI (`discoveree mcp serve`) resolves the *same* path with no shell present. The desktop shell calls the same function. One resolution routine, two callers; divergence here means the CLI serves a different (empty) database than the app, which is the worst silent failure this design can produce.
- Blob/object storage (GCS replacement) lives beside it under `<dataDir>/objects/` — out of scope here (storage seam, next ADR), but the directory layout is decided now so the two seams don't fight.

### Lifecycle inside embedded Express

1. Process start → `resolveDataDir()` → acquire the **writer lock** (below) → `new PGlite(dir)` → `provider.migrate()` → seed local rows if first run (§4) → register routes → `listen()` on localhost.
2. PGlite executes queries serially on its single connection and internally queues concurrent async calls — no pool semantics, nothing to configure. Consequence for app code: long transactions block everything, including MCP reads. Keep transactions short (the three existing `db.transaction` sites are fine); agents must not wrap whole runs in a transaction.
3. Shutdown: on SIGINT/SIGTERM/shell "before-quit" → stop scheduler → `closeDatabase()` (PGlite `close()` flushes to disk) → release lock. `close()` must be idempotent; a crash without `close()` is recoverable (PGlite/Postgres WAL semantics) but the lock file must be stale-detectable.

### The single-writer lock (this is the sharp edge)

PGlite is **single-connection and single-process**: two PGlite instances opened on the same data directory can corrupt it, and there is no postmaster to stop you. The brief requires the MCP CLI to be headless-capable *and* the app to serve MCP while open — both wanting the same database. Decision:

- `server/db/lock.ts` takes an exclusive lock file (`<dataDir>/db.lock` with PID + port, stale-PID detection — use `proper-lockfile` semantics) before any PGlite open.
- **App running, CLI starts:** the CLI finds the lock, reads the app's localhost MCP port from it, and **proxies stdio ⇄ localhost HTTP MCP** instead of opening the DB. Claude gets identical answers either way.
- **App closed, CLI starts:** CLI acquires the lock and opens PGlite directly (headless mode).
- **CLI running headless, app starts:** the app must win — it is the writer (agents run there). App signals the CLI (lock file contains the CLI's PID; send SIGTERM), waits for lock release with a short timeout, then opens. The CLI's MCP session drops and Claude reconnects — acceptable; document it.

This also enforces the brief's single-writer governance (§7 rung 1) at the storage level, not just at the UI level.

### Limitations checked against the current schema

| Concern | Finding |
|---|---|
| Extensions (pgvector etc.) | None used anywhere in `shared/schema.ts` or server SQL. Nothing to load. If vector search is ever wanted, PGlite ships pgvector as an optional extension — door stays open. |
| `gen_random_uuid()` | Built into Postgres ≥13; PGlite is PG16/17-based. Works, no pgcrypto needed. |
| `text[]` arrays, `jsonb`, partial unique indexes | All supported. |
| LISTEN/NOTIFY | Not used (SSE is app-level). PGlite supports it anyway. |
| Concurrency | Single connection; serial execution. Fine for one user + agents; the lock above handles multi-process. |
| `connect-pg-simple` | Needs a `pg` Pool; irrelevant — desktop has no sessions (§4). |

---

## 3. Migration strategy for desktop

### Decision: generated SQL migration files, bundled with the app, applied at launch

- Dev-time: `drizzle-kit generate` against `shared/schema.ts` produces numbered SQL files + journal in `shared/migrations/`, committed to the repo. Migration `0000_baseline.sql` is the full desktop schema (fresh, squashed — no SaaS history).
- Run-time: `provider.migrate()` calls Drizzle's `migrate()` (`drizzle-orm/pglite/migrator` / `drizzle-orm/node-postgres/migrator`) with the bundled folder on **every launch**, before routes register. Drizzle's `__drizzle_migrations` table makes this idempotent. A failed migration aborts startup with a visible error — never boot against a half-migrated schema.
- Packaging note for step 7 of the build sequence: the migrations folder must ship inside app resources (Electron: `extraResources`/asar-unpacked; Tauri: bundled resource dir) and the folder path resolved at runtime, not assumed relative to `cwd`. The headless CLI also runs `migrate()` — first launch after an app update might otherwise be the CLI.
- Data repairs, if ever needed, are ordinary numbered migrations (SQL `DO` blocks). No parallel mechanism.

### Rejected alternatives

- **`drizzle-kit push` at runtime.** Push is an interactive dev tool: it diffs a live DB, can prompt (the SaaS repo carries a workaround for exactly this — the `products_slug_unique` interactive-prompt fix in `ensureSchemaColumns`), can generate destructive DDL, and would require shipping `drizzle-kit` inside the packaged app. Wrong tool for unattended end-user machines.
- **Porting the `ensureSchemaColumns()` pattern.** It is 600 lines of un-ordered, un-versioned, silently-skipped-on-error DDL that exists because push and manual ALTERs drifted. It is the strongest argument in the codebase for real migrations. Explicitly banned in the new repo (CI can grep for it).
- **Porting `runOneTimeMigrations()`.** It contains customer-specific production data repairs (Bondaval row deletions). None of that data exists in a fresh desktop install. Drop it; the "one-time named migration" job is exactly what numbered migrations do.
- **Schema-version pragma + hand-written upgrade functions (classic desktop pattern).** Reinvents what drizzle's migrator already does, and loses the guarantee that `shared/schema.ts` and the DDL were generated from each other.

Team-mode implication: the **same** migration folder migrates team Postgres. One schema history for both deployments is what keeps "one codebase, two deployments" true at the data layer, and is the mechanism for solo→team context migration (§5).

---

## 4. Schema handling: tenancy columns, auth/session/billing tables

### Decision: strip dead *tables*, keep tenancy *columns* with seeded fixed rows

Two different questions with two different answers:

**(a) Tables owned by CUT modules: strip.** The desktop baseline schema simply never contains: `sessions`, `password_reset_tokens`, `team_invitations`, `team_members`, `organization_subscriptions`, `product_access`, `product_access_requests`, all `slack_*` tables, `analytics_widgets`, `inline_comments` (+attachments), `tasks`, `period_reflection_*`, `goal_proposals`, `problem_statement_comments`. Billing/Slack/digest columns on surviving tables (`organizations.stripeCustomerId`, `users.slack*`, `users.digest*` email-delivery fields) are likewise omitted from the baseline. This is safe precisely because §3 starts from a squashed `0000_baseline` — there is no old DDL to diverge from. The brief's rule "delete cut modules rather than porting them" applies to their tables too.

**(b) Tenancy scoping columns on surviving tables: keep, with fixed seeded rows.** `organizations`, `users`, and `organization_users` survive (heavily slimmed), and `organizationId` / `userId` / `productId` foreign keys stay on every surviving table. First run seeds exactly one organisation ("Local workspace"), one user (from onboarding), one membership — `server/db/seedLocal.ts`, idempotent. All storage code keeps its existing scoping predicates; desktop simply only ever has one org id to scope by. Same for `teams`: the table survives (roadmap items and feedback carry `team_id`, and Roadmap Review groups by team) even though team *management* UI is cut.

### Why not strip the tenancy columns too

- **Team mode is the same schema.** Rung 3 is "today's Express app minus Stripe" against real Postgres. If desktop dropped `organizationId`, team mode would need a divergent schema and a divergent storage layer — that is the fork the brief forbids. Keeping the column costs one seeded row and ~nothing at runtime.
- **The upgrade path becomes a data copy.** Solo → team migration is: dump local rows, remap the local org/user ids to the team server's real ids, insert. With stripped columns it would be a schema transformation.
- **The licensing/seat boundary needs identity anyway.** Write governance ($199 full seats vs free readers) is per-user; `users`/`organization_users.seatType` is where seat state lives in team mode, and the local seed row is where the desktop licence attaches.

### Rejected alternatives

- **Strip all multi-tenancy, re-add for team tier.** Rejected above: it is the fork.
- **Keep every table, ignore the dead ones.** Ships auth/billing/Slack DDL to every desktop user's machine, keeps 30+ dead storage methods compiling, and makes the public source-available repo look like the multi-tenant SaaS it is not. Dead schema is dead weight in a repo whose selling point is a clean, inspectable context schema.
- **Nullable-and-unused tenancy columns (no seed rows).** Forces `organizationId` NOT NULL constraints to be relaxed, which team mode would have to re-tighten — a real divergence, unlike a seed row.

Sessions specifically: desktop runs **no `express-session` at all** — the localhost server trusts its single user; the licence check is not a login. Team mode reintroduces sessions via the *auth* seam (separate ADR), and its session store will need a real `pg` Pool — see §5 for how it gets one without polluting this seam.

---

## 5. Team-mode swap

```ts
// server/db/postgres.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

export function createPostgresProvider(connectionString: string): PostgresProvider {
  const pool = new Pool({ connectionString });
  return {
    kind: "postgres",
    db: drizzle(pool, { schema }),
    migrate: () => migrate(db, { migrationsFolder }),   // same folder as pglite
    close: () => pool.end(),
    pool,                                               // on PostgresProvider only — NOT on DatabaseProvider
  };
}
```

- Driver is `pg` (node-postgres). Works for self-hosted Docker Postgres and hosted providers including Neon-over-TCP. No websocket shim, no `neonConfig`.
- The team **bootstrap** (`server/deploy/team.ts`, later) imports the concrete `createPostgresProvider` and may use the `pool` it exposes for team-only wiring: `connect-pg-simple` session store, pool sizing, TLS options. That is legitimate because the bootstrap *is* deployment-specific by definition.

**What must NOT leak through the seam** (i.e. must never be reachable from `storage.ts`, agents, routes, or MCP code — enforce in review and, where possible, with lint rules):

1. `pool` or any connection object — only `Db`.
2. Driver-specific query-result shapes — raw SQL goes through `db.execute()`; no code may depend on `rowCount` semantics that differ between drivers (pglite returns `affectedRows`-style results; write ported call sites against what `db.execute` returns and test on both).
3. `provider.kind` as a branching condition in app code. If module behaviour must differ by deployment (it shouldn't at the DB layer), that is a feature flag on the deployment config, not a DB-driver sniff.
4. Connection strings, data-dir paths, lock files — config resolution stays in the entry points.
5. Migration mechanics — app code never triggers migrations; only `initDatabase()` does.

The CI-enforceable version: nothing outside `server/db/` imports `@electric-sql/pglite`, `pg`, or `drizzle-orm/pglite` / `drizzle-orm/node-postgres`. One ESLint `no-restricted-imports` rule buys the whole seam.

---

## 6. What to build first (concrete file list)

Order matters; each step compiles and its test passes before the next.

```
discoveree-desktop/
├── package.json                          # deps below
├── tsconfig.json                         # config below
├── drizzle.config.ts                     # schema: shared/schema.ts → out: shared/migrations, dialect postgresql
├── shared/
│   ├── schema.ts                         # 1. ported from SaaS, desktop-scoped per §4 (largest single task)
│   └── migrations/                       # 4. drizzle-kit generate output: 0000_baseline.sql + meta/_journal.json
├── server/
│   └── db/
│       ├── types.ts                      # 2. export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
│       ├── provider.ts                   # 2. DatabaseProvider interface + DbConfig
│       ├── dataDir.ts                    # 3. resolveDataDir() — env override → env-paths; plain Node only
│       ├── lock.ts                       # 3. writer lock: acquire/release/stale-detect; lock file carries PID + MCP port
│       ├── pglite.ts                     # 5. createPgliteProvider(dataDir)
│       ├── postgres.ts                   # 6. createPostgresProvider(connectionString) — proves the seam with impl #2
│       ├── migrate.ts                    # 5. bundled-folder resolution + drizzle migrate() call
│       ├── seedLocal.ts                  # 7. idempotent first-run seed: local org + user + membership
│       ├── index.ts                      # 8. initDatabase()/getDb()/db proxy/closeDatabase()
│       └── __tests__/
│           ├── pglite.test.ts            # in-memory PGlite: migrate → insert product → select → transaction → close
│           ├── seam.test.ts              # getDb() before init throws; db proxy delegates; close is idempotent
│           └── lock.test.ts             # second acquire fails; stale lock recovered
```

Numbers are build order. `storage.ts` porting starts only after 8 is green.

**package.json dependencies (seam work only):**

```jsonc
{
  "dependencies": {
    "@electric-sql/pglite": "latest-stable",   // pin exact at install; verify drizzle compat matrix
    "drizzle-orm": "latest-stable",            // NOT the SaaS 0.39 pin — needs current pglite driver
    "drizzle-zod": "latest-stable",
    "zod": "^3.x",
    "pg": "^8.x",
    "env-paths": "^3.x",
    "proper-lockfile": "^4.x"
  },
  "devDependencies": {
    "drizzle-kit": "latest-stable",
    "@types/pg": "^8.x",
    "@types/proper-lockfile": "^4.x",
    "typescript": "^5.x",
    "tsx": "^4.x",
    "vitest": "^3.x"
  }
}
```

(`express` and friends arrive with the server port, not the seam. Note `env-paths` v3+ and some deps are ESM-only — consistent with the NodeNext tsconfig below.)

**tsconfig.json for the seam (the repo gates on clean `tsc`):**

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["shared/*"] }
  },
  "include": ["shared", "server"]
}
```

Strict from commit one — the SaaS repo's 669 pre-existing `tsc` errors are the cautionary tale. `skipLibCheck` stays on (WASM-adjacent deps ship imperfect types); everything first-party is strict.

CI additions with the seam: `tsc --noEmit`, `vitest run`, and the `no-restricted-imports` lint rule from §5.

---

## 7. Risks and open questions

| # | Risk / question | Recommended resolution |
|---|---|---|
| 1 | **PGlite maturity / data safety.** PGlite is young; a desktop product's database corrupting is existential trust damage. | Mitigate three ways: (a) snapshot export/import is already a v1 brief feature (§7 rung 1) — surface it as automatic periodic backup to `<dataDir>/backups/` (retain N, prune); (b) `close()` on every exit path; (c) the writer lock prevents the main corruption vector (two processes, one dir). Keep a documented escape hatch: the provider seam means a desperate future swap to another embedded engine is contained in one file. |
| 2 | **drizzle-orm ↔ PGlite version coupling.** The pglite driver tracks PGlite releases; a careless `npm update` can break the pairing. | Pin exact versions of `drizzle-orm`, `drizzle-kit`, `@electric-sql/pglite` (no `^`). The pglite smoke test runs in CI, so any bump that breaks the pairing fails visibly. |
| 3 | **Headless CLI vs running app contention** (both want the DB). | Resolved by design in §2: lock file carries PID + MCP port; CLI proxies to the app's HTTP MCP when the app holds the lock; app preempts a headless CLI. Build `lock.ts` in the seam sprint, not the MCP sprint — retrofitting locking is how corruption happens. |
| 4 | **`db.execute()` result-shape drift between drivers** (pglite vs pg rows/rowCount). | Small and containable: ported raw-SQL call sites are few (scheduler, feedbackPoller) and most die with cut modules. Rule: any surviving `db.execute` call site gets exercised by a test that runs on the PGlite provider; `seam.test.ts` pins the shapes we rely on. If drift is found, add a tiny `execRows<T>()` helper in `server/db/` rather than normalising everywhere. |
| 5 | **Schema port scope creep** — `shared/schema.ts` is 2,230 lines with cut-module tables interleaved, and `storage.ts` methods reference them. | Port schema first with §4's strip list applied, then let `tsc` list every dead storage method — delete those methods and their `IStorage` entries rather than stubbing. The 669-error SaaS baseline never recovers; a gated repo must never acquire error #1. |
| 6 | **Squashed baseline loses SaaS drift knowledge** — prod DBs contain `ensureSchemaColumns` artefacts not all reflected in `shared/schema.ts` (e.g. tables created only in raw SQL: `market_reviews`, `roadmap_recommendations`, `skills`). | Before writing `0000_baseline`, reconcile: for each KEEP module, cross-check `shared/schema.ts` against the `ensureSchemaColumns` statement list and fold missing columns/tables into the ported schema. Budget a day; this is the only forensic task the clean-repo strategy leaves us. |
| 7 | **Does `organization_users` survive, or just `organizations` + `users`?** | Keep it (three seeded rows total). It is where `seatType` lives, which is the licensing/seat boundary in team mode; stripping it would re-fork the schema at rung 3. Cheap insurance. |
| 8 | **Solo→team migration mechanics** (id remapping, conflict policy) are asserted but not designed. | Out of scope here; the seam guarantees the precondition (identical schema + shared migration history). Write ADR when team tier is scheduled. Until then, the snapshot export format (risk 1) should be schema-versioned so old exports can be migrated forward — note for the storage-seam ADR. |
| 9 | **Where do encrypted LLM keys live now?** SaaS stores them on `organizations` with `crypto.ts` (needs a server-side secret). On desktop, the "server" is on the user's machine — an in-DB encrypted blob with a bundled key is theatre. | Keep the columns (schema continuity, §4) but the desktop *write path* should prefer OS keychain via the shell (Electron `safeStorage` / Tauri keyring) with DB storage as fallback. Decide fully in the auth/licensing ADR; the seam is unaffected either way. |

---

### Summary of decisions

1. Tiny provider seam (`DatabaseProvider`, `Db = PgDatabase<PgQueryResultHKT, typeof schema>`) below `storage.ts`; `db` stays importable via a lazy proxy; `pool` is never exported; driver imports are lint-banned outside `server/db/`.
2. PGlite via `drizzle-orm/pglite`, data in the platform app-data dir resolved by plain-Node code shared with the headless CLI, guarded by a writer lock that doubles as the CLI's proxy-or-open switch.
3. Generated, committed, bundled SQL migrations applied idempotently at every launch; `push`/`ensureSchemaColumns`/`runOneTimeMigrations` patterns are explicitly banned.
4. Strip cut-module tables and dead columns from a squashed baseline; keep tenancy columns and the identity tables with seeded fixed local rows — because team mode is the same schema and the upgrade path is a data copy.
5. Team mode = `pg` + `drizzle-orm/node-postgres` behind the same interface, same migration folder; deployment-specific needs (sessions store) take the concrete provider, never the seam.
