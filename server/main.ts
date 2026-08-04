/**
 * Desktop-solo entry point (ADR 002 §2) — the ONLY file that knows it is
 * desktop. Startup sequence:
 *
 * 1. resolveDataDir()               (ADR 001)
 * 2. acquireWriterLock()            (lock.ts — carries the port for the CLI)
 * 3. configureSecrets(dataDir)      (per-install secret.key)
 * 4. initDatabase({ pglite })       (migrate + seed local org/user)
 * 5. seedAgents()                   (idempotent ai_agents upsert)
 * 6. registerCompetitorAgents()     (scheduler registry)
 * 7. buildApp() → listen 127.0.0.1  (one port for API now + local MCP later)
 * 8. startScheduler()               (minute tick)
 * 9. scheduleCatchUpPass({45s})     (overdue agents collapse to one run)
 *
 * Shutdown mirrors ADR 001 §2: stop scheduler → close server → close DB →
 * release lock.
 */
import type { Server } from "node:http";
import { resolveDataDir } from "./db/dataDir.js";
import { acquireWriterLock, type WriterLockHandle } from "./db/lock.js";
import { closeDatabase, initDatabase } from "./db/index.js";
import { configureSecrets } from "./lib/secrets.js";
import { seedAgents } from "./lib/agents/seed.js";
import { registerCompetitorAgents } from "./modules/competitors/index.js";
import { buildApp } from "./app.js";
import { startScheduler, stopScheduler } from "./scheduler/index.js";
import { cancelCatchUpPass, scheduleCatchUpPass } from "./scheduler/catchUp.js";
import { resolveServerPort } from "./http/serverPort.js";

/**
 * One port serves the API now and localhost HTTP MCP later (resolution
 * shared with the Settings about block via http/serverPort.ts).
 * Bind 127.0.0.1 ONLY; rung-1 team read-sharing opts into LAN exposure
 * explicitly, later.
 */
const PORT = resolveServerPort();
const HOST = "127.0.0.1";

async function main(): Promise<void> {
  const dataDir = resolveDataDir();

  const lockResult = await acquireWriterLock(dataDir, { mcpPort: PORT });
  if (!lockResult.acquired) {
    console.error(
      `Another Discoveree process (pid ${lockResult.holder.pid}) already owns the database at ${dataDir}. ` +
      "Close it before starting a second instance.",
    );
    process.exit(1);
  }
  const lock: WriterLockHandle = lockResult.handle;

  let server: Server | null = null;
  let shuttingDown = false;

  async function shutdown(code = 0): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    cancelCatchUpPass();
    stopScheduler();
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    await closeDatabase().catch(() => {});
    await lock.release().catch(() => {});
    process.exit(code);
  }

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  try {
    configureSecrets(dataDir);
    await initDatabase({ target: "pglite", dataDir });
    await seedAgents();
    registerCompetitorAgents();

    const app = buildApp();
    server = app.listen(PORT, HOST, () => {
      console.log(`[Discoveree] API listening on http://${HOST}:${PORT}`);
    });

    startScheduler();
    scheduleCatchUpPass({ delayMs: 45_000 });
  } catch (err) {
    console.error("[Discoveree] Startup failed:", err);
    await shutdown(1);
  }
}

void main();
