/**
 * Customers API against in-memory PGlite (ADR 004 §6): segments on the 3a
 * entity/facet shapes with the §7 gate ruling, personas with per-product
 * facets, evidence-gated enrichment (§3.3), direct-add feedback with the
 * date-discipline rules, the collect run with entity-resolved
 * cross-allocation (§2), human-only theme operations, and sources CRUD.
 * LLM + review mining are mocked — no network.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

const mockState = vi.hoisted(() => ({
  insightsOutput: null as unknown,
}));

vi.mock("../../../lib/llm/router.js", () => ({
  callLLM: vi.fn(async (config: { agentSlug?: string; prompt?: string }) => {
    const base = { promptTokens: 1, completionTokens: 1, model: "mock", provider: "gemini" as const };
    const prompt = config.prompt ?? "";
    switch (config.agentSlug) {
      case "customer-quotes-agent":
        return {
          ...base,
          text: JSON.stringify({
            segmentIndicators: ["practice", "clients"],
            quotes: [
              { text: "As an accountant I rely on the export every quarter-end.", source: "G2 Review", sourceUrl: "https://g2.example/acme/reviews", attribution: "Accountant", date: "2026-03", sentiment: "positive", relevanceScore: 90 },
            ],
          }),
        };
      case "customer-insights-agent":
        return { ...base, text: JSON.stringify(mockState.insightsOutput ?? {}) };
      case "sentiment-analysis-agent": {
        const ids = [...prompt.matchAll(/ID="([0-9a-f-]{36})"/g)].map(m => m[1]!);
        return { ...base, text: JSON.stringify({ scores: ids.map(id => ({ id, score: 70 })) }) };
      }
      case "gather-feedback-agent": {
        // Batch feature extraction (no web search in this call)
        const count = [...prompt.matchAll(/\[\d+\]/g)].length;
        return {
          ...base,
          text: JSON.stringify({ features: Array.from({ length: count }, (_, i) => ({ index: i, feature: i === 0 ? "Receipt Scanning" : "Bank Integration" })) }),
        };
      }
      case "competitor-summary-agent":
        return { ...base, text: JSON.stringify({ summary: "Rivalify is a rival expense tool for accountants." }) };
      case "competitor-features-agent":
        return { ...base, text: JSON.stringify({ features: [] }) };
      default:
        return { ...base, text: JSON.stringify({ updates: [], searchSummary: "" }) };
    }
  }),
  clearLlmClientCaches: vi.fn(),
  collectAllowedSourceUrls: vi.fn(() => new Set<string>()),
  enforceSourceUrlAllowList: vi.fn((value: unknown) => ({ value, stripped: [] })),
}));

vi.mock("../../../lib/web/fetch.js", () => ({
  validateUrlWithSoft404Detection: vi.fn(async (url: string) => url),
  validateUrlsWithSoft404Detection: vi.fn(async (urls: string[]) => urls),
  fetchViaJina: vi.fn(async () => null),
}));

vi.mock("../../../lib/reviews/fetch.js", () => ({
  fetchProductReviews: vi.fn(async () => ({
    quotes: [
      {
        text: "Great tool for scanning receipts, the OCR rarely misses.",
        source: "G2", sourceUrl: "https://g2.example/acme/reviews", sentiment: null,
        verified: true, sourceType: "web_search", fetchedAt: new Date().toISOString(),
        // Date discipline: an OLD review mined today keeps its authored date.
        sourceCreatedAt: "2024-11-05T00:00:00.000Z",
      },
      {
        text: "Solid product but the bank imports are slow sometimes.",
        source: "Capterra", sourceUrl: "", sentiment: null,
        verified: false, sourceType: "web_search", fetchedAt: new Date().toISOString(),
        sourceCreatedAt: null, // undatable — must stay undated, never ingestion-dated
      },
    ],
    crossAllocatedQuotes: [
      {
        text: "Rivalify handles multi-entity setups much better than most.",
        source: "Reddit", sourceUrl: "https://reddit.example/r/acc", sentiment: null,
        verified: false, sourceType: "web_search", fetchedAt: new Date().toISOString(),
        sourceCreatedAt: null, matchedCompetitor: "Rivalify",
      },
      {
        text: "NobodyTracks is the tool everyone forgot.",
        source: "Reddit", sourceUrl: "", sentiment: null,
        verified: false, sourceType: "web_search", fetchedAt: new Date().toISOString(),
        sourceCreatedAt: null, matchedCompetitor: "NobodyTracks",
      },
    ],
    sourcesUsed: ["G2", "Capterra"],
    hasRealData: true,
  })),
  fetchCompetitorReviews: vi.fn(async () => []),
}));

import { aiAgentExecutions } from "@shared/schema";
import { buildApp } from "../../../app.js";
import { closeDatabase, getDb, initDatabase } from "../../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../../db/seedLocal.js";
import { seedAgents } from "../../../lib/agents/seed.js";
import { createAiAgentExecution, updateAiAgentExecution } from "../../../lib/agents/executions.js";
import { getAiAgentBySlug } from "../../../lib/agents/registry.js";
import * as competitorsStorage from "../../competitors/storage.js";
import { settleBackgroundTasks } from "../../competitors/service.js";
import { addSegment, settleCustomerBackgroundTasks } from "../service.js";
import * as storage from "../storage.js";
import { getProduct } from "../../products/storage.js";

let app: Express;
let productId: string;
let productBId: string;
let segmentId: string; // Accountants facet on product A
let segmentEntityId: string;
let rivalifyEntityId: string;

const api = (pid: string) => `/api/products/${pid}`;

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  await seedAgents();
  app = buildApp();

  const a = await request(app).post("/api/products").send({ name: "Acme", url: "https://acme.example" });
  productId = a.body.product.id;
  const b = await request(app).post("/api/products").send({ name: "Second" });
  productBId = b.body.product.id;

  // A tracked competitor for cross-allocation to resolve against.
  const comp = await request(app)
    .post(`${api(productId)}/competitors`)
    .send({ name: "Rivalify", classification: "DIRECT" });
  rivalifyEntityId = comp.body.competitor.entityId;
  await settleBackgroundTasks();
  await request(app).post(`${api(productId)}/competitors/${comp.body.competitor.id}/accept`);
});

afterAll(async () => {
  await settleCustomerBackgroundTasks();
  await settleBackgroundTasks();
  await closeDatabase();
});

describe("Segments (§6.1 — gate ruling §7)", () => {
  it("owner POST creates entity + facet TRACKED immediately with owner provenance", async () => {
    const res = await request(app)
      .post(`${api(productId)}/segments`)
      .send({ name: "Accountants", description: "Accounting practices", segmentType: "primary_persona" });
    expect(res.status).toBe(201);
    expect(res.body.adopted).toBe(false);
    expect(res.body.segment).toMatchObject({
      name: "Accountants",
      status: "tracked", // deliberate asymmetry with competitor POST (§7)
      provenance: "owner",
      segmentType: "primary_persona",
      personaCount: 0,
    });
    expect(res.body.segment.evidenceStatus).toMatchObject({
      count: 0,
      distinctSources: 0,
      thresholds: { persona: 3, insights: 5 },
      sufficientFor: [],
    });
    segmentId = res.body.segment.id;
    segmentEntityId = res.body.segment.entityId;
  });

  it("duplicate name (normalisation-aware) → 409", async () => {
    const res = await request(app).post(`${api(productId)}/segments`).send({ name: "accountants" });
    expect(res.status).toBe(409);
  });

  it("a second product adding the same vocabulary ADOPTS the org entity", async () => {
    const res = await request(app).post(`${api(productBId)}/segments`).send({ name: "Accountants" });
    expect(res.status).toBe(201);
    expect(res.body.adopted).toBe(true);
    expect(res.body.segment.entityId).toBe(segmentEntityId);

    const entities = await request(app).get("/api/entities/segments");
    const accountants = entities.body.entities.find((e: { name: string }) => e.name === "Accountants");
    expect(accountants.facets).toHaveLength(2);

    // Clean up product B's facet — entity survives (product A still tracks).
    await request(app).delete(`${api(productBId)}/segments/${res.body.segment.id}`);
    expect(await storage.getSegmentEntityById(segmentEntityId)).toBeDefined();
  });

  it("agent-created facets are PROPOSED and hidden from the default list until accept", async () => {
    const product = (await getProduct(productId))!;
    const proposed = await addSegment(LOCAL_ORGANIZATION_ID, product, {
      name: "Bookkeepers",
      provenance: "agent",
    });
    expect(proposed.facet.status).toBe("proposed");

    const defaultList = await request(app).get(`${api(productId)}/segments`);
    expect(defaultList.body.segments.map((s: { name: string }) => s.name)).not.toContain("Bookkeepers");
    const withProposed = await request(app).get(`${api(productId)}/segments?include=proposed`);
    expect(withProposed.body.segments.map((s: { name: string }) => s.name)).toContain("Bookkeepers");

    const accepted = await request(app).post(`${api(productId)}/segments/${proposed.facet.id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.segment.status).toBe("tracked");
    await request(app).delete(`${api(productId)}/segments/${proposed.facet.id}`);
  });

  it("PATCH splits entity fields (name/description/type) from facet fields; scores are owner-entered", async () => {
    const res = await request(app)
      .patch(`${api(productId)}/segments/${segmentId}`)
      .send({ description: "Accounting practices in the UK", isIcp: true, icpFit: "strong", csatScore: 72 });
    expect(res.status).toBe(200);
    expect(res.body.segment).toMatchObject({ isIcp: true, icpFit: "strong" });

    const facet = await storage.getSegmentFacetById(segmentId);
    expect(facet!.csatScore).toBe(72);
    expect(facet!.csatDataSource).toBe("user"); // §3.4: "ai" does not exist
    const entity = await storage.getSegmentEntityById(segmentEntityId);
    expect(entity!.description).toBe("Accounting practices in the UK");
  });

  it("delete + blocklist: a deleted name cannot be silently re-added until unblocked", async () => {
    const created = await request(app).post(`${api(productId)}/segments`).send({ name: "Tax Advisers" });
    expect(created.status).toBe(201);

    const del = await request(app).delete(`${api(productId)}/segments/${created.body.segment.id}`);
    expect(del.status).toBe(204);

    const blockedAdd = await request(app).post(`${api(productId)}/segments`).send({ name: "Tax Advisers" });
    expect(blockedAdd.status).toBe(409);
    expect(blockedAdd.body.error).toMatch(/previously deleted/i);

    // The earlier Bookkeepers delete blocklisted too — find the row by name.
    const blocked = await request(app).get(`${api(productId)}/segments/blocked`);
    const taxRow = blocked.body.blocked.find((b: { originalName: string }) => b.originalName === "Tax Advisers");
    expect(taxRow).toBeTruthy();
    await request(app).delete(`${api(productId)}/segments/blocked/${taxRow.id}`);

    const readd = await request(app).post(`${api(productId)}/segments`).send({ name: "Tax Advisers" });
    expect(readd.status).toBe(201);
    await request(app).delete(`${api(productId)}/segments/${readd.body.segment.id}`);
  });
});

describe("Feedback (§6.3 — direct-add, date discipline)", () => {
  it("manual add defaults sourceCreatedAt to entry time (creation ≈ occurrence) with owner provenance semantics", async () => {
    const res = await request(app)
      .post(`${api(productId)}/feedback`)
      .send({ quotedText: "Our clients love the export flow.", sourceName: "Interview", sentiment: 80 });
    expect(res.status).toBe(201);
    expect(res.body.feedback.sourceType).toBe("manual");
    expect(res.body.feedback.verified).toBe(true);
    expect(res.body.feedback.sourceCreatedAt).toBeTruthy();
  });

  it("manual add accepts an EXPLICIT authored-at date and uses it", async () => {
    const res = await request(app)
      .post(`${api(productId)}/feedback`)
      .send({ quotedText: "Quarter-end close was painful before we switched.", sourceName: "Interview", sourceCreatedAt: "2026-05-14" });
    expect(res.status).toBe(201);
    expect(res.body.feedback.sourceCreatedAt).toContain("2026-05-14");
  });

  it("an unparseable or future explicit date is rejected (sanity path)", async () => {
    const bad = await request(app)
      .post(`${api(productId)}/feedback`)
      .send({ quotedText: "Test", sourceCreatedAt: "sometime last spring maybe" });
    expect(bad.status).toBe(400);

    const future = await request(app)
      .post(`${api(productId)}/feedback`)
      .send({ quotedText: "Test", sourceCreatedAt: "2091-01-01" });
    expect(future.status).toBe(400);
  });

  it("PATCH topic/sentiment/archive and DELETE work; archived entries leave the default list", async () => {
    const created = await request(app)
      .post(`${api(productId)}/feedback`)
      .send({ quotedText: "Temporary note", sourceName: "Interview" });
    const id = created.body.feedback.id;

    const patched = await request(app).patch(`${api(productId)}/feedback/${id}`).send({ topic: "Exports", archived: true });
    expect(patched.status).toBe(200);
    expect(patched.body.feedback.archivedAt).toBeTruthy();

    const list = await request(app).get(`${api(productId)}/feedback`);
    expect(list.body.feedback.map((f: { id: string }) => f.id)).not.toContain(id);

    const del = await request(app).delete(`${api(productId)}/feedback/${id}`);
    expect(del.status).toBe(204);
  });
});

describe("Collect run (§2 — cross-allocation against ENTITIES)", () => {
  it("mines own-product entries with honest dates, resolves tracked competitors, drops untracked with a log", async () => {
    const res = await request(app).post(`${api(productId)}/feedback/collect`);
    expect(res.status).toBe(202);
    await settleCustomerBackgroundTasks();

    const entries = await storage.getFeedbackEntriesByProduct(productId, { includeArchived: true });

    // Own-product mined entries: topics extracted, sentiment scored (pipeline
    // stage), dates honest — the 2024 review keeps its authored date; the
    // undatable one stays NULL (never masquerades as fresh).
    const ocr = entries.find(e => e.quotedText.includes("scanning receipts"));
    expect(ocr).toBeTruthy();
    expect(ocr!.topic).toBe("Receipt Scanning");
    expect(ocr!.sentiment).toBe(70);
    expect(new Date(ocr!.sourceCreatedAt!).toISOString()).toBe("2024-11-05T00:00:00.000Z");
    const slow = entries.find(e => e.quotedText.includes("bank imports are slow"));
    expect(slow!.sourceCreatedAt).toBeNull();

    // Cross-allocation: the tracked "Rivalify" mention became a feedback entry
    // keyed by competitorEntityId AND appended to the entity's reviews…
    const rival = entries.find(e => e.isCompetitor && e.competitorEntityId === rivalifyEntityId);
    expect(rival).toBeTruthy();
    const rivalEntity = await competitorsStorage.getCompetitorEntityById(rivalifyEntityId);
    const entityReviews = (rivalEntity!.reviews as Array<{ text: string }>) ?? [];
    expect(entityReviews.some(r => r.text.includes("multi-entity"))).toBe(true);

    // …while the UNTRACKED "NobodyTracks" mention was dropped entirely.
    expect(entries.some(e => e.quotedText.includes("NobodyTracks"))).toBe(false);
  });
});

describe("Evidence gate + enrichment (§3.3)", () => {
  it("manual enrich below threshold → 422 { error: insufficient_evidence, evidenceStatus }", async () => {
    // Product B has no feedback at all — its segment pool is empty.
    const seg = await request(app).post(`${api(productBId)}/segments`).send({ name: "Founders" });
    const res = await request(app).post(`${api(productBId)}/segments/${seg.body.segment.id}/enrich`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("insufficient_evidence");
    expect(res.body.evidenceStatus).toMatchObject({ thresholds: { persona: 3, insights: 5 } });
  });

  it("with sufficient evidence the synthesiser runs on the LEDGER: facet data + PROPOSED agent personas, all evidence-cited", async () => {
    // Pool: the manual entries above + mined entries — well past both thresholds,
    // with multiple distinct sources.
    mockState.insightsOutput = {
      personas: [{
        title: "Practice Accountant",
        description: "Runs the books for many clients.",
        behaviours: ["quarter-end heavy usage"],
        goals: [{ text: "Close the quarter faster", evidenceRefs: ["E1"] }],
        painPoints: [{ text: "Slow bank imports", evidenceRefs: ["E2"] }],
        evidenceRefs: ["E1", "E2", "E3"],
      }],
      needsSummary: "Accountants need reliable imports and fast exports.",
      needs: [{ need: "Reliable bank imports", importance: 5, evidenceRefs: ["E2"] }],
      jobsToBeDone: {
        coreJob: { text: "Close clients' books accurately", evidenceRefs: ["E1"] },
        functionalJobs: [{ text: "Export quarter-end reports", evidenceRefs: ["E3"] }],
        emotionalJobs: [], socialJobs: [], desiredOutcomes: [],
      },
      segmentInsights: { text: "Evidence shows import reliability drives satisfaction.", evidenceRefs: ["E1", "E2", "E3", "E4", "E5"] },
    };

    const res = await request(app).post(`${api(productId)}/segments/${segmentId}/enrich`);
    expect(res.status).toBe(202);
    await settleCustomerBackgroundTasks();

    const detail = await request(app).get(`${api(productId)}/segments/${segmentId}`);
    const segment = detail.body.segment;
    expect(segment.needsSummary).toMatch(/reliable imports/i);
    expect(segment.needs[0].evidenceRefs.length).toBeGreaterThanOrEqual(1);
    expect(segment.segmentInsights).toMatch(/import reliability/i);
    expect(segment.overallSatisfaction).not.toBeNull(); // computed from cited sentiment (§3.4)
    // The quotes gatherer stored its URL-cited quote as evidence.
    expect(segment.quotes.some((q: { text: string }) => q.text.includes("quarter-end"))).toBe(true);

    // Agent persona: PROPOSED facet, provenance agent (§7).
    expect(segment.personas).toHaveLength(1);
    expect(segment.personas[0]).toMatchObject({
      title: "Practice Accountant",
      facetStatus: "proposed",
      provenance: "agent",
    });

    const accepted = await request(app).post(`${api(productId)}/personas/${segment.personas[0].id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.persona.facetStatus).toBe("tracked");
  });

  it("an output citing refs OUTSIDE the ledger is rejected — nothing stored", async () => {
    mockState.insightsOutput = {
      personas: [],
      needs: [{ need: "Invented need", evidenceRefs: ["E999"] }], // E999 resolves to nothing → min(1) fails
      segmentInsights: null,
    };
    const facetBefore = await storage.getSegmentFacetById(segmentId);
    const res = await request(app).post(`${api(productId)}/segments/${segmentId}/enrich`);
    expect(res.status).toBe(202);
    await settleCustomerBackgroundTasks();
    const facetAfter = await storage.getSegmentFacetById(segmentId);
    // The needs written by the previous (valid) run survive unchanged.
    expect(facetAfter!.needs).toEqual(facetBefore!.needs);
  });
});

describe("Personas (§6.2 — owner path)", () => {
  it("owner-created persona is tracked immediately; delete GCs identity on last facet", async () => {
    const res = await request(app)
      .post(`${api(productId)}/segments/${segmentId}/personas`)
      .send({ title: "Junior Bookkeeper", facet: { goals: ["Learn the ropes"], painPoints: ["Manual entry"] } });
    expect(res.status).toBe(201);
    expect(res.body.persona).toMatchObject({ title: "Junior Bookkeeper", facetStatus: "tracked", provenance: "owner" });
    // Owner claims carry labelled owner evidence — never dressed up as research.
    expect(res.body.persona.goals[0].evidenceRefs[0].kind).toBe("owner");

    const patched = await request(app)
      .patch(`${api(productId)}/personas/${res.body.persona.id}`)
      .send({ title: "Senior Bookkeeper", goals: ["Own the close process"] });
    expect(patched.status).toBe(200);
    expect(patched.body.persona.title).toBe("Senior Bookkeeper");

    const del = await request(app).delete(`${api(productId)}/personas/${res.body.persona.id}`);
    expect(del.status).toBe(204);
    expect(await storage.getPersonaById(res.body.persona.id)).toBeUndefined(); // identity GC'd with last facet
  });
});

describe("Themes (§6.3 — human-only identity operations)", () => {
  let themeAId: string;
  let themeBId: string;

  it("GET serves the catalogue with unfiledCount (the honest backlog)", async () => {
    const entries = await storage.getFeedbackEntriesByProduct(productId, {});
    const [e1, e2, e3] = entries.slice(0, 3).map(e => e.id);
    themeAId = (await storage.createFeedbackTheme({
      productId, themeName: "Unreliable Bank Imports", aliases: [], summary: "Imports fail.",
      status: "needs_review", mentionCount: 2, feedbackEntryIds: [e1, e2], confidence: 90, coherence: 88,
    })).id;
    themeBId = (await storage.createFeedbackTheme({
      productId, themeName: "Bank Feed Failures", aliases: [], summary: "Feeds fail.",
      status: "needs_review", mentionCount: 1, feedbackEntryIds: [e3], confidence: 80, coherence: 75,
    })).id;

    const res = await request(app).get(`${api(productId)}/themes`);
    expect(res.status).toBe(200);
    expect(res.body.themes).toHaveLength(2);
    expect(res.body.unfiledCount).toBeGreaterThanOrEqual(1);
    expect(res.body.themes[0].coherence).not.toBeNull(); // §3.5: stored, served
  });

  it("human rename records the old name as an alias", async () => {
    const res = await request(app)
      .patch(`${api(productId)}/themes/${themeAId}`)
      .send({ themeName: "Unreliable Bank Statement Imports" });
    expect(res.status).toBe(200);
    expect(res.body.theme.themeName).toBe("Unreliable Bank Statement Imports");
    expect(res.body.theme.aliases).toContain("Unreliable Bank Imports");
  });

  it("human merge unions members and records the absorbed name as an alias", async () => {
    const res = await request(app)
      .post(`${api(productId)}/themes/${themeAId}/merge`)
      .send({ absorbThemeId: themeBId });
    expect(res.status).toBe(200);
    expect(res.body.theme.mentionCount).toBe(3);
    expect(res.body.theme.aliases).toContain("Bank Feed Failures");
    expect(await storage.getFeedbackThemeById(themeBId)).toBeUndefined();
  });
});

describe("Feedback sources (§6.3 — manual CRUD)", () => {
  it("create, list, delete", async () => {
    const created = await request(app)
      .post(`${api(productId)}/feedback-sources`)
      .send({ name: "G2", url: "https://www.g2.com/products/acme/reviews", type: "review" });
    expect(created.status).toBe(201);
    expect(created.body.source.isManual).toBe(true);

    const list = await request(app).get(`${api(productId)}/feedback-sources`);
    expect(list.body.sources).toHaveLength(1);

    const del = await request(app).delete(`${api(productId)}/feedback-sources/${created.body.source.id}`);
    expect(del.status).toBe(204);
  });
});

describe("Crossover semantics (integration ruling — competitor chip on own-product feedback)", () => {
  it("a competitorEntityId reference WITHOUT the explicit flag stays own-product (isCompetitor false)", async () => {
    const res = await request(app)
      .post(`${api(productId)}/feedback`)
      .send({
        quotedText: "Love the exports, though Rivalify's multi-entity view is something we miss.",
        sourceName: "Interview",
        competitorEntityId: rivalifyEntityId, // the chip, not the subject
      });
    expect(res.status).toBe(201);
    expect(res.body.feedback.isCompetitor).toBe(false);
    expect(res.body.feedback.competitorEntityId).toBe(rivalifyEntityId);

    // It lives in own-product queries, chip intact.
    const ownList = await request(app).get(`${api(productId)}/feedback?isCompetitor=false&limit=200`);
    const found = ownList.body.feedback.find((f: { id: string }) => f.id === res.body.feedback.id);
    expect(found).toBeTruthy();
    expect(found.competitorEntityId).toBe(rivalifyEntityId);
  });

  it("an explicit isCompetitor:true creates an ABOUT-the-competitor record, excluded from own-product queries", async () => {
    const res = await request(app)
      .post(`${api(productId)}/feedback`)
      .send({
        quotedText: "Rivalify's onboarding took our client a whole week.",
        sourceName: "Interview",
        isCompetitor: true,
        competitorEntityId: rivalifyEntityId,
      });
    expect(res.status).toBe(201);
    expect(res.body.feedback.isCompetitor).toBe(true);

    const ownList = await request(app).get(`${api(productId)}/feedback?isCompetitor=false&limit=200`);
    expect(ownList.body.feedback.some((f: { id: string }) => f.id === res.body.feedback.id)).toBe(false);
    const competitorList = await request(app).get(`${api(productId)}/feedback?isCompetitor=true&limit=200`);
    expect(competitorList.body.feedback.some((f: { id: string }) => f.id === res.body.feedback.id)).toBe(true);
  });
});

describe("Theme evidence.distinctSources is computed server-side", () => {
  it("serves the distinct member-entry source count on the Theme payload", async () => {
    const e1 = await storage.createFeedbackEntry({
      productId, isCompetitor: false, sourceName: "G2", sourceType: "review", verified: true,
      collectedAt: new Date(), quotedText: "Distinct-source member one",
    });
    const e2 = await storage.createFeedbackEntry({
      productId, isCompetitor: false, sourceName: "Capterra", sourceType: "review", verified: true,
      collectedAt: new Date(), quotedText: "Distinct-source member two",
    });
    const e3 = await storage.createFeedbackEntry({
      productId, isCompetitor: false, sourceName: "g2 ", sourceType: "review", verified: true,
      collectedAt: new Date(), quotedText: "Same source, different casing",
    });
    const theme = await storage.createFeedbackTheme({
      productId, themeName: "Distinct Source Fixture", aliases: [], summary: "Fixture.",
      status: "needs_review", mentionCount: 3, feedbackEntryIds: [e1.id, e2.id, e3.id],
      confidence: 90, coherence: 90,
    });

    const res = await request(app).get(`${api(productId)}/themes`);
    const view = res.body.themes.find((t: { id: string }) => t.id === theme.id);
    // G2 + Capterra — "g2 " normalises into G2 (case/whitespace-insensitive).
    expect(view.evidence).toEqual({ count: 3, distinctSources: 2 });

    // PATCH and merge responses carry it too.
    const patched = await request(app).patch(`${api(productId)}/themes/${theme.id}`).send({ status: "reviewed" });
    expect(patched.body.theme.evidence.distinctSources).toBe(2);
    await storage.deleteFeedbackTheme(theme.id);
  });
});

describe("GET /customers/runs/active (run status for the three 202s)", () => {
  it("idle → { active: false }", async () => {
    const res = await request(app).get(`${api(productId)}/customers/runs/active`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: false });
  });

  it("a live collect run reports kind 'collect'; enrich runs carry the facet targetId", async () => {
    const gatherAgent = await getAiAgentBySlug("gather-feedback-agent");
    const collectExec = await createAiAgentExecution({
      agentId: gatherAgent!.id,
      organizationId: LOCAL_ORGANIZATION_ID,
      productId,
      status: "running",
    });

    const collect = await request(app).get(`${api(productId)}/customers/runs/active`);
    expect(collect.body).toMatchObject({ active: true, kind: "collect", agentLabel: "Feedback collection" });
    expect(collect.body.targetId).toBeUndefined();
    expect(collect.body.startedAt).toBeTruthy();
    await updateAiAgentExecution(collectExec.id, { status: "completed", completedAt: new Date() });

    const insightsAgent = await getAiAgentBySlug("customer-insights-agent");
    const enrichExec = await createAiAgentExecution({
      agentId: insightsAgent!.id,
      organizationId: LOCAL_ORGANIZATION_ID,
      productId,
      status: "running",
      inputParameters: { segmentName: "Accountants", facetId: segmentId },
    });

    const enrich = await request(app).get(`${api(productId)}/customers/runs/active`);
    expect(enrich.body).toMatchObject({
      active: true,
      kind: "enrich",
      targetId: segmentId,
      agentLabel: "Segment synthesis",
    });
    await updateAiAgentExecution(enrichExec.id, { status: "completed", completedAt: new Date() });
  });

  it("a stale running row (>2h) is ignored, matching the competitors pattern", async () => {
    const themeAgent = await getAiAgentBySlug("theme-aggregation-agent");
    await getDb().insert(aiAgentExecutions).values({
      agentId: themeAgent!.id,
      organizationId: LOCAL_ORGANIZATION_ID,
      productId,
      status: "running",
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });

    const res = await request(app).get(`${api(productId)}/customers/runs/active`);
    expect(res.body).toEqual({ active: false });
  });
});
