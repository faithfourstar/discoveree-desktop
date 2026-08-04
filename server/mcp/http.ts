/**
 * The localhost HTTP MCP endpoint (ADR 005 §1.5) — stateless Streamable HTTP,
 * one server+transport per request (`sessionIdGenerator: undefined`); the
 * SaaS routes.ts:35226–35283 pattern with DNS-rebinding protection ON.
 * Statelessness is load-bearing: it keeps the stdio⇄HTTP proxy a dumb bridge
 * and makes app takeover/restart invisible to consumers.
 *
 * BAN (ADR 005 §3.6, CI-greppable): server/mcp/ never imports server/lib/llm/.
 */
import type { Express, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { asyncHandler } from "../http/asyncHandler.js";
import { resolveServerPort } from "../http/serverPort.js";
import { buildMcpServer } from "./server.js";

export interface MountMcpOptions {
  /**
   * Host headers accepted by the DNS-rebinding protection (exact host:port
   * match per the SDK). A thunk is evaluated per request — the headless CLI
   * only knows its bound port after listening. `false` disables protection
   * (test-only; never in production paths).
   */
  allowedHosts?: string[] | (() => string[]) | false;
}

function defaultAllowedHosts(): string[] {
  const port = resolveServerPort();
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

export function mountMcp(app: Express, options: MountMcpOptions = {}): void {
  const handle = asyncHandler(async (req: Request, res: Response) => {
    // Stateless: fresh server + transport per request; no session to lose.
    const server = buildMcpServer({ organizationId: req.ctx.organizationId });
    const allowed = options.allowedHosts === false
      ? false
      : typeof options.allowedHosts === "function"
        ? options.allowedHosts()
        : options.allowedHosts ?? defaultAllowedHosts();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      ...(allowed === false
        ? {}
        : {
            enableDnsRebindingProtection: true,
            allowedHosts: allowed,
          }),
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // POST carries JSON-RPC; GET/DELETE exist for protocol completeness — the
  // stateless transport answers them with the correct method-not-allowed
  // semantics itself.
  app.post("/mcp", handle);
  app.get("/mcp", handle);
  app.delete("/mcp", handle);
}
