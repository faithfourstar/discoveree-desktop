/**
 * Unit tests for the updates-scan validation pass and the provenance
 * (citation-marker) resolution used by the detail endpoint. Pure functions —
 * no DB, no HTTP.
 */
import { describe, it, expect } from "vitest";
import { filterAndNormaliseUpdates } from "../agents/updates.js";
import { resolveCitationUrl } from "../routes.js";

const KNOWN = ["Acme", "Globex"];

function baseUpdate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    competitorName: "Acme",
    changeType: "feature",
    changeTitle: "v2 shipped",
    changeDescription: "Big release",
    sourceUrl: "https://acme.example/changelog/v2",
    publishedDate: "2026-07-01",
    stream: "product",
    severity: "major",
    ...overrides,
  };
}

describe("filterAndNormaliseUpdates", () => {
  it("keeps a fully valid update", () => {
    const out = filterAndNormaliseUpdates([baseUpdate()], KNOWN, "product");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ competitorName: "Acme", severity: "major" });
  });

  it("drops items without a valid http source URL (evidence-cited, always)", () => {
    expect(filterAndNormaliseUpdates([baseUpdate({ sourceUrl: "" })], KNOWN, "product")).toHaveLength(0);
    expect(filterAndNormaliseUpdates([baseUpdate({ sourceUrl: "ftp://x" })], KNOWN, "product")).toHaveLength(0);
  });

  it("drops feature/marketing pages", () => {
    const out = filterAndNormaliseUpdates(
      [baseUpdate({ sourceUrl: "https://acme.example/product/features-page" })],
      KNOWN,
      "product",
    );
    expect(out).toHaveLength(0);
  });

  it("drops items without a real dated year (no fake backfill)", () => {
    expect(filterAndNormaliseUpdates([baseUpdate({ publishedDate: "Unknown" })], KNOWN, "product")).toHaveLength(0);
    expect(filterAndNormaliseUpdates([baseUpdate({ publishedDate: "" })], KNOWN, "product")).toHaveLength(0);
    expect(filterAndNormaliseUpdates([baseUpdate({ publishedDate: undefined })], KNOWN, "product")).toHaveLength(0);
  });

  it("drops items for competitors not in the known list", () => {
    expect(filterAndNormaliseUpdates([baseUpdate({ competitorName: "Imposter" })], KNOWN, "product")).toHaveLength(0);
  });

  it("normalises unknown changeType to 'update' and unknown stream to the default", () => {
    const out = filterAndNormaliseUpdates(
      [baseUpdate({ changeType: "weird", stream: "nonsense" })],
      KNOWN,
      "market",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ changeType: "update", stream: "market" });
  });

  it("defaults severity to 'minor' on product-stream items", () => {
    const out = filterAndNormaliseUpdates([baseUpdate({ severity: undefined })], KNOWN, "product");
    expect(out[0]?.severity).toBe("minor");
  });
});

describe("resolveCitationUrl (differentiator provenance)", () => {
  const citations = ["https://cite.example/one", "https://cite.example/two"];

  it("maps a [n] marker to citations[n-1]", () => {
    expect(resolveCitationUrl("Cheaper for SMBs [2]", citations, "https://fallback.example")).toBe("https://cite.example/two");
  });

  it("falls back to the summary source URL when there is no marker", () => {
    expect(resolveCitationUrl("No marker here", citations, "https://fallback.example")).toBe("https://fallback.example");
  });

  it("falls back on out-of-range markers and null citations", () => {
    expect(resolveCitationUrl("Out of range [9]", citations, "https://fallback.example")).toBe("https://fallback.example");
    expect(resolveCitationUrl("Marker [1]", null, null)).toBeNull();
  });
});
