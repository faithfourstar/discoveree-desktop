/**
 * Customer insights agent — REWRITTEN (ADR 004 §3.3; replaces the SaaS
 * `generateCustomerSegmentInsights`, gemini.ts:5062–5555, whose seeded prompt
 * is the hallucination instruction and does not ship).
 *
 * Evidence SYNTHESIS: web search is OFF; the enumerated evidence items are
 * the agent's ENTIRE knowledge of the customer. Every claim must cite item
 * ids; the Zod schema (schemas.ts) requires the refs (persona ≥3, claim ≥1,
 * insights ≥5); the service verifies the cited refs against the ledger before
 * anything persists. Fewer or no personas is a valid — often the correct —
 * output.
 */
import { callLLM } from "../../../lib/llm/router.js";
import { sanitizeJsonResponse } from "../../../lib/llm/json.js";
import { AgentSlugs } from "../../../lib/agents/slugs.js";
import type { EvidenceItem, EvidenceRef } from "../evidence.js";
import { segmentInsightsOutputSchema, type SegmentInsightsOutput } from "../schemas.js";

/**
 * Enumerate the pool for the prompt AND build the id→ref mapping the output
 * cites through: the model cites "E3"; the service resolves E3 back to the
 * real EvidenceRef before verification/persist.
 */
export function enumerateEvidence(items: EvidenceItem[]): {
  block: string;
  refByToken: Map<string, EvidenceRef>;
} {
  const refByToken = new Map<string, EvidenceRef>();
  const lines: string[] = [];
  items.forEach((item, i) => {
    const token = `E${i + 1}`;
    refByToken.set(token, item.ref);
    const dateLabel = item.at ? item.at.toISOString().slice(0, 10) : "undated";
    lines.push(`[${token}] (${item.source}, ${dateLabel}) "${item.text.substring(0, 400)}"`);
  });
  return { block: lines.join("\n"), refByToken };
}

/** The raw LLM output cites tokens; this resolves tokens → EvidenceRefs. */
function resolveTokens(value: unknown, refByToken: Map<string, EvidenceRef>): unknown {
  if (Array.isArray(value)) return value.map(v => resolveTokens(v, refByToken));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "evidenceRefs" && Array.isArray(v)) {
        out[k] = v
          .map(token => (typeof token === "string" ? refByToken.get(token.trim()) : undefined))
          .filter((r): r is EvidenceRef => r !== undefined);
      } else {
        out[k] = resolveTokens(v, refByToken);
      }
    }
    return out;
  }
  return value;
}

export async function synthesiseSegmentInsights(
  segmentName: string,
  segmentDescription: string | null,
  productName: string,
  evidence: EvidenceItem[],
  organizationId: string,
): Promise<SegmentInsightsOutput | null> {
  const { block, refByToken } = enumerateEvidence(evidence);

  const prompt = `You are a customer research analyst. Below is the COMPLETE evidence pool for the "${segmentName}" segment of "${productName}"${segmentDescription ? ` (${segmentDescription})` : ""}. This pool is your ENTIRE knowledge of these customers — you have no other information and must not use any.

EVIDENCE POOL (cite items by their [En] token):
${block}

YOUR TASK:
Synthesise ONLY what this evidence supports:
1. personas: 0-3 personas — ONLY where at least 3 distinct evidence items clearly describe the same role/person type. Each persona needs "evidenceRefs" listing the ≥3 supporting tokens. If the evidence does not support a persona, return an empty personas array — that is the CORRECT answer, not a failure.
2. needs: customer needs, each with ≥1 citing token in "evidenceRefs".
3. jobsToBeDone: core/functional/emotional/social jobs and desired outcomes, each claim with ≥1 citing token.
4. segmentInsights: a short synthesis (what matters, health signals, risks) citing ≥5 distinct tokens in "evidenceRefs".
5. needsSummary: one paragraph summarising the needs, grounded in the same evidence.

HARD RULES:
- Make ONLY claims supported by the listed evidence items; cite the exact [En] tokens per claim in each "evidenceRefs" array (as plain strings, e.g. "E3").
- NEVER invent customers, quotes, statistics, satisfaction scores, or market facts.
- Do NOT estimate CSAT or NPS — those fields do not exist in your output.
- Return fewer claims, or none, rather than pad. An empty result on thin evidence is correct.

Respond with ONLY a valid JSON object matching the schema.`;

  // Prompt-facing schema: evidenceRefs are token strings the model can emit;
  // resolveTokens maps them to real refs before the REAL schema validates.
  const promptSchema = {
    type: "object",
    properties: {
      personas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            demographics: {
              type: "object",
              properties: { role: { type: "string" }, industry: { type: "string" }, companySize: { type: "string" }, experience: { type: "string" } },
            },
            behaviours: { type: "array", items: { type: "string" } },
            goals: { type: "array", items: { type: "object", properties: { text: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["text", "evidenceRefs"] } },
            painPoints: { type: "array", items: { type: "object", properties: { text: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["text", "evidenceRefs"] } },
            evidenceRefs: { type: "array", items: { type: "string" } },
          },
          required: ["title", "evidenceRefs"],
        },
      },
      needsSummary: { type: "string" },
      needs: {
        type: "array",
        items: {
          type: "object",
          properties: { need: { type: "string" }, importance: { type: "number" }, evidenceRefs: { type: "array", items: { type: "string" } } },
          required: ["need", "evidenceRefs"],
        },
      },
      jobsToBeDone: {
        type: "object",
        properties: {
          coreJob: { type: "object", properties: { text: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["text", "evidenceRefs"] },
          summary: { type: "string" },
          functionalJobs: { type: "array", items: { type: "object", properties: { text: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["text", "evidenceRefs"] } },
          emotionalJobs: { type: "array", items: { type: "object", properties: { text: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["text", "evidenceRefs"] } },
          socialJobs: { type: "array", items: { type: "object", properties: { text: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["text", "evidenceRefs"] } },
          desiredOutcomes: { type: "array", items: { type: "object", properties: { text: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["text", "evidenceRefs"] } },
        },
      },
      segmentInsights: {
        type: "object",
        properties: { text: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } },
        required: ["text", "evidenceRefs"],
      },
    },
  };

  const response = await callLLM({
    organizationId,
    agentSlug: AgentSlugs.CUSTOMER_INSIGHTS,
    prompt,
    useWebSearch: false, // §3.3: gathering and synthesis are separated
    responseSchema: promptSchema,
  });

  const raw = JSON.parse(sanitizeJsonResponse(response.text) || "null");
  if (!raw) return null;

  const resolved = resolveTokens(raw, refByToken);
  const parsed = segmentInsightsOutputSchema.safeParse(resolved);
  if (!parsed.success) {
    // Rejected parse is a VISIBLE failure (risk 5): log and store nothing —
    // the execution row carries the error via the thrown rejection.
    console.warn(`[Customer Insights] Output failed the evidence-required schema for "${segmentName}":`, parsed.error.issues.slice(0, 5));
    throw new Error(`Customer insights output rejected: ${parsed.error.issues.map(i => i.message).slice(0, 3).join("; ")}`);
  }

  return parsed.data;
}
