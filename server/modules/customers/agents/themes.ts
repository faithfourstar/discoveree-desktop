/**
 * Theme pipeline agents — CLASSIFY-FIRST (ADR 004 §3.6, amendment 4 Aug 2026).
 *
 * The SaaS failure mechanisms and their answers here:
 * 1. Wholesale re-derivation → classifyEntriesIntoThemes is NEW code: stored
 *    themes enter as the classification CATALOGUE; the run never re-invents
 *    the set and NO code path in this file writes `themeName` of an existing
 *    theme.
 * 2. Within-run-only semantic dedup → semanticCreationGate compares residue
 *    candidates against the STORED catalogue (names + aliases + summaries) —
 *    the repurposed mergeSemanticallySimilarThemes (gemini.ts:8059–8163).
 * 3. Forced total assignment → the clustering prompt (reshaped
 *    aggregateFeedbackThemes, gemini.ts:8165–8489) loses "EVERY feedback
 *    entry must be assigned" and gains "leave entries unassigned rather than
 *    force a grouping"; unfiled is a designed, served state.
 * 4. Discarded quality scores → coherence gates creation (service, step 4d).
 *
 * The creation-gate ORCHESTRATION (steps 4a–d + soft cap) lives in
 * service.ts; this file provides the LLM calls, the alias-aware name
 * normaliser, and the deterministic prune.
 */
import { Type } from "@google/genai";
import type { FeedbackTheme } from "@shared/schema";
import { callLLM } from "../../../lib/llm/router.js";
import { sanitizeJsonResponse } from "../../../lib/llm/json.js";
import { AgentSlugs } from "../../../lib/agents/slugs.js";
import {
  buildClassificationResultSchema,
  residueClusteringResultSchema,
  semanticGateResultSchema,
  type ResidueThemeCandidate,
  type SemanticGateResult,
} from "../schemas.js";
import * as storage from "../storage.js";

// ── Name normalisation (scheduler.ts:113–130, extended to aliases §3.6.3) ───

export function normalizeThemeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[&]/g, "and")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Gate step 4(a): does a candidate name match an existing theme's name OR any
 * of its human-merge aliases (normalised)? Aliases make every human
 * consolidation permanent matching vocabulary (§3.6.1 step 7).
 */
export function findThemeByNameOrAlias(
  candidateName: string,
  catalogue: Array<Pick<FeedbackTheme, "id" | "themeName" | "aliases">>,
): string | null {
  const normalized = normalizeThemeName(candidateName);
  for (const theme of catalogue) {
    if (normalizeThemeName(theme.themeName) === normalized) return theme.id;
    for (const alias of (theme.aliases as string[] | null) ?? []) {
      if (normalizeThemeName(alias) === normalized) return theme.id;
    }
  }
  return null;
}

// ── CLASSIFY (§3.6.1 step 2 — NEW code, not in the SaaS) ────────────────────

export interface ClassificationCatalogueEntry {
  id: string;
  themeName: string;
  summary: string | null;
}

export interface ClassificationAssignment {
  entryId: string;
  themeId: string | null;
}

/**
 * One classification batch (≤100 entries): the stored catalogue is the input,
 * the output is entry→theme assignments. Invented theme/entry ids are ZOD
 * FAILURES (the factory schema checks against the inputs) — the batch throws
 * and the run records a failed execution rather than storing drift.
 */
export async function classifyEntriesIntoThemes(
  catalogue: ClassificationCatalogueEntry[],
  entries: Array<{ id: string; quotedText: string; topic: string | null }>,
  organizationId: string,
): Promise<ClassificationAssignment[]> {
  if (catalogue.length === 0 || entries.length === 0) return entries.map(e => ({ entryId: e.id, themeId: null }));

  const catalogueBlock = catalogue
    .map(t => `- themeId "${t.id}": "${t.themeName}"${t.summary ? ` — ${t.summary}` : ""}`)
    .join("\n");
  const entriesBlock = entries
    .map(e => `- entryId "${e.id}": "${e.quotedText.substring(0, 400)}"${e.topic ? ` (topic: ${e.topic})` : ""}`)
    .join("\n");

  const prompt = `You are a strict feedback classification engine. Below is the STABLE THEME CATALOGUE for a product, followed by unfiled feedback entries. Your ONLY job is to classify each entry into one existing theme, or mark it null when no existing theme genuinely fits.

THEME CATALOGUE (the ONLY valid themeId values — never invent an id, never propose a new theme):
${catalogueBlock}

UNFILED FEEDBACK ENTRIES:
${entriesBlock}

RULES:
- Assign an entry to a theme ONLY when the entry expresses the same underlying customer problem the theme describes.
- When no existing theme fits, return themeId null for that entry. Null is the correct answer for genuinely new problems — do NOT force a fit.
- Every entryId from the input must appear exactly once in your output.
- themeId must be copied verbatim from the catalogue above.

Respond with ONLY valid JSON: { "assignments": [{ "entryId": "...", "themeId": "..." | null }] }`;

  const response = await callLLM({
    organizationId,
    agentSlug: AgentSlugs.THEME_AGGREGATION,
    prompt,
    useWebSearch: false,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        assignments: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              entryId: { type: Type.STRING },
              themeId: { type: Type.STRING, nullable: true },
            },
            required: ["entryId"],
          },
        },
      },
      required: ["assignments"],
    },
  });

  const raw = JSON.parse(sanitizeJsonResponse(response.text) || '{"assignments":[]}');
  const schema = buildClassificationResultSchema(
    new Set(catalogue.map(t => t.id)),
    new Set(entries.map(e => e.id)),
  );
  // Zod failure on invented ids is DELIBERATE — throw so the execution row
  // records the failure and nothing is stored (ADR 002 risk-3 pattern).
  const parsed = schema.parse({
    assignments: (raw.assignments || []).map((a: { entryId: string; themeId?: string | null }) => ({
      entryId: a.entryId,
      themeId: a.themeId ?? null,
    })),
  });
  return parsed.assignments;
}

// ── RESIDUE clustering (§3.6.1 step 3 — reshaped gemini.ts:8165–8489) ───────

export async function clusterResidueEntries(
  entries: Array<{ id: string; quotedText: string; topic: string | null; sentiment: number | null; sourceName: string }>,
  productName: string,
  organizationId: string,
): Promise<ResidueThemeCandidate[]> {
  if (entries.length === 0) return [];

  const feedbackText = entries
    .map(f => `[ID:${f.id}] "${f.quotedText}" - Topic: ${f.topic || "Unknown"} | Sentiment: ${f.sentiment ?? "N/A"} | Source: ${f.sourceName}`)
    .join("\n");

  const n = entries.length;
  const rawCount = n <= 120 ? Math.floor(n / 12) : 10 + Math.floor((n - 120) / 20);
  const targetThemeCount = Math.min(Math.max(3, rawCount), 30);

  const prompt = `You are an expert product analyst. Your job is to read ${entries.length} customer feedback entries for "${productName}" and identify the distinct UNDERLYING PROBLEMS or NEEDS that customers are expressing.

Do NOT group feedback by surface-level topic (e.g. "Integrations", "Mobile App"). Instead, ask yourself: "What is the actual problem this customer needs solved?" Two reviews that mention different features but describe the same underlying frustration belong in the SAME theme.

FEEDBACK ENTRIES:
${feedbackText}

YOUR TASK:
Read each piece of feedback and identify what the customer actually needs or what problem they're facing. Then group entries that share the same underlying problem together into candidate themes.

HOW TO THINK ABOUT EACH ENTRY:
1. What is the customer trying to accomplish?
2. What is preventing them or frustrating them?
3. What would "success" look like for this customer?
4. Which other entries describe the same gap between expectation and reality?

CONSTRAINTS:
- Produce ${targetThemeCount} or FEWER candidate themes. Fewer, genuinely distinct themes are far more valuable than many overlapping ones.
- Each candidate theme should group entries that clearly share one underlying problem.
- If two potential themes could reasonably be described as "the same problem viewed from different angles," merge them into one.
- LEAVE ENTRIES UNASSIGNED rather than force a grouping. An entry that does not clearly share a problem with others should simply not appear in any theme — unfiled is a valid, expected outcome.

THEME NAMING:
- Name themes as specific problem statements, not feature areas or vague categories.
- Keep names short (3-6 words) but specific enough to stand alone. Good examples: "Unreliable Bank Statement Imports", "Slow Receipt Processing Speed", "Complex Multi-Entity Setup". Bad examples: "Data Accuracy", "User Experience", "Core Automation" — vague category labels are rejected.
- A reader should understand the specific issue just from the theme name alone.

FOR EACH CANDIDATE THEME, PROVIDE:
1. themeName: A specific problem statement (not a category label)
2. summary: One concise sentence stating the specific problem and its scope — direct and factual, no filler.
3. averageSentiment: Average sentiment score of the grouped entries
4. feedbackEntryIds: The exact entry IDs belonging to this theme
5. confidence (0-100): How confident are you this represents a genuinely distinct problem?
6. coherence (0-100): How tightly do the grouped entries relate to the same underlying problem?`;

  const response = await callLLM({
    organizationId,
    agentSlug: AgentSlugs.THEME_AGGREGATION,
    prompt,
    useWebSearch: false,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        themes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              themeName: { type: Type.STRING },
              summary: { type: Type.STRING },
              averageSentiment: { type: Type.INTEGER },
              feedbackEntryIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              confidence: { type: Type.INTEGER },
              coherence: { type: Type.INTEGER },
            },
            required: ["themeName", "summary", "feedbackEntryIds", "confidence", "coherence"],
          },
        },
        analysisNotes: { type: Type.STRING },
      },
      required: ["themes", "analysisNotes"],
    },
  });

  const raw = JSON.parse(sanitizeJsonResponse(response.text) || '{"themes":[],"analysisNotes":""}');
  const parsed = residueClusteringResultSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[Theme Residue] Output failed schema validation:`, parsed.error.issues.slice(0, 3));
    return [];
  }

  // Only ids that were actually in the residue may be claimed.
  const validIds = new Set(entries.map(e => e.id));
  return parsed.data.themes.map(t => ({
    ...t,
    feedbackEntryIds: t.feedbackEntryIds.filter(id => validIds.has(id)),
  })).filter(t => t.feedbackEntryIds.length > 0);
}

// ── Semantic creation gate (§3.6.1 step 4b — repurposed gemini.ts:8059) ─────

/**
 * One Zod-validated call over the residue CANDIDATES plus the STORED
 * catalogue: a "same underlying problem" verdict against an existing theme
 * converts the candidate into a classification into it; candidate-vs-candidate
 * duplicates collapse in the same call (as the SaaS did within-run).
 */
export async function semanticCreationGate(
  candidates: ResidueThemeCandidate[],
  catalogue: Array<Pick<FeedbackTheme, "id" | "themeName" | "aliases" | "summary">>,
  organizationId: string,
): Promise<SemanticGateResult> {
  if (candidates.length === 0) return { verdicts: [] };
  if (catalogue.length === 0 && candidates.length < 2) return { verdicts: [] };

  const catalogueBlock = catalogue.length > 0
    ? catalogue.map(t => {
        const aliases = ((t.aliases as string[] | null) ?? []);
        return `- themeId "${t.id}": "${t.themeName}"${aliases.length ? ` (also known as: ${aliases.join(", ")})` : ""}${t.summary ? ` — ${t.summary}` : ""}`;
      }).join("\n")
    : "(none yet)";
  const candidatesBlock = candidates
    .map((c, i) => `- candidateIndex ${i}: "${c.themeName}" — ${c.summary}`)
    .join("\n");

  const prompt = `You are a strict theme deduplication engine. Below is the STORED theme catalogue for a product, and a list of NEW candidate themes proposed from unfiled feedback. Identify candidates that describe the SAME underlying customer problem as an existing stored theme — even if the names look distinct — and candidates that duplicate each other.

STORED THEMES:
${catalogueBlock}

NEW CANDIDATES:
${candidatesBlock}

Two themes are the same when a product manager would say "these are just different angles on the same underlying problem." Examples that MUST match:
- "Core Automation" and "Automated Workflows" → same automation reliability problem
- "Inconsistent Mobile Experience & Data Accuracy" and "Mobile Experience" → same mobile quality problem

For EACH candidate return a verdict:
- matchesExistingThemeId: the stored themeId it duplicates (copied verbatim), or null
- duplicateOfCandidateIndex: the LOWER candidateIndex it duplicates, or null

Only propose matches you are confident about. Do not merge genuinely different problems just because they share a word.

Respond with ONLY valid JSON: { "verdicts": [{ "candidateIndex": 0, "matchesExistingThemeId": "..." | null, "duplicateOfCandidateIndex": null }] }`;

  const response = await callLLM({
    organizationId,
    agentSlug: AgentSlugs.THEME_AGGREGATION,
    prompt,
    useWebSearch: false,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        verdicts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              candidateIndex: { type: Type.INTEGER },
              matchesExistingThemeId: { type: Type.STRING, nullable: true },
              duplicateOfCandidateIndex: { type: Type.INTEGER, nullable: true },
            },
            required: ["candidateIndex"],
          },
        },
      },
      required: ["verdicts"],
    },
  });

  const raw = JSON.parse(sanitizeJsonResponse(response.text) || '{"verdicts":[]}');
  const parsed = semanticGateResultSchema.safeParse({
    verdicts: (raw.verdicts || []).map((v: Record<string, unknown>) => ({
      candidateIndex: v["candidateIndex"],
      matchesExistingThemeId: v["matchesExistingThemeId"] ?? null,
      duplicateOfCandidateIndex: v["duplicateOfCandidateIndex"] ?? null,
    })),
  });
  if (!parsed.success) {
    console.warn(`[Theme Gate] Semantic gate output failed validation — treating as no matches:`, parsed.error.issues.slice(0, 3));
    return { verdicts: [] };
  }
  // Drop verdicts referencing unknown ids/indices (conservative-only gate).
  const catalogueIds = new Set(catalogue.map(t => t.id));
  return {
    verdicts: parsed.data.verdicts.filter(v =>
      v.candidateIndex < candidates.length &&
      (v.matchesExistingThemeId === null || catalogueIds.has(v.matchesExistingThemeId)) &&
      (v.duplicateOfCandidateIndex === null || (v.duplicateOfCandidateIndex >= 0 && v.duplicateOfCandidateIndex < candidates.length)),
    ),
  };
}

// ── PRUNE (scheduler.ts:379–418, unchanged semantics) ───────────────────────

export async function pruneOrphanedThemesForProduct(productId: string): Promise<{ deleted: number; updated: number }> {
  const allEntries = await storage.getFeedbackEntriesByProduct(productId, { includeArchived: true });
  // Only count entries that are not archived — matching the semantics of the Raw tab.
  const activeIds = new Set(allEntries.filter(e => !e.archivedAt).map(e => e.id));

  const themes = await storage.getFeedbackThemesByProduct(productId);

  let deleted = 0;
  let updated = 0;

  for (const theme of themes) {
    const entryIds: string[] = Array.isArray(theme.feedbackEntryIds) ? (theme.feedbackEntryIds as string[]) : [];
    if (entryIds.length === 0) continue;

    const validIds = entryIds.filter(id => activeIds.has(id));

    if (validIds.length === 0) {
      await storage.deleteFeedbackTheme(theme.id);
      deleted++;
      console.log(`[Theme Pruning] Deleted orphaned theme "${theme.themeName}" (${entryIds.length} stale IDs) for product ${productId}`);
    } else if (validIds.length < entryIds.length) {
      const newMentionCount = validIds.length;
      const newPriority = newMentionCount >= 10 ? "high" : newMentionCount >= 5 ? "medium" : "low";
      await storage.updateFeedbackTheme(theme.id, {
        feedbackEntryIds: validIds,
        mentionCount: newMentionCount,
        priority: newPriority,
      });
      updated++;
      console.log(`[Theme Pruning] Trimmed theme "${theme.themeName}": ${entryIds.length} → ${validIds.length} IDs for product ${productId}`);
    }
  }

  return { deleted, updated };
}
