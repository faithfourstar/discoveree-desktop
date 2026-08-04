/**
 * Sentiment scoring — ported from the SaaS gemini.ts:7745–8044
 * (`scoreSentimentBatch`) and scheduler.ts:330–362 (`scoreUnscoredFeedback`).
 * The 0–100 rubric ports verbatim; a pipeline stage, not a scheduled agent
 * (ADR 004 §9). `analyzeSentiment` (7522–7743) is deliberately NOT ported in
 * 3b: nothing in the ported surface calls the single-comment structured
 * analysis — the batch scorer is the pipeline's consumer.
 */
import { Type } from "@google/genai";
import { callLLM } from "../../../lib/llm/router.js";
import { sanitizeJsonResponse } from "../../../lib/llm/json.js";
import { AgentSlugs } from "../../../lib/agents/slugs.js";
import * as storage from "../storage.js";

export async function scoreSentimentBatch(
  entries: Array<{ id: string; text: string }>,
  productName: string,
  organizationId?: string,
): Promise<Array<{ id: string; score: number }>> {
  if (entries.length === 0) return [];

  const entriesBlock = entries.map((e) => `ID="${e.id}"\n"${e.text.substring(0, 500)}"`).join("\n\n");

  const prompt = `You are an expert sentiment analysis system for product-related feedback about "${productName}".

Score each feedback entry below on a 0-100 scale using these signal categories:

VERY NEGATIVE (0-20) - Abandon/Fail signals:
  - Switching away, cancelling, data loss, broken critical workflows

NEGATIVE (21-40) - Frustration/Pain signals:
  - Repeated complaints, workarounds needed, "wasted hours", regressions

SLIGHTLY NEGATIVE (41-50) - Confusion/Friction signals:
  - Unclear docs, unintuitive UX, minor annoyances, feature requests as complaints

NEUTRAL/MIXED (51-60):
  - Balanced pros/cons, factual without emotion, "decent for the price"

POSITIVE (61-80) - Value signals:
  - Specific praise, "saved us time", favorable comparisons

VERY POSITIVE (81-100) - Recommendation/Delight signals:
  - Unsolicited recommendations, "game changer", loyal testimonials

NUANCES:
- Detect sarcasm: "Great, another update that breaks everything" = NEGATIVE
- Politeness masking frustration: weight toward negative
- Feature requests without frustration = neutral (50-55)

FEEDBACK ENTRIES:
${entriesBlock}

Return a score for each entry.`;

  try {
    const response = await callLLM({
      organizationId: organizationId || "",
      agentSlug: AgentSlugs.SENTIMENT_ANALYSIS,
      prompt,
      useWebSearch: false,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          scores: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                score: { type: Type.INTEGER },
              },
              required: ["id", "score"],
            },
          },
        },
        required: ["scores"],
      },
    });

    const parsed = JSON.parse(sanitizeJsonResponse(response.text) || "{}");
    const results: Array<{ id: string; score: number }> = [];
    const inputIds = new Set(entries.map(e => e.id));

    for (const item of parsed.scores || []) {
      if (!item.id || !inputIds.has(item.id)) continue;
      const score = Math.max(0, Math.min(100, Math.round(Number(item.score) || 50)));
      results.push({ id: item.id, score });
      inputIds.delete(item.id);
    }

    if (inputIds.size > 0) {
      console.warn(`[Sentiment Batch] ${inputIds.size} entries missing from LLM response, will be retried next run`);
    }

    return results;
  } catch (error) {
    console.error("[Sentiment Batch] Error scoring batch:", error instanceof Error ? error.message : error);
    return [];
  }
}

/** scheduler.ts:330–362 — fills unscored entries after every collection run. */
export async function scoreUnscoredFeedback(productId: string, productName: string, organizationId: string): Promise<number> {
  try {
    const allEntries = await storage.getFeedbackEntriesByProduct(productId, { includeArchived: true });
    const unscored = allEntries.filter(e => e.sentiment === null || e.sentiment === undefined);

    if (unscored.length === 0) {
      return 0;
    }

    console.log(`[Sentiment Scoring] Scoring ${unscored.length} entries for ${productName}...`);

    const BATCH_SIZE = 15;
    let scored = 0;
    for (let i = 0; i < unscored.length; i += BATCH_SIZE) {
      const batch = unscored.slice(i, i + BATCH_SIZE);
      const batchInput = batch.map(e => ({ id: e.id, text: e.quotedText }));
      const results = await scoreSentimentBatch(batchInput, productName, organizationId);

      for (const result of results) {
        await storage.updateFeedbackEntry(result.id, { sentiment: result.score });
        scored++;
      }
    }

    console.log(`[Sentiment Scoring] Scored ${scored}/${unscored.length} entries for ${productName}`);
    return scored;
  } catch (error) {
    console.error(`[Sentiment Scoring] Error scoring feedback for ${productId}:`, error instanceof Error ? error.message : error);
    return 0;
  }
}
