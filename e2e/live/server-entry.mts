/**
 * Boot the real desktop server against a scratch data directory for the e2e
 * live project. Runs BEFORE Playwright's health check passes, so cleanup of
 * the previous run's directory happens here (Playwright starts webServers
 * before globalSetup, so a config-level teardown could not do this safely).
 *
 * The directory is fixed (e2e/.tmp/live-data), wiped on every start, and
 * gitignored — this script touches nothing outside e2e/.tmp/.
 */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../.tmp/live-data");

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

process.env["DISCOVEREE_DATA_DIR"] = dataDir;
process.env["DISCOVEREE_PORT"] = process.env["DISCOVEREE_PORT"] || "7411";

console.log(`[e2e] Live server starting — data dir ${dataDir}, port ${process.env["DISCOVEREE_PORT"]}`);

// main.ts runs its startup sequence on import (desktop entry point).
await import("../../server/main.js");
