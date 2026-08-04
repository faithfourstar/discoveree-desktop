/**
 * The declarative tool registry (ADR 005 §6.1) — single source for server
 * registration, the docs/introspection surface, and (5b) reader-seat
 * filtering. Replaces the SaaS `_registeredTools` private-API reflection:
 * category is a field, so the "sync test" is unnecessary by construction.
 *
 * BAN (ADR 005 §3.6, CI-greppable): server/mcp/ never imports server/lib/llm/.
 */
import type { ZodRawShape } from "zod/v4";
import type { McpCaller } from "./caller.js";

export interface McpToolCtx {
  organizationId: string;
  caller: McpCaller;
  /** CLI --product pin (slug or id); null when unpinned (ADR 003 §1.2). */
  productPin: string | null;
  /** From the initialize handshake's clientInfo; null when unknown. */
  client: { name: string; version: string } | null;
}

export interface ToolDef {
  name: string;
  description: string;
  category: "read" | "write";
  /** Zod raw shape — the SDK derives the JSON schema from it. */
  inputSchema: ZodRawShape;
  handler(ctx: McpToolCtx, args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

const tools: ToolDef[] = [];

export function registerToolDef(def: ToolDef): void {
  if (tools.some(t => t.name === def.name)) return; // idempotent across test re-imports
  tools.push(def);
}

export function listToolDefs(): readonly ToolDef[] {
  return tools;
}

export function getToolDef(name: string): ToolDef | undefined {
  return tools.find(t => t.name === name);
}
