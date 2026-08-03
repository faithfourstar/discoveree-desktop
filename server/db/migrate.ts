/**
 * Bundled-migrations folder resolution (ADR 001 §3).
 *
 * Migrations are generated at dev time (`npm run db:generate`), committed to
 * `shared/migrations/`, and applied idempotently on every launch via
 * drizzle's migrator (its `__drizzle_migrations` table records what has run).
 * A failed migration must abort startup — never boot against a half-migrated
 * schema.
 *
 * The folder is resolved relative to this module, NOT `process.cwd()`:
 * packaged apps (Electron extraResources / Tauri resource dir) and the
 * headless CLI both run with arbitrary working directories.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  // Running from source (tsx/vitest): server/db/ → ../../shared/migrations
  path.resolve(HERE, "../../shared/migrations"),
  // Running from a build output one level deeper (dist/server/db/)
  path.resolve(HERE, "../../../shared/migrations"),
];

export function resolveMigrationsFolder(): string {
  for (const candidate of CANDIDATES) {
    if (fs.existsSync(path.join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
  }
  throw new Error(
    `Could not locate the bundled migrations folder (looked in: ${CANDIDATES.join(", ")}). ` +
      "The shared/migrations directory must ship with the application.",
  );
}
