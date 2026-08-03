/**
 * URL classification helpers — ported from the SaaS gemini.ts:9943–9990
 * (isGroundingRedirectUrl / isReviewSiteUrl).
 */

/**
 * True when a URL is a Google grounding redirect (vertexaisearch) rather than
 * a real destination. Such URLs must never be stored as official/source URLs.
 */
export function isGroundingRedirectUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.includes("grounding-api-redirect")) return true;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "vertexaisearch.cloud.google.com";
  } catch {
    return false;
  }
}

/**
 * Helper function to detect if a URL is from a review site (or a grounding redirect).
 * Any URL returning true here should NOT be used as a competitor's official website URL.
 */
export function isReviewSiteUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  // Grounding redirect URLs should always be rejected as invalid official URLs
  if (isGroundingRedirectUrl(url)) return true;

  const reviewSitePatterns = [
    "g2.com",
    "capterra.com",
    "trustradius.com",
    "softwareadvice.com",
    "getapp.com",
    "gartner.com/reviews",
    "reddit.com",
    "producthunt.com",
    "alternativeto.net",
    "softwaresuggest.com",
    "trustpilot.com",
    "crunchbase.com",
    "linkedin.com",
    "twitter.com",
    "facebook.com",
    "youtube.com",
    "monito.com",
    "nerdwallet.com",
    "finder.com",
    "moneysavingexpert.com",
  ];

  const urlLower = url.toLowerCase();
  return reviewSitePatterns.some(pattern => urlLower.includes(pattern));
}
