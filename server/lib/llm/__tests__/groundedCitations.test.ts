/**
 * Gemini grounded citations — extraction + allow-list enforcement (evidence
 * gate hardening, owner-reported 4 Aug 2026).
 *
 * Part 1: pure helpers — grounding extraction from the SDK response shape,
 * redirect handling (house rule: vertexaisearch redirects are never stored),
 * allow-list collection, enforcement semantics, and the Gemini 3+ single-call
 * capability gate.
 *
 * Part 2: the two-phase web-search+schema flow through callLLM with a mocked
 * Gemini client: phase 1's groundingMetadata becomes the phase-2 allow-list,
 * fabricated URLs are STRIPPED from the output, and real citations ride the
 * response. No LLM HTTP is exercised.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// ── Mock the Gemini provider (must precede the app-graph imports) ──────────

const geminiMock = vi.hoisted(() => ({
  generateContent: vi.fn<(req: any) => Promise<any>>(),
}));

vi.mock("../providers/gemini.js", () => ({
  getGeminiClient: vi.fn(async () => ({ models: { generateContent: geminiMock.generateContent } })),
  getGeminiKeySource: vi.fn(async () => ({ configured: true, description: "mocked org key" })),
}));

import { closeDatabase, initDatabase } from "../../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../../db/seedLocal.js";
import { encrypt, resetSecrets, setEncryptionKeySource } from "../../secrets.js";
import { updateOrganization } from "../keys.js";
import {
  callLLM,
  collectAllowedSourceUrls,
  enforceSourceUrlAllowList,
  extractGeminiGroundingCitations,
  supportsGroundedStructuredOutput,
} from "../router.js";

const REDIRECT_URL = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123";

describe("extractGeminiGroundingCitations", () => {
  it("extracts web URLs from groundingChunks in order, deduped, dropping vertexaisearch redirects", () => {
    const response = {
      candidates: [{
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: "https://grounded.example/docs", title: "Docs" } },
            { web: { uri: REDIRECT_URL, title: "Redirect" } }, // house rule: never stored
            { web: { uri: "https://grounded.example/docs" } }, // dupe collapses
            { web: { title: "No URI at all" } },
            { retrievedContext: { uri: "gs://not-web" } }, // non-web chunk ignored
            { web: { uri: "https://second.example/pricing" } },
          ],
        },
      }],
    };
    expect(extractGeminiGroundingCitations(response)).toEqual([
      "https://grounded.example/docs",
      "https://second.example/pricing",
    ]);
  });

  it("returns [] for responses without grounding metadata", () => {
    expect(extractGeminiGroundingCitations({})).toEqual([]);
    expect(extractGeminiGroundingCitations({ candidates: [{}] })).toEqual([]);
    expect(extractGeminiGroundingCitations(undefined)).toEqual([]);
  });
});

describe("collectAllowedSourceUrls", () => {
  it("combines grounded citations with URLs verbatim in the research text (trailing punctuation trimmed, redirects excluded)", () => {
    const allowed = collectAllowedSourceUrls(
      ["https://grounded.example/docs", REDIRECT_URL],
      `Pricing at https://phase1.example/pricing. Also ${REDIRECT_URL} was consulted.`,
    );
    expect(allowed.has("https://grounded.example/docs")).toBe(true);
    expect(allowed.has("https://phase1.example/pricing")).toBe(true);
    expect([...allowed].some(u => u.includes("vertexaisearch"))).toBe(false);
  });
});

describe("enforceSourceUrlAllowList", () => {
  const allowed = collectAllowedSourceUrls(
    ["https://grounded.example/docs"],
    "see https://phase1.example/pricing today",
  );

  it("keeps allow-listed URL fields and strips fabricated ones to null", () => {
    const { value, stripped } = enforceSourceUrlAllowList(
      {
        websiteUrl: "https://grounded.example/docs/", // trailing slash tolerated
        sourceUrl: "https://fabricated.example/made-up",
        nested: { evidenceUrl: "https://phase1.example/pricing" },
      },
      allowed,
    );
    expect(value.websiteUrl).toBe("https://grounded.example/docs/");
    expect(value.sourceUrl).toBeNull();
    expect(value.nested.evidenceUrl).toBe("https://phase1.example/pricing");
    expect(stripped).toEqual(["https://fabricated.example/made-up"]);
  });

  it("removes non-conforming URLs from ARRAYS (no null holes) and leaves prose containing URLs alone", () => {
    const { value, stripped } = enforceSourceUrlAllowList(
      {
        citations: ["https://grounded.example/docs", "https://also-fake.example/x"],
        summary: "Read more at https://also-fake.example/x for context.", // prose — not a URL field
      },
      allowed,
    );
    expect(value.citations).toEqual(["https://grounded.example/docs"]);
    expect(value.summary).toContain("https://also-fake.example/x");
    expect(stripped).toEqual(["https://also-fake.example/x"]);
  });

  it("always strips grounding redirect URLs, even when allow-listed by mistake", () => {
    const { value } = enforceSourceUrlAllowList(
      { sourceUrl: REDIRECT_URL },
      [REDIRECT_URL],
    );
    expect(value.sourceUrl).toBeNull();
  });
});

describe("supportsGroundedStructuredOutput (checked 4 Aug 2026)", () => {
  it("Gemini ≤2.5 must use two-phase; Gemini 3+ may single-call", () => {
    expect(supportsGroundedStructuredOutput("gemini-2.5-flash")).toBe(false);
    expect(supportsGroundedStructuredOutput("gemini-2.0-flash")).toBe(false);
    expect(supportsGroundedStructuredOutput("gemini-3-flash-preview")).toBe(true);
    expect(supportsGroundedStructuredOutput("gemini-3.5-flash")).toBe(true);
    expect(supportsGroundedStructuredOutput("gpt-4o")).toBe(false);
  });
});

describe("two-phase web-search+schema flow (mocked Gemini client)", () => {
  beforeAll(async () => {
    setEncryptionKeySource(() => "grounded-citations-test-key");
    await initDatabase({ target: "pglite", dataDir: "memory://" });
    // Gemini-only org — exactly the user class the hardening protects.
    await updateOrganization(LOCAL_ORGANIZATION_ID, {
      geminiApiKey: encrypt("AIzaSyTestGeminiKey123"),
      openaiApiKey: null,
      perplexityApiKey: null,
      claudeApiKey: null,
      openrouterApiKey: null,
      llmKeyMode: "individual",
    });
  });

  afterAll(async () => {
    resetSecrets();
    await closeDatabase();
  });

  it("phase 1 grounding feeds the phase-2 allow-list; fabricated URLs are stripped; real citations ride the response", async () => {
    const phase1Text = `Research findings: Acme pricing is listed at https://phase1.example/pricing. Consulted ${REDIRECT_URL} during search.`;

    geminiMock.generateContent.mockReset();
    geminiMock.generateContent
      // Phase 1 — grounded research (tools: googleSearch, no schema)
      .mockResolvedValueOnce({
        text: phase1Text,
        candidates: [{
          finishReason: "STOP",
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://grounded.example/docs", title: "Acme docs" } },
              { web: { uri: REDIRECT_URL, title: "Redirect" } },
            ],
          },
        }],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 23 },
      })
      // Phase 2 — schema extraction (no tools, responseSchema set)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Acme is a tool. Details at https://inline-fake.example/blog remain prose.",
          sourceUrl: "https://fabricated.example/made-up",
          websiteUrl: "https://grounded.example/docs",
          extraUrls: ["https://phase1.example/pricing", "https://also-fake.example/x"],
        }),
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 13 },
      });

    const response = await callLLM({
      organizationId: LOCAL_ORGANIZATION_ID,
      prompt: "Research Acme and return JSON.",
      useWebSearch: true,
      responseSchema: { type: "object" },
    });

    // Two calls: grounded research, then extraction.
    expect(geminiMock.generateContent).toHaveBeenCalledTimes(2);
    const phase1Request = geminiMock.generateContent.mock.calls[0]![0];
    expect(phase1Request.config.tools).toEqual([{ googleSearch: {} }]);
    expect(phase1Request.config.responseSchema).toBeUndefined();

    // Phase 2 carries the explicit allow-list, not hope.
    const phase2Request = geminiMock.generateContent.mock.calls[1]![0];
    expect(phase2Request.config.tools).toBeUndefined();
    expect(phase2Request.config.responseMimeType).toBe("application/json");
    expect(String(phase2Request.contents)).toContain("SOURCES — the only URLs you may cite");
    expect(String(phase2Request.contents)).toContain("https://grounded.example/docs");

    // Enforcement on the output: grounded + phase-1-verbatim URLs survive,
    // reconstructed ones are stripped (null / removed from arrays).
    const parsed = JSON.parse(response.text);
    expect(parsed.websiteUrl).toBe("https://grounded.example/docs");
    expect(parsed.sourceUrl).toBeNull();
    expect(parsed.extraUrls).toEqual(["https://phase1.example/pricing"]);
    expect(parsed.summary).toContain("https://inline-fake.example/blog"); // prose untouched

    // The REAL grounded citations (redirects dropped) ride the response.
    expect(response.citations).toEqual(["https://grounded.example/docs"]);
    expect(response.provider).toBe("gemini");
    // Token accounting sums both phases.
    expect(response.promptTokens).toBe(18);
    expect(response.completionTokens).toBe(36);
  });
});
