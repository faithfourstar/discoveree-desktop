/**
 * `discoveree mcp serve` (ADR 005 §1.1) — the decision flow on the built lock
 * handshake:
 *
 *   acquireWriterLock(dataDir)
 *     ├─ held, holder.mcpPort set   → PROXY stdio ⇄ the holder's HTTP endpoint
 *     ├─ held, holder.mcpPort null  → retry ≤5 s, then proxy; else error honestly
 *     └─ acquired                   → HEADLESS: open PGlite (migrate + seed),
 *                                     serve stdio AND localhost HTTP,
 *                                     publish the port via setMcpPort
 *
 * The headless CLI NEVER starts the scheduler (§1.3): serving context is not
 * running agents. App preemption (§1.4): implemented as the ADR's accepted
 * FALLBACK — on SIGTERM the holder closes cleanly and exits with a clear
 * message (the AI client reconnects and the fresh spawn proxies to the app).
 * The resume-as-proxy refinement is deliberately not attempted in 5a: it
 * requires swapping a live stdio transport between server and bridge
 * mid-session, which is exactly the fiddly case the ADR said may fall back.
 */
import type { Server } from "node:http";
import { acquireWriterLock, readWriterLock, type WriterLockHandle } from "../db/lock.js";
import { resolveDataDir } from "../db/dataDir.js";
import { closeDatabase, initDatabase } from "../db/index.js";
import { configureSecrets } from "../lib/secrets.js";
import { resolveServerPort } from "../http/serverPort.js";
import { buildApp } from "../app.js";
import { buildMcpServer } from "../mcp/server.js";
import { runProxy } from "./proxy.js";

export type ServeDecision =
  | { mode: "headless" }
  | { mode: "proxy"; port: number }
  | { mode: "error"; message: string };

const HOLDER_PORT_WAIT_MS = 5_000;
const HOLDER_PORT_POLL_MS = 250;

/**
 * The §1.1 decision, separated from the transports so it is testable: try to
 * acquire; a live holder with a published port means proxy; a holder mid-
 * startup (no port yet) is polled briefly for the port it will publish.
 */
export async function decideServeMode(
  dataDir: string,
  options: { waitMs?: number; pollMs?: number } = {},
): Promise<{ decision: ServeDecision; handle: WriterLockHandle | null }> {
  const result = await acquireWriterLock(dataDir);
  if (result.acquired) {
    return { decision: { mode: "headless" }, handle: result.handle };
  }

  if (result.holder.mcpPort !== null) {
    return { decision: { mode: "proxy", port: result.holder.mcpPort }, handle: null };
  }

  // Another process is mid-startup: wait briefly for the port it publishes.
  const waitMs = options.waitMs ?? HOLDER_PORT_WAIT_MS;
  const pollMs = options.pollMs ?? HOLDER_PORT_POLL_MS;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollMs));
    const current = await readWriterLock(dataDir);
    if (!current) {
      // Holder went away — try to become the holder ourselves.
      const retry = await acquireWriterLock(dataDir);
      if (retry.acquired) return { decision: { mode: "headless" }, handle: retry.handle };
      if (retry.holder.mcpPort !== null) return { decision: { mode: "proxy", port: retry.holder.mcpPort }, handle: null };
      continue;
    }
    if (current.mcpPort !== null) {
      return { decision: { mode: "proxy", port: current.mcpPort }, handle: null };
    }
  }
  return {
    decision: {
      mode: "error",
      message:
        `Another Discoveree process holds the database at ${dataDir} but has not published an MCP port ` +
        `within ${Math.round(waitMs / 1000)} seconds. If it is stuck, close it and try again.`,
    },
    handle: null,
  };
}

export interface McpServeOptions {
  productPin?: string | null;
  dataDirOverride?: string | null;
}

export async function mcpServe(options: McpServeOptions = {}): Promise<void> {
  if (options.dataDirOverride) {
    // Maps onto the existing DISCOVEREE_DATA_DIR resolution — one path
    // routine (ADR 001 §2), no second resolver.
    process.env["DISCOVEREE_DATA_DIR"] = options.dataDirOverride;
  }
  const dataDir = resolveDataDir();
  const productPin = options.productPin ?? null;

  // An AI client that quits abruptly closes our stdout — that is a normal
  // disconnect, not a crash. Headless mode swaps in a clean shutdown (DB
  // close + lock release) below.
  let onStdoutGone: () => void = () => process.exit(0);
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") onStdoutGone();
    else throw err;
  });

  const { decision, handle } = await decideServeMode(dataDir);

  if (decision.mode === "error") {
    console.error(`[discoveree mcp] ${decision.message}`);
    process.exit(1);
  }

  if (decision.mode === "proxy") {
    console.error(`[discoveree mcp] Proxying to the running Discoveree instance on port ${decision.port}.`);
    await runProxyWithReconnect(dataDir, decision.port, productPin);
    process.exit(0);
  }

  // HEADLESS: this process is the single writer while it holds the lock.
  const lock = handle!;
  let httpServer: Server | null = null;
  let shuttingDown = false;

  async function shutdown(code: number, reason: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[discoveree mcp] ${reason}`);
    if (httpServer) await new Promise<void>(resolve => httpServer!.close(() => resolve()));
    await closeDatabase().catch(() => {});
    await lock.release().catch(() => {});
    process.exit(code);
  }

  // App preemption (§1.4 fallback): the app SIGTERMs the holder; close
  // cleanly and exit with a clear message — the AI client's reconnect spawns
  // a fresh CLI that proxies to the app.
  process.on("SIGTERM", () => void shutdown(0, "Discoveree app is starting and taking over the database — this MCP session is ending; reconnect and it will be served by the app."));
  process.on("SIGINT", () => void shutdown(0, "Stopped."));
  onStdoutGone = () => void shutdown(0, "MCP client closed the connection — releasing the database.");

  try {
    configureSecrets(dataDir);
    // A failed migration must exit with a clear stdio error, never serve a
    // half-migrated schema (ADR 005 risk 3).
    await initDatabase({ target: "pglite", dataDir });
  } catch (err) {
    await lock.release().catch(() => {});
    console.error(`[discoveree mcp] Could not open the Discoveree database: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // First-holder-serves-HTTP (§1.4): siblings proxy to this port. The
  // rebinding allow-list is a thunk because the bound port is only known
  // after listen (ephemeral fallback).
  const preferredPort = resolveServerPort();
  let boundPort: number | null = null;
  const app = buildApp({
    mcpAllowedHosts: () => boundPort !== null
      ? [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`]
      : [`127.0.0.1:${preferredPort}`, `localhost:${preferredPort}`],
  });
  const port = await new Promise<number>((resolve) => {
    const tryListen = (candidate: number, fallbackEphemeral: boolean) => {
      const server = app.listen(candidate, "127.0.0.1", () => {
        httpServer = server;
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : candidate);
      });
      server.on("error", () => {
        if (fallbackEphemeral) tryListen(0, false);
        else resolve(-1);
      });
    };
    tryListen(preferredPort, true);
  });
  if (port > 0) {
    boundPort = port;
    await lock.setMcpPort(port);
    console.error(`[discoveree mcp] Headless: serving stdio and http://127.0.0.1:${port}/mcp`);
  } else {
    console.error("[discoveree mcp] Headless: serving stdio only (no HTTP port available).");
  }

  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const server = buildMcpServer({
    organizationId: (await import("../db/seedLocal.js")).LOCAL_ORGANIZATION_ID,
    productPin,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // The SDK transport does not watch stdin EOF — a client that closes the
  // pipe (rather than signalling) would otherwise leave us waiting forever.
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    process.stdin.once("end", () => resolve());
    process.stdin.once("close", () => resolve());
  });
  await shutdown(0, "MCP client disconnected — releasing the database.");
}

/** Proxy with the bounded reconnect flow (§1.4: holder exits under a sibling). */
async function runProxyWithReconnect(dataDir: string, initialPort: number, productPin: string | null): Promise<void> {
  let port = initialPort;
  let attempts = 0;
  const MAX_RECONNECTS = 3;
  for (;;) {
    let upstreamClosed = false;
    await runProxy({
      port,
      productPin,
      onUpstreamClosed: () => { upstreamClosed = true; },
    });
    if (!upstreamClosed || attempts >= MAX_RECONNECTS) return;
    attempts++;
    const { decision } = await decideServeMode(dataDir, { waitMs: 2000 });
    if (decision.mode === "proxy") {
      port = decision.port;
      continue;
    }
    // We could become the holder — but a live stdio session cannot be swapped
    // onto a fresh in-process server mid-stream in 5a; exit honestly and let
    // the client reconnect.
    console.error("[discoveree mcp] The instance this session was proxying to has gone away — reconnect to continue.");
    return;
  }
}
