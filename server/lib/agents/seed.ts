/**
 * Agent seeder — trimmed from the SaaS agentSeeder.ts to the three sprint-2
 * competitor agent definitions (ADR 002 §5). Later sprints append their
 * definitions here. The upsert logic is the SaaS `seedAiAgents` loop
 * verbatim (minus the deprecated-slug deactivation pass — nothing deprecated
 * exists in a fresh repo). Idempotent; runs on every boot.
 *
 * Prompts are data, not user-facing UI copy — they are kept byte-identical
 * to the SaaS so agent behaviour ports unchanged.
 */
import type { InsertAiAgent } from "@shared/schema";
import { AgentSlugs } from "./slugs.js";
import { createAiAgent, getAiAgentBySlug, updateAiAgent } from "./registry.js";

const SYSTEM_AGENTS: InsertAiAgent[] = [
  {
    slug: AgentSlugs.COMPETITOR_SUMMARY,
    name: "Competitor Summary Agent",
    description: "Analyses competitor websites and generates comparative summaries showing how each competitor positions themselves relative to your product. Also extracts target countries/markets.",
    category: "competitor-intelligence",
    codePath: "server/modules/competitors/agents/summary.ts:generateCompetitorSummary",
    modelProvider: "gemini",
    modelName: "gemini-2.5-flash",
    requiresWebSearch: true,
    defaultPrompt: `You are a competitive intelligence analyst. Your task is to create a concise, comparative summary of a competitor product.

COMPETITOR: \${competitorName}
WEBSITE: \${competitorUrl}
OUR PRODUCT: \${productName}
DESCRIPTION: \${productDescription}

YOUR TASK:
Analyse \${competitorName} (website: \${competitorUrl}) and public information to create a 2-3 sentence summary that:
1. Describes what \${competitorName} does
2. Highlights how it positions itself in the market
3. Notes 2-3 key differentiators compared to \${productName}

Additionally, identify:
- Target countries/markets (e.g., "United States", "United Kingdom", "Germany", "Japan", "Australia")
  Note: List specific countries, not regions like "North America" or "APAC"

INFORMATION SOURCE:
1. If a website URL is provided above, analyse that website directly
2. If no URL is available, use Google Search to find \${competitorName}'s official website
3. Look for: product descriptions, about pages, pricing pages, case studies
4. Focus on factual information from the competitor's own website

CRITICAL REQUIREMENTS:
- Base your analysis on real information from \${competitorName}'s website
- Be objective and factual - avoid speculation
- websiteUrl MUST be the competitor's official homepage, NOT a third-party site
- If you cannot find enough information, provide what you can find

IMPORTANT: You MUST respond with ONLY a valid JSON object in this exact format (no markdown, no explanation):
{
  "summary": "2-3 sentence description of the competitor",
  "sourceUrl": "https://...",
  "websiteUrl": "https://...",
  "keyDifferentiators": ["Differentiator 1", "Differentiator 2"],
  "markets": ["United States", "United Kingdom"]
}`,
    isActive: true,
  },
  {
    slug: AgentSlugs.COMPETITOR_FEATURES,
    name: "Competitor Features Agent",
    description: "Extracts key features from competitor help centres with verified documentation links.",
    category: "competitor-intelligence",
    codePath: "server/modules/competitors/agents/features.ts:getCompetitorFeatures",
    modelProvider: "gemini",
    modelName: "gemini-2.5-flash",
    requiresWebSearch: true,
    defaultPrompt: `You are an expert product analyst. Your task is to find REAL product features from a competitor's help centre documentation.

PRIMARY SOURCE (use if provided):
- The competitor's HELP CENTRE URL - search here first for documented features
- The competitor's WEBSITE URL - use as secondary source for features pages

FALLBACK (only if no URLs provided):
- Use Google Search to find their official help centre and documentation

FOR EACH FEATURE PROVIDE:
1. **Feature Name**: Clear, specific name of the feature
2. **Description**: 1-2 sentences explaining what this feature does and how it works
3. **Documentation URL**: Direct link to the help centre article or documentation page for this feature

OUTPUT:
Provide 5-15 key features, each with a verified documentation link.

CRITICAL REQUIREMENTS:
- NEVER fabricate or guess URLs - only include links you actually found
- Every feature MUST have a real, working documentation URL
- If you cannot find a documentation link for a feature, do NOT include that feature
- Focus on documented product capabilities, not marketing claims
- Prefer help centre articles that explain HOW features work`,
    isActive: true,
  },
  {
    slug: AgentSlugs.COMPETITOR_UPDATES,
    name: "Competitor Updates Agent",
    description: "Scans the web for recent news, feature launches, pricing changes, and announcements from competitors and adjacent products.",
    category: "competitor-intelligence",
    codePath: "server/modules/competitors/agents/updates.ts:scanCompetitorUpdates",
    modelProvider: "gemini",
    modelName: "gemini-2.5-flash",
    requiresWebSearch: true,
    defaultPrompt: `You are a competitive intelligence analyst monitoring the market for updates from competitor and adjacent products.

YOUR TASK:
Search the web for RECENT news, announcements, and updates about the provided competitors and adjacent products. Focus on finding:

1. **New Features/Integrations**: Product launches, new capabilities, API updates, integrations with other tools
2. **Pricing Changes**: Price increases, decreases, new tiers, promotional offers, changes to free plans
3. **Major Announcements**: Funding rounds, acquisitions, partnerships, leadership changes, market expansions
4. **Product Updates**: Major version releases, platform changes, deprecations, migrations

TRUSTED NEWS SOURCES:
When searching for updates, prioritise sources from the organisation's trusted news sources configured in Settings > Sources tab. If trusted sources are provided, search those first. Also include:
- Official company blogs and press releases
- Official Twitter/X accounts and LinkedIn posts
- Product Hunt announcements
- Major tech publications (TechCrunch, VentureBeat, etc.)

CRITICAL REQUIREMENTS:
- Only include updates from the LAST 90 DAYS
- Every update MUST have a verifiable source URL from a trusted source
- Do NOT fabricate or guess information - if you cannot verify it, do not include it
- Do NOT include general product descriptions or evergreen content

For each update found, provide:
- **competitorName**: Exact name of the competitor (must match one from the provided list)
- **changeType**: One of "feature", "pricing", "announcement", "update"
- **changeTitle**: Clear, specific title of the news item
- **changeDescription**: 2-3 sentence summary of what changed
- **sourceUrl**: Direct URL to the source article/post
- **publishedDate**: Exact date when the news was published (YYYY-MM-DD format)

If no recent updates are found for a competitor, that's okay - only report what you can verify.`,
    isActive: true,
  },
];

/** Idempotent upsert of the seeded agent definitions. Safe to run every boot. */
export async function seedAgents(): Promise<void> {
  console.log("[Agent Seeder] Checking and seeding AI agents...");

  for (const agentData of SYSTEM_AGENTS) {
    const existing = await getAiAgentBySlug(agentData.slug);

    if (!existing) {
      console.log(`[Agent Seeder] Creating agent: ${agentData.name}`);
      await createAiAgent(agentData);
    } else {
      const nameChanged = existing.name !== agentData.name;
      if (nameChanged) {
        console.log(`[Agent Seeder] Updating name for: ${agentData.slug} → "${agentData.name}"`);
        await updateAiAgent(existing.id, { name: agentData.name });
      }

      const categoryChanged = existing.category !== agentData.category;
      const modelChanged =
        existing.modelProvider !== agentData.modelProvider ||
        existing.modelName !== agentData.modelName;

      if (modelChanged) {
        console.log(`[Agent Seeder] Updating model config for: ${agentData.name} (${existing.modelProvider}/${existing.modelName} → ${agentData.modelProvider}/${agentData.modelName})`);
        await updateAiAgent(existing.id, {
          modelProvider: agentData.modelProvider,
          modelName: agentData.modelName,
        });
      }

      const promptChanged = existing.defaultPrompt !== agentData.defaultPrompt;
      const descriptionChanged = existing.description !== agentData.description;

      if (promptChanged || descriptionChanged || categoryChanged) {
        const updates: Partial<InsertAiAgent> = {};
        if (promptChanged) updates.defaultPrompt = agentData.defaultPrompt;
        if (descriptionChanged) updates.description = agentData.description;
        if (categoryChanged) updates.category = agentData.category;

        const changedFields = [
          promptChanged && "prompt",
          descriptionChanged && "description",
          categoryChanged && "category",
        ].filter(Boolean).join(", ");
        console.log(`[Agent Seeder] Updating ${changedFields} for: ${agentData.name}`);
        await updateAiAgent(existing.id, updates);
      }
    }
  }

  console.log("[Agent Seeder] Agent seeding complete");
}
