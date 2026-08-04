/**
 * The two write tools (ADR 005 §3) — pure data writes: no LLM calls, no
 * enrichment fan-out, no agent triggers (§3.6 — this is what makes headless
 * writes safe). The gate follows the SEAT, not the transport (§3.1):
 * owner-seat log_feedback is a direct add with mcp provenance;
 * propose_competitor_intel ALWAYS queues into intel_proposals.
 *
 * BAN (ADR 005 §3.6, CI-greppable): server/mcp/ never imports server/lib/llm/.
 */
import { z } from "zod/v4";
import { buildMcpProvenance } from "@shared/provenance";
import { INTEL_PROPOSAL_KINDS } from "@shared/schema";
import { sanitizeSourceDate } from "../../lib/reviews/search.js";
import {
  proposeCompetitorIntel,
  resolveTrackedCompetitorForProduct,
} from "../../modules/competitors/service.js";
import * as competitorsStorage from "../../modules/competitors/storage.js";
import * as customersStorage from "../../modules/customers/storage.js";
import { requireWriteSeat } from "../caller.js";
import { resolveProductParam } from "../payloads.js";
import { registerToolDef, type McpToolCtx } from "../registry.js";

async function ownerName(): Promise<string> {
  const { getDb } = await import("../../db/index.js");
  const { users } = await import("@shared/schema");
  const rows = await getDb().select().from(users).limit(1);
  return rows[0]?.name ?? "the workspace owner";
}

function clientLabel(ctx: McpToolCtx): string | null {
  return ctx.client ? `${ctx.client.name} ${ctx.client.version}`.trim() : null;
}

const WHERE_MAX_LENGTH = 120;

/**
 * Sanitise the `where` attribution detail (channel/meeting/source): collapse
 * whitespace, trim, cap at ~120 chars. Absent or empty → null — provenance
 * never carries filler.
 */
export function sanitiseWhere(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > WHERE_MAX_LENGTH ? cleaned.slice(0, WHERE_MAX_LENGTH) : cleaned;
}

// ── log_feedback (ADR 005 §3.2 — owner-seat direct add) ─────────────────────

registerToolDef({
  name: "log_feedback",
  description: "Log a piece of customer feedback into Discoveree, verbatim, with provenance. shared_by is REQUIRED and must be the attribution as stated by the user — pass the literal \"unattributed\" when they do not say; never invent attribution. Omit sentiment unless the user stated it — Discoveree scores it.",
  category: "write",
  inputSchema: {
    product: z.string().optional().describe("Product id or slug. Omit when the workspace has exactly one product."),
    quoted_text: z.string().min(1).max(4000).describe("The verbatim words of the feedback."),
    shared_by: z.string().min(1).describe("Who shared it (person/channel), AS STATED by the user; \"unattributed\" is accepted."),
    where: z.string().max(400).optional().describe('where this was heard — a channel, meeting, or source, e.g. "#sales-eu" or "quarterly business review"'),
    source_name: z.string().max(200).optional().describe("Where it came from, e.g. \"Slack #enterprise-deals\"."),
    source_url: z.string().optional(),
    source_created_at: z.string().optional().describe("ISO date when it was SAID. Omit when unknown — never guess."),
    topic: z.string().max(200).optional(),
    sentiment: z.number().int().min(0).max(100).optional().describe("Only when the user stated it; otherwise omit."),
    reviewer_name: z.string().max(200).optional().describe("The customer being quoted, if known."),
    competitor: z.string().optional().describe("Competitor entity id or name, when the feedback is about a competitor."),
  },
  handler: async (ctx, args) => {
    requireWriteSeat(ctx.caller, "log_feedback", args, await ownerName());
    const product = await resolveProductParam(ctx.organizationId, args["product"] as string | undefined, ctx.productPin);

    const quotedText = String(args["quoted_text"]);
    const sharedBy = String(args["shared_by"]);

    // Competitor resolution: TRACKED entity → isCompetitor + competitorEntityId;
    // unresolved → plain feedback with the name in topic — never an invented
    // entity row (ADR 005 §3.2).
    let isCompetitor = false;
    let competitorEntityId: string | null = null;
    let topic = (args["topic"] as string | undefined) ?? null;
    if (args["competitor"]) {
      const name = String(args["competitor"]);
      const resolved = await resolveTrackedCompetitorForProduct(ctx.organizationId, product.id, name)
        ?? (await (async () => {
          const byId = await competitorsStorage.getCompetitorEntityById(name);
          if (byId && byId.organizationId === ctx.organizationId) {
            const facet = await competitorsStorage.getCompetitorProfileByProductAndEntity(product.id, byId.id);
            if (facet && facet.status === "tracked") return { entityId: byId.id, entityName: byId.name };
          }
          return null;
        })());
      if (resolved) {
        isCompetitor = true;
        competitorEntityId = resolved.entityId;
      } else if (!topic) {
        topic = name;
      }
    }

    // Idempotency over scolding: the ported 100-char prefix dedup key.
    const dedupKey = quotedText.toLowerCase().trim().substring(0, 100);
    const recent = await customersStorage.getFeedbackEntriesByProduct(product.id, { includeArchived: true, limit: 500 });
    const existing = recent.find(e => (e.quotedText || "").toLowerCase().trim().substring(0, 100) === dedupKey);
    if (existing) {
      return {
        id: existing.id,
        duplicate: true,
        message: "This feedback is already logged — returning the existing entry.",
      };
    }

    // §4a attribution in full: "shared by Maya in #sales-eu" — `where` is the
    // channel/meeting half, carried as provenance.detail.
    const provenance = buildMcpProvenance({
      client: clientLabel(ctx),
      sharedBy,
      keyId: ctx.caller.keyId,
      detail: sanitiseWhere(args["where"]),
    });

    const entry = await customersStorage.createFeedbackEntry({
      productId: product.id,
      isCompetitor,
      competitorEntityId,
      sourceName: (args["source_name"] as string | undefined) ?? "MCP",
      sourceUrl: (args["source_url"] as string | undefined) ?? null,
      sourceType: "mcp", // vocabulary extension (ADR 004 §8 reserved)
      verified: false,
      collectedAt: new Date(),
      // Date discipline: authored-at when stated (sanity-checked); never guessed.
      sourceCreatedAt: sanitizeSourceDate(args["source_created_at"] as string | undefined, "mcp feedback"),
      topic,
      quotedText,
      // Null, NOT the SaaS default-50 — the sentiment pass scores nulls.
      sentiment: (args["sentiment"] as number | undefined) ?? null,
      reviewerName: (args["reviewer_name"] as string | undefined) ?? null,
      provenance,
    });

    return {
      id: entry.id,
      message: `Feedback logged with provenance: via ${provenance.client ?? "MCP"} · shared by ${sharedBy}. Sentiment will be scored on the next collection run.`,
    };
  },
});

// ── propose_competitor_intel (ADR 005 §3.3 — always queues) ─────────────────

registerToolDef({
  name: "propose_competitor_intel",
  description: "Propose competitor intelligence (pricing moves, features, news, positioning, customer wins) into Discoveree's review queue. Nothing changes until a human accepts it. shared_by is REQUIRED — the attribution as stated by the user, or the literal \"unattributed\".",
  category: "write",
  inputSchema: {
    product: z.string().optional().describe("Product id or slug. Omit when the workspace has exactly one product."),
    competitor: z.string().min(1).describe("The competitor's facet id, entity id, or name."),
    intel: z.string().min(1).max(4000).describe("The claim, in the sharer's words."),
    kind: z.enum(INTEL_PROPOSAL_KINDS).optional().describe("pricing | feature | news | positioning | customer | other. Default other."),
    shared_by: z.string().min(1).describe("Who shared it, AS STATED by the user; \"unattributed\" is accepted."),
    where: z.string().max(400).optional().describe('where this was heard — a channel, meeting, or source, e.g. "#sales-eu" or "quarterly business review"'),
    source_url: z.string().optional(),
    effective_date: z.string().optional().describe("ISO date when the observed thing happened, if known."),
  },
  handler: async (ctx, args) => {
    requireWriteSeat(ctx.caller, "propose_competitor_intel", args, await ownerName());
    const product = await resolveProductParam(ctx.organizationId, args["product"] as string | undefined, ctx.productPin);

    const provenance = buildMcpProvenance({
      client: clientLabel(ctx),
      sharedBy: String(args["shared_by"]),
      keyId: ctx.caller.keyId,
      detail: sanitiseWhere(args["where"]),
    });

    const effectiveDate = sanitizeSourceDate(args["effective_date"] as string | undefined, "intel effective");

    const result = await proposeCompetitorIntel(ctx.organizationId, product.id, {
      competitor: String(args["competitor"]),
      intel: String(args["intel"]),
      kind: (args["kind"] as string | undefined) ?? "other",
      sourceUrl: (args["source_url"] as string | undefined) ?? null,
      effectiveDate,
      provenance,
    });

    return {
      proposalId: result.proposalId,
      status: "pending",
      competitor: result.targetEntityId
        ? { entityId: result.targetEntityId }
        : { name: result.targetName },
      message: "Queued for review in Discoveree — nothing changes until it is accepted.",
    };
  },
});

// Registration side-effect module: importing this file registers the tools.
