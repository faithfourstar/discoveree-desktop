import type { Db } from "./types.js";

/**
 * The database seam (ADR 001 §1). Two concrete implementations exist:
 * `createPgliteProvider()` (desktop solo mode) and `createPostgresProvider()`
 * (team mode). One is selected at process start by the deployment entry point.
 */
export interface DatabaseProvider {
  /** For logging/diagnostics only — never for branching in app code. */
  readonly kind: "pglite" | "postgres";
  readonly db: Db;
  /** Apply the bundled migrations (ADR 001 §3). Idempotent. */
  migrate(): Promise<void>;
  /** Flush + release; must be safe to call twice. */
  close(): Promise<void>;
}

/**
 * Resolved by the deployment entry point (desktop shell, headless CLI, or
 * team server bootstrap) — never read from `process.env` deep inside the seam.
 */
export type DbConfig =
  | { target: "pglite"; dataDir: string }
  | { target: "postgres"; connectionString: string };
