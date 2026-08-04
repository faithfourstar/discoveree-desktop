/**
 * The evidence ledger (ADR 004 §3.2) — the customers module's centre of
 * gravity. Every generation agent's claims are made from, and verified
 * against, this pool; absence is served honestly as `evidenceStatus` instead
 * of fabricated completeness.
 *
 * ADR 004 §3 ADDENDUM — DATE DISCIPLINE (owner ruling, 4 Aug 2026):
 * The SaaS dated feedback by WHEN IT WAS GATHERED, so old mined reviews read
 * as fresh signal and corrupted trends. Desktop rule, structural:
 * `collectedAt` is ingestion time; `sourceCreatedAt` is when the feedback was
 * authored at its source (null when the source shows none). Every
 * recency-derived computation uses
 * `effectiveDate = sourceCreatedAt ?? (manual ? collectedAt : null)` —
 * manual/owner entries default authored≈entered (the API accepts an explicit
 * date); MINED entries with no source date are EXCLUDED from windowed trend
 * calculations. They still count as evidence toward thresholds and totals —
 * they are real feedback, just undatable — but an undated review must never
 * masquerade as this week's signal.
 */
import { z } from "zod/v4";
import type { CustomerSegmentProfile, FeedbackEntry } from "@shared/schema";
import * as storage from "./storage.js";

// ── Evidence refs (the module's shared currency, §3.2) ──────────────────────

export const evidenceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("feedback_entry"), id: z.string().min(1) }), // feedback_entries.id
  z.object({ kind: z.literal("quote"), url: z.string(), source: z.string() }), // mined quote with validated URL
  z.object({ kind: z.literal("owner"), note: z.string().optional() }), // owner assertion (manual entry / interview)
  z.object({ kind: z.literal("document"), id: z.string() }), // RESERVED — §4a Sources sprint
  z.object({ kind: z.literal("crm"), id: z.string() }), // RESERVED — §4a.3
  z.object({ kind: z.literal("call_transcript"), id: z.string() }), // RESERVED — §4a.4
]);
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

/** §3.3 thresholds (v1, tune with use — never tune the requirement away). */
export const EVIDENCE_THRESHOLDS = {
  /** Agent-proposed persona: ≥3 distinct items citing that role… */
  persona: 3,
  /** …from ≥2 distinct sources. */
  personaDistinctSources: 2,
  /** Every JTBD / goal / pain-point / need claim: ≥1 ref (schema-required). */
  claim: 1,
  /** segmentInsights synthesis: evidence pool ≥5 items. */
  insights: 5,
  /** Theme creation: ≥3 member entries (§3.6.1 step 4c)… */
  theme: 3,
  /** …with elicited coherence ≥70 (step 4d). */
  themeCoherence: 70,
} as const;

export interface EvidenceItem {
  /** Stable id used to enumerate items in the synthesiser prompt (E1, E2, …). */
  ref: EvidenceRef;
  text: string;
  source: string;
  /** The item's honest date (date-discipline rule) — null for undatable items. */
  at: Date | null;
}

export interface EvidenceStatus {
  count: number;
  distinctSources: number;
  newestAt: string | null;
  thresholds: { persona: number; insights: number };
  /** Which agent outputs the pool currently supports. */
  sufficientFor: string[];
}

// ── Date discipline helpers ─────────────────────────────────────────────────

/**
 * The date a feedback entry may honestly claim (§3 addendum): the
 * authored-at-source date; for manual/owner entries, entry time approximates
 * occurrence; a MINED entry with no source date has NO effective date and is
 * excluded from every windowed computation.
 */
export function effectiveFeedbackDate(entry: Pick<FeedbackEntry, "sourceCreatedAt" | "collectedAt" | "sourceType">): Date | null {
  if (entry.sourceCreatedAt) return new Date(entry.sourceCreatedAt);
  if (entry.sourceType === "manual") return entry.collectedAt ? new Date(entry.collectedAt) : null;
  return null;
}

/** Entries eligible for a windowed/trend computation over [since, now]. */
export function entriesWithinWindow<T extends Pick<FeedbackEntry, "sourceCreatedAt" | "collectedAt" | "sourceType">>(
  entries: T[],
  since: Date,
): T[] {
  return entries.filter(e => {
    const at = effectiveFeedbackDate(e);
    return at !== null && at >= since;
  });
}

// ── The ledger ──────────────────────────────────────────────────────────────

/**
 * Assemble the evidence pool for a segment (§3.2): active own-product
 * feedback entries (product-wide — ADR 004 risk 2: no feedback→segment
 * linkage exists yet, thresholds are calibrated to that), URL-validated
 * quotes on the facet, and owner research items (provenance `owner`,
 * first-class and labelled).
 */
export async function collectSegmentEvidence(
  productId: string,
  facet: CustomerSegmentProfile,
): Promise<{ items: EvidenceItem[]; status: EvidenceStatus }> {
  const items: EvidenceItem[] = [];

  const entries = await storage.getFeedbackEntriesByProduct(productId, { isCompetitor: false });
  for (const entry of entries) {
    if (entry.archivedAt) continue;
    items.push({
      ref: { kind: "feedback_entry", id: entry.id },
      text: entry.quotedText,
      source: entry.sourceName,
      at: effectiveFeedbackDate(entry),
    });
  }

  const quotes = (facet.quotes as Array<{ text?: string; source?: string; sourceUrl?: string; date?: string }> | null) ?? [];
  for (const quote of quotes) {
    if (!quote.text) continue;
    items.push({
      ref: { kind: "quote", url: quote.sourceUrl || "", source: quote.source || "Web" },
      text: quote.text,
      source: quote.source || "Web",
      at: quote.date ? (Number.isNaN(new Date(quote.date).getTime()) ? null : new Date(quote.date)) : null,
    });
  }

  const researchItems = (facet.researchItems as Array<{ title?: string; notes?: string; url?: string; addedAt?: string }> | null) ?? [];
  for (const item of researchItems) {
    if (!item.title && !item.notes) continue;
    items.push({
      ref: { kind: "owner", note: item.title || undefined },
      text: [item.title, item.notes].filter(Boolean).join(" — "),
      source: "Owner research",
      at: item.addedAt ? (Number.isNaN(new Date(item.addedAt).getTime()) ? null : new Date(item.addedAt)) : null,
    });
  }

  return { items, status: evidenceStatusFor(items) };
}

export function evidenceStatusFor(items: EvidenceItem[]): EvidenceStatus {
  const sources = new Set(items.map(i => i.source.toLowerCase().trim()).filter(Boolean));
  // newestAt is a recency claim — it uses honest dates only (date discipline):
  // an undatable item never contributes to "newest".
  const dated = items.map(i => i.at).filter((d): d is Date => d !== null);
  const newest = dated.length > 0 ? new Date(Math.max(...dated.map(d => d.getTime()))) : null;

  const sufficientFor: string[] = [];
  if (items.length >= EVIDENCE_THRESHOLDS.persona && sources.size >= EVIDENCE_THRESHOLDS.personaDistinctSources) {
    sufficientFor.push("personas");
  }
  if (items.length >= EVIDENCE_THRESHOLDS.insights) {
    sufficientFor.push("insights");
  }

  return {
    count: items.length,
    distinctSources: sources.size,
    newestAt: newest ? newest.toISOString() : null,
    thresholds: { persona: EVIDENCE_THRESHOLDS.persona, insights: EVIDENCE_THRESHOLDS.insights },
    sufficientFor,
  };
}

// ── Verification (§3.3 layer 3: refs must exist in the ledger) ──────────────

function refKey(ref: EvidenceRef): string {
  switch (ref.kind) {
    case "feedback_entry": return `feedback_entry:${ref.id}`;
    case "quote": return `quote:${(ref.url || "").toLowerCase()}`;
    case "owner": return "owner";
    default: return `${ref.kind}:${(ref as { id?: string }).id ?? ""}`;
  }
}

/**
 * Verify agent-cited refs against the assembled pool: a cited feedback id
 * must exist and be active; a cited quote must be in the facet's quotes;
 * owner refs are always valid (owner knowledge is first-class). Returns the
 * invalid refs — non-empty means REJECT the output, log, store nothing.
 */
export function findInvalidEvidenceRefs(refs: EvidenceRef[], pool: EvidenceItem[]): EvidenceRef[] {
  const poolKeys = new Set(pool.map(i => refKey(i.ref)));
  return refs.filter(ref => {
    if (ref.kind === "owner") return false;
    return !poolKeys.has(refKey(ref));
  });
}

/** Distinct sources cited by a set of refs, resolved through the pool. */
export function distinctSourcesForRefs(refs: EvidenceRef[], pool: EvidenceItem[]): number {
  const byKey = new Map(pool.map(i => [refKey(i.ref), i.source.toLowerCase().trim()]));
  const sources = new Set<string>();
  for (const ref of refs) {
    const source = byKey.get(refKey(ref));
    if (source) sources.add(source);
    else if (ref.kind === "owner") sources.add("owner");
  }
  return sources.size;
}

/**
 * §3.4: overallSatisfaction is COMPUTED from the sentiment of evidence-linked
 * feedback (mean of linked entries' scores), or null. Never an LLM output.
 */
export function computeOverallSatisfaction(refs: EvidenceRef[], entriesById: Map<string, FeedbackEntry>): number | null {
  const scores: number[] = [];
  for (const ref of refs) {
    if (ref.kind !== "feedback_entry") continue;
    const entry = entriesById.get(ref.id);
    if (entry && typeof entry.sentiment === "number") scores.push(entry.sentiment);
  }
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
