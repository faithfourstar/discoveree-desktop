/**
 * buildMcpServer (ADR 005 §1.1) — one McpServer from the declarative
 * registry, with the §2.8 instructions. Stateless-friendly: cheap to build
 * per request (in-app HTTP) or once (headless stdio).
 *
 * The wrapper is where cross-cutting behaviour lives: activity logging
 * (payloads never logged), deterministic tool errors, the reader-seat
 * refusal shape, and clientInfo capture for provenance.
 *
 * BAN (ADR 005 §3.6, CI-greppable): server/mcp/ never imports server/lib/llm/.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { recordMcpActivity } from "./activity.js";
import { ReaderSeatError, resolveMcpCaller, type McpCaller } from "./caller.js";
import { McpToolError } from "./payloads.js";
import { listToolDefs, type McpToolCtx } from "./registry.js";
// Importing the tool modules registers their defs (side-effect imports).
import "./tools/read.js";
import "./tools/write.js";

export const MCP_SERVER_NAME = "discoveree";
export const MCP_SERVER_VERSION = "0.1.0";

/** §2.8 — behaviour-shaping instructions most clients inject into context. */
export const MCP_INSTRUCTIONS = [
  "Discoveree is the system of record for this team's product context: competitors, customer segments, feedback and themes — structured, evidence-cited and freshness-stamped.",
  "In a fresh conversation, call get_context_health first to learn what context exists and how fresh it is.",
  "IDs are stable — cite them, and pass them back to other tools.",
  "Freshness stamps mean what they say: hedge on stale data rather than presenting it as current.",
  "Evidence status is honest: when Discoveree says there is no evidence for something, say so rather than inventing.",
  "When the user shares customer feedback or competitor intelligence, offer to log_feedback or propose_competitor_intel — with the user's stated attribution, never invented; \"unattributed\" is acceptable.",
  "Writes may be refused on reader seats — relay the refusal message verbatim rather than paraphrasing it away.",
].join(" ");

export interface BuildMcpServerOptions {
  organizationId: string;
  productPin?: string | null;
  /** Overridable for tests (forced-reader fixtures). */
  caller?: McpCaller;
}

export function buildMcpServer(options: BuildMcpServerOptions): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: MCP_INSTRUCTIONS },
  );

  const caller = options.caller ?? resolveMcpCaller();

  for (const def of listToolDefs()) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
        // readOnlyHint lets clients render gentler permission prompts for the
        // ten read tools; write tools are non-destructive additions/proposals.
        annotations: {
          title: def.title,
          readOnlyHint: def.category === "read",
          destructiveHint: false,
        },
      },
      (async (args: Record<string, unknown>) => {
        // clientInfo arrives with the initialize handshake; on stateless HTTP
        // tool calls it is absent (null) — recorded honestly either way.
        const clientInfo = server.server.getClientVersion();
        const ctx: McpToolCtx = {
          organizationId: options.organizationId,
          caller,
          productPin: options.productPin ?? null,
          client: clientInfo ? { name: clientInfo.name, version: clientInfo.version } : null,
        };

        let isError = false;
        try {
          const result = await def.handler(ctx, args ?? {});
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (err) {
          isError = true;
          if (err instanceof ReaderSeatError) {
            return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(err.toPayload()) }] };
          }
          if (err instanceof McpToolError) {
            return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(err.payload) }] };
          }
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[MCP] ${def.name} failed:`, message);
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify({ error: "tool_failed", message }) }],
          };
        } finally {
          // Activity only — payloads are never logged (§2.7).
          await recordMcpActivity({
            clientName: clientInfo?.name ?? null,
            clientVersion: clientInfo?.version ?? null,
            toolName: def.name,
            isError,
            keyId: caller.keyId,
          });
        }
      }) as Parameters<typeof server.registerTool>[2],
    );
  }

  return server;
}
