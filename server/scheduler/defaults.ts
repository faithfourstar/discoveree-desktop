/**
 * Audience-aware schedule defaults — ported from the SaaS scheduler.ts:26–76,
 * trimmed to the competitor keys sprint 2 schedules (ADR 002 §5). Later
 * module sprints extend `computeDefaultSchedules` with their keys.
 */
import type { AgentSchedule } from "@shared/schema";

/**
 * Maps a product's audience array to a default collection cadence.
 * Priority: B2C (most frequent) → B2B Corporate / Government (least frequent) → weekly (default).
 */
export function getAudienceFrequency(
  audience: string[] | null | undefined,
): { frequencyValue: number; frequencyUnit: "hours" | "days" } {
  const list = Array.isArray(audience) ? audience : [];
  if (list.includes("B2C")) {
    return { frequencyValue: 1, frequencyUnit: "days" };
  }
  if (list.some((a) => a === "B2B (Corporate)" || a === "Government")) {
    return { frequencyValue: 30, frequencyUnit: "days" };
  }
  // B2B (SMB), Charities/Non-profits, Other, or unknown → weekly
  return { frequencyValue: 7, frequencyUnit: "days" };
}

/**
 * Computes audience-aware default agent schedules for a product. Competitor
 * keys per ADR 002 §5; the ADR 004 §9 customer keys: feedback/themes at the
 * audience-derived pipeline cadence, competitorReviews at base frequency,
 * segmentQuotes weekly, segmentInsights weekly offset AFTER quotes (gather
 * before synthesise).
 */
export function computeDefaultSchedules(
  product: { audience?: unknown },
): Record<string, AgentSchedule> {
  const baseFreq = getAudienceFrequency(product.audience as string[] | null);

  return {
    competitorUpdates: { enabled: true, ...baseFreq, timeOfDay: "09:00" },
    competitorFeatures: { enabled: true, ...baseFreq, timeOfDay: "09:00" },
    competitorReviews: { enabled: true, ...baseFreq, timeOfDay: "09:00" },
    feedbackCollection: { enabled: true, ...baseFreq, timeOfDay: "08:00" },
    themeAggregation: { enabled: true, ...baseFreq, timeOfDay: "10:00" },
    segmentQuotes: { enabled: true, frequencyValue: 7, frequencyUnit: "days", timeOfDay: "09:00" },
    segmentInsights: { enabled: true, frequencyValue: 7, frequencyUnit: "days", timeOfDay: "12:00" },
  };
}
