/**
 * Web-search review mining — ported from the SaaS reviewSearch.ts (632 lines)
 * per ADR 004 §5, G2 imports deleted (§2: G2 API is CUT, not deferred).
 *
 * The validation pipeline is the point (ADR 004 risk 3) and ports untrimmed:
 * URL reachability + product-specificity checks, review TEXT content
 * validation with competitor cross-allocation, and the honest `verified`
 * flag — unverifiable quotes are stored flagged, never laundered.
 *
 * Date discipline (owner ruling, 4 Aug 2026): gatherers extract the date the
 * review was AUTHORED where the platform shows one; LLM-extracted dates are
 * sanity-validated (not future, not implausibly old — rejected to null with a
 * log). `sourceCreatedAt` is that date; ingestion time never masquerades as it.
 *
 * lib/ placement rule: this module knows product/competitor NAMES as strings
 * only — zero `modules/` imports.
 */
import { Type } from "@google/genai";
import { callLLM } from "../llm/router.js";
import { sanitizeJsonResponse } from "../llm/json.js";
import { resolveAgentPrompt } from "../agents/registry.js";
import { AgentSlugs } from "../agents/slugs.js";

export interface WebSearchReview {
  text: string;
  source: string;
  sourceUrl: string;
  sentiment: number | null;
  verified: boolean;
  fetchedAt: string;
  sourceType: "web_search";
  /** When the review was authored at its source; null when the source shows none. */
  sourceCreatedAt: string | null;
}

export interface CrossAllocatedReview extends WebSearchReview {
  matchedCompetitor: string; // The competitor name this review was allocated to
}

export interface ReviewSearchResult {
  reviews: WebSearchReview[];
  crossAllocatedReviews: CrossAllocatedReview[]; // Reviews that matched a competitor instead
  searchQuery: string;
  sourcesFound: string[];
}

/**
 * Sanity-validate an LLM-extracted source date. Rejects to null (with a log):
 * unparseable values, future dates (>1 day of clock skew), and implausibly
 * old dates (>30 years). An undatable review is real feedback — it simply
 * never counts as windowed signal (date-discipline ruling).
 */
export function sanitizeSourceDate(raw: string | null | undefined, label = "review"): Date | null {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  const parsed = new Date(raw.trim());
  if (Number.isNaN(parsed.getTime())) {
    console.log(`[Review Search] Rejected unparseable ${label} date: "${raw}"`);
    return null;
  }
  const now = Date.now();
  if (parsed.getTime() > now + 24 * 60 * 60 * 1000) {
    console.log(`[Review Search] Rejected future ${label} date: "${raw}"`);
    return null;
  }
  if (parsed.getTime() < now - 30 * 365 * 24 * 60 * 60 * 1000) {
    console.log(`[Review Search] Rejected implausibly old ${label} date: "${raw}"`);
    return null;
  }
  return parsed;
}

const REVIEW_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    source: { type: Type.STRING },
    sourceUrl: { type: Type.STRING },
    relevanceConfidence: { type: Type.STRING },
    reviewDate: { type: Type.STRING, nullable: true },
  },
  required: ["text", "source", "sourceUrl", "relevanceConfidence"],
};

export async function searchProductReviews(
  productName: string,
  maxReviews = 5,
  trustedFeedbackSources?: Array<{ name: string; url: string }>,
  organizationId?: string,
  knownCompetitors?: string[], // List of known competitor names to cross-allocate reviews
): Promise<ReviewSearchResult> {
  const searchQuery = `${productName} user reviews feedback`;

  // Build platform search instructions based on trusted sources or defaults
  const platformInstructions = trustedFeedbackSources && trustedFeedbackSources.length > 0
    ? `IMPORTANT: Search for reviews specifically on these TRUSTED platforms:
${trustedFeedbackSources.map(s => {
  try {
    const domain = new URL(s.url.startsWith("http") ? s.url : `https://${s.url}`).hostname;
    return `- site:${domain} "${productName}" reviews`;
  } catch {
    return `- "${productName}" ${s.name} reviews`;
  }
}).join("\n")}

These are the organisation's trusted feedback sources. Prioritise these platforms.`
    : `Find actual user reviews from sites like G2, Capterra, TrustRadius, Product Hunt, Reddit, or other review platforms.`;

  const fallbackSystemPrompt = `You are a feedback collection specialist. Your task is to gather individual customer reviews and feedback items for analysis.

YOUR TASK:
Search trusted feedback sources to collect individual customer feedback:
1. Find real customer reviews with direct quotes
2. Identify the source platform and URL for each review
3. Determine sentiment (positive, negative, neutral) for each review
4. Extract the main topic or feature being discussed
5. Note if the reviewer is verified

CRITICAL REQUIREMENTS:
- Collect individual reviews, not summaries
- Include real, verifiable source URLs
- Capture both positive and negative feedback
- Capture the gist of each review accurately, using the reviewer's own words where available — paraphrasing is acceptable when needed to avoid recitation issues
- Do not embed citation markers or source reference numbers (e.g. [1], [2]) inside the quote text
- Record the date the review was WRITTEN when the platform shows it (reviewDate, YYYY-MM-DD or YYYY-MM); leave it out when no date is visible — NEVER guess a date`;

  const systemPrompt = await resolveAgentPrompt(AgentSlugs.GATHER_FEEDBACK, organizationId || "", fallbackSystemPrompt);

  const prompt = `Search for real user reviews and feedback specifically about the product "${productName}".

CRITICAL URL REQUIREMENTS:
- The sourceUrl MUST be a direct link to the "${productName}" product's review page on the source platform
- The URL path MUST contain the product name or a product slug (e.g., /products/dext/reviews, /software/hubdoc/reviews)
- DO NOT return generic category pages or reviews of different products
- If you cannot find a direct URL to "${productName}" reviews, use "web_search" as the sourceUrl

${platformInstructions}

For each review found:
1. Extract the actual quote/text from the review - must be about "${productName}" specifically
2. Note the source platform name
3. Provide the DIRECT URL to "${productName}" review page (NOT a generic category or different product)
4. Record reviewDate: the date the review was WRITTEN as shown on the platform (YYYY-MM-DD or YYYY-MM). Omit it if no date is visible — never invent one.
5. Rate your confidence that this review is ACTUALLY about "${productName}" (not a similarly-named or competitor product):
   - "definitely" = You are certain this review discusses "${productName}"
   - "possibly" = The review might be about "${productName}" but could be about a related/competitor product
   - "unlikely" = The review is probably about a different product

IMPORTANT: You MUST respond with ONLY a valid JSON object. Do NOT wrap your response in markdown code blocks or add any text before/after the JSON.

Return up to ${maxReviews} real reviews. Only include reviews that are definitively about "${productName}".`;

  try {
    const response = await callLLM({
      organizationId: organizationId || "",
      agentSlug: AgentSlugs.GATHER_FEEDBACK,
      prompt,
      systemPrompt,
      useWebSearch: true,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          reviews: { type: Type.ARRAY, items: REVIEW_ITEM_SCHEMA },
          sourcesFound: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["reviews", "sourcesFound"],
      },
    });

    const result = JSON.parse(sanitizeJsonResponse(response.text) || "{}");

    // Pre-filter: Remove reviews the LLM itself flagged as unlikely to be about this product
    if (Array.isArray(result.reviews)) {
      const beforeCount = result.reviews.length;
      result.reviews = result.reviews.filter((r: any) => {
        const confidence = (r.relevanceConfidence || "definitely").toLowerCase();
        if (confidence === "unlikely") {
          console.log(`[Review Search] LLM flagged review as unlikely about "${productName}", removing: "${(r.text || "").substring(0, 80)}..."`);
          return false;
        }
        return true;
      });
      const removedCount = beforeCount - result.reviews.length;
      if (removedCount > 0) {
        console.log(`[Review Search] Removed ${removedCount} reviews flagged as unlikely by LLM inline validation`);
      }
    }

    // VALIDATION: Check for error payloads that might have slipped through
    if (result.error) {
      console.error(`[Review Search] LLM returned error payload: ${result.error}`);
      return { reviews: [], crossAllocatedReviews: [], searchQuery, sourcesFound: [] };
    }

    // VALIDATION: Ensure reviews array exists
    if (!Array.isArray(result.reviews)) {
      console.error(`[Review Search] Invalid response structure - reviews is not an array`);
      return { reviews: [], crossAllocatedReviews: [], searchQuery, sourcesFound: result.sourcesFound || [] };
    }

    const now = new Date().toISOString();
    const MIN_REVIEW_TEXT_LENGTH = 10;

    const candidateReviews = (result.reviews || [])
      .filter((r: any) => {
        const text = (r.text || "").trim();
        if (text.length < MIN_REVIEW_TEXT_LENGTH) {
          console.log(`[Review Search] Discarding review with empty/too-short text (${text.length} chars) from ${r.source || "unknown"}`);
          return false;
        }
        return true;
      })
      .map((r: any) => ({
        text: r.text.trim(),
        source: r.source || "Web Search",
        sourceUrl: r.sourceUrl || "",
        sentiment: null as number | null,
        fetchedAt: now,
        sourceType: "web_search" as const,
        // Date discipline: sanity-validated authored-at date or null.
        sourceCreatedAt: sanitizeSourceDate(r.reviewDate)?.toISOString() ?? null,
      }));

    // Validate each URL in parallel - checking both reachability AND product-specificity
    // Also validate the review TEXT content to ensure it's actually about the product
    const validationResults = await Promise.all(
      candidateReviews.map(async (review: any) => {
        const isReachable = await validateUrl(review.sourceUrl);
        const isProductSpecific = validateProductUrl(review.sourceUrl, productName);

        // CRITICAL: Validate review TEXT content - check for competitor mentions
        const contentValidation = validateReviewContent(review.text, productName, knownCompetitors || [], isReachable && isProductSpecific);

        // Check if it matches any known competitor instead (by URL or content)
        let matchedCompetitor: string | null = null;
        if (!isProductSpecific && isReachable) {
          matchedCompetitor = findMatchingCompetitor(review.sourceUrl, knownCompetitors || []);
        }
        // If content validation found a competitor, use that
        if (!contentValidation.isValid && contentValidation.matchedCompetitor) {
          matchedCompetitor = contentValidation.matchedCompetitor;
        }

        return {
          review,
          isReachable,
          isProductSpecific,
          contentIsValid: contentValidation.isValid,
          contentReason: contentValidation.reason,
          matchedCompetitor,
        };
      }),
    );

    // Process reviews: keep those with verified product-specific URLs AND valid content
    const processedReviews: WebSearchReview[] = [];
    const crossAllocatedReviews: CrossAllocatedReview[] = [];
    let verifiedCount = 0;
    let crossAllocatedCount = 0;
    let rejectedCount = 0;

    for (const { review, isReachable, isProductSpecific, contentIsValid, contentReason, matchedCompetitor } of validationResults) {
      // First check: is the review content about a competitor instead?
      if (matchedCompetitor) {
        // Cross-allocate to the competitor (whether detected by URL or content)
        crossAllocatedReviews.push({
          ...review,
          verified: isReachable && isProductSpecific, // Only mark verified if URL was valid for that product
          matchedCompetitor,
        });
        crossAllocatedCount++;
        console.log(`[Review Search] Cross-allocated review from "${productName}" to competitor "${matchedCompetitor}" - ${contentReason}`);
      } else if (contentIsValid) {
        // Content is valid for our product
        if (isReachable && isProductSpecific) {
          // URL is also valid - fully verified
          processedReviews.push({ ...review, verified: true });
          verifiedCount++;
        } else {
          // Content valid but URL not specific - accept with cleared URL
          processedReviews.push({ ...review, sourceUrl: "", verified: false });
          verifiedCount++; // Still count as accepted, just not URL-verified
        }
      } else {
        // Content is not valid for our product and doesn't match a competitor - reject entirely
        rejectedCount++;
        console.log(`[Review Search] REJECTED review for "${productName}" - ${contentReason}`);
      }
    }

    console.log(`[Review Search] Found ${candidateReviews.length} candidates for "${productName}": ${verifiedCount} accepted, ${crossAllocatedCount} cross-allocated, ${rejectedCount} rejected`);

    return {
      reviews: processedReviews,
      crossAllocatedReviews,
      searchQuery,
      sourcesFound: result.sourcesFound || [],
    };
  } catch (error) {
    console.error("[Review Search] Error searching for reviews:", error);
    return { reviews: [], crossAllocatedReviews: [], searchQuery, sourcesFound: [] };
  }
}

export async function searchCompetitorReviews(
  productName: string,
  competitorName: string,
  topic: string,
  maxReviews = 3,
  trustedFeedbackSources?: Array<{ name: string; url: string }>,
  organizationId?: string,
): Promise<WebSearchReview[]> {
  // Build platform search instructions based on trusted sources or defaults
  const platformInstructions = trustedFeedbackSources && trustedFeedbackSources.length > 0
    ? `IMPORTANT: Search for reviews specifically on these TRUSTED platforms:
${trustedFeedbackSources.map(s => {
  try {
    const domain = new URL(s.url.startsWith("http") ? s.url : `https://${s.url}`).hostname;
    return `- site:${domain} "${competitorName}" reviews ${topic}`;
  } catch {
    return `- "${competitorName}" ${s.name} reviews ${topic}`;
  }
}).join("\n")}

These are the organisation's trusted feedback sources. Prioritise these platforms.`
    : `Find actual user feedback from review sites (G2, Capterra, TrustRadius, Reddit, etc.) about how ${competitorName} handles ${topic}.`;

  const fallbackSystemPrompt = `You are a feedback collection specialist. Your task is to gather individual customer reviews and feedback items for analysis.

CRITICAL REQUIREMENTS:
- Collect individual reviews, not summaries
- Include real, verifiable source URLs
- Capture both positive and negative feedback
- Capture the gist of each review accurately, using the reviewer's own words where available — paraphrasing is acceptable when needed to avoid recitation issues
- Do not embed citation markers or source reference numbers (e.g. [1], [2]) inside the quote text
- Record the date the review was WRITTEN when the platform shows it; never guess a date`;

  const systemPrompt = await resolveAgentPrompt(AgentSlugs.GATHER_FEEDBACK, organizationId || "", fallbackSystemPrompt);

  const prompt = `Search for user reviews about the product "${competitorName}" specifically related to "${topic}".

Context: We're comparing "${competitorName}" to "${productName}" on this topic.

CRITICAL URL REQUIREMENTS:
- The sourceUrl MUST be a direct link to the "${competitorName}" product's review page on the source platform
- DO NOT return generic category pages or reviews of different products
- If you cannot find a direct URL to "${competitorName}" reviews, use "web_search" as the sourceUrl

${platformInstructions}

For each relevant review:
1. Extract the actual review text about "${competitorName}" mentioning ${topic}
2. Note the source platform name
3. Provide the DIRECT URL to "${competitorName}" review page
4. Record reviewDate (YYYY-MM-DD or YYYY-MM) when visible; omit when not — never invent one
5. Rate your confidence that this review is ACTUALLY about "${competitorName}":
   - "definitely" / "possibly" / "unlikely"

IMPORTANT: You MUST respond with ONLY a valid JSON object.

Return up to ${maxReviews} relevant real reviews that are definitively about "${competitorName}".`;

  try {
    const response = await callLLM({
      organizationId: organizationId || "",
      agentSlug: AgentSlugs.GATHER_FEEDBACK,
      prompt,
      systemPrompt,
      useWebSearch: true,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          reviews: { type: Type.ARRAY, items: REVIEW_ITEM_SCHEMA },
        },
        required: ["reviews"],
      },
    });

    const result = JSON.parse(sanitizeJsonResponse(response.text) || "{}");

    if (Array.isArray(result.reviews)) {
      result.reviews = result.reviews.filter((r: any) => {
        const confidence = (r.relevanceConfidence || "definitely").toLowerCase();
        if (confidence === "unlikely") {
          console.log(`[Review Search] LLM flagged competitor review as unlikely about "${competitorName}", removing`);
          return false;
        }
        return true;
      });
    }

    if (result.error || !Array.isArray(result.reviews)) {
      console.error(`[Review Search] Competitor ${competitorName}: invalid response`);
      return [];
    }

    const now = new Date().toISOString();
    const MIN_REVIEW_TEXT_LENGTH = 10;

    const candidateReviews = (result.reviews || [])
      .filter((r: any) => (r.text || "").trim().length >= MIN_REVIEW_TEXT_LENGTH)
      .map((r: any) => ({
        text: r.text.trim(),
        source: r.source || "Web Search",
        sourceUrl: r.sourceUrl || "",
        sentiment: null as number | null,
        fetchedAt: now,
        sourceType: "web_search" as const,
        sourceCreatedAt: sanitizeSourceDate(r.reviewDate)?.toISOString() ?? null,
      }));

    const validationResults = await Promise.all(
      candidateReviews.map(async (review: any) => {
        const isReachable = await validateUrl(review.sourceUrl);
        const isCompetitorSpecific = validateProductUrl(review.sourceUrl, competitorName);
        return { review, isReachable, isCompetitorSpecific };
      }),
    );

    const processedReviews: WebSearchReview[] = [];
    let verifiedCount = 0;
    let fallbackCount = 0;

    for (const { review, isReachable, isCompetitorSpecific } of validationResults) {
      if (isReachable && isCompetitorSpecific) {
        processedReviews.push({ ...review, verified: true });
        verifiedCount++;
      } else {
        processedReviews.push({ ...review, sourceUrl: "", verified: false });
        fallbackCount++;
      }
    }

    console.log(`[Review Search] Competitor ${competitorName}: ${candidateReviews.length} candidates, ${verifiedCount} verified, ${fallbackCount} unverified`);

    return processedReviews;
  } catch (error) {
    console.error("[Review Search] Error searching competitor reviews:", error);
    return [];
  }
}

export async function validateUrl(url: string): Promise<boolean> {
  if (!url || !url.startsWith("http")) {
    return false;
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Validates that a URL is product-specific by checking if it contains the product name or a recognizable slug
 */
export function validateProductUrl(url: string, productName: string): boolean {
  if (!url || !url.startsWith("http")) {
    return false;
  }

  try {
    const urlObj = new URL(url);
    const urlLower = urlObj.pathname.toLowerCase() + urlObj.search.toLowerCase();

    // Normalize the product name to common URL slug formats
    const productLower = productName.toLowerCase();
    const productSlug = productLower.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const productSlugUnderscore = productLower.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const productNoSpaces = productLower.replace(/\s+/g, "");

    // Check if URL contains any variant of the product name
    const containsProduct =
      urlLower.includes(productLower) ||
      urlLower.includes(productSlug) ||
      urlLower.includes(productSlugUnderscore) ||
      urlLower.includes(productNoSpaces);

    // Also check query parameters
    const queryLower = urlObj.search.toLowerCase();
    const inQuery =
      queryLower.includes(productLower) ||
      queryLower.includes(productSlug);

    return containsProduct || inQuery;
  } catch {
    return false;
  }
}

/**
 * Validates that review TEXT content is actually about the target product.
 * Checks that the product name appears and no competitor names appear more prominently.
 * @param isProductSpecificUrl - Whether the review's source URL was positively validated as
 *   a product-specific page. Used to decide whether to accept reviews with no product/competitor
 *   mentions: only accepted when the URL is product-specific, otherwise discarded.
 */
export function validateReviewContent(
  reviewText: string,
  productName: string,
  competitors: string[] = [],
  isProductSpecificUrl: boolean = false,
): { isValid: boolean; matchedCompetitor: string | null; reason: string } {
  const textLower = reviewText.toLowerCase();
  const productLower = productName.toLowerCase();

  const allCompetitors = competitors
    .map(c => c.toLowerCase())
    .filter(c => c !== productLower);

  const productMentions = (textLower.match(new RegExp(productLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

  let maxCompetitorMentions = 0;
  let dominantCompetitor: string | null = null;

  for (const competitor of allCompetitors) {
    const competitorRegex = new RegExp(competitor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const mentions = (textLower.match(competitorRegex) || []).length;
    if (mentions > maxCompetitorMentions) {
      maxCompetitorMentions = mentions;
      dominantCompetitor = competitor;
    }
  }

  if (maxCompetitorMentions > 0 && productMentions === 0) {
    return {
      isValid: false,
      matchedCompetitor: dominantCompetitor,
      reason: `Review mentions competitor "${dominantCompetitor}" (${maxCompetitorMentions}x) but not "${productName}" - cross-allocating`,
    };
  }

  if (maxCompetitorMentions > 0 && maxCompetitorMentions > productMentions) {
    return {
      isValid: false,
      matchedCompetitor: dominantCompetitor,
      reason: `Review mentions "${dominantCompetitor}" (${maxCompetitorMentions}x) more than "${productName}" (${productMentions}x) - cross-allocating`,
    };
  }

  if (maxCompetitorMentions > 0 && productMentions >= maxCompetitorMentions) {
    return {
      isValid: true,
      matchedCompetitor: null,
      reason: `Valid: "${productName}" mentioned ${productMentions}x, top competitor "${dominantCompetitor}" mentioned ${maxCompetitorMentions}x - keeping as own-product`,
    };
  }

  if (productMentions === 0) {
    if (isProductSpecificUrl) {
      return {
        isValid: true,
        matchedCompetitor: null,
        reason: `No explicit product or competitor mention but URL is product-specific - accepting`,
      };
    }
    return {
      isValid: false,
      matchedCompetitor: null,
      reason: `No explicit product or competitor mention and URL is not product-specific - discarding`,
    };
  }

  return {
    isValid: true,
    matchedCompetitor: null,
    reason: `Valid: "${productName}" mentioned ${productMentions}x, no competitor mentions`,
  };
}

/**
 * Finds which competitor (if any) a URL matches from a list of known competitors
 * Returns the competitor name if found, null otherwise
 */
export function findMatchingCompetitor(url: string, competitors: string[]): string | null {
  if (!url || !url.startsWith("http") || !competitors || competitors.length === 0) {
    return null;
  }

  for (const competitor of competitors) {
    if (validateProductUrl(url, competitor)) {
      return competitor;
    }
  }

  return null;
}

export function generateFallbackSearchUrl(productName: string, platform: "g2" | "capterra" | "trustradius" | "reddit"): string {
  const encodedName = encodeURIComponent(productName);

  switch (platform) {
    case "g2":
      return `https://www.g2.com/search?query=${encodedName}`;
    case "capterra":
      return `https://www.capterra.com/search/?search=${encodedName}`;
    case "trustradius":
      return `https://www.trustradius.com/search?q=${encodedName}`;
    case "reddit":
      return `https://www.reddit.com/search/?q=${encodedName}%20review`;
    default:
      return `https://www.google.com/search?q=${encodedName}+reviews`;
  }
}
