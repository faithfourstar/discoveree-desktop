/**
 * Zod schemas for the competitors module (ADR 002 §6):
 * - agent-output schemas — every enrichment write is parsed here first
 *   (agent JSON → schema → merge-don't-replace update). Reject-and-log on
 *   parse failure; never store unvalidated LLM output. Schemas start
 *   permissive-but-typed (`.nullish()` where the SaaS tolerated absence) and
 *   tighten later (risk 3).
 * - API request-body schemas for the routes.
 */
import { z } from "zod/v4";

// ── Agent outputs ────────────────────────────────────────────────────────────

/** Output of the competitor summary agent (gemini.ts CompetitorSummaryResult). */
export const competitorSummaryResultSchema = z.object({
  summary: z.string().min(1),
  sourceUrl: z.string().nullish(),
  websiteUrl: z.string().nullish(),
  keyDifferentiators: z.array(z.string()).nullish(),
  markets: z.array(z.string()).nullish(),
  customerSegments: z.array(z.string()).nullish(),
  // Numbered source URLs for [n] citation markers in summary/differentiator text
  citations: z.array(z.string()).nullish(),
});
export type CompetitorSummaryResult = z.infer<typeof competitorSummaryResultSchema>;

/** One feature from the competitor features agent. */
export const competitorFeatureSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  documentationUrl: z.string().default(""),
  category: z.string().nullish(),
});
export type CompetitorFeature = z.infer<typeof competitorFeatureSchema>;

export const competitorFeaturesResultSchema = z.object({
  features: z.array(competitorFeatureSchema),
  lastUpdated: z.string(),
});
export type CompetitorFeaturesResult = z.infer<typeof competitorFeaturesResultSchema>;

/** One item from the dual-stream updates scan. */
export const competitorUpdateSchema = z.object({
  competitorName: z.string().min(1),
  changeType: z.enum(["feature", "pricing", "announcement", "update"]),
  changeTitle: z.string().min(1),
  changeDescription: z.string().default(""),
  sourceUrl: z.string().min(1),
  publishedDate: z.string().nullish(),
  stream: z.enum(["market", "product"]),
  severity: z.enum(["major", "minor"]).nullish(),
});
export type CompetitorUpdate = z.infer<typeof competitorUpdateSchema>;

export const competitorUpdatesResultSchema = z.object({
  updates: z.array(competitorUpdateSchema),
  searchSummary: z.string().default(""),
});

// ── API request bodies ───────────────────────────────────────────────────────

export const classificationSchema = z.enum(["DIRECT", "ADJACENT"]);
export type Classification = z.infer<typeof classificationSchema>;

export const threatLevelSchema = z.enum(["none", "watch", "competitive", "big_threat"]);
export type ThreatLevel = z.infer<typeof threatLevelSchema>;

export const createCompetitorBodySchema = z.object({
  name: z.string().trim().min(1, "Competitor name is required").max(200),
  url: z.string().trim().url().optional(),
  classification: classificationSchema,
});
export type CreateCompetitorBody = z.infer<typeof createCompetitorBodySchema>;

export const patchCompetitorBodySchema = z
  .object({
    classification: classificationSchema.optional(),
    threatLevel: threatLevelSchema.optional(),
    url: z.string().trim().url().optional(),
    // Inline-rename (spec 2.4 proposal card): same rules as POST. The route
    // additionally rejects renames of TRACKED competitors (400) — change
    // history is name-keyed, so tracked renames are deferred (ADR 002 §9).
    name: z.string().trim().min(1, "Competitor name is required").max(200).optional(),
  })
  .refine(
    (body) =>
      body.classification !== undefined ||
      body.threatLevel !== undefined ||
      body.url !== undefined ||
      body.name !== undefined,
    { message: "Provide at least one of name, classification, threatLevel or url" },
  );
export type PatchCompetitorBody = z.infer<typeof patchCompetitorBodySchema>;

/** Mapping between the API classification and the schema's sourceCategory. */
export function classificationToSourceCategory(classification: Classification): "competitor" | "adjacent" {
  return classification === "ADJACENT" ? "adjacent" : "competitor";
}

export function sourceCategoryToClassification(sourceCategory: string | null | undefined): Classification {
  return sourceCategory === "adjacent" ? "ADJACENT" : "DIRECT";
}
