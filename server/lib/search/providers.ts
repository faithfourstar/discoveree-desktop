/**
 * Search Provider Abstraction — ported whole from the SaaS
 * server/searchProviders.ts (brief §3: web search survives unchanged).
 *
 * Provides a unified interface for web search across multiple providers:
 * - Perplexity (primary - designed for web search)
 * - OpenAI Responses API with web_search tool
 * - Gemini with googleSearch grounding (fallback)
 *
 * Seam changes only: keys come from the local org row (BYO — platform env
 * fallbacks deleted), and `getAvailableSearchProviders` no longer assumes
 * Gemini is "always available via Replit integration" — a provider is
 * available only when its key exists.
 */
import { trackLlmUsage } from "../llm/usage.js";
import { sanitizeJsonResponse } from "../llm/json.js";
import { callLLM } from "../llm/router.js";
import { AgentSlugs } from "../agents/slugs.js";
import {
  getOpenAIApiKey as getOrgOpenAIApiKey,
  getPerplexityApiKey as getOrgPerplexityApiKey,
  getGeminiApiKey as getOrgGeminiApiKey,
} from "../llm/keys.js";

export type SearchProvider = "perplexity" | "openai_web_search" | "gemini";

// Cache for org-specific API keys to avoid repeated decryption
const orgApiKeyCache = new Map<string, { openai?: string; perplexity?: string; expiry: number }>();

// 1-hour in-memory cache for Gemini web-search results.
// Keyed by sorted product names so identical sets of products share a single cached entry,
// eliminating redundant calls when the Sources tab or other triggers fire within the TTL window.
const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const platformSearchCache = new Map<string, { result: PlatformSearchResult; expiresAt: number }>();
const newsSearchCache = new Map<string, { result: NewsSourceSearchResult; expiresAt: number }>();

/**
 * Get OpenAI API key for a specific organisation (BYO only).
 */
async function getOpenAIApiKey(organizationId?: string): Promise<string | null> {
  if (!organizationId) return null;

  const cached = orgApiKeyCache.get(organizationId);
  if (cached && cached.expiry > Date.now() && cached.openai) {
    return cached.openai;
  }

  try {
    const decryptedKey = await getOrgOpenAIApiKey(organizationId);
    if (decryptedKey) {
      orgApiKeyCache.set(organizationId, {
        ...cached,
        openai: decryptedKey,
        expiry: Date.now() + 5 * 60 * 1000,
      });
      return decryptedKey;
    }
  } catch (error) {
    console.error("[OpenAI] Error getting org key:", error);
  }

  return null;
}

/**
 * Get Perplexity API key for a specific organisation (BYO only).
 */
async function getPerplexityApiKey(organizationId?: string): Promise<string | null> {
  if (!organizationId) return null;

  const cached = orgApiKeyCache.get(organizationId);
  if (cached && cached.expiry > Date.now() && cached.perplexity) {
    return cached.perplexity;
  }

  try {
    const decryptedKey = await getOrgPerplexityApiKey(organizationId);
    if (decryptedKey) {
      orgApiKeyCache.set(organizationId, {
        ...cached,
        perplexity: decryptedKey,
        expiry: Date.now() + 5 * 60 * 1000,
      });
      return decryptedKey;
    }
  } catch (error) {
    console.error("[Perplexity] Error getting org key:", error);
  }

  return null;
}

/**
 * Clear cached API keys for an organisation (call when API keys are updated)
 */
export function clearApiKeyCache(organizationId: string): void {
  orgApiKeyCache.delete(organizationId);
}

export interface SearchProviderConfig {
  provider: SearchProvider;
  apiKey?: string;
}

export interface PlatformMention {
  productName: string;
  productUrl: string;
  verified?: boolean;
}

export interface DiscoveredPlatform {
  name: string;
  platformUrl: string;
  mentions: PlatformMention[];
  /** "review" = genuine user-generated content (G2, Reddit, forums); "editorial" = one-way editorial content (blogs, news) */
  sourceType?: "review" | "editorial";
}

export interface DiscoveredNewsSource {
  name: string;
  url: string;
  type: "news" | "blog" | "publication";
  relevanceScore?: number;
}

export interface PlatformSearchResult {
  platforms: DiscoveredPlatform[];
  analysisNotes: string;
  providerUsed: SearchProvider;
  success: boolean;
}

export interface NewsSourceSearchResult {
  sources: DiscoveredNewsSource[];
  analysisNotes: string;
  providerUsed: SearchProvider;
  success: boolean;
}

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const PERPLEXITY_MODEL = "llama-3.1-sonar-large-128k-online";

/**
 * Validate that a URL is a proper HTTP/HTTPS URL
 */
function isValidHttpUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Search for review platforms using Perplexity
 */
async function searchPlatformsPerplexity(
  productNames: string[],
  organizationId?: string,
): Promise<PlatformSearchResult> {
  const apiKey = await getPerplexityApiKey(organizationId);
  if (!apiKey) {
    console.log("[Search:Perplexity] No API key configured");
    return { platforms: [], analysisNotes: "Perplexity API key not configured", providerUsed: "perplexity", success: false };
  }

  const prompt = `Search the web to find websites and platforms where these software products are genuinely reviewed or discussed by real users:

Products: ${productNames.join(", ")}

SEARCH FOR SOURCES WHERE USERS ACTIVELY REVIEW OR DISCUSS PRODUCTS:
1. SOFTWARE REVIEW PLATFORMS: G2, Capterra, TrustRadius, GetApp, Software Advice, Gartner Peer Insights, SourceForge, AlternativeTo, SaaSHub, Crozdesk, FinancesOnline, Product Hunt
2. APP MARKETPLACES: Xero App Store, Salesforce AppExchange, Shopify App Store, HubSpot Marketplace, QuickBooks App Store, Zapier, Microsoft AppSource
3. COMMUNITY DISCUSSION SITES: Reddit (r/[relevant subreddit]), Quora, Stack Overflow, industry forums, product-specific communities

DO NOT include:
- Blog posts, "X vs Y" comparison articles, or buyer's guides written by editorial teams
- News articles, press releases, or announcements
- YouTube videos, social media posts, or industry analyst reports
- Any site where the content is produced by editors/journalists rather than real product users

For each platform found, classify its sourceType:
- "review": Has genuine user-generated ratings, reviews, or discussion (G2, Reddit, forums, marketplaces)
- "editorial": Content is written by editors/journalists with no real user reviews (blogs, news sites)

Return ONLY valid JSON in this exact format:
{
  "platforms": [
    {
      "name": "Platform or Site Name",
      "platformUrl": "https://main-site-url.com",
      "sourceType": "review",
      "mentions": [
        { "productName": "Product Name", "productUrl": "https://specific-url-where-product-mentioned" }
      ]
    }
  ],
  "analysisNotes": "Brief summary of what was found"
}`;

  try {
    console.log("[Search:Perplexity] Searching for platforms for:", productNames);

    const response = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages: [
          { role: "system", content: "You are a helpful assistant that searches for software review platforms. Return only valid JSON with no additional text." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Search:Perplexity] API error:", response.status, errorText);
      return { platforms: [], analysisNotes: `Perplexity API error: ${response.status}`, providerUsed: "perplexity", success: false };
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || "";
    const citations = data.citations || [];

    console.log("[Search:Perplexity] Raw response:", content.substring(0, 500));
    console.log("[Search:Perplexity] Citations:", citations);

    // Track usage for cost visibility
    const usage = data.usage || {};
    await trackLlmUsage(
      organizationId,
      "perplexity",
      PERPLEXITY_MODEL,
      "review_platforms",
      usage.prompt_tokens || 0,
      usage.completion_tokens || 0,
      true,
    );

    // Parse the JSON response
    const sanitized = sanitizeJsonResponse(content);
    const result = JSON.parse(sanitized || '{"platforms": [], "analysisNotes": "Failed to parse response"}');

    // Validate URLs
    result.platforms = (result.platforms || []).map((platform: DiscoveredPlatform) => ({
      ...platform,
      platformUrl: platform.platformUrl || "",
      mentions: (platform.mentions || []).filter((m: PlatformMention) =>
        m.productUrl && isValidHttpUrl(m.productUrl),
      ),
    })).filter((p: DiscoveredPlatform) => p.mentions.length > 0);

    console.log(`[Search:Perplexity] Found ${result.platforms.length} platforms`);

    return {
      platforms: result.platforms,
      analysisNotes: result.analysisNotes || "Search completed",
      providerUsed: "perplexity",
      success: true,
    };
  } catch (error) {
    console.error("[Search:Perplexity] Error:", error);
    return { platforms: [], analysisNotes: `Perplexity error: ${error}`, providerUsed: "perplexity", success: false };
  }
}

/**
 * Search for review platforms using OpenAI Responses API with web_search
 */
async function searchPlatformsOpenAI(
  productNames: string[],
  organizationId?: string,
): Promise<PlatformSearchResult> {
  const apiKey = await getOpenAIApiKey(organizationId);
  if (!apiKey) {
    console.log("[Search:OpenAI] No API key configured");
    return { platforms: [], analysisNotes: "OpenAI API key not configured", providerUsed: "openai_web_search", success: false };
  }

  const prompt = `Search the web to find websites and platforms where these software products are genuinely reviewed or discussed by real users:

Products: ${productNames.join(", ")}

SEARCH FOR SOURCES WHERE USERS ACTIVELY REVIEW OR DISCUSS PRODUCTS:
1. SOFTWARE REVIEW PLATFORMS: G2, Capterra, TrustRadius, GetApp, Software Advice, Gartner Peer Insights, SourceForge, AlternativeTo, SaaSHub, Product Hunt
2. APP MARKETPLACES: Xero App Store, Salesforce AppExchange, Shopify App Store, HubSpot Marketplace, QuickBooks App Store, Zapier, Microsoft AppSource
3. COMMUNITY DISCUSSION SITES: Reddit (r/[relevant subreddit]), Quora, Stack Overflow, industry forums

DO NOT include blog posts, "X vs Y" comparison articles, news articles, press releases, YouTube videos, or industry analyst reports.

For each platform found, classify its sourceType:
- "review": Has genuine user-generated ratings, reviews, or discussion (G2, Reddit, forums, marketplaces)
- "editorial": Content is written by editors/journalists with no real user reviews (blogs, news sites)

Return ONLY valid JSON:
{
  "platforms": [
    {
      "name": "Platform or Site Name",
      "platformUrl": "https://main-site-url.com",
      "sourceType": "review",
      "mentions": [
        { "productName": "Product Name", "productUrl": "https://specific-url-where-product-mentioned" }
      ]
    }
  ],
  "analysisNotes": "Brief summary"
}`;

  try {
    console.log("[Search:OpenAI] Searching for platforms for:", productNames);

    // Use the Responses API with web_search tool
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        tools: [{ type: "web_search" }],
        input: prompt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Search:OpenAI] API error:", response.status, errorText);
      return { platforms: [], analysisNotes: `OpenAI API error: ${response.status}`, providerUsed: "openai_web_search", success: false };
    }

    const data = await response.json() as any;

    // Extract output text from Responses API format
    let outputText = "";
    if (data.output) {
      for (const item of data.output) {
        if (item.type === "message" && item.content) {
          for (const content of item.content) {
            if (content.type === "output_text") {
              outputText = content.text;
              break;
            }
          }
        }
      }
    }

    console.log("[Search:OpenAI] Raw response:", outputText.substring(0, 500));

    // Track usage for cost visibility
    const usage = data.usage || {};
    await trackLlmUsage(
      organizationId,
      "openai",
      "gpt-4o",
      "review_platforms",
      usage.input_tokens || 0,
      usage.output_tokens || 0,
      true,
    );

    // Parse the JSON response
    const sanitized = sanitizeJsonResponse(outputText);
    const result = JSON.parse(sanitized || '{"platforms": [], "analysisNotes": "Failed to parse response"}');

    // Validate URLs
    result.platforms = (result.platforms || []).map((platform: DiscoveredPlatform) => ({
      ...platform,
      platformUrl: platform.platformUrl || "",
      mentions: (platform.mentions || []).filter((m: PlatformMention) =>
        m.productUrl && isValidHttpUrl(m.productUrl),
      ),
    })).filter((p: DiscoveredPlatform) => p.mentions.length > 0);

    console.log(`[Search:OpenAI] Found ${result.platforms.length} platforms`);

    return {
      platforms: result.platforms,
      analysisNotes: result.analysisNotes || "Search completed",
      providerUsed: "openai_web_search",
      success: true,
    };
  } catch (error) {
    console.error("[Search:OpenAI] Error:", error);
    return { platforms: [], analysisNotes: `OpenAI error: ${error}`, providerUsed: "openai_web_search", success: false };
  }
}

/**
 * Search for review platforms using Gemini with Google Search grounding
 */
async function searchPlatformsGemini(
  productNames: string[],
  organizationId?: string,
): Promise<PlatformSearchResult> {
  // Check 1-hour in-memory cache before making a Gemini web-search call.
  const cacheKey = JSON.stringify([...productNames].sort());
  const cachedPlatform = platformSearchCache.get(cacheKey);
  if (cachedPlatform && cachedPlatform.expiresAt > Date.now()) {
    console.log("[Search:Gemini] Returning cached platform search results for:", productNames);
    return cachedPlatform.result;
  }

  const prompt = `Search the web to find websites and platforms where these software products are genuinely reviewed or discussed by real users:

Products to search: ${productNames.join(", ")}

SEARCH STRATEGY - Use multiple search queries for each product:
- "[product name] reviews"
- "[product name] reddit"
- "[product name] forum"
- "[product name] user feedback"
- "[product name] alternatives"

LOOK FOR THESE TYPES OF SOURCES (where users actively review or discuss products):
1. SOFTWARE REVIEW PLATFORMS: G2, Capterra, TrustRadius, Product Hunt, GetApp, Software Advice, Gartner Peer Insights, SourceForge, AlternativeTo, SaaSHub
2. APP MARKETPLACES: Xero App Store, Salesforce AppExchange, Shopify App Store, QuickBooks App Store, Zapier, Microsoft AppSource
3. COMMUNITY DISCUSSION SITES: Reddit (r/[relevant subreddit]), Quora, Stack Overflow, industry forums

DO NOT include: blog posts, "X vs Y" comparison articles written by editors, news articles, press releases, YouTube videos, or analyst reports.

For each platform found, classify its sourceType:
- "review": Has genuine user-generated ratings, reviews, or discussion (G2, Reddit, forums, marketplaces)
- "editorial": Content is written by editors/journalists with no real user reviews (blogs, news sites)

RESPONSE REQUIREMENTS:
1. Return the EXACT URL from search results (not constructed URLs)
2. Include community sites (Reddit, forums) where users genuinely discuss products
3. Products may be listed under different names - search variations

Return JSON in this format:
{
  "platforms": [
    {
      "name": "Platform or Site Name",
      "platformUrl": "https://main-site-url.com",
      "sourceType": "review",
      "mentions": [
        { "productName": "Product Name", "productUrl": "https://specific-url-where-mentioned" }
      ]
    }
  ],
  "analysisNotes": "Summary of search results"
}`;

  try {
    console.log("[Search:Gemini] Starting search for products:", productNames);

    const response = await callLLM({
      organizationId: organizationId || "",
      agentSlug: AgentSlugs.PLATFORM_SEARCH,
      prompt,
      useWebSearch: true,
    });

    console.log("[Search:Gemini] Raw response:", response.text?.substring(0, 500));

    const sanitized = sanitizeJsonResponse(response.text);
    const result = JSON.parse(sanitized || '{"platforms": [], "analysisNotes": "No response"}');

    // Validate URLs (no domain filtering - just check format)
    result.platforms = (result.platforms || []).map((platform: DiscoveredPlatform) => ({
      ...platform,
      platformUrl: platform.platformUrl || "",
      mentions: (platform.mentions || []).filter((m: PlatformMention) =>
        m.productUrl && isValidHttpUrl(m.productUrl),
      ),
    })).filter((p: DiscoveredPlatform) => p.mentions.length > 0);

    console.log(`[Search:Gemini] Found ${result.platforms.length} platforms`);

    const platformResult: PlatformSearchResult = {
      platforms: result.platforms,
      analysisNotes: result.analysisNotes || "Search completed",
      providerUsed: "gemini",
      success: result.platforms.length > 0,
    };
    // Store successful results in cache
    if (platformResult.success) {
      platformSearchCache.set(cacheKey, { result: platformResult, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
    }
    return platformResult;
  } catch (error) {
    console.error("[Search:Gemini] Error:", error);
    return { platforms: [], analysisNotes: `Gemini error: ${error}`, providerUsed: "gemini", success: false };
  }
}

/**
 * Search for news sources using Perplexity
 */
async function searchNewsPerplexity(
  productNames: string[],
  industry: string,
  organizationId?: string,
): Promise<NewsSourceSearchResult> {
  const apiKey = await getPerplexityApiKey(organizationId);
  if (!apiKey) {
    return { sources: [], analysisNotes: "Perplexity API key not configured", providerUsed: "perplexity", success: false };
  }

  const prompt = `Find news publications, industry blogs, and tech news sites that cover these software products or their industry:

Products: ${productNames.join(", ")}
Industry: ${industry || "Software/Technology"}

Search for:
1. Tech news sites that have written about any of these products
2. Industry-specific publications covering this market
3. Popular blogs in this space
4. Trade publications and analyst sites

For each source, provide the publication name and main URL.

Return ONLY valid JSON:
{
  "sources": [
    { "name": "Publication Name", "url": "https://publication-url.com", "type": "news" }
  ],
  "analysisNotes": "Brief summary"
}

Types can be: "news", "blog", or "publication"`;

  try {
    console.log("[Search:Perplexity] Searching for news sources for:", productNames);

    const response = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages: [
          { role: "system", content: "You are a helpful assistant that finds news and publication sources. Return only valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      return { sources: [], analysisNotes: `Perplexity API error: ${response.status}`, providerUsed: "perplexity", success: false };
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || "";

    // Track usage
    const usage = data.usage || {};
    await trackLlmUsage(
      organizationId,
      "perplexity",
      PERPLEXITY_MODEL,
      "news_sources",
      usage.prompt_tokens || 0,
      usage.completion_tokens || 0,
      true,
    );

    const sanitized = sanitizeJsonResponse(content);
    const result = JSON.parse(sanitized || '{"sources": [], "analysisNotes": "Failed to parse"}');

    // Validate URLs
    result.sources = (result.sources || []).filter((s: DiscoveredNewsSource) =>
      s.url && isValidHttpUrl(s.url),
    );

    console.log(`[Search:Perplexity] Found ${result.sources.length} news sources`);

    return {
      sources: result.sources,
      analysisNotes: result.analysisNotes || "Search completed",
      providerUsed: "perplexity",
      success: true,
    };
  } catch (error) {
    console.error("[Search:Perplexity] News search error:", error);
    return { sources: [], analysisNotes: `Perplexity error: ${error}`, providerUsed: "perplexity", success: false };
  }
}

/**
 * Search for news sources using OpenAI web search
 */
async function searchNewsOpenAI(
  productNames: string[],
  industry: string,
  organizationId?: string,
): Promise<NewsSourceSearchResult> {
  const apiKey = await getOpenAIApiKey(organizationId);
  if (!apiKey) {
    return { sources: [], analysisNotes: "OpenAI API key not configured", providerUsed: "openai_web_search", success: false };
  }

  const prompt = `Search the web to find news publications, industry blogs, and tech news sites that cover these software products:

Products: ${productNames.join(", ")}
Industry: ${industry || "Software/Technology"}

Find relevant publications including tech news sites, industry-specific publications, popular blogs, and trade publications.

Return ONLY valid JSON:
{
  "sources": [
    { "name": "Publication Name", "url": "https://publication-url.com", "type": "news" }
  ],
  "analysisNotes": "Brief summary"
}`;

  try {
    console.log("[Search:OpenAI] Searching for news sources for:", productNames);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        tools: [{ type: "web_search" }],
        input: prompt,
      }),
    });

    if (!response.ok) {
      return { sources: [], analysisNotes: `OpenAI API error: ${response.status}`, providerUsed: "openai_web_search", success: false };
    }

    const data = await response.json() as any;

    let outputText = "";
    if (data.output) {
      for (const item of data.output) {
        if (item.type === "message" && item.content) {
          for (const content of item.content) {
            if (content.type === "output_text") {
              outputText = content.text;
              break;
            }
          }
        }
      }
    }

    const usage = data.usage || {};
    await trackLlmUsage(
      organizationId,
      "openai",
      "gpt-4o",
      "news_sources",
      usage.input_tokens || 0,
      usage.output_tokens || 0,
      true,
    );

    const sanitized = sanitizeJsonResponse(outputText);
    const result = JSON.parse(sanitized || '{"sources": [], "analysisNotes": "Failed to parse"}');

    result.sources = (result.sources || []).filter((s: DiscoveredNewsSource) =>
      s.url && isValidHttpUrl(s.url),
    );

    console.log(`[Search:OpenAI] Found ${result.sources.length} news sources`);

    return {
      sources: result.sources,
      analysisNotes: result.analysisNotes || "Search completed",
      providerUsed: "openai_web_search",
      success: true,
    };
  } catch (error) {
    console.error("[Search:OpenAI] News search error:", error);
    return { sources: [], analysisNotes: `OpenAI error: ${error}`, providerUsed: "openai_web_search", success: false };
  }
}

/**
 * Search for news sources using Gemini with Google Search
 */
async function searchNewsGemini(
  productNames: string[],
  industry: string,
  organizationId?: string,
): Promise<NewsSourceSearchResult> {
  // Check 1-hour in-memory cache before making a Gemini web-search call.
  const newsCacheKey = JSON.stringify({ products: [...productNames].sort(), industry: industry || "" });
  const cachedNews = newsSearchCache.get(newsCacheKey);
  if (cachedNews && cachedNews.expiresAt > Date.now()) {
    console.log("[Search:Gemini] Returning cached news search results for:", productNames);
    return cachedNews.result;
  }

  const prompt = `Search the web to find news publications, industry blogs, and tech news sites that cover these software products:

Products: ${productNames.join(", ")}
Industry: ${industry || "Software/Technology"}

Find:
1. Tech news sites that have written about any of these products
2. Industry-specific publications covering this market
3. Popular blogs in this space
4. Trade publications and analyst sites

Return JSON:
{
  "sources": [
    { "name": "Publication Name", "url": "https://publication-url.com", "type": "news" }
  ],
  "analysisNotes": "Brief summary of what was found"
}`;

  try {
    console.log("[Search:Gemini] Searching for news sources for:", productNames);

    const response = await callLLM({
      organizationId: organizationId || "",
      agentSlug: AgentSlugs.NEWS_SEARCH,
      prompt,
      useWebSearch: true,
    });

    const sanitized = sanitizeJsonResponse(response.text);
    const result = JSON.parse(sanitized || '{"sources": [], "analysisNotes": "No response"}');

    result.sources = (result.sources || []).filter((s: DiscoveredNewsSource) =>
      s.url && isValidHttpUrl(s.url),
    );

    console.log(`[Search:Gemini] Found ${result.sources.length} news sources`);

    const newsResult: NewsSourceSearchResult = {
      sources: result.sources,
      analysisNotes: result.analysisNotes || "Search completed",
      providerUsed: "gemini",
      success: result.sources.length > 0,
    };
    // Store successful results in cache
    if (newsResult.success) {
      newsSearchCache.set(newsCacheKey, { result: newsResult, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
    }
    return newsResult;
  } catch (error) {
    console.error("[Search:Gemini] News search error:", error);
    return { sources: [], analysisNotes: `Gemini error: ${error}`, providerUsed: "gemini", success: false };
  }
}

/**
 * Main function to search for review platforms with fallback
 */
export async function searchReviewPlatforms(
  productNames: string[],
  preferredProvider: SearchProvider = "perplexity",
  organizationId?: string,
): Promise<PlatformSearchResult> {
  const providers: SearchProvider[] = [];

  // Order providers based on preference
  if (preferredProvider === "perplexity") {
    providers.push("perplexity", "openai_web_search", "gemini");
  } else if (preferredProvider === "openai_web_search") {
    providers.push("openai_web_search", "perplexity", "gemini");
  } else {
    providers.push("gemini", "perplexity", "openai_web_search");
  }

  console.log(`[SearchProvider] Starting platform search with order: ${providers.join(" -> ")}`);

  for (const provider of providers) {
    let result: PlatformSearchResult;

    switch (provider) {
      case "perplexity":
        result = await searchPlatformsPerplexity(productNames, organizationId);
        break;
      case "openai_web_search":
        result = await searchPlatformsOpenAI(productNames, organizationId);
        break;
      case "gemini":
        result = await searchPlatformsGemini(productNames, organizationId);
        break;
    }

    if (result.success && result.platforms.length > 0) {
      console.log(`[SearchProvider] Success with ${provider}: ${result.platforms.length} platforms found`);
      return result;
    }

    console.log(`[SearchProvider] ${provider} returned no results or failed, trying next...`);
  }

  // All providers failed
  return {
    platforms: [],
    analysisNotes: "All search providers failed to find results",
    providerUsed: providers[providers.length - 1]!,
    success: false,
  };
}

/**
 * Main function to search for news sources with fallback
 */
export async function searchNewsSources(
  productNames: string[],
  industry: string,
  preferredProvider: SearchProvider = "perplexity",
  organizationId?: string,
): Promise<NewsSourceSearchResult> {
  const providers: SearchProvider[] = [];

  // Order providers based on preference
  if (preferredProvider === "perplexity") {
    providers.push("perplexity", "openai_web_search", "gemini");
  } else if (preferredProvider === "openai_web_search") {
    providers.push("openai_web_search", "perplexity", "gemini");
  } else {
    providers.push("gemini", "perplexity", "openai_web_search");
  }

  console.log(`[SearchProvider] Starting news search with order: ${providers.join(" -> ")}`);

  for (const provider of providers) {
    let result: NewsSourceSearchResult;

    switch (provider) {
      case "perplexity":
        result = await searchNewsPerplexity(productNames, industry, organizationId);
        break;
      case "openai_web_search":
        result = await searchNewsOpenAI(productNames, industry, organizationId);
        break;
      case "gemini":
        result = await searchNewsGemini(productNames, industry, organizationId);
        break;
    }

    if (result.success && result.sources.length > 0) {
      console.log(`[SearchProvider] Success with ${provider}: ${result.sources.length} sources found`);
      return result;
    }

    console.log(`[SearchProvider] ${provider} returned no results or failed, trying next...`);
  }

  return {
    sources: [],
    analysisNotes: "All search providers failed to find results",
    providerUsed: providers[providers.length - 1]!,
    success: false,
  };
}

/**
 * Get list of available search providers based on configured API keys.
 * Desktop seam change: a provider is available only when its BYO key exists
 * (the SaaS assumed Gemini was always available via a platform integration).
 */
export async function getAvailableSearchProviders(organizationId?: string): Promise<SearchProvider[]> {
  const available: SearchProvider[] = [];

  // Check Perplexity availability
  const perplexityKey = await getPerplexityApiKey(organizationId);
  if (perplexityKey) {
    available.push("perplexity");
  }

  // Check Gemini availability
  if (organizationId) {
    try {
      const geminiKey = await getOrgGeminiApiKey(organizationId);
      if (geminiKey) {
        available.push("gemini");
      }
    } catch {
      // no Gemini key
    }
  }

  // Check OpenAI availability
  const openaiKey = await getOpenAIApiKey(organizationId);
  if (openaiKey) {
    available.push("openai_web_search");
  }

  return available;
}
