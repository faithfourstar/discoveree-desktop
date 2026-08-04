/**
 * Own-product feedback mining — reshaped from the SaaS
 * `collectFeedbackForProduct` (scheduler.ts:538–1154) per ADR 004 §5:
 * - the profile→feedback bridge blocks (590–645) are DELETED (§2: competitor
 *   voice lives on the competitor object);
 * - the per-competitor review loops (744–870) are DELETED (the entity-scoped
 *   competitor-reviews-agent owns them);
 * - the MCP block is deferred to the MCP sprint; team routing is CUT.
 * What remains: product mining + cross-allocation + feature extraction +
 * the sentiment pass. Cross-allocation resolution against competitor
 * ENTITIES happens in service.ts (the allowed cross-module path).
 *
 * Feature topic extraction: gemini.ts:8494–8625 ported verbatim.
 */
import { Type } from "@google/genai";
import { callLLM } from "../../../lib/llm/router.js";
import { sanitizeJsonResponse } from "../../../lib/llm/json.js";
import { AgentSlugs } from "../../../lib/agents/slugs.js";

/**
 * Extract the primary feature/topic being discussed in a review comment
 * (gemini.ts:8494–8545).
 */
export async function extractFeatureFromReview(
  reviewText: string,
  productName: string,
  organizationId?: string,
): Promise<string> {
  try {
    const prompt = `Analyse this customer review about "${productName}" and identify the PRIMARY feature or capability being discussed.

Review:
"${reviewText.substring(0, 1000)}"

Return a short, specific feature name (2-4 words max) that captures what product capability is being discussed.

Examples of good feature names:
- "Receipt Scanning"
- "Mobile App"
- "Expense Reports"
- "Invoice Management"
- "Bank Integration"
- "OCR Processing"
- "Team Management"
- "API Access"
- "Multi-currency"
- "Approval Workflows"

If the review discusses multiple features, pick the most prominent one.
If you cannot identify a specific feature, return "General".`;

    const response = await callLLM({
      organizationId: organizationId || "",
      agentSlug: AgentSlugs.GATHER_FEEDBACK,
      prompt,
      useWebSearch: false,
      responseSchema: {
        type: Type.OBJECT,
        properties: { feature: { type: Type.STRING } },
        required: ["feature"],
      },
    });

    const result = JSON.parse(sanitizeJsonResponse(response.text) || '{"feature": "General"}');
    return result.feature || "General";
  } catch (error) {
    console.error("Error extracting feature from review:", error instanceof Error ? error.message : error);
    return "General";
  }
}

/**
 * Extract features from multiple reviews in batch for efficiency
 * (gemini.ts:8547–8625).
 */
export async function extractFeaturesFromReviews(
  reviews: { text: string; id?: string }[],
  productName: string,
  organizationId?: string,
): Promise<Map<string, string>> {
  const featureMap = new Map<string, string>();

  if (reviews.length === 0) return featureMap;

  try {
    const reviewsText = reviews.map((r, i) => `[${i}] "${r.text.substring(0, 500)}"`).join("\n\n");

    const prompt = `Analyse these customer reviews about "${productName}" and identify the PRIMARY feature or capability being discussed in each one.

Reviews:
${reviewsText}

For each review (by index), return a short, specific feature name (2-4 words max) that captures what product capability is being discussed.

Examples of good feature names:
- "Receipt Scanning"
- "Mobile App"
- "Expense Reports"
- "Invoice Management"
- "Bank Integration"
- "OCR Processing"
- "Team Management"
- "Approval Workflows"

If a review discusses multiple features, pick the most prominent one.
If you cannot identify a specific feature, use "General".`;

    const response = await callLLM({
      organizationId: organizationId || "",
      agentSlug: AgentSlugs.GATHER_FEEDBACK,
      prompt,
      useWebSearch: false,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          features: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                index: { type: Type.INTEGER },
                feature: { type: Type.STRING },
              },
              required: ["index", "feature"],
            },
          },
        },
        required: ["features"],
      },
    });

    const result = JSON.parse(sanitizeJsonResponse(response.text) || '{"features": []}');
    for (const item of result.features || []) {
      if (item.index !== undefined && item.index < reviews.length) {
        const review = reviews[item.index]!;
        const key = review.id || review.text.substring(0, 100);
        featureMap.set(key, item.feature || "General");
      }
    }
  } catch (error) {
    console.error("Error extracting features from reviews:", error instanceof Error ? error.message : error);
  }

  // Fill in any missing with "General"
  for (const review of reviews) {
    const key = review.id || review.text.substring(0, 100);
    if (!featureMap.has(key)) {
      featureMap.set(key, "General");
    }
  }

  return featureMap;
}
