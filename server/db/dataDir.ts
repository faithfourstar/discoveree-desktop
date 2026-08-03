import path from "node:path";
import envPaths from "env-paths";

/**
 * Resolve the Discoveree application data directory.
 *
 * MUST stay plain Node (no Electron/Tauri APIs): the headless CLI
 * (`discoveree mcp serve`) resolves the *same* path with no shell present,
 * and divergence here means the CLI serves a different (empty) database than
 * the app — the worst silent failure this design can produce (ADR 001 §2).
 *
 * Resolution order:
 * 1. `DISCOVEREE_DATA_DIR` environment override.
 * 2. The platform app-data convention via `env-paths`
 *    (macOS: ~/Library/Application Support/Discoveree,
 *     Windows: %LOCALAPPDATA%\Discoveree\Data,
 *     Linux: $XDG_DATA_HOME/Discoveree or ~/.local/share/Discoveree).
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["DISCOVEREE_DATA_DIR"];
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  return envPaths("Discoveree", { suffix: "" }).data;
}

/**
 * The PGlite data directory lives at `<dataDir>/db/`. Blob storage (the GCS
 * replacement) will live beside it at `<dataDir>/objects/` (separate seam).
 * The special `memory://` location (in-memory PGlite, used by tests) is
 * passed through untouched.
 */
export function resolveDbDir(dataDir: string): string {
  if (dataDir.startsWith("memory://")) return dataDir;
  return path.join(dataDir, "db");
}
