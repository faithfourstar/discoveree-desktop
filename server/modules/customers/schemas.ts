/**
 * Zod schemas for the customers module (ADR 004 §3.3 layer 3 — where the
 * evidence rule actually lives): agent outputs REQUIRE evidence refs at the
 * schema level (persona ≥3, every claim ≥1, insights ≥5); parse failure means
 * nothing is stored. Plus API request bodies (§6).
 */
import { z } from "zod/v4";
import { evidenceRefSchema, EVIDENCE_THRESHOLDS } from "./evidence.js";

// ── Agent outputs ───────────────────────────────────────────────────────────

/** Output of the customer-quotes-agent (gatherer — URLs are its evidence). */
export const customerQuoteSchema = z.object({
  text: z.string().min(1),
  source: z.string().nullish().transform(v => v ?? "Web"),
  // Nullable: the citation allow-list strips unverifiable URLs to null —
  // the quote survives with empty provenance rather than fabricated provenance.
  sourceUrl: z.string().nullish().transform(v => v ?? ""),
  attribution: z.string().nullish().transform(v => v ?? ""),
  date: z.string().nullish().transform(v => v ?? ""),
  sentiment: z.string().nullish().transform(v => v ?? "neutral"),
  relevanceScore: z.number().nullish().transform(v => v ?? 70),
});
export type CustomerQuote = z.infer<typeof customerQuoteSchema>;

export const customerQuotesResultSchema = z.object({
  quotes: z.array(customerQuoteSchema),
  segmentIndicators: z.array(z.string()).nullish(),
});

/** An evidence-cited claim (JTBD job, goal, pain point, need…): ≥1 ref each. */
export const evidenceClaimSchema = z.object({
  text: z.string().min(1),
  evidenceRefs: z.array(evidenceRefSchema).min(EVIDENCE_THRESHOLDS.claim),
});
export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;

export const needClaimSchema = z.object({
  need: z.string().min(1),
  importance: z.number().min(1).max(5).nullish(),
  // §3.4: satisfaction only when derived from cited feedback sentiment —
  // schema permits absence, not invention (the service recomputes it anyway).
  evidenceRefs: z.array(evidenceRefSchema).min(EVIDENCE_THRESHOLDS.claim),
});

export const jobsToBeDoneSchema = z.object({
  coreJob: evidenceClaimSchema.nullish(),
  summary: z.string().nullish(),
  functionalJobs: z.array(evidenceClaimSchema).default([]),
  emotionalJobs: z.array(evidenceClaimSchema).default([]),
  socialJobs: z.array(evidenceClaimSchema).default([]),
  desiredOutcomes: z.array(evidenceClaimSchema).default([]),
});

/** Agent-proposed persona: ≥3 evidence refs (distinct-source check in service). */
export const personaProposalSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  demographics: z.object({
    role: z.string().nullish(),
    industry: z.string().nullish(),
    companySize: z.string().nullish(),
    experience: z.string().nullish(),
  }).nullish(),
  behaviours: z.array(z.string()).default([]),
  goals: z.array(evidenceClaimSchema).default([]),
  painPoints: z.array(evidenceClaimSchema).default([]),
  jobsToBeDone: jobsToBeDoneSchema.nullish(),
  evidenceRefs: z.array(evidenceRefSchema).min(EVIDENCE_THRESHOLDS.persona),
});
export type PersonaProposal = z.infer<typeof personaProposalSchema>;

/** The rewritten customer-insights-agent output (§3.3 — synthesis, no web). */
export const segmentInsightsOutputSchema = z.object({
  // Fewer/no personas rather than invention — an empty array is a VALID output.
  personas: z.array(personaProposalSchema).default([]),
  needsSummary: z.string().nullish(),
  needs: z.array(needClaimSchema).default([]),
  jobsToBeDone: jobsToBeDoneSchema.nullish(),
  segmentInsights: z.object({
    text: z.string().min(1),
    evidenceRefs: z.array(evidenceRefSchema).min(EVIDENCE_THRESHOLDS.insights),
  }).nullish(),
});
export type SegmentInsightsOutput = z.infer<typeof segmentInsightsOutputSchema>;

// ── Theme pipeline (§3.6) ───────────────────────────────────────────────────

/**
 * Classification output schema factory: every themeId must reference the
 * input catalogue and every entryId an input entry — an invented id is a ZOD
 * FAILURE, not a soft drop (§3.6.1 step 2).
 */
export function buildClassificationResultSchema(validThemeIds: ReadonlySet<string>, validEntryIds: ReadonlySet<string>) {
  return z.object({
    assignments: z.array(z.object({
      entryId: z.string().refine(id => validEntryIds.has(id), { message: "entryId not in the input batch" }),
      themeId: z.string().nullable().refine(
        id => id === null || validThemeIds.has(id),
        { message: "themeId not in the classification catalogue — invented ids are rejected" },
      ),
    })),
  });
}

export const residueThemeCandidateSchema = z.object({
  themeName: z.string().min(1),
  summary: z.string().default(""),
  feedbackEntryIds: z.array(z.string()).min(1),
  averageSentiment: z.number().nullish(),
  confidence: z.number().min(0).max(100).default(80),
  coherence: z.number().min(0).max(100).default(70),
});
export type ResidueThemeCandidate = z.infer<typeof residueThemeCandidateSchema>;

export const residueClusteringResultSchema = z.object({
  themes: z.array(residueThemeCandidateSchema),
  analysisNotes: z.string().default(""),
});

/** Creation-gate semantic verdicts (step 4b): candidates vs the STORED catalogue. */
export const semanticGateResultSchema = z.object({
  verdicts: z.array(z.object({
    candidateIndex: z.number().int().min(0),
    /** Existing theme id this candidate is "the same underlying problem" as, or null. */
    matchesExistingThemeId: z.string().nullable(),
    /** Another candidate index this one duplicates (within-run dedup), or null. */
    duplicateOfCandidateIndex: z.number().int().nullable(),
  })),
});
export type SemanticGateResult = z.infer<typeof semanticGateResultSchema>;

// ── API request bodies (§6) ─────────────────────────────────────────────────

export const segmentTypeSchema = z.enum(["customer_segment", "industry_vertical", "primary_persona", "partnership"]);

export const createSegmentBodySchema = z.object({
  name: z.string().trim().min(1, "Segment name is required").max(200),
  description: z.string().trim().max(5000).optional(),
  segmentType: segmentTypeSchema.optional(),
});

export const patchSegmentBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullish(),
  segmentType: segmentTypeSchema.optional(),
  icpFit: z.enum(["strong", "moderate", "weak"]).nullish(),
  isIcp: z.boolean().optional(),
  // §3.4: owner-entered only; dataSource columns are pinned to "user" on write.
  csatScore: z.number().min(0).max(100).nullish(),
  npsScore: z.number().min(-100).max(100).nullish(),
  needsSummary: z.string().nullish(),
  researchItems: z.array(z.object({
    title: z.string().min(1),
    url: z.string().optional(),
    type: z.string().optional(),
    notes: z.string().optional(),
    addedAt: z.string().optional(),
  })).optional(),
});

export const createPersonaBodySchema = z.object({
  title: z.string().trim().min(1, "Persona title is required").max(200),
  description: z.string().trim().max(5000).optional(),
  demographics: z.record(z.string(), z.unknown()).optional(),
  behaviours: z.array(z.string()).optional(),
  facet: z.object({
    goals: z.array(z.string()).optional(),
    painPoints: z.array(z.string()).optional(),
    jobsToBeDone: z.unknown().optional(),
  }).optional(),
});

export const patchPersonaBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullish(),
  demographics: z.record(z.string(), z.unknown()).nullish(),
  behaviours: z.array(z.string()).optional(),
  goals: z.array(z.string()).optional(),
  painPoints: z.array(z.string()).optional(),
  jobsToBeDone: z.unknown().optional(),
});

export const createFeedbackBodySchema = z.object({
  quotedText: z.string().trim().min(1, "Feedback text is required").max(10000),
  sourceName: z.string().trim().max(200).optional(),
  topic: z.string().trim().max(200).optional(),
  sentiment: z.number().min(0).max(100).optional(),
  reviewerName: z.string().trim().max(200).optional(),
  /**
   * Crossover semantics (integration ruling): isCompetitor means "this record
   * is ABOUT the competitor" and must be set EXPLICITLY on manual add; a mere
   * competitorEntityId reference (a review of OUR product that mentions a
   * competitor) keeps isCompetitor false and stays in own-product queries.
   */
  isCompetitor: z.boolean().optional(),
  competitorEntityId: z.string().optional(),
  /**
   * Date discipline: optional explicit authored-at date. When omitted on a
   * manual entry, entry time approximates occurrence (creation ≈ occurrence).
   */
  sourceCreatedAt: z.string().optional(),
});

export const patchFeedbackBodySchema = z.object({
  topic: z.string().trim().max(200).nullish(),
  sentiment: z.number().min(0).max(100).nullish(),
  archived: z.boolean().optional(),
}).refine(
  body => body.topic !== undefined || body.sentiment !== undefined || body.archived !== undefined,
  { message: "Provide at least one of topic, sentiment or archived" },
);

export const patchThemeBodySchema = z.object({
  status: z.string().trim().min(1).optional(),
  /** Human rename (§3.6.1 step 7) — the agent never writes themeName. */
  themeName: z.string().trim().min(1).max(200).optional(),
}).refine(
  body => body.status !== undefined || body.themeName !== undefined,
  { message: "Provide status or themeName" },
);

export const mergeThemeBodySchema = z.object({
  absorbThemeId: z.string().min(1),
});

export const createFeedbackSourceBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().trim().url(),
  type: z.enum(["review", "comparison"]).default("review"),
});
