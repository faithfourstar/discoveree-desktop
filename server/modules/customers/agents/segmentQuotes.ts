/**
 * Customer quotes agent — ported from the SaaS gemini.ts:5809–5933
 * (`findCustomerSegmentQuotes`). Evidence GATHERING (ADR 004 §3.3 layer 2):
 * web search stays ON because its output carries URLs — the quotes ARE
 * evidence. Zod at the boundary; on the Gemini path the router's grounded
 * two-phase already enforces the citation allow-list, and the exported
 * validator is applied again here against the response's real citations.
 */
import { Type } from "@google/genai";
import { callLLM, collectAllowedSourceUrls, enforceSourceUrlAllowList } from "../../../lib/llm/router.js";
import { sanitizeJsonResponse } from "../../../lib/llm/json.js";
import { AgentSlugs } from "../../../lib/agents/slugs.js";
import { customerQuotesResultSchema, type CustomerQuote } from "../schemas.js";

export async function findCustomerSegmentQuotes(
  companyName: string,
  companyUrl: string,
  segmentName: string,
  segmentDescription: string,
  existingQuotes: Array<{ text?: string }>,
  organizationId: string,
): Promise<CustomerQuote[]> {
  let searchDomain = "";
  try {
    const urlObj = new URL(companyUrl.startsWith("http") ? companyUrl : `https://${companyUrl}`);
    searchDomain = urlObj.hostname.replace("www.", "");
  } catch {
    searchDomain = companyUrl.replace(/^https?:\/\//, "").replace("www.", "").split("/")[0] ?? "";
  }

  const existingTexts = existingQuotes.map(q => (q.text || "").toLowerCase().slice(0, 50)).filter(Boolean);
  const existingTextsList = existingTexts.length > 0
    ? `\n\nEXISTING QUOTES TO AVOID DUPLICATING:\n${existingTexts.map(t => `- "${t}..."`).join("\n")}`
    : "";

  const prompt = `You are an expert customer research analyst specializing in finding authentic customer voices and testimonials. Your task is to find real quotes and references from "${segmentName}" users of "${companyName}".

SEGMENT: ${segmentName}
DESCRIPTION: ${segmentDescription || "No description provided"}
COMPANY: ${companyName}
WEBSITE: ${companyUrl || "N/A"}

SEGMENT-SPECIFIC SEARCH INDICATORS:
First, determine what keywords and phrases would indicate a review or quote is from someone in the "${segmentName}" segment. For example:
- If the segment is "Accountants", look for terms like: "clients", "bookkeeping", "tax season", "year-end", "practice", "firm", "audit", "compliance", "payroll"
- If the segment is "Small Businesses", look for: "small team", "growing company", "budget", "startup", "owner", "bootstrapped"

Generate the appropriate indicator terms for "${segmentName}" and use them to filter your search results.

SEARCH STRATEGY (perform ALL of these):
1. Search for "${companyName}" reviews on G2, Capterra, TrustRadius, Software Advice — filter for reviews that mention ${segmentName}-related terms
2. Search for "${companyName} ${segmentName}" case studies and testimonials
3. Search site:${searchDomain} for testimonials, case studies, or customer stories involving ${segmentName}
4. Search for "${companyName}" forum discussions, Reddit posts, or community feedback from ${segmentName} users
5. Search for industry publications or news articles quoting ${segmentName} users of ${companyName}
${existingTextsList}

REQUIREMENTS:
- Find 5-10 REAL, AUTHENTIC quotes — do NOT fabricate or paraphrase
- Each quote must come from a verifiable source with a URL
- Prioritise quotes that reveal needs, pain points, satisfaction, or product feedback
- Include the sentiment of each quote (positive, neutral, negative, mixed)
- Record the date the quote/review was WRITTEN when the source shows one (approximate month is fine); NEVER guess a date
- Rate relevance (1-100) of how confident you are this quote is from the "${segmentName}" segment
- Only include quotes with relevance score above 50
- Do NOT include any quotes that match the existing quotes listed above

Respond with ONLY a valid JSON object:
{
  "segmentIndicators": ["keyword1", "keyword2", "keyword3"],
  "quotes": [
    {
      "text": "Exact quote text from the source",
      "source": "Source name (e.g. G2 Review, Company Blog, Reddit)",
      "sourceUrl": "https://exact-url-where-quote-was-found",
      "attribution": "Role/title of the person (e.g. 'Senior Accountant at Mid-size Firm')",
      "date": "2025-01 or approximate date",
      "sentiment": "positive|negative|neutral|mixed",
      "relevanceScore": 85
    }
  ]
}`;

  try {
    const response = await callLLM({
      organizationId,
      agentSlug: AgentSlugs.CUSTOMER_QUOTES,
      prompt,
      useWebSearch: true,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          segmentIndicators: { type: Type.ARRAY, items: { type: Type.STRING } },
          quotes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                source: { type: Type.STRING },
                sourceUrl: { type: Type.STRING },
                attribution: { type: Type.STRING },
                date: { type: Type.STRING },
                sentiment: { type: Type.STRING },
                relevanceScore: { type: Type.NUMBER },
              },
              required: ["text"],
            },
          },
        },
        required: ["quotes"],
      },
    });

    let raw: unknown = JSON.parse(sanitizeJsonResponse(response.text) || "{}");

    // Evidence gate on URLs: when the provider returned real citations
    // (Perplexity numbered citations; Gemini grounding chunks via the
    // hardened router), any sourceUrl NOT in the allow-list is stripped to
    // null rather than stored as fabricated provenance.
    if (response.citations && response.citations.length > 0) {
      const allowed = collectAllowedSourceUrls(response.citations, response.text);
      const { value, stripped } = enforceSourceUrlAllowList(raw, allowed);
      if (stripped.length > 0) {
        console.log(`[Customer Quotes] Stripped ${stripped.length} unverifiable sourceUrl(s) for segment "${segmentName}"`);
      }
      raw = value;
    }

    const parsed = customerQuotesResultSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[Customer Quotes] Output failed schema validation for "${segmentName}":`, parsed.error.issues.slice(0, 3));
      return [];
    }

    console.log(`[Customer Quotes] Found ${parsed.data.quotes.length} quotes for segment "${segmentName}" of ${companyName}`);
    if (parsed.data.segmentIndicators?.length) {
      console.log(`[Customer Quotes] Segment indicators used: ${parsed.data.segmentIndicators.join(", ")}`);
    }

    return parsed.data.quotes.filter(q => q.text && q.relevanceScore >= 50);
  } catch (error) {
    console.error(`[Customer Quotes] Error finding quotes for "${segmentName}":`, error);
    throw error;
  }
}
