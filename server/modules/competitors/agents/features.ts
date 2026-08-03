/**
 * Competitor Features Agent — ported from the SaaS gemini.ts
 * (`getCompetitorFeatures` at 10712–10774 plus its internal implementation
 * `analyzeCompetitorFeatures` at 4421–4758, which the mapped function cannot
 * run without — noted as a deviation from the §5 line map).
 *
 * Searches the competitor help centre to find key features with verified
 * documentation links; falls back to direct page fetch (Jina) + extraction
 * when grounding fails.
 *
 * Seam changes: multi-lingual search context is stripped (deferred to the
 * reviews/pricing sprint per ADR 002 §1), and outputs are Zod-parsed.
 */
import { Type } from "@google/genai";
import { callLLM } from "../../../lib/llm/router.js";
import { sanitizeJsonResponse } from "../../../lib/llm/json.js";
import { resolveAgentPrompt } from "../../../lib/agents/registry.js";
import { AgentSlugs } from "../../../lib/agents/slugs.js";
import { progressEmitter } from "../../../lib/progress.js";
import { fetchViaJina, validateUrlWithSoft404Detection } from "../../../lib/web/fetch.js";
import { competitorFeaturesResultSchema, type CompetitorFeaturesResult } from "../schemas.js";

interface CompetitorFeatureAnalysis {
  features: Array<{
    name: string;
    description: string;
    documentationUrl: string;
    category?: string;
  }>;
  analysisNotes: string;
  urlsAvailable: boolean;
  missingUrls: {
    websiteUrl: boolean;
    helpCenterUrl: boolean;
  };
}

/**
 * Analyses a competitor's website and extracts their key features with REAL
 * documentation links. Never generates placeholder URLs.
 */
async function analyzeCompetitorFeatures(
  competitorName: string,
  competitorUrl: string | null,
  helpCenterUrl: string | null,
  organizationId?: string,
  productId?: string,
): Promise<CompetitorFeatureAnalysis> {
  const hasWebsiteUrl = !!competitorUrl && competitorUrl.trim() !== "";
  const hasHelpCenterUrl = !!helpCenterUrl && helpCenterUrl.trim() !== "";

  // Extract base domain for site-specific searches
  let baseDomain = "";
  if (hasWebsiteUrl) {
    try {
      const parsed = new URL(competitorUrl!);
      baseDomain = parsed.hostname;
    } catch {
      console.log(`[Competitor Features] Invalid website URL for ${competitorName}: ${competitorUrl}`);
    }
  }

  let validUrlCount = 0;

  let helpCenterDomain = "";
  if (hasHelpCenterUrl) {
    try {
      helpCenterDomain = new URL(helpCenterUrl!).hostname;
      validUrlCount++;
    } catch {
      console.log(`[Competitor Features] Invalid help centre URL for ${competitorName}: ${helpCenterUrl}`);
    }
  }
  if (hasWebsiteUrl && baseDomain) {
    validUrlCount++;
  }

  // Only consider URLs available if at least one was successfully parsed
  const urlsAvailable = validUrlCount > 0;

  const fallbackBaseInstructions = `You are an expert product analyst finding real product features with verified documentation links for a competitor product.

YOUR TASK:
Find 5-15 SPECIFIC product features documented in the competitor's help centre or official documentation.

For EACH feature provide:
1. **Feature Name**: Clear, specific name (e.g., "Automatic Receipt Scanning")
2. **Description**: 1-2 sentences explaining what this feature does
3. **Documentation URL**: Exact URL to the help centre article or documentation page
4. **Category**: Short category label (max 5 words, title-case)

CRITICAL REQUIREMENTS:
- Only include features with real, working documentation URLs
- Never fabricate or guess URLs
- Focus on specific capabilities, not product lines
- Prefer help centre articles over marketing pages`;

  const baseInstructions = await resolveAgentPrompt(AgentSlugs.COMPETITOR_FEATURES, organizationId || "", fallbackBaseInstructions);

  const prompt = `${baseInstructions}

Competitor: "${competitorName}"

${hasHelpCenterUrl ? `HELP CENTRE URL: ${helpCenterUrl}
IMPORTANT: Search primarily within this help centre (site:${helpCenterDomain}) to find documented features.` : "HELP CENTRE URL: Not provided"}

${hasWebsiteUrl ? `WEBSITE URL: ${competitorUrl}` : "WEBSITE URL: Not provided"}

SEARCH STRATEGY:
${hasHelpCenterUrl ? `1. PRIORITISE: Search site:${helpCenterDomain} for feature documentation, guides, and how-to articles
2. SECONDARY: Search the main website for features pages` : hasWebsiteUrl ? `1. Search site:${baseDomain} for features pages and documentation
2. Search for "${competitorName} help centre" or "${competitorName} documentation"` : `1. Search for "${competitorName} help centre" and "${competitorName} documentation"
2. Search for "${competitorName} features" on official sources`}

Provide analysis notes summarising what sources you found.

IMPORTANT: You MUST respond with ONLY a valid JSON object in this exact format (no markdown, no explanation):
{
  "features": [
    {"name": "Feature Name", "description": "Feature description", "documentationUrl": "https://...", "category": "Category Label"}
  ],
  "analysisNotes": "Summary of what sources you found"
}`;

  try {
    const response = await callLLM({
      organizationId: organizationId || "",
      productId,
      agentSlug: AgentSlugs.COMPETITOR_FEATURES,
      prompt,
      useWebSearch: true,
      inputSummary: { competitorName },
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          features: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                documentationUrl: { type: Type.STRING },
                category: { type: Type.STRING },
              },
              required: ["name", "description", "documentationUrl"],
            },
          },
          analysisNotes: { type: Type.STRING },
        },
        required: ["features", "analysisNotes"],
      },
    });

    // Check if response text is empty or null
    if (!response.text) {
      console.error(`[Competitor Features] Empty response for ${competitorName} - grounding may have failed`);
      throw new Error(`No response from AI for ${competitorName}. Grounding may have failed or returned no results.`);
    }

    const sanitized = sanitizeJsonResponse(response.text);
    const rawResult = JSON.parse(sanitized);
    console.log(`[Competitor Features] Parsed result - features count: ${rawResult.features?.length || 0}`);

    // Helper to validate URL format
    const isValidUrlFormat = (url: string | undefined): boolean => {
      if (!url) return false;
      try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    };

    // Validate feature documentation URLs using soft-404 detection (consistent with other agents)
    const validatedFeatures: Array<{ name: string; description: string; documentationUrl: string; category: string }> = [];

    const featuresToValidate = (rawResult.features || []).filter(
      (f: any) => f.name && f.description,
    );

    const validationResults = await Promise.all(
      featuresToValidate.map(async (feature: any) => {
        const hasValidUrl = feature.documentationUrl && isValidUrlFormat(feature.documentationUrl);

        if (hasValidUrl) {
          const validatedUrl = await validateUrlWithSoft404Detection(feature.documentationUrl, 4000);
          if (validatedUrl) {
            console.log(`[Competitor Features] Verified feature "${feature.name}" with URL: ${feature.documentationUrl}`);
            return { name: feature.name, description: feature.description, documentationUrl: feature.documentationUrl, category: feature.category || "" };
          } else {
            console.log(`[Competitor Features] Stripped broken/soft-404 URL for "${feature.name}": ${feature.documentationUrl}`);
            return { name: feature.name, description: feature.description, documentationUrl: "", category: feature.category || "" };
          }
        } else {
          console.log(`[Competitor Features] Added feature "${feature.name}" without documentation URL`);
          return { name: feature.name, description: feature.description, documentationUrl: "", category: feature.category || "" };
        }
      }),
    );

    validatedFeatures.push(...validationResults);

    console.log(`[Competitor Features] Found ${validatedFeatures.length} verified features for ${competitorName}, URLs available: ${urlsAvailable}`);

    // If no features found despite having URLs, try direct page fetch fallback
    if (validatedFeatures.length === 0 && hasWebsiteUrl) {
      console.log(`[Competitor Features] No features found via grounding, trying direct page fetch for ${competitorName}`);

      try {
        // Try to fetch feature pages directly - cap at 3 patterns and run in parallel
        const featurePagePatterns = [
          "/features",
          "/product/features",
          "/all-features",
        ];

        let pageContent = "";
        let fetchedUrl = "";

        const jinaResults = await Promise.all(
          featurePagePatterns.map(async (pattern) => {
            try {
              const testUrl = new URL(pattern, competitorUrl!).toString();
              console.log(`[Competitor Features] Trying to fetch via Jina: ${testUrl}`);
              const content = await fetchViaJina(testUrl, 12000);
              if (content && content.length > 500) {
                console.log(`[Competitor Features] Successfully fetched ${testUrl} via Jina (${content.length} chars)`);
                return { url: testUrl, content };
              }
            } catch {
              // Ignore per-pattern failures
            }
            return null;
          }),
        );

        // Take the result with the most content (most likely to have feature data)
        const bestResult = jinaResults
          .filter((r): r is { url: string; content: string } => r !== null)
          .sort((a, b) => b.content.length - a.content.length)[0];

        if (bestResult) {
          pageContent = bestResult.content.slice(0, 20000);
          fetchedUrl = bestResult.url;
        }

        if (pageContent && pageContent.length > 500) {
          console.log(`[Competitor Features] Analysing fetched page content with AI...`);

          // Second AI call with actual page content
          try {
            const extractPrompt = `Extract product features from this ${competitorName} features page.

PAGE URL: ${fetchedUrl}
PAGE CONTENT:
${pageContent}

TASK: Extract 5-15 SPECIFIC product features from this page.

For each feature found, provide:
- name: The specific feature name (e.g., "Automatic receipt scanning", "Bank reconciliation", "Multi-currency support")
- description: 1-2 sentences about what this feature does
- documentationUrl: Use "${fetchedUrl}" since this is where you found the feature
- category: A short category label (1-5 words) grouping related features (e.g., "Collaboration", "Integrations", "Analytics & Reporting")

RULES:
- Extract SPECIFIC features, not product line names
- Look for bullet points, feature lists, headings about capabilities
- Each feature should be a distinct capability users can use
- Do NOT include general marketing statements

Return the features array.`;

            const extractResponse = await callLLM({
              organizationId: organizationId || "",
              productId,
              agentSlug: AgentSlugs.COMPETITOR_FEATURES,
              prompt: extractPrompt,
              useWebSearch: false,
              inputSummary: { competitorName },
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  features: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        description: { type: Type.STRING },
                        documentationUrl: { type: Type.STRING },
                        category: { type: Type.STRING },
                      },
                      required: ["name", "description", "documentationUrl"],
                    },
                  },
                },
                required: ["features"],
              },
            });

            const extractedResult = JSON.parse(sanitizeJsonResponse(extractResponse.text) || "null");

            if (extractedResult?.features && extractedResult.features.length > 0) {
              console.log(`[Competitor Features] Direct page fetch found ${extractedResult.features.length} features`);

              // Format features to match expected structure
              const extractedFeatures = extractedResult.features.map((f: any) => ({
                name: f.name,
                description: f.description,
                documentationUrl: f.documentationUrl || fetchedUrl,
                category: f.category || "",
              }));

              return {
                features: extractedFeatures,
                analysisNotes: `Features extracted from ${fetchedUrl} via direct page analysis`,
                urlsAvailable,
                missingUrls: {
                  websiteUrl: !hasWebsiteUrl,
                  helpCenterUrl: !hasHelpCenterUrl,
                },
              };
            }
          } catch (extractError) {
            console.log(`[Competitor Features] AI extraction from page content failed:`, extractError);
          }
        }
      } catch (fallbackError) {
        console.log(`[Competitor Features] Direct page fetch fallback failed:`, fallbackError);
      }

      // If fallback also failed, throw error
      console.error(`[Competitor Features] No features found for ${competitorName} despite having URLs - grounding and fallback both failed`);
      throw new Error(`No features could be found for ${competitorName}. The search may have failed to access the website.`);
    }

    return {
      features: validatedFeatures,
      analysisNotes: rawResult.analysisNotes || "",
      urlsAvailable,
      missingUrls: {
        websiteUrl: !hasWebsiteUrl,
        helpCenterUrl: !hasHelpCenterUrl,
      },
    };
  } catch (error) {
    console.error(`[Competitor Features] Error analysing ${competitorName}:`, error);
    // Propagate the error instead of silently returning empty results
    throw error;
  }
}

export async function getCompetitorFeatures(
  competitorName: string,
  competitorUrl: string,
  helpCenterUrl?: string,
  organizationId?: string,
  taskId?: string,
  productId?: string,
): Promise<CompetitorFeaturesResult | null> {
  console.log(`[Competitor Features] Getting features for ${competitorName}`);

  if (taskId) {
    progressEmitter.emit(taskId, "init", `Analysing features for ${competitorName}...`, 10);
  }

  try {
    if (taskId) {
      progressEmitter.emit(taskId, "searching", `Searching for ${competitorName} feature documentation...`, 30);
    }

    const result = await analyzeCompetitorFeatures(
      competitorName,
      competitorUrl,
      helpCenterUrl || null,
      organizationId,
      productId,
    );

    if (!result || !result.features || result.features.length === 0) {
      console.log(`[Competitor Features] No features found for ${competitorName}`);
      // Throw an error so the caller can capture the message for the frontend
      throw new Error(`No features could be found for ${competitorName}. The AI search may have been unable to access their documentation.`);
    }

    console.log(`[Competitor Features] Found ${result.features.length} verified features for ${competitorName}`);

    if (taskId) {
      progressEmitter.complete(taskId, `Found ${result.features.length} features for ${competitorName}`);
    }

    // Zod-validate at the module boundary before anything is stored
    const validated = competitorFeaturesResultSchema.safeParse({
      features: result.features,
      lastUpdated: new Date().toISOString(),
    });
    if (!validated.success) {
      console.error(
        `[Competitor Features] Zod validation failed for ${competitorName}:`,
        validated.error.issues,
      );
      throw new Error(`Feature results for ${competitorName} failed validation.`);
    }

    return validated.data;
  } catch (error) {
    console.error(`[Competitor Features] Error for ${competitorName}:`, error);
    if (taskId) {
      progressEmitter.error(taskId, `Error analysing features for ${competitorName}`);
    }
    // Re-throw to let the caller handle the error with the detailed message
    throw error;
  }
}
