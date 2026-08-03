/**
 * Competitor Summary Agent — ported from the SaaS gemini.ts:10538–10706
 * (`CompetitorSummaryResult` + `generateCompetitorSummary`).
 *
 * Generates a comparative summary of a competitor product by analysing their
 * website. Uses web-search grounding so all data comes from real, verifiable
 * sources. Also extracts target markets.
 *
 * Seam change: the raw LLM JSON is parsed through the module's Zod schema
 * (schemas.ts) before it is returned — never trust unvalidated output.
 */
import { Type } from "@google/genai";
import { callLLM } from "../../../lib/llm/router.js";
import { sanitizeJsonResponse } from "../../../lib/llm/json.js";
import { resolveAgentPrompt } from "../../../lib/agents/registry.js";
import { AgentSlugs } from "../../../lib/agents/slugs.js";
import { progressEmitter } from "../../../lib/progress.js";
import { isGroundingRedirectUrl } from "../../../lib/web/urls.js";
import { competitorSummaryResultSchema, type CompetitorSummaryResult } from "../schemas.js";

export async function generateCompetitorSummary(
  competitorName: string,
  competitorUrl: string,
  productName: string,
  productDescription?: string,
  organizationId?: string,
  taskId?: string,
  productId?: string,
): Promise<CompetitorSummaryResult | null> {
  if (taskId) {
    progressEmitter.emit(taskId, "init", `Generating summary for ${competitorName}...`, 10);
  }

  // Build the fallback prompt with context-specific information
  const fallbackPrompt = `You are a competitive intelligence analyst. Your task is to create a concise, comparative summary of a competitor product.

YOUR TASK:
Analyse ${competitorName}'s website${competitorUrl ? ` (${competitorUrl})` : ""} and public information to:

1. ${competitorUrl ? `Use the provided URL (${competitorUrl}) as the competitor's official website` : `Find ${competitorName}'s official website URL (their main company/product website, NOT a blog post or review site)`}
2. Create a 2-3 sentence summary that describes what ${competitorName} does and how it positions itself
3. Identify 2-3 key differentiators compared to ${productName}${productDescription ? ` (${productDescription})` : ""}
4. Identify target countries/markets (specific countries they operate in)

INFORMATION SOURCE:
${competitorUrl ? `1. Analyse the provided competitor URL: ${competitorUrl}
2. Look for: product descriptions, about pages, pricing pages, case studies
3. Focus on factual information from the competitor's own website
4. If the provided URL doesn't work, fall back to Google Search` : `1. Use Google Search to find ${competitorName}'s official website
2. Look for: their main website homepage, product descriptions, about pages, pricing pages
3. Focus on factual information from the competitor's own official website`}

OUTPUT:
- websiteUrl: The competitor's official website URL (e.g., "https://chaserhq.com" or "https://expensify.com"). This MUST be their main company/product website, NOT a blog post, review site, or article about them.
- summary: 2-3 sentences (max 250 chars) describing what they do
- sourceUrl: Link to the specific page where you found the information (can be the same as websiteUrl if from homepage)
- keyDifferentiators: 2-3 key differences from ${productName}
- markets: List specific countries where they operate (e.g., "United States", "United Kingdom", "Germany", "Japan", "Australia"). IMPORTANT: Only use "Global" if they explicitly serve more than 20 countries. Otherwise, list individual country names. Do NOT use regions like "North America" or "APAC".

CRITICAL REQUIREMENTS:
- websiteUrl MUST be the competitor's official homepage (e.g., https://companyname.com), NOT a third-party site
- Base your analysis on real information from the competitor's website
- Be objective and factual - avoid speculation
- For markets: List specific country names only (e.g., "United States", "Germany"), NOT regions (e.g., NOT "Europe", "APAC", "North America")

IMPORTANT: You MUST respond with ONLY a valid JSON object in this exact format (no markdown, no explanation):
{
  "summary": "2-3 sentence description of the competitor",
  "sourceUrl": "https://...",
  "websiteUrl": "https://...",
  "keyDifferentiators": ["Differentiator 1", "Differentiator 2"],
  "markets": ["United States", "United Kingdom"]
}`;

  // Resolve prompt using priority: org-specific > platform-wide > default > fallback
  const basePrompt = await resolveAgentPrompt(AgentSlugs.COMPETITOR_SUMMARY, organizationId || "", fallbackPrompt);

  // If we got a custom prompt from the database, we need to inject the context variables
  const prompt = basePrompt
    .replace(/\$\{competitorName\}/g, competitorName)
    .replace(/\$\{competitorUrl\}/g, competitorUrl || "")
    .replace(/\$\{productName\}/g, productName)
    .replace(/\$\{productDescription\}/g, productDescription || "");

  console.log(`[Competitor Summary] Generating summary for ${competitorName} compared to ${productName}`);

  if (taskId) {
    progressEmitter.emit(taskId, "searching", `Researching ${competitorName}...`, 40);
  }

  try {
    const response = await callLLM({
      organizationId: organizationId || "",
      productId,
      agentSlug: AgentSlugs.COMPETITOR_SUMMARY,
      prompt,
      useWebSearch: true,
      inputSummary: { competitorName },
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          sourceUrl: { type: Type.STRING },
          websiteUrl: { type: Type.STRING },
          keyDifferentiators: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          markets: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of specific countries (e.g., 'United States', 'Germany'), NOT regions",
          },
        },
        required: ["summary", "sourceUrl", "websiteUrl"],
      },
    });

    const raw = JSON.parse(sanitizeJsonResponse(response.text) || "null");
    const parsed = competitorSummaryResultSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(
        `[Competitor Summary] Zod validation failed for ${competitorName}:`,
        parsed.error.issues,
        `raw: ${JSON.stringify(raw).slice(0, 500)}`,
      );
      return null;
    }
    const result = parsed.data;

    // Attach the provider's numbered citation sources so [n] markers in the text
    // can be rendered as links instead of bare brackets.
    if (response.citations && response.citations.length > 0) {
      result.citations = response.citations;
    }

    // Validate and sanitise websiteUrl — reject grounding redirects and non-http(s) URLs
    if (result.websiteUrl) {
      if (isGroundingRedirectUrl(result.websiteUrl)) {
        console.log(`[Competitor Summary] Rejected grounding redirect websiteUrl for ${competitorName}: ${result.websiteUrl}`);
        result.websiteUrl = undefined;
      } else {
        try {
          const url = new URL(result.websiteUrl);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            result.websiteUrl = undefined;
          }
        } catch {
          result.websiteUrl = undefined;
        }
      }
    }

    // Validate the source URL
    if (result.sourceUrl) {
      if (isGroundingRedirectUrl(result.sourceUrl)) {
        console.log(`[Competitor Summary] Rejected grounding redirect sourceUrl for ${competitorName}: ${result.sourceUrl}`);
        result.sourceUrl = competitorUrl || `https://www.google.com/search?q=${encodeURIComponent(competitorName)}`;
      } else {
        try {
          const url = new URL(result.sourceUrl);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            result.sourceUrl = competitorUrl || `https://www.google.com/search?q=${encodeURIComponent(competitorName)}`;
          }
        } catch {
          result.sourceUrl = competitorUrl || `https://www.google.com/search?q=${encodeURIComponent(competitorName)}`;
        }
      }
    }

    console.log(`[Competitor Summary] Generated summary for ${competitorName}: ${result.summary.substring(0, 100)}...`);

    if (taskId) {
      progressEmitter.complete(taskId, `Generated summary for ${competitorName}`);
    }

    return result;
  } catch (error) {
    console.error(`[Competitor Summary] Error generating summary for ${competitorName}:`, error);
    if (taskId) {
      progressEmitter.error(taskId, `Error generating summary for ${competitorName}`);
    }
    return null;
  }
}
