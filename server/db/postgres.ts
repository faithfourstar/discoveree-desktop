/**
 * Team-mode provider: real Postgres over TCP via `pg` (node-postgres).
 * Works for self-hosted Docker Postgres and hosted providers including
 * Neon-over-TCP. Same migration folder as the PGlite provider — one schema
 * history for both deployments (ADR 001 §5).
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "@shared/schema";
import type { DatabaseProvider } from "./provider.js";
import { resolveMigrationsFolder } from "./migrate.js";

export interface PostgresProvider extends DatabaseProvider {
  readonly kind: "postgres";
  /**
   * Deployment-specific wiring only (e.g. the team bootstrap's
   * connect-pg-simple session store). Exposed on PostgresProvider, NOT on
   * DatabaseProvider — it must never be reachable through the seam.
   */
  readonly pool: pg.Pool;
}

export function createPostgresProvider(connectionString: string): PostgresProvider {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  let closed = false;
  return {
    kind: "postgres",
    db,
    pool,
    async migrate(): Promise<void> {
      await migrate(db, { migrationsFolder: resolveMigrationsFolder() });
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
