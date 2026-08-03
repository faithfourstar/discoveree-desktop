/**
 * Desktop solo-mode provider: embedded PGlite (ADR 001 §2).
 *
 * Callers MUST hold the writer lock (see lock.ts) before creating a provider
 * on a real data directory — two PGlite instances on the same directory can
 * corrupt it. The entry point owns lock acquisition; this module only opens
 * the database.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@shared/schema";
import type { DatabaseProvider } from "./provider.js";
import { resolveDbDir } from "./dataDir.js";
import { resolveMigrationsFolder } from "./migrate.js";

export interface PgliteProvider extends DatabaseProvider {
  readonly kind: "pglite";
  /** The underlying client — for seam-internal use and tests only. */
  readonly client: PGlite;
}

/**
 * @param dataDir The Discoveree app-data directory (the database lives in
 *   `<dataDir>/db/`), or the special `memory://` location for an in-memory
 *   database (tests).
 */
export function createPgliteProvider(dataDir: string): PgliteProvider {
  const location = resolveDbDir(dataDir);
  const client = new PGlite(location.startsWith("memory://") ? "memory://" : location);
  const db = drizzle(client, { schema });
  let closed = false;
  return {
    kind: "pglite",
    db,
    client,
    async migrate(): Promise<void> {
      await migrate(db, { migrationsFolder: resolveMigrationsFolder() });
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // PGlite close() flushes WAL to disk.
      await client.close();
    },
  };
}

/** Convenience for tests and the seam smoke test. */
export function createInMemoryPgliteProvider(): PgliteProvider {
  return createPgliteProvider("memory://");
}
