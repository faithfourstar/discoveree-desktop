# ADR 002 — Porting the Competitive Intelligence vertical

**Status:** Proposed · **Date:** 3 August 2026 · **Author:** Desktop architect (Claude Code)
**Context:** Build brief §3 (KEEP: Competitive Intelligence), §10 (sequence step 3: extract the keep-modules), §10a (over-invest in schema, pipelines, provenance). Builds on ADR 001 (the DB seam, implemented in `server/db/`).
**Source basis:** SaaS repo `main @ 823d979e` — `competitorAgentRunner.ts`, `searchProviders.ts`, `reviewSearch.ts`, `reviewService.ts`, `g2Api.ts`, `llmRouter.ts`, `crypto.ts`, `gemini.ts` (26,949 lines), `storage.ts` (5,805 lines), `scheduler.ts` (8,335 lines), `routes.ts` (46,316 lines).

This is the first real module extraction. The decisions here — server bootstrap, per-module layout, storage carving, scheduler registration, agent extraction from `gemini.ts` — are the template every later module (Customers, Strategy, Roadmap Review) follows. Where this ADR trades module coverage for pattern quality, that trade is deliberate.

---

## 1. Sprint scope

### The end-to-end slice that must work

> Add a competitor by name/URL → the summary agent researches it (web-search LLM call) → a `competitor_profiles` row is stored with provenance (source URLs, verified-at timestamps) → the client renders it → a refresh (manual or scheduled) runs the updates scan and records *changes* in `competitor_changes` — detecting change, not re-deriving the world (brief §10a.2).

### IN (sprint 2)

| Piece | Why |
|---|---|
| Add / list / view / delete / reclassify competitor | The CRUD spine; exercises routes → module storage → seam |
| **Competitor summary agent** (`competitor-summary-agent`) | The "agent researches" step: description, key differentiators, markets, official URL — each with `sourceUrl` provenance. ~160 lines in `gemini.ts`, uses `callLLM` with web search |
| **Competitor features agent** (`competitor-features-agent`) | Cheap (~60 lines), fills `keyFeatures` with per-feature `sourceUrl`; makes the profile feel researched rather than summarised |
| **Competitor updates scan** (`competitor-updates-agent` + `probeProductReleaseSources`) | The "refresh detects change" step. Dual-stream market/product signal scan writing `competitor_changes` rows; caches `validReleaseSources` so re-runs are cheap. This is the deterministic-maintenance differentiator — it ships in sprint 2 |
| LLM router + BYO keys + local encryption (§4) | Nothing runs without it |
| Search providers (`searchProviders.ts`) | Dependency of the router's web-search paths; ports whole per brief §3 |
| Scheduler skeleton + catch-up-on-launch (§7) | Competitor agents are the first registrants |
| Zod validation of every agent output at the module boundary | New code, small, non-negotiable per brief §10 constraints — and it sets the pattern |

### OUT (explicitly deferred, with destination)

| Piece | Verdict | Reasoning |
|---|---|---|
| **G2 API** (`g2Api.ts`) | Defer to a later sprint, behind "own G2 key" setting | The SaaS G2 key is a *platform* credential. Desktop is BYO-keys; almost no customer has a G2 API contract. `reviewService.ts` already degrades gracefully without it. Do not port a dead credential path in the flagship sprint |
| **Review mining** (`reviewSearch.ts`, `reviewService.ts`, `getCompetitorReviews`) | Sprint 3 (with Customer Insights, which shares the review pipeline) | Sentiment/review-count fields in the client render as absent blocks — the brief's "blocks materialise only when populated" (§6) makes partial profiles a designed state, not a bug |
| **Pricing agent** (`getCompetitorPricing`) | Sprint 3 | ~600 lines with segment/market/trusted-source coupling — 4× the size of summary+features combined for one profile section |
| **Integrations, customer segments, investor relations, announcements agents** | Sprint 3+ | Same pattern as summary/features; add mechanically once the pattern is proven |
| **Competitor discovery** (`analyzeCompetitors`, `analyzeAdjacentProducts`) | Onboarding sprint (brief §5 step 1 — "proposes competitors") | It belongs to the wizard's flow, not the module |
| **Multi-lingual / market-scoped search** | With reviews/pricing | It rides in as parameters of the deferred agents |
| **Comparison view, landscape, threat-history chart** | Later UI sprint | Views over data that sprint 2 stores; `threat_level_history` rows are written from sprint 2 so history exists when the chart arrives |
| **Battlecards** | CUT (brief §3: MCP replaces them) | Also see risk 8 — the schema still carries battlecard columns |
| **Help-centre crawler / GitHub / changelog monitor** | Product-profile sprint (brief §3 row "deep product understanding") | They serve the own-product evidence base first; the competitor `changelogContentHash` fields wait for that sprint |

Rejected alternative: shipping summary-only ("thinnest possible slice"). Rejected because without the updates scan the vertical is "Claude with my docs" — a one-off research report. Change detection is the reason this product exists; it must be in the first vertical.

---

## 2. Server bootstrap

The repo has no Express app. This skeleton is what every later module plugs into.

### Files

```
server/
├── main.ts            # desktop-solo entry point (the ONLY file that knows it is desktop)
├── app.ts             # buildApp(): assembles Express from module registrations
├── http/
│   ├── errors.ts      # DomainError hierarchy + central error middleware
│   ├── asyncHandler.ts# wraps async routes so rejections hit the error middleware
│   └── identity.ts    # attaches req.ctx = { organizationId, userId } (fixed local ids)
```

### `main.ts` startup sequence (desktop solo)

1. `resolveDataDir()` (existing, ADR 001)
2. `acquireWriterLock(dataDir, { port })` (existing `lock.ts`)
3. `initDatabase({ target: "pglite", dataDir })` — migrates + seeds local org/user (existing)
4. `seedAgents()` — idempotent upsert of the competitor `ai_agents` rows (§5, from a trimmed `agentSeeder`)
5. `const app = buildApp()` → `app.listen(PORT, "127.0.0.1")`
6. `startScheduler()` — minute tick (§7)
7. `scheduleCatchUpPass({ delayMs: 45_000 })` — §7; delayed so launch isn't janked by LLM traffic
8. Shutdown (SIGINT/SIGTERM, later shell before-quit): `stopScheduler()` → `server.close()` → `closeDatabase()` → `releaseWriterLock()` — mirror of ADR 001 §2 lifecycle.

**Port:** default `7317` (already the number in the client mock footer, "MCP serving :7317"), override `DISCOVEREE_PORT`. One port serves the API now and localhost HTTP MCP later — the lock file already carries it for the headless-CLI proxy handshake (ADR 001 §2). **Bind `127.0.0.1` only**; rung-1 team read-sharing opts into LAN exposure explicitly, later.

### `app.ts` — module registration pattern

```ts
// server/app.ts
import { registerCompetitorRoutes } from "./modules/competitors/routes.js";
import { registerProductRoutes } from "./modules/products/routes.js";

export function buildApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api", localIdentity);          // req.ctx = { organizationId: LOCAL_ORGANIZATION_ID, userId: LOCAL_USER_ID }
  registerProductRoutes(app);
  registerCompetitorRoutes(app);
  app.use("/api", notFoundHandler);        // unknown /api/* → 404 JSON, never the SPA
  app.use(errorMiddleware);                // ZodError → 400 {error, issues}; DomainError → its status; else 500 + log
  return app;
}
```

- Each module exports one `register<Module>Routes(app)` using an `express.Router`. Modules never import each other's routes; cross-module needs go through the other module's storage/service functions.
- **`localIdentity` is the auth seam.** Today it injects the fixed ids from `seedLocal.ts`. In team mode the same slot holds the real auth middleware, and route handlers are already written against `req.ctx.organizationId` — no handler changes at the seam. This is the "strip auth/org-scoping" instruction made concrete: handlers keep their org-scoping *predicates* (ADR 001 §4) and lose only the *source* of the ids.
- `asyncHandler` wrapper on every route (Express 4 does not catch async rejections). Central error middleware is the only place that writes 500s; handlers `throw`, never hand-roll status codes beyond domain 4xx.

Rejected alternatives:
- **Porting `routes.ts` and deleting.** 46k lines with auth, org-lookup, region, Stripe and progress-task plumbing braided through every handler. Route *bodies* are ported selectively into module routes (§5); the file itself is never copied.
- **A DI container / plugin framework.** Two deployments and ~6 modules do not justify it; a `register*` function per module is the whole pattern.

### Client dev wiring

- `client/vite.config.ts` gains `server.proxy: { "/api": "http://127.0.0.1:7317" }`.
- `client/src/lib/api.ts` exposes `apiUrl(path)` reading an **API base URL** value (empty in dev/desktop → relative, proxied; a team-server URL when the desktop app is pointed at a team deployment). This is the fourth seam from the brief (§8) — it costs one file now and prevents `fetch("/api/...")` literals from spreading.
- Sprint 2 client work: swap `CompetitorsPage` from `mock/data.ts` to the API for the competitor list/detail, keeping `mock/types.ts` shapes as the rendering contract (§6). Add TanStack Query (the SaaS client already uses it; ported components expect it).

Dev scripts: `npm run dev:server` = `tsx watch server/main.ts` (with `DISCOVEREE_DATA_DIR` pointed at a scratch dir); `npm run dev` in `client/` unchanged.

---

## 3. Module structure

### Decision: `server/modules/<name>/` verticals over a thin `server/lib/` core

```
server/
├── db/                                # ADR 001 — unchanged
├── lib/                               # shared infrastructure (no domain knowledge)
│   ├── llm/
│   │   ├── router.ts                  # from llmRouter.ts, trimmed (§5)
│   │   ├── providers/claude.ts        # from claude.ts (client factory only)
│   │   ├── providers/gemini.ts        # getGeminiClient/getGeminiKeySource/clearGeminiClientCache (from gemini.ts:603–688)
│   │   ├── keys.ts                    # read/decrypt org LLM keys (queries organizations via getDb())
│   │   ├── usage.ts                   # trackLlmUsage (from gemini.ts:548–603) → llm_usage table
│   │   └── json.ts                    # sanitizeJsonResponse (gemini.ts:160–200)
│   ├── search/providers.ts            # searchProviders.ts, whole
│   ├── web/fetch.ts                   # fetchViaJina, validateUrl[s]WithSoft404Detection (gemini.ts:447–548)
│   ├── agents/
│   │   ├── slugs.ts                   # AgentSlugs const (agentExecutionLogger.ts:98+), competitor entries only for now
│   │   ├── executions.ts              # trackAgentExecution (agentExecutionLogger.ts) + execution storage fns
│   │   ├── registry.ts               # ai_agents storage fns (getAiAgentBySlug…) + resolveAgentPrompt (from llmRouter)
│   │   ├── seed.ts                    # trimmed agentSeeder: competitor agent definitions only
│   │   └── batch.ts                   # runAgentBatch/isRetryableError/retryAfterMs (competitorAgentRunner.ts, whole)
│   ├── progress.ts                    # progressEvents.ts (in-memory emitter)
│   └── secrets.ts                     # local encryption-key source + encrypt/decrypt/maskApiKey (§4)
├── modules/
│   ├── products/                      # minimal in sprint 2: the one product row competitors hang off
│   │   ├── routes.ts                  # GET/PATCH /api/product
│   │   └── storage.ts                 # getProduct/updateProduct/getAllProducts (carved)
│   └── competitors/
│       ├── routes.ts                  # §6 surface
│       ├── storage.ts                 # carved competitor storage (below)
│       ├── service.ts                 # add/refresh/delete orchestration; owns enrichment fan-out
│       ├── schemas.ts                 # Zod schemas for agent outputs + API responses
│       └── agents/
│           ├── summary.ts             # generateCompetitorSummary (gemini.ts:10550–10712)
│           ├── features.ts            # getCompetitorFeatures (gemini.ts:10712–10780)
│           ├── updates.ts             # scanCompetitorUpdates + internal scans + failure taxonomy (gemini.ts:8627–9203)
│           └── releaseSources.ts      # buildProductReleaseSources + probeProductReleaseSources (in the 8627–9203 block)
└── scheduler/                         # §7
    ├── index.ts                       # start/stop + minute tick over registered agents
    ├── registry.ts                    # ScheduledAgent interface; modules register here
    ├── gates.ts                       # frequency gate, circuit breaker, timeOfDay (scheduler.ts:2246–2412, minus login gate)
    ├── defaults.ts                    # computeDefaultSchedules trimmed to competitor keys (scheduler.ts:26–76)
    └── catchUp.ts                     # §7 launch pass
```

The rule for `lib/` vs `modules/`: **lib code must compile with zero imports from `modules/`**. Anything mentioning a competitor, segment, or roadmap item lives in a module. (`lib/agents/*` knows about the *ai_agents machinery*, which is infrastructure; the agent *definitions* it seeds are data.)

### Storage carving: per-module function files, not the 5,800-line class

**Decision: do not port `DatabaseStorage`/`IStorage`.** Each module gets a `storage.ts` of plain exported async functions whose *bodies* are copied verbatim from the corresponding `DatabaseStorage` methods (they are self-contained Drizzle queries; the `db` proxy from ADR 001 §1 means even their `import { db }` line works unchanged).

Sprint 2 carve for `modules/competitors/storage.ts` (source: `storage.ts` line refs):

- `getCompetitorProfile` (2214), `getCompetitorProfilesByProduct` (2227), `upsertCompetitorProfile` (2235), `updateCompetitorProfile` (2261), `deleteCompetitorProfile` (2274)
- `getCompetitorChangesByProduct[Paginated]` (2127/2136), `createCompetitorChange` (2195), `deleteCompetitorChangesByProduct` (2209)
- `createCompetitorThreatLevelHistory` (2417), `getCompetitorThreatLevelHistory` (2422), `getRecentThreatLevelChangesByProduct` (2430)

Plus `lib/agents/executions.ts`: `getAiAgentBySlug`, `getAiAgent`, `createAiAgentExecution`, `updateAiAgentExecution`, `getLastExecutionForAgentAndProduct`, `getRecentExecutionsForAgentAndProduct`, `getAiAgentExecutionsByProduct`. Rough scale: ~350 lines of carved storage for sprint 2, against 5,805 in the monolith.

Why carve rather than port wholesale (the alternative ADR 001 left open):

1. **Deleting cut modules is the brief's instruction** (§10 step 3). A single class referencing every table keeps ~30 dead method groups compiling or forces a giant deletion pass anyway — carving *is* that deletion pass, done incrementally with each module sprint.
2. The class is the repo's worst merge/typecheck hotspot; per-module files make module PRs disjoint.
3. Method bodies port verbatim either way, so the "near-zero churn" promise of ADR 001 is preserved *per method* — only the class wrapper and the 700-line `IStorage` interface die. This is a refinement of ADR 001's assumption ("storage ports nearly intact"), not a contradiction: the seam sits below storage regardless of whether storage is one file or eight.

Convention to enforce in review: module storage functions take `organizationId`/`productId` explicitly (from `req.ctx`) — never import the seed constants inside `modules/` (only `http/identity.ts` and tests may).

### The single biggest behavioural decision: `competitor_profiles` becomes canonical

The SaaS dual-writes competitors into **both** `products.competitors` (a jsonb array) and `competitor_profiles` rows, with re-read-before-write races patched all over `routes.ts` (e.g. `add-competitor` at 11738 re-reads twice) and `scheduler.ts` (7447: "re-read from DB before writing to avoid overwriting concurrent deletions").

**Desktop decision: `competitor_profiles` is the single source of truth.** `POST /api/competitors` creates a profile row immediately (`enrichmentStatus: "pending"`) and enrichment updates that row. The `products.competitors` jsonb column stays in the schema (ADR 001 §4 continuity — team mode and the solo→team copy) but the desktop code path never writes it; ported agent functions that take a `competitors: Array<{name, url…}>` parameter are fed a projection built from profile rows.

- This honours the brief's stable-ID rule (§10a.1): the API and client key on `competitor_profiles.id`, not on `competitorName` in URLs as the SaaS routes do.
- Rejected: porting the dual-write verbatim. It would import a known race-and-drift generator into a codebase whose pitch is "no silent duplicates and drift", and single-writer PGlite would hide the races until team mode resurfaces them.
- Consequence to flag: the "own product as a competitor row" convention (`isOwnProduct`) survives as a profile row with `sourceCategory: "own_product"` — nothing in sprint 2 depends on it, but the updates scan accepts it later.

---

## 4. LLM keys locally

### Storage and encryption

- **Where:** the existing encrypted columns on `organizations` (`openaiApiKey`, `geminiApiKey`, `perplexityApiKey`, `claudeApiKey`, `openrouterApiKey`, `llmKeyMode`), on the seeded local org row. `useOwnLlmKeys` is already seeded `true` — desktop is BYO by definition; the SaaS platform-key fallback paths in the router are deleted, not disabled.
- **Cipher:** keep `crypto.ts` exactly (AES-256-GCM, `iv:tag:ciphertext` hex format, `maskApiKey`) so decrypt/mask logic and any future solo→team key migration port intact.
- **Key material:** `server/lib/secrets.ts` replaces the `process.env.ENCRYPTION_KEY` lookup with `getLocalEncryptionKey()`: on first run, generate 32 random bytes → write to `<dataDir>/secret.key` with mode `0600`; subsequently read it. Same plain-Node constraint as `dataDir.ts` — the headless MCP CLI must decrypt keys too.
- **Honesty note (goes in SECURITY.md, not marketing):** a key file beside the database protects against casual file copying, not against a local attacker — the same model as most desktop tools' token stores. When the shell lands (build step 7), `secrets.ts` upgrades to Electron `safeStorage`/Tauri keyring **behind the same function**, re-encrypting the columns on first launch; this fulfils ADR 001 risk 9's "OS keychain preferred, DB fallback" without blocking sprint 2 on a shell that doesn't exist yet.
- Rejected: storing keys plaintext ("it's the user's own machine") — makes snapshot export/backup files (ADR 001 risk 1) toxic. Rejected: bundling a fixed key in the app — theatre, and ADR 001 already called it that.

### Router behaviour with one key (the common desktop case)

Ported `getAvailableProviders` + selection logic (llmRouter.ts:1836–1966) already handle it correctly — verify with tests, don't redesign:

- Primary selection: an agent's configured provider is used only if its key exists (`isProviderAvailable`); otherwise `getBestProviderForWebSearch`/`ForAnalysis` picks from what's available (e.g. only an OpenAI key → `gpt-4o-mini` with `web_search` for search calls, `gpt-4o` for analysis).
- Fallback lists (`getFallbackProviders`) filter to available providers, so with one key the list is empty → behaviour degrades to "retry same provider / surface the error". That is correct for BYO: never silently fail across providers the user doesn't have.
- `llmKeyMode: "openrouter"` remains the one-key-for-everything path (routes web search to `perplexity/sonar` via OpenRouter) — worth keeping; it is the cheapest good onboarding answer ("one key from any provider is enough", brief §5 step 5).
- **Deleted from the router during port:** `enforceOrgBudget`/`LLMBudgetExceededError` + `llmCredits.ts` (platform-billed credits don't exist on desktop — the user's spend is their provider bill, which `trackLlmUsage`/`llm_usage` still records and Settings can display), Langfuse spans (`langfuse.ts` — platform observability; strip the ~12 call sites), the `/tmp/llm_debug.log` file logger (replace with the normal logger).

Sprint 2 test matrix (small, pays for itself every later module): each provider key alone × {analysis call, web-search call} → asserts a sensible provider/model is chosen and no platform-key path is reachable.

---

## 5. Extraction map

Per source file: **TAKE** (near-verbatim), **TAKE-PARTIAL** (named functions only), **LEAVE** (dies with the SaaS or waits for a later sprint). Line counts are of the source; "port scale" is the expected size landing in the new repo.

| Source file (lines) | Verdict | What moves → where | Port scale |
|---|---|---|---|
| `competitorAgentRunner.ts` (126) | **TAKE** | Whole → `lib/agents/batch.ts`. Zero deps, already tested patterns | ~126 |
| `crypto.ts` (60) | **TAKE** | Whole → inside `lib/secrets.ts`, with `getEncryptionKey()` swapped per §4 | ~80 |
| `searchProviders.ts` (923) | **TAKE** | Whole → `lib/search/providers.ts`. Its two `gemini.ts` imports (`trackLlmUsage`, `sanitizeJsonResponse`) now come from `lib/llm/*` | ~920 |
| `llmRouter.ts` (3,129) | **TAKE-PARTIAL** | `callLLM`, `callLLMWithModel`, `callLLMStream`, provider call fns, `getAvailableProviders` + selection/fallback fns, `validateLLMResponse`, `toStrictOpenAISchema`, key validators, client caches, `resolveAgentPrompt`/`getAgentConfig` (→ `lib/agents/registry.ts`). **Leave:** `enforceOrgBudget`, Langfuse call sites, debug file logger, platform-key fallbacks | ~2,300 |
| `claude.ts` | **TAKE-PARTIAL** | `getClaudeClient`, `DEFAULT_CLAUDE_MODEL` → `lib/llm/providers/claude.ts` | ~60 |
| `gemini.ts` (26,949) | **TAKE-PARTIAL** — the whole point of the module structure is never copying this file | Shared helpers: `sanitizeJsonResponse` (160–200), `fetchViaJina` (447–481), `validateUrl[s]WithSoft404Detection` (481–548), `trackLlmUsage` (548–603), `getGeminiClient`/`clearGeminiClientCache`/`getGeminiKeySource` (603–688), `isGroundingRedirectUrl`/`isReviewSiteUrl` (9943–9990) → `lib/`. Module agents: `generateCompetitorSummary` (10550–10712), `getCompetitorFeatures` (10712–10780), the updates block `CompetitorUpdateFailureReason`/`buildProductReleaseSources`/`probeProductReleaseSources`/internal `scanMarketSignals`+`scanProductSignals`/`scanCompetitorUpdates` (8627–9203) → `modules/competitors/agents/`. `formatCompetitorProfilesForPrompt` (688–815) only if a taken function needs it — check at port time, else leave | ~1,600 of 26,949 |
| `agentExecutionLogger.ts` (211) | **TAKE** | `trackAgentExecution` + `AgentSlugs` (competitor entries; add others per sprint) → `lib/agents/` | ~210 |
| `agentSeeder.ts` (2,841) | **TAKE-PARTIAL** | Definitions/prompts for the 3 sprint-2 slugs (`competitor-summary-agent`, `competitor-features-agent`, `competitor-updates-agent`) → `lib/agents/seed.ts`, idempotent upsert at boot. Later sprints append | ~300 |
| `progressEvents.ts` (75) | **TAKE** | Whole → `lib/progress.ts` (taken agents emit into it; §6 exposes it via the active-run poll) | ~75 |
| `storage.ts` (5,805) | **TAKE-PARTIAL** | The §3 carve list, verbatim bodies → `modules/*/storage.ts`, `lib/agents/executions.ts` | ~350 |
| `scheduler.ts` (8,335) | **TAKE-PARTIAL** | `getAudienceFrequency`/`computeDefaultSchedules` (26–76, trimmed to competitor keys), `frequencyToMs`/`passesFrequencyGate`/`shouldRunAgentNow`/`shouldRunSchedule` + circuit breaker (2246–2412, **minus** `passesLoginGate` — see §7), the *logic* of the competitorUpdates/Features sections (2510–2779) re-expressed as registry entries, `runInitialCompetitorAnalysis` (7325–7935) reduced to the summary+features orchestration in `modules/competitors/service.ts`. **Leave:** everything else (feedback pipeline, digests, Slack, billing sweeps, e2e runners, MCP syncs — later sprints or cut) | ~600 |
| `routes.ts` (46,316) | **TAKE-PARTIAL** (bodies only, reshaped) | Handler logic from: GET `competitor-profiles` (7865), GET `…/:competitorName` (8086), POST `add-competitor` (11738), POST `…/refresh` (8318), DELETE (8969), PATCH `threat-level` (8885), PATCH `category` (8930), GET `competitor-changes` (7831), GET `active-job` (7971 + `findActiveExecutionForCompetitor` 7919). Rewritten against profile-canonical ids (§3) and `req.ctx` | ~450 |
| `reviewSearch.ts` (632), `reviewService.ts` (224), `g2Api.ts` (479) | **LEAVE (defer)** | Sprint 3 with reviews; §1 reasoning. Nothing in the sprint-2 slice imports them | 0 |
| `segmentNormalization.ts` (314) | **LEAVE (defer)** | Only `mergeDifferentiators` is touched by the summary save path — inline a ~15-line copy in `service.ts` with a `TODO(sprint-3)` to re-home when the file ports for Customers | ~15 |
| `db.ts`, `customAuth.ts`, `stripeClient.ts`, `billingRoutes.ts`, `region.ts`, `resendClient.ts`, `slackBot.ts`, `objectStorage.ts`/`objectAcl.ts`, `langfuse.ts`, `llmCredits.ts`, `vite.ts`, `replit_integrations/` | **LEAVE** | Replaced by the seam / cut modules / later seams | 0 |

Total new-repo landing: roughly **7,100 lines ported + ~1,200 new** (bootstrap, registry, schemas, catch-up, tests) — against ~90,000 lines of source surveyed. The engineer's job per row is mechanical: copy the named range, fix imports to `lib/`, run `tsc` (strict — the new repo gates on zero errors), add the Zod schema at the boundary.

---

## 6. API surface (sprint 2)

All routes org-scoped via `req.ctx` (never from the URL); all ids are `competitor_profiles.id`. Shapes align with `client/src/mock/types.ts` where the mock is right, and deviate where the mock invented data we don't have yet (noted).

```
GET    /api/competitors
→ 200 { competitors: CompetitorCard[] }

CompetitorCard {
  id: string
  name: string
  classification: "DIRECT" | "ADJACENT"        // mapped from sourceCategory; see note below
  domain: string | null                        // derived from competitorUrl
  summary: string | null                       // description
  threatLevel: "none" | "watch" | "competitive" | "big_threat"
  enrichmentStatus: "pending" | "enriching" | "completed" | "failed"
  lastVerifiedAt: string | null                // ISO; client renders "verified 2h ago" — never format dates server-side
  sentiment: number | null                     // null until reviews sprint; block stays unrendered
  reviewCount: number | null                   // ditto
}

POST   /api/competitors        { name: string, url?: string, classification: "DIRECT" | "ADJACENT" }
→ 201 { competitor: CompetitorCard }           // profile row created enrichmentStatus:"pending";
                                               // enrichment (summary→features) starts in background
→ 409 { error }                                // duplicate name (case-insensitive), replacing SaaS 400

GET    /api/competitors/:id
→ 200 {
  competitor: CompetitorCard & {
    keyDifferentiators: { text: string, sourceUrl: string | null }[]
    keyFeatures:        { feature: string, sourceUrl: string | null }[]
    markets:            { market: string, sourceUrl: string | null }[]
    summarySourceUrl: string | null            // descriptionSourceUrl — provenance is first-class in the payload
  }
  changes: CompetitorChange[]                  // most recent 20
  openThread: null                             // DeepDiveThread — strategy sprint; shape reserved per mock/types.ts
  filedThreads: []
}

CompetitorChange {
  id: string
  changeType: "feature" | "pricing" | "news" | "announcement" | string
  title: string, description: string
  sourceUrl: string | null                     // evidence-cited, always
  detectedAt: string                           // ISO
}

POST   /api/competitors/:id/refresh
→ 202 { runId: string }                        // re-runs summary + features + updates scan for this competitor
→ 409 { error, activeRun }                     // a competitor-agent run is already active (from ai_agent_executions)

DELETE /api/competitors/:id                    → 204
PATCH  /api/competitors/:id                    { classification? , threatLevel? , url? }
→ 200 { competitor: CompetitorCard }           // threatLevel change also writes competitor_threat_level_history

GET    /api/competitors/runs/active
→ 200 { active: false } | { active: true, competitorId, competitorName, agentLabel, startedAt }
       // port of findActiveExecutionForCompetitor incl. the 2h stale-run threshold; client polls while enriching

GET    /api/changes?limit&offset               // product-wide change feed (Home briefing feeds from this later)
→ 200 { changes: CompetitorChange[], total }
```

Notes and deliberate deviations:

- **`ASPIRATIONAL` (mock) has no source of truth** — SaaS `sourceCategory` is `competitor | adjacent` (+`own_product`). Sprint 2 ships two classifications; extending the enum is a schema decision for the strategy sprint if wanted (open question 6, §8). Do not invent a third value the pipeline can't populate.
- **`theyBeatYouOn` / `youBeatThemOn` (mock)** are a *view* over `keyDifferentiators` + (later) `featureStrengthSummary`. Sprint 2 serves `keyDifferentiators` with provenance and the client renders it under one heading; the beats-you split arrives with the reviews/features-comparison sprint. The mock types file should be annotated accordingly when the client is wired.
- Every enrichment write goes through `modules/competitors/schemas.ts` Zod parsing first (agent JSON → schema → merge-don't-replace update). Reject-and-log on parse failure; never store unvalidated LLM output. This is new code the SaaS lacks in places — it is the brief's §10 constraint and part of the pattern.

---

## 7. Scheduler and catch-up-on-launch

### What ports and what changes

Per-agent last-run tracking **already lives in the database** (`ai_agent_executions` via `getLastExecutionForAgentAndProduct`) — this is exactly what a desktop app that is frequently closed needs, so the gates port as-is:

- **Frequency gate** (any-status last execution — keeps the retry-storm fix): port.
- **Circuit breaker** (3 consecutive failures → suppress 2× frequency): port.
- **Time-of-day gate** for daily+ cadences: port, but it becomes advisory (see catch-up).
- **Login gate** (`passesLoginGate`): **delete.** Its job was "don't burn LLM money for orgs nobody looks at" — on desktop, the scheduler only runs while the app is open, which *is* the login. The catch-up pass supersedes it.

### Registry pattern (new, small — the bit later modules plug into)

```ts
// server/scheduler/registry.ts
export interface ScheduledAgent {
  slug: string;                        // AgentSlugs value; execution tracking key
  scheduleKey: string;                 // key in products.agentSchedules jsonb (e.g. "competitorUpdates")
  defaultSchedule(product: Product): AgentSchedule;   // from defaults.ts
  run(product: Product): Promise<unknown>;            // wrapped in trackAgentExecution by the tick
}
export function registerScheduledAgent(agent: ScheduledAgent): void;
```

`modules/competitors/index.ts` registers three agents (summary-refresh folds into updates for scheduling purposes; updates + features are the scheduled pair, matching SaaS `schedules.competitorUpdates` / `schedules.competitorFeatures`). The tick (ported minute loop) iterates products × registered agents through `shouldRunAgentNow`. This replaces the 1,000-line if-chain in `runProductScheduledAgents` and is how Customers/Strategy/Roadmap add agents without touching scheduler code.

### Catch-up on launch (`scheduler/catchUp.ts`)

Concrete semantics of the brief's "catch up on launch if overdue":

1. Runs once per process start, **45 s after boot** (footer shows "Agents catching up…"; instant-launch feel preserved; a user quitting immediately loses nothing — next launch catches up).
2. For each product × registered agent where `enabled && (now − lastExecution.startedAt) ≥ frequencyMs` (or no execution ever): run it **now, ignoring the time-of-day gate**. TimeOfDay only shapes steady-state runs while the app stays open.
3. **Missed intervals collapse to one run.** An app closed for 3 weeks with a weekly scan does *not* run 3 scans — the agents re-derive current state and diff against stored state; they are not tick-accumulators. (The gap in `competitor_changes` is honest: nothing was observed while closed. Freshness accounting per brief §10a.3, not fake backfill.)
4. Ordering: catch-up runs **sequentially by module priority** (competitors first in sprint 2), and within a module through `runAgentBatch` with concurrency 3 — the ported batch runner exists precisely to prevent the relaunch-after-holiday 429 stampede. PGlite's serial single connection (ADR 001 §2) reinforces the rule: agents write in short transactions, never wrap a run in one.
5. Circuit breaker applies during catch-up too (an agent that failed 3× before quit must not greet the user with the same failure on every launch).
6. Steady-state: the minute tick starts immediately at boot but the catch-up pass holds a mutex, so tick-triggered runs can't overlap catch-up for the same agent+product. In-flight guard is per agent+product (port of the `quickWinInFlight` idea, generalised into the registry).

Rejected: a persisted "next run at" queue table. The execution log already encodes it (`lastRun + frequency`), needs no compaction, and can't drift from reality.

---

## 8. Risks and open questions

| # | Risk / question | Recommended resolution |
|---|---|---|
| 1 | **Profile-canonical vs `products.competitors` jsonb** (§3) is a real behavioural divergence — some ported functions (e.g. `enrichSingleCompetitor`, discovery agents in later sprints) read/write the jsonb shape. | Hold the line: the projection helper (`profilesToCompetitorArray()`) feeds ported functions read-only; any ported code that *writes* the jsonb is rewritten to write the profile row instead, at port time. Document in the module README so sprint 3+ porters don't regress it. |
| 2 | **`gemini.ts` gravity.** Every extracted function tempts the porter to "just copy the helper too", and the helpers chain back into the monolith. | The §5 map is the allowlist. CI greps the new repo for `from "./gemini"`-style imports and for banned symbols (`chatWith*`, `finalize*`, battlecard functions). Anything not on the map needs an ADR note, not a copy. Also enforces brief §10a: no chat/generation features ride in. |
| 3 | **Agent output drift vs new Zod schemas** — SaaS prompts sometimes return shapes the SaaS code tolerated loosely; strict parsing will surface real-world failures. | Schemas start permissive-but-typed (`.nullish()` where the SaaS tolerated absence), tighten later; every parse failure logs the raw payload to the agent execution row (`errorMessage`) so drift is visible in the run history, not silent. |
| 4 | **Single-key routing regressions** — desktop's common case (one key) is the SaaS's rare case; fallback-empty paths are undertested upstream. | The §4 test matrix (each provider alone × search/analysis) runs in CI. Onboarding later warns which capabilities need web search when only Claude is configured (Claude path has no web-search fallback in `getFallbackProviders`). |
| 5 | **`fetchViaJina` dependency** (`r.jina.ai`) — free third-party fetch proxy in the sprint-2 path via URL validation; rate limits/outages degrade enrichment. | Acceptable for v1 (outbound-only, no data stored there beyond fetched public pages — note it in the privacy docs since "data stays local" is the pitch). Wrap in `lib/web/fetch.ts` so a native-fetch fallback can be added without touching agents. |
| 6 | **Mock's `ASPIRATIONAL` classification and beats-you lists** have no pipeline behind them (§6). | Client renders two classifications and a single differentiators block in sprint 2; revisit both when the comparison view sprint defines the feature-strength pipeline. Update `mock/types.ts` comments when wiring. |
| 7 | **Scheduler while laptop lid closes mid-run** — an execution stuck in `running` blocks the frequency gate's honesty and the active-run endpoint. | Port `resetStaleEnrichingProfiles` (scheduler.ts:4033) generalised: at boot, mark `running` executions older than 2 h as `failed (interrupted)` before catch-up computes gates. The 2 h stale threshold in the active-run poll (routes.ts:7905) already assumes this. |
| 8 | **Desktop schema still carries battlecard columns** (`battlecardMessages/ReadyFlag/Output` on `competitor_profiles`) though battlecards are CUT — an ADR 001 §4 strip-list miss now baked into `0000_baseline.sql`. | Flagging rather than silently overriding ADR 001: recommend dropping the three columns via a follow-up migration (or regenerating the baseline while zero installs exist — cheaper now than ever again). Decision belongs to the schema owner; sprint 2 must not write these columns either way. |
| 9 | **`secret.key` + DB in the same backup/snapshot** means exported snapshots contain decryptable LLM keys. | Snapshot/export (storage-seam ADR) must exclude `secret.key` and either strip the encrypted key columns or re-wrap them with an export passphrase. Note carried forward to that ADR; not a sprint-2 blocker since export doesn't exist yet. |
| 10 | **Pattern lock-in risk**: sprint 2 choices (registry, carving, module layout) will be cargo-culted by every later sprint — including any mistakes. | That is the point of this ADR; treat the sprint-2 PR review as an architecture review. The Customers port (sprint 3) should require *zero* new infrastructure files — if it doesn't, the pattern failed and we fix it then, before Strategy and Roadmap multiply it. |

---

### Summary of decisions

1. Sprint 2 ships the full slice add → research (summary + features) → provenance-stored profile → serve → refresh-detects-change (updates scan + `competitor_changes`); G2, reviews, pricing, integrations, discovery, comparisons all explicitly deferred with destinations.
2. Minimal Express bootstrap: `buildApp()` + per-module `register*Routes`, `localIdentity` middleware as the auth seam injecting the seeded org/user ids, central error middleware, `127.0.0.1:7317`, vite proxy + `apiUrl()` as the API-base-URL seam.
3. `server/modules/<name>/` verticals over a domain-free `server/lib/`; storage carved per module with verbatim method bodies instead of porting the 5,800-line class; `competitor_profiles` becomes the single source of truth with stable-ID routes (dual-write jsonb path deliberately not ported).
4. LLM keys: encrypted columns on the local org row, AES-GCM format unchanged, key material from a per-install `secret.key` (0600) behind `lib/secrets.ts`, upgraded to OS keychain when the shell lands; router ports with platform-key, budget, and Langfuse paths deleted; single-key fallback behaviour verified by a CI matrix.
5. Extraction is an allowlist (§5 map, ~7k lines of ~90k surveyed), CI-enforced against `gemini.ts` gravity and forbidden generation features.
6. Scheduler becomes a registry modules plug into; gates port minus the login gate; catch-up-on-launch = delayed single pass, overdue-collapse-to-one-run, timeOfDay ignored, batch-limited, circuit-breaker-respecting.

---

## 9. Addendum — review-before-save gate (proposed → tracked lifecycle)

**Decision (owner, 3 Aug 2026):** competitors must be confirmed by the user before they are tracked. The spec's review-before-save gate (competitors-module-spec §2.4 — "nothing is saved until 'Track'") gets a server implementation; the write-governance rule (human-accepted, everywhere) now applies to competitor creation itself.

**Schema:** `competitor_profiles.status` (text, NOT NULL, DEFAULT `'tracked'`; values `proposed | tracked`). The tracked default keeps baseline seeds and future imports sane; the API sets `proposed` explicitly on create. `0000_baseline.sql` was regenerated in place — the zero-installs baseline rewrite window (risk 8 ruling) was still open; the header comment records both rewrites. Table count is unchanged (44): this is a column, not a table.

**Contract (fixed — the client wires against exactly this):**

- `POST /api/competitors` → 201, creates with `status: "proposed"`; background enrichment runs exactly as before and populates the draft profile.
- `GET /api/competitors` returns only tracked rows by default; `?include=proposed` adds proposed rows. Every card now carries `status` so the client can distinguish.
- `POST /api/competitors/:id/accept` → 200 `{competitor}` — flips proposed → tracked. Succeeds regardless of `enrichmentStatus` (failed enrichment = the spec's save-unverified path). Accepting an already-tracked competitor is a no-op 200.
- `DELETE /api/competitors/:id` on a **proposed** row discards it completely — profile, draft `competitor_changes` rows, and any threat-level history. A proposal that was never accepted leaves no history. DELETE on **tracked** rows keeps its existing behaviour (change history retained for attribution).
- `GET /api/competitors/:id` works for proposed rows (the add-flow proposal card reads the draft from it, including its draft changes).
- `GET /api/changes` never includes changes from proposed competitors (exclusion is by competitor name — `competitor_changes` carries no profile FK).
- `PATCH /api/competitors/:id` accepts an optional `name` (the proposal card's inline-rename). Allowed ONLY while `status` is `proposed` — renaming a tracked competitor → 400 (deferred: change history is name-keyed, see the known edge below). Validation matches POST (non-empty, trimmed, max 200); a case-insensitive collision with another competitor of the product → 409, same as POST's duplicate handling. The rename and the update of the row's draft `competitor_changes` rows (name-keyed) happen in one transaction (`renameCompetitorProfile`), so a renamed proposal never orphans its draft changes from the discard-purge or the feed exclusion; threat-level history is renamed alongside for consistency.

**Scheduler:** proposed competitors are excluded from scheduled runs (`runUpdatesScan` when it fetches its own profile set, and `runFeaturesScanForProduct`). An explicitly-passed profile list (the single-competitor refresh path) is honoured as given.

**Known edge (accepted, name-keyed changes):** because change rows are keyed by `competitorName`, retained history from a previously deleted *tracked* competitor of the same name is (a) hidden from the feed while a same-name proposal exists and (b) deleted if that proposal is discarded. Duplicate live names are impossible (409 on create); resolving the historical-name collision properly means a profile FK on `competitor_changes`, deferred until a sprint needs it.
