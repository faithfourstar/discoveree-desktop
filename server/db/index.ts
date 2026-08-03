/**
 * The database seam (ADR 001 §1).
 *
 * Initialisation is an explicit call — no top-level await, no import-time
 * side effects. Entry points resolve their own config (data dir, connection
 * string) and MUST hold the writer lock (lock.ts) before calling
 * `initDatabase()` with a persistent PGlite directory.
 *
 * `pool` is deliberately NOT exported. Raw SQL goes through
 * `db.execute(sql\`...\`)`, which works on both drivers.
 */
import type { Db } from "./types.js";
import type { DatabaseProvider, DbConfig } from "./provider.js";
import { createPgliteProvider } from "./pglite.js";
import { createPostgresProvider } from "./postgres.js";
import { seedLocalData } from "./seedLocal.js";

let provider: DatabaseProvider | null = null;

/**
 * Construct the provider for `config`, apply bundled migrations, and (in
 * desktop solo mode) seed the fixed local organisation/user rows. A failed
 * migration aborts startup — the process must never run against a
 * half-migrated schema.
 */
export async function initDatabase(config: DbConfig): Promise<void> {
  if (provider) {
    throw new Error("initDatabase() called while a database is already initialised — call closeDatabase() first.");
  }
  const next =
    config.target === "pglite"
      ? createPgliteProvider(config.dataDir)
      : createPostgresProvider(config.connectionString);
  try {
    await next.migrate();
    if (config.target === "pglite") {
      // Team mode has real organisations/users (auth seam); the fixed local
      // rows are a desktop-solo concept only.
      await seedLocalData(next.db);
    }
  } catch (err) {
    await next.close().catch(() => {});
    throw err;
  }
  provider = next;
}

/** Preferred accessor for new code. Throws until initDatabase() has run. */
export function getDb(): Db {
  if (!provider) {
    throw new Error("Database not initialised — call initDatabase() before using getDb() or db.");
  }
  return provider.db;
}

/** Diagnostics only (logging); never branch app behaviour on this. */
export function getDatabaseKind(): "pglite" | "postgres" {
  if (!provider) {
    throw new Error("Database not initialised — call initDatabase() first.");
  }
  return provider.kind;
}

/**
 * Port-compatibility export: the SaaS storage layer imports `{ db }` at
 * module level. This lazy proxy delegates every access to the initialised
 * provider so those imports port intact. New code should prefer `getDb()`.
 */
export const db: Db = new Proxy(Object.create(null) as Db, {
  get(_target, prop, _receiver) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
  has(_target, prop) {
    return prop in (getDb() as object);
  },
});

/** Flush + release. Idempotent — safe to call on every shutdown path. */
export async function closeDatabase(): Promise<void> {
  const current = provider;
  provider = null;
  if (current) {
    await current.close();
  }
}

export { execRows } from "./exec.js";
export type { Db } from "./types.js";
export type { DatabaseProvider, DbConfig } from "./provider.js";
