/**
 * Date discipline (ADR 004 §3 addendum, owner ruling 4 Aug 2026): feedback is
 * dated by when it was AUTHORED at its source, never by when it was gathered.
 * Pure-function tests over the helpers every recency computation must use.
 */
import { describe, it, expect } from "vitest";
import type { FeedbackEntry } from "@shared/schema";
import { sanitizeSourceDate } from "../../../lib/reviews/search.js";
import { effectiveFeedbackDate, entriesWithinWindow, evidenceStatusFor, type EvidenceItem } from "../evidence.js";

type DateFields = Pick<FeedbackEntry, "sourceCreatedAt" | "collectedAt" | "sourceType">;

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const weekAgo = new Date(now.getTime() - 7 * DAY);

function entry(overrides: Partial<DateFields>): DateFields {
  return {
    sourceCreatedAt: null,
    collectedAt: now,
    sourceType: "review",
    ...overrides,
  } as DateFields;
}

describe("sanitizeSourceDate (gatherer sanity path)", () => {
  it("accepts plausible dates, rejects unparseable/future/implausibly-old to null", () => {
    expect(sanitizeSourceDate("2026-05-14")!.toISOString()).toContain("2026-05-14");
    expect(sanitizeSourceDate("March 2026")).not.toBeNull();
    expect(sanitizeSourceDate("no idea, honestly")).toBeNull();
    expect(sanitizeSourceDate("")).toBeNull();
    expect(sanitizeSourceDate(undefined)).toBeNull();
    expect(sanitizeSourceDate("2091-01-01")).toBeNull(); // future
    expect(sanitizeSourceDate("1971-01-01")).toBeNull(); // implausibly old
  });
});

describe("effectiveFeedbackDate = sourceCreatedAt ?? (manual ? collectedAt : null)", () => {
  it("a mined review keeps its authored date — an OLD review mined TODAY is old", () => {
    const oldMined = entry({ sourceCreatedAt: new Date("2024-11-05"), collectedAt: now, sourceType: "review" });
    expect(effectiveFeedbackDate(oldMined)!.toISOString()).toContain("2024-11-05");
  });

  it("an UNDATED mined review has NO effective date — ingestion time never masquerades as authored time", () => {
    expect(effectiveFeedbackDate(entry({ sourceCreatedAt: null, sourceType: "review" }))).toBeNull();
  });

  it("a manual entry defaults to entry time (creation ≈ occurrence) and honours an explicit date", () => {
    expect(effectiveFeedbackDate(entry({ sourceCreatedAt: null, sourceType: "manual" }))!.getTime()).toBe(now.getTime());
    const explicit = entry({ sourceCreatedAt: new Date("2026-05-14"), sourceType: "manual" });
    expect(effectiveFeedbackDate(explicit)!.toISOString()).toContain("2026-05-14");
  });
});

describe("entriesWithinWindow (the trend/lifecycle window rule)", () => {
  it("an old-dated mined review entering today does NOT produce a this-week signal", () => {
    const oldMinedToday = entry({ sourceCreatedAt: new Date("2024-11-05"), collectedAt: now, sourceType: "review" });
    expect(entriesWithinWindow([oldMinedToday], weekAgo)).toHaveLength(0);
  });

  it("an undated mined review is EXCLUDED from windows but still counts as evidence toward totals", () => {
    const undatedMined = entry({ sourceCreatedAt: null, collectedAt: now, sourceType: "review" });
    expect(entriesWithinWindow([undatedMined], weekAgo)).toHaveLength(0);

    // Evidence accounting: the same item still counts toward count/thresholds…
    const pool: EvidenceItem[] = [
      { ref: { kind: "feedback_entry", id: "a" }, text: "undatable", source: "G2", at: null },
      { ref: { kind: "feedback_entry", id: "b" }, text: "dated", source: "Capterra", at: new Date("2026-08-01") },
    ];
    const status = evidenceStatusFor(pool);
    expect(status.count).toBe(2);
    // …but never drives the recency claim: newestAt comes from dated items only.
    expect(status.newestAt).toContain("2026-08-01");
  });

  it("a recent authored date passes the window; a manual entry passes on entry time", () => {
    const recentMined = entry({ sourceCreatedAt: new Date(now.getTime() - 2 * DAY), sourceType: "review" });
    const manualNow = entry({ sourceCreatedAt: null, sourceType: "manual" });
    expect(entriesWithinWindow([recentMined, manualNow], weekAgo)).toHaveLength(2);
  });
});
