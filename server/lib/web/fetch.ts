/**
 * Web fetch + URL validation helpers — ported from the SaaS gemini.ts:420–548
 * (SOFT_404_PATTERNS, fetchViaJina, validateUrl[s]WithSoft404Detection).
 *
 * ADR 002 risk 5: `fetchViaJina` depends on the free r.jina.ai proxy —
 * outbound-only, no data stored there beyond fetched public pages. Kept
 * behind this module so a native-fetch fallback can be added without
 * touching agents.
 */

/**
 * Soft 404 detection patterns - phrases that indicate a page doesn't exist
 * even when the server returns HTTP 200
 */
const SOFT_404_PATTERNS = [
  /404[\s\-–—]*page\s*(missing|not\s*found)/i,
  /page\s*(missing|not\s*found)/i,
  /(this|that)\s*page\s*(doesn't|does\s*not|does&#x27;t)\s*exist/i,
  /we\s*can'?t\s*(quite\s*)?find\s*(what\s*you)/i,
  /sorry[\s,]+.*page.*not\s*found/i,
  /the\s*page\s*you\s*(are\s*)?(looking\s*for|requested)/i,
  /oops[\s!]+.*not\s*found/i,
  /uh\s*oh[.!,]?\s*(that\s*page|page)/i,
  /error\s*404/i,
  /page\s*does\s*not\s*exist/i,
  /content\s*(not\s*found|unavailable)/i,
  /(this|that)\s*link\s*(is\s*)?(broken|invalid)/i,
  /page\s*has\s*been\s*(removed|deleted|moved)/i,
  /it'?s\s*not\s*here/i,
  /nowhere\s*to\s*be\s*found/i,
  /hmm[,.]?\s*it'?s\s*not\s*here/i,
  /article\s*(not\s*found|does\s*not\s*exist|unavailable)/i,
  /we\s*couldn'?t\s*find\s*(this|that|the)\s*(page|article)/i,
  /this\s*article\s*(doesn't|does\s*not)\s*exist/i,
];

/**
 * Fetch a URL's content via Jina Reader (https://r.jina.ai/).
 * Jina runs a headless browser and returns clean markdown, bypassing Cloudflare,
 * bot protection, and JS-rendered pages that raw fetch() cannot access.
 */
export async function fetchViaJina(url: string, timeoutMs: number = 15000): Promise<string | null> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    // Include JINA_API_KEY when set — improves rate limits and content quality.
    const jinaApiKey = process.env["JINA_API_KEY"];
    const headers: Record<string, string> = {
      "Accept": "text/plain, text/markdown, */*",
      "X-Return-Format": "markdown",
    };
    if (jinaApiKey) {
      headers["Authorization"] = `Bearer ${jinaApiKey}`;
    }
    const response = await fetch(jinaUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const text = (await response.text()).trim();
    return text.length > 100 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Validate a URL by checking both HTTP status and response body for soft 404s.
 * Returns the URL if valid, null if invalid or soft 404.
 */
export async function validateUrlWithSoft404Detection(
  url: string,
  timeoutMs: number = 3000,
): Promise<string | null> {
  if (!url || !url.startsWith("http")) {
    return null;
  }

  try {
    // Use GET to read response body for soft 404 detection
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ProductIntelligenceBot/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Check HTTP status first
    if (!response.ok) {
      return null;
    }

    // Read response body to check for soft 404 patterns
    const contentType = response.headers.get("content-type") || "";

    // Only check HTML content for soft 404 patterns
    if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
      const text = await response.text();

      // Check the first 10000 characters for soft 404 patterns (title/header/body area)
      const checkText = text.slice(0, 10000).toLowerCase();

      for (const pattern of SOFT_404_PATTERNS) {
        if (pattern.test(checkText)) {
          console.log(`[URL Validation] Soft 404 detected at ${url}: matched pattern ${pattern}`);
          return null;
        }
      }
    }

    return url;
  } catch {
    // Timeout, network error, or other failure
    return null;
  }
}

/**
 * Validate multiple URLs in parallel with soft 404 detection.
 * Returns array of valid URLs (nulls filtered out).
 */
export async function validateUrlsWithSoft404Detection(
  urls: string[],
  timeoutMs: number = 3000,
): Promise<string[]> {
  const results = await Promise.all(
    urls.map(url => validateUrlWithSoft404Detection(url, timeoutMs)),
  );
  return results.filter((url): url is string => url !== null);
}
