/**
 * Review fetching — ported from the SaaS reviewService.ts with EVERY g2Api
 * branch deleted (ADR 004 §2: G2 API is CUT — a dead platform credential
 * under BYO keys). Web-search mining is the only source; the validation
 * pipeline in lib/reviews/search.ts is what makes its output evidence-grade.
 *
 * `mergeQuotesWithAIGenerated` deliberately does NOT port — "ai_generated"
 * quotes are fabricated evidence, banned by ADR 004 §3.
 */
import { searchProductReviews, searchCompetitorReviews } from "./search.js";
import type { ReviewSourceType } from "@shared/schema";

export interface EnrichedReviewQuote {
  text: string;
  source: string;
  sourceUrl: string;
  sentiment: number | null;
  verified: boolean;
  sourceType: ReviewSourceType;
  fetchedAt: string;
  /** When the review was authored at its source; null when the source shows none. */
  sourceCreatedAt: string | null;
}

export interface CrossAllocatedQuote extends EnrichedReviewQuote {
  matchedCompetitor: string;
}

export interface ProductReviewData {
  quotes: EnrichedReviewQuote[];
  crossAllocatedQuotes: CrossAllocatedQuote[]; // Reviews that matched a competitor instead
  sourcesUsed: string[];
  hasRealData: boolean;
}

export async function fetchProductReviews(
  productName: string,
  maxQuotes = 5,
  trustedFeedbackSources?: Array<{ name: string; url: string }>,
  organizationId?: string,
  knownCompetitors?: string[], // List of known competitor names for cross-allocation
): Promise<ProductReviewData> {
  const quotes: EnrichedReviewQuote[] = [];
  const crossAllocatedQuotes: CrossAllocatedQuote[] = [];
  const sourcesUsed: string[] = [];
  const now = new Date().toISOString();

  try {
    const searchResult = await searchProductReviews(productName, maxQuotes, trustedFeedbackSources, organizationId, knownCompetitors);

    if (searchResult.reviews.length > 0) {
      quotes.push(...searchResult.reviews.map(r => ({
        text: r.text,
        source: r.source,
        sourceUrl: r.sourceUrl,
        sentiment: r.sentiment,
        verified: r.verified,
        sourceType: "web_search" as ReviewSourceType,
        fetchedAt: now,
        sourceCreatedAt: r.sourceCreatedAt,
      })));
      sourcesUsed.push(...searchResult.sourcesFound);
      console.log(`[Review Service] Found ${searchResult.reviews.length} quotes from web search for ${productName}`);
    }

    // Add cross-allocated reviews (reviews that matched a competitor instead)
    if (searchResult.crossAllocatedReviews.length > 0) {
      crossAllocatedQuotes.push(...searchResult.crossAllocatedReviews.map(r => ({
        text: r.text,
        source: r.source,
        sourceUrl: r.sourceUrl,
        sentiment: r.sentiment,
        verified: r.verified,
        sourceType: "web_search" as ReviewSourceType,
        fetchedAt: now,
        sourceCreatedAt: r.sourceCreatedAt,
        matchedCompetitor: r.matchedCompetitor,
      })));
      console.log(`[Review Service] Cross-allocated ${searchResult.crossAllocatedReviews.length} reviews to competitors`);
    }
  } catch (error) {
    console.error("[Review Service] Web search error:", error);
  }

  if (quotes.length === 0) {
    console.log(`[Review Service] No real reviews found for ${productName}`);
  }

  return {
    quotes: quotes.slice(0, maxQuotes),
    crossAllocatedQuotes,
    sourcesUsed: Array.from(new Set(sourcesUsed)),
    hasRealData: quotes.length > 0,
  };
}

export async function fetchCompetitorReviews(
  productName: string,
  competitorName: string,
  topic: string,
  maxQuotes = 3,
  trustedFeedbackSources?: Array<{ name: string; url: string }>,
  organizationId?: string,
): Promise<EnrichedReviewQuote[]> {
  const quotes: EnrichedReviewQuote[] = [];
  const now = new Date().toISOString();

  try {
    const webReviews = await searchCompetitorReviews(productName, competitorName, topic, maxQuotes, trustedFeedbackSources, organizationId);

    quotes.push(...webReviews.map(r => ({
      text: r.text,
      source: r.source,
      sourceUrl: r.sourceUrl,
      sentiment: r.sentiment,
      verified: r.verified,
      sourceType: "web_search" as ReviewSourceType,
      fetchedAt: now,
      sourceCreatedAt: r.sourceCreatedAt,
    })));
  } catch (error) {
    console.error("[Review Service] Web search error for competitor:", error);
  }

  if (quotes.length === 0) {
    console.log(`[Review Service] No real reviews found for competitor ${competitorName}`);
  }

  return quotes.slice(0, maxQuotes);
}
