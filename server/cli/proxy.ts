/**
 * The stdio ⇄ Streamable-HTTP bridge (ADR 005 §1.5) — a TRANSPORT-level
 * bridge, not a tool mirror: both transports speak JSONRPCMessage; wire
 * `onmessage` of each to `send` of the other. Statelessness upstream means
 * there is no session bookkeeping here.
 *
 * The one place the bridge inspects payloads (§2.3): the --product pin
 * middleware injects/validates the `product` argument on tools/call requests
 * — a project-scoped connection must not quietly read a sibling product.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export interface ProxyOptions {
  port: number;
  productPin: string | null;
  /** Re-run the serve decision flow when the upstream holder goes away. */
  onUpstreamClosed: () => void;
}

interface ToolCallish {
  method?: string;
  id?: unknown;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

/**
 * Apply the --product pin to an outbound message (§2.3): inject the pin when
 * the parameter is absent; a mismatching explicit value is answered locally
 * with the deterministic `product_pinned` error, without reaching upstream.
 * Tool-call params are stable protocol surface, which is what makes this one
 * inspection tolerable.
 */
export function applyProductPin(
  message: JSONRPCMessage,
  pin: string,
): { forward: JSONRPCMessage } | { reject: JSONRPCMessage } {
  const call = message as ToolCallish;
  if (call.method !== "tools/call" || !call.params) return { forward: message };
  const args = { ...(call.params.arguments ?? {}) } as Record<string, unknown>;
  const requested = args["product"];
  if (requested !== undefined && requested !== pin) {
    return {
      reject: {
        jsonrpc: "2.0",
        id: (call.id ?? 0) as number | string,
        result: {
          isError: true,
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "product_pinned",
              message: `This connection is pinned to the product "${pin}" — it cannot read a sibling product. Omit the product parameter or pass "${pin}".`,
            }),
          }],
        },
      } as JSONRPCMessage,
    };
  }
  args["product"] = pin;
  return {
    forward: {
      ...(message as unknown as Record<string, unknown>),
      params: { ...call.params, arguments: args },
    } as unknown as JSONRPCMessage,
  };
}

/** Bridge stdio ⇄ the holder's localhost HTTP endpoint. Resolves when closed. */
export async function runProxy(options: ProxyOptions): Promise<void> {
  const stdio = new StdioServerTransport();
  const upstream = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${options.port}/mcp`),
  );

  stdio.onmessage = (message: JSONRPCMessage) => {
    if (options.productPin) {
      const pinned = applyProductPin(message, options.productPin);
      if ("reject" in pinned) {
        void stdio.send(pinned.reject);
        return;
      }
      void upstream.send(pinned.forward).catch(err => {
        console.error("[discoveree mcp] Upstream send failed:", err instanceof Error ? err.message : err);
        options.onUpstreamClosed();
      });
      return;
    }
    void upstream.send(message).catch(err => {
      console.error("[discoveree mcp] Upstream send failed:", err instanceof Error ? err.message : err);
      options.onUpstreamClosed();
    });
  };
  upstream.onmessage = (message: JSONRPCMessage) => {
    void stdio.send(message);
  };
  upstream.onclose = () => options.onUpstreamClosed();
  upstream.onerror = (err) => {
    console.error("[discoveree mcp] Upstream error:", err instanceof Error ? err.message : err);
  };

  await upstream.start();
  await stdio.start();

  // Keep running until stdio closes (the AI client quit us). The SDK
  // transport does not watch stdin EOF, so listen for it directly too.
  await new Promise<void>((resolve) => {
    stdio.onclose = () => resolve();
    process.stdin.once("end", () => resolve());
    process.stdin.once("close", () => resolve());
  });
  await upstream.close().catch(() => {});
}
