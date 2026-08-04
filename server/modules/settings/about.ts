/**
 * About & your data (Settings spec §7, fixed API contract):
 *
 *   GET /api/settings/about → { dataDir, dbSizeBytes, appVersion, serverPort }
 *
 * dbSizeBytes is the on-disk size of the database directory
 * (`<dataDir>/db/`) — the same figure, same source of truth, as the footer's
 * "Local · 42 MB on disk" segment. In-memory databases (tests) report 0.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataDir, resolveDbDir } from "../../db/dataDir.js";
import { resolveServerPort } from "../../http/serverPort.js";

export interface AboutInfo {
  dataDir: string;
  dbSizeBytes: number;
  appVersion: string;
  serverPort: number;
}

/** Recursive directory size; a missing directory is honestly 0 bytes. */
export async function directorySizeBytes(dir: string): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySizeBytes(entryPath);
    } else if (entry.isFile()) {
      try {
        total += (await fs.stat(entryPath)).size;
      } catch {
        // Removed between readdir and stat — skip.
      }
    }
  }
  return total;
}

let cachedVersion: string | null = null;

/**
 * The version from package.json, located by walking up from this module so
 * the lookup survives both tsx (source layout) and a bundled build.
 */
export async function readAppVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    try {
      const raw = await fs.readFile(path.join(dir, "package.json"), "utf8");
      const version = (JSON.parse(raw) as { version?: unknown }).version;
      if (typeof version === "string" && version) {
        cachedVersion = version;
        return version;
      }
    } catch {
      // No package.json at this level — keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.0.0";
}

export async function getAboutInfo(): Promise<AboutInfo> {
  const dataDir = resolveDataDir();
  const dbDir = resolveDbDir(dataDir);
  return {
    dataDir,
    dbSizeBytes: dbDir.startsWith("memory://") ? 0 : await directorySizeBytes(dbDir),
    appVersion: await readAppVersion(),
    serverPort: resolveServerPort(),
  };
}
