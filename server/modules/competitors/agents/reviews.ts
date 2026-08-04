/**
 * Competitor reviews agent — ported from the SaaS gemini.ts:11516–12053
 * (`getCompetitorReviews`), run as an ENTITY-scoped agent (ADR 004 §2:
 * mined once per org per competitor entity node). Trims in port:
 * - multi-lingual search context stripped (deferred with reviews/pricing per
 *   ADR 002 §1);
 * - the direct-page-fetch (Jina) fallback block is NOT ported in 3b — the
 *   grounded search + soft-404 validation is the pipeline; the fallback can
 *   return with the Sources sprint if dogfood shows need;
 * - output is Zod-validated and, when the provider returned real citations,
 *   quote URLs are enforced against the allow-list (evidence gate).
 * All quotes carry sourceUrl; unverifiable quotes are flagged
 * `verified: false`, never silently dressed up (§6.4).
 */
import { Type } from "@google/genai";
import { callLLM, collectAllowedSourceUrls, enforceSourceUrlAllowList } from "../../../lib/llm/router.js";
import { sanitizeJsonResponse } from "../../../lib/llm/json.js";
import { resolveAgentPrompt } from "../../../lib/agents/registry.js";
import { AgentSlugs } from "../../../lib/agents/slugs.js";
import { validateUrlWithSoft404Detection } from "../../../lib/web/fetch.js";
import { competitorReviewsResultSchema, type CompetitorReviewsResult } from "../schemas.js";

export async function getCompetitorReviews(
  competitorName: string,
  organizationId?: string,
  trustedFeedbackSources?: Array<{ name: string; url: string }>,
): Promise<CompetitorReviewsResult | null> {
  // Build search instructions based on trusted feedback sources or defaults
  const buildPlatformSearches = () => {
    if (trustedFeedbackSources && trustedFeedbackSources.length > 0) {
      const searches = trustedFeedbackSources.map((source, i) => {
        try {
          const domain = new URL(source.url.startsWith("http") ? source.url : `https://${source.url}`).hostname;
          return `${i + 1}. site:${domain} "${competitorName}" reviews`;
        } catch {
          return `${i + 1}. "${competitorName}" ${source.name} reviews`;
        }
      });
      return searches.join("\n");
    }
    // Default platforms if no trusted sources configured
    return `1. site:g2.com "${competitorName}" reviews
2. site:g2.com/products "${competitorName}"
3. site:capterra.com "${competitorName}" reviews
4. site:capterra.com/software "${competitorName}"
5. site:trustradius.com "${competitorName}" reviews
6. site:trustradius.com/products "${competitorName}"
7. site:gartner.com/reviews "${competitorName}"
8. site:softwareadvice.com "${competitorName}" reviews
9. site:getapp.com "${competitorName}" reviews
10. "${competitorName}" LinkedIn reviews OR discussion OR experience`;
  };

  const buildPlatformsList = () => {
    if (trustedFeedbackSources && trustedFeedbackSources.length > 0) {
      return trustedFeedbackSources.map(s => `- ${s.name} (${s.url})`).join("\n");
    }
    return `- G2 (g2.com/products/[company])
- Capterra (capterra.com/software/[id]/[company])
- TrustRadius (trustradius.com/products/[company])
- Gartner Peer Insights (gartner.com/reviews/market/[category]/vendor/[company])
- Software Advice (softwareadvice.com/[category]/[company]-profile)
- GetApp (getapp.com/software/[id]/[company])`;
  };

  const trustedSourcesNote = trustedFeedbackSources && trustedFeedbackSources.length > 0
    ? `\nIMPORTANT: These are the organisation's trusted feedback sources. Prioritise searching these specific platforms.`
    : "";

  const fallbackPrompt = `You are a customer feedback analyst. Your task is to gather real customer reviews about ${competitorName} using web search.

COMPETITOR: ${competitorName}
${trustedSourcesNote}

CRITICAL SEARCH STRATEGY - USE SITE: OPERATOR:
You MUST use the site: operator to search DIRECTLY on review platforms. This ensures you find actual review pages with ratings and quotes.

REQUIRED SEARCHES (execute ALL of these):
${buildPlatformSearches()}

FALLBACK SEARCHES (if site-specific searches return few results):
- "${competitorName}" customer reviews ${new Date().getFullYear()}
- "${competitorName}" software reviews rating

YOUR TASK:
1. Execute the site: searches above to find ${competitorName}'s review profiles
2. Extract the ACTUAL RATINGS shown on those pages (e.g., "4.5/5 stars", "4.7 out of 5")
3. Note the REVIEW COUNT (e.g., "Based on 500 reviews")
4. Identify POSITIVE themes from review snippets (what customers love)
5. Identify NEGATIVE themes from review snippets (common complaints)
6. Extract 2-4 ACTUAL QUOTE snippets from reviews with the exact source URL and, when visible, the date the review was written (never guess a date)

PLATFORMS TO FIND:
${buildPlatformsList()}

OUTPUT:
Provide:
- averageRating: Average rating out of 5 (calculate from platform ratings)
- totalReviews: Approximate total reviews across all platforms
- platforms: Array of platforms with their profile URLs and individual ratings
- positiveThemes: Top 3-5 things customers consistently praise
- negativeThemes: Top 3-5 common complaints or criticisms
- quotes: 2-4 actual review excerpts with source URLs

**URL RULE - VERY IMPORTANT**:
- ONLY use URLs that you ACTUALLY FOUND and VERIFIED via web search
- DO NOT construct or guess URLs - only return URLs from actual search results
- Each quote must have a real sourceUrl that you visited

IMPORTANT: You MUST respond with ONLY a valid JSON object in this exact format (no markdown, no explanation):
{
  "averageRating": 4.5,
  "totalReviews": 500,
  "platforms": [{"name": "G2", "url": "https://...", "rating": 4.5, "reviewCount": 250}],
  "positiveThemes": ["Easy to use", "Great support"],
  "negativeThemes": ["Limited integrations", "Expensive"],
  "quotes": [{"text": "Quote text", "source": "G2", "sourceUrl": "https://...", "rating": 5, "date": "2025-01-15"}]
}`;

  const prompt = await resolveAgentPrompt(AgentSlugs.COMPETITOR_REVIEWS, organizationId || "", fallbackPrompt);

  console.log(`[Competitor Reviews] Searching reviews for ${competitorName}`);

  const response = await callLLM({
    organizationId: organizationId || "",
    agentSlug: AgentSlugs.COMPETITOR_REVIEWS,
    prompt,
    useWebSearch: true,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        averageRating: { type: Type.NUMBER },
        totalReviews: { type: Type.NUMBER },
        platforms: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              url: { type: Type.STRING },
              rating: { type: Type.NUMBER },
              reviewCount: { type: Type.NUMBER },
            },
            required: ["name", "url"],
          },
        },
        positiveThemes: { type: Type.ARRAY, items: { type: Type.STRING } },
        negativeThemes: { type: Type.ARRAY, items: { type: Type.STRING } },
        quotes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              source: { type: Type.STRING },
              sourceUrl: { type: Type.STRING },
              rating: { type: Type.NUMBER },
              date: { type: Type.STRING },
            },
            required: ["text", "source", "sourceUrl"],
          },
        },
      },
      required: ["platforms", "positiveThemes", "negativeThemes", "quotes"],
    },
  });

  let raw: unknown = JSON.parse(sanitizeJsonResponse(response.text) || "null");
  if (!raw) {
    console.log(`[Competitor Reviews] No valid result for ${competitorName}`);
    throw new Error(`No review data could be found for ${competitorName}. The search may have been unable to access review platforms.`);
  }

  // Evidence gate: with real provider citations available, quote/platform
  // URLs the model reconstructed are stripped rather than stored.
  if (response.citations && response.citations.length > 0) {
    const allowed = collectAllowedSourceUrls(response.citations, response.text);
    const { value, stripped } = enforceSourceUrlAllowList(raw, allowed);
    if (stripped.length > 0) {
      console.log(`[Competitor Reviews] Stripped ${stripped.length} unverifiable URL(s) for ${competitorName}`);
    }
    raw = value;
  }

  const parsed = competitorReviewsResultSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[Competitor Reviews] Output failed schema validation for ${competitorName}:`, parsed.error.issues.slice(0, 3));
    throw new Error(`Competitor reviews output rejected by schema for ${competitorName}`);
  }
  const result = parsed.data;

  console.log(`[Competitor Reviews] Found reviews for ${competitorName}: ${result.platforms.length} platforms, ${result.quotes.length} quotes`);

  // Build known fallback URLs for popular review platforms (always valid searches)
  const knownFallbackUrls: Record<string, string> = {
    "g2": `https://www.g2.com/search?utf8=%E2%9C%93&query=${encodeURIComponent(competitorName)}`,
    "capterra": `https://www.capterra.com/search/?query=${encodeURIComponent(competitorName)}`,
    "trustradius": `https://www.trustradius.com/search?q=${encodeURIComponent(competitorName)}`,
    "gartner": `https://www.gartner.com/reviews/search?search=${encodeURIComponent(competitorName)}`,
    "gartner peer insights": `https://www.gartner.com/reviews/search?search=${encodeURIComponent(competitorName)}`,
    "softwareadvice": `https://www.softwareadvice.com/search/?q=${encodeURIComponent(competitorName)}`,
    "software advice": `https://www.softwareadvice.com/search/?q=${encodeURIComponent(competitorName)}`,
    "getapp": `https://www.getapp.com/search/?q=${encodeURIComponent(competitorName)}`,
  };

  // Validate platform URLs with soft-404 detection; fall back to known search
  // URLs rather than dropping platforms (users always get somewhere to look).
  if (result.platforms.length > 0) {
    await Promise.all(result.platforms.map(async (platform) => {
      if (platform.url) {
        const validatedUrl = await validateUrlWithSoft404Detection(platform.url, 4000);
        if (!validatedUrl) {
          const platformKey = (platform.name || "").toLowerCase();
          platform.url = knownFallbackUrls[platformKey] || knownFallbackUrls["g2"]!;
        }
      } else {
        const platformKey = (platform.name || "").toLowerCase();
        platform.url = knownFallbackUrls[platformKey] || knownFallbackUrls["g2"]!;
      }
    }));
  }

  // Validate quote sourceUrls with soft-404 detection. A quote whose URL fails
  // keeps the text but LOSES the URL claim (verified handling happens at the
  // write path) — honest provenance, never a fabricated deep link.
  if (result.quotes.length > 0) {
    await Promise.all(result.quotes.map(async (quote) => {
      if (quote.sourceUrl) {
        const validatedUrl = await validateUrlWithSoft404Detection(quote.sourceUrl, 4000);
        if (!validatedUrl) {
          console.log(`[Competitor Reviews] Invalid/soft-404 quote URL cleared: ${quote.sourceUrl}`);
          quote.sourceUrl = "";
        }
      }
    }));
  }

  return { ...result, lastUpdated: new Date().toISOString() };
}
