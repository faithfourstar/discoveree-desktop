/**
 * MCP-writer provenance (ADR 005 §3.5) — one shape shared by
 * feedback_entries.provenance, competitor_changes.provenance and
 * intel_proposals.provenance.
 *
 * Required vs inferred, precisely: the tool schemas REQUIRE `shared_by` (the
 * human origin — the one thing only the user knows, the brief §4a promise;
 * the literal "unattributed" is accepted, invented attribution is forbidden);
 * the server INFERS `client`, `keyId` and `at` (things the caller would only
 * get wrong). Rendered as:
 * "via Claude Desktop · shared by Maria (#enterprise-deals) · 4 Aug 2026".
 */
import { z } from "zod/v4";

export const mcpProvenanceSchema = z.object({
  via: z.literal("mcp"),
  /** INFERRED from the initialize handshake's clientInfo — never asked. */
  client: z.string().nullable(),
  /** REQUIRED from the tool call — user-stated; "unattributed" permitted. */
  sharedBy: z.string(),
  /** Reader-key id when one exists (sprint 5b); null on the owner seat. */
  keyId: z.string().nullable(),
  /** Optional free text ("from #competitive-intel thread"). */
  detail: z.string().nullable(),
  /** ISO 8601, server-stamped. */
  at: z.string(),
});

export type McpProvenance = z.infer<typeof mcpProvenanceSchema>;

export function buildMcpProvenance(input: {
  client: string | null;
  sharedBy: string;
  keyId?: string | null;
  detail?: string | null;
}): McpProvenance {
  return {
    via: "mcp",
    client: input.client,
    sharedBy: input.sharedBy,
    keyId: input.keyId ?? null,
    detail: input.detail ?? null,
    at: new Date().toISOString(),
  };
}
