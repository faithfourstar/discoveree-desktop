/**
 * Competitors API against in-memory PGlite with the seeded local org, on the
 * ADR 003 surface: /api/products/:productId/... product scoping, org-level
 * canonical entities with per-product facets, the adoption/dedup flow, the
 * tree-aware discard GC, and the entity-keyed change feed join.
 *
 * The LLM router and web-fetch modules are mocked (no live API calls) so the
 * FULL slice runs: add → background enrichment (summary → features, Zod →
 * merge-don't-replace, split at the entity/facet seam) → provenance-stored
 * profile → serve → refresh detects change (entity-scoped updates scan →
 * competitor_changes).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

// ── Mocks (must be declared before importing the app graph) ────────────────

// Mutable knobs the hoisted mock factory can read (vi.mock factories are
// hoisted above imports, so plain module-level lets are not visible to them).
const mockState = vi.hoisted(() => ({
  /** When true, the features agent "discovers" a third feature (diff-scan tests). */
  includeGanttFeature: false,
}));

vi.mock("../../../lib/llm/router.js", () => ({
  callLLM: vi.fn(async (config: { agentSlug?: string }) => {
    const base = { promptTokens: 10, completionTokens: 20, model: "mock-model", provider: "gemini" as const };
    if (config.agentSlug === "competitor-summary-agent") {
      return {
        ...base,
        text: JSON.stringify({
          summary: "Acme is a project management tool positioned for small teams.",
          sourceUrl: "https://acme.example/about",
          websiteUrl: "https://acme.example",
          keyDifferentiators: ["Cheaper for small teams [1]", "Faster onboarding flow"],
          markets: ["United Kingdom", "United States"],
        }),
        citations: ["https://cite.example/pricing-review"],
      };
    }
    if (config.agentSlug === "competitor-features-agent") {
      return {
        ...base,
        text: JSON.stringify({
          features: [
            { name: "CSV export", description: "Exports project data to CSV.", documentationUrl: "https://acme.example/docs/csv", category: "Reporting" },
            { name: "Kanban boards", description: "Drag-and-drop boards.", documentationUrl: "https://acme.example/docs/kanban", category: "Planning" },
            ...(mockState.includeGanttFeature
              ? [{ name: "Gantt charts", description: "Timeline planning.", documentationUrl: "https://acme.example/docs/gantt", category: "Planning" }]
              : []),
          ],
          analysisNotes: "Found in the Acme help centre.",
        }),
      };
    }
    // competitor-updates-agent (both streams share the slug)
    return {
      ...base,
      text: JSON.stringify({
        updates: [
          {
            competitorName: "Acme",
            changeType: "feature",
            changeTitle: "v2.0 — AI summaries launched",
            changeDescription: "Acme shipped AI-generated project summaries.",
            sourceUrl: "https://acme.example/changelog/v2",
            publishedDate: "2026-07-15",
            stream: "product",
            severity: "major",
          },
          // Historic item inside the agent's 180-day lookback but BEFORE the
          // entity began being tracked — must be clamped, not backfilled.
          {
            competitorName: "Acme",
            changeType: "announcement",
            changeTitle: "Legacy 2020 announcement",
            changeDescription: "Ancient news the first scan must not backfill as fresh.",
            sourceUrl: "https://acme.example/blog/2020-announcement",
            publishedDate: "2020-01-10",
            stream: "market",
          },
        ],
        searchSummary: "Checked the confirmed changelog sources.",
      }),
    };
  }),
  // Non-callLLM exports pulled in via the app graph (settings + gatherer agents).
  clearLlmClientCaches: vi.fn(),
  collectAllowedSourceUrls: vi.fn(() => new Set<string>()),
  enforceSourceUrlAllowList: vi.fn((value: unknown) => ({ value, stripped: [] })),
}));

vi.mock("../../../lib/web/fetch.js", () => ({
  // Pretend every candidate URL exists — keeps the probe/validation paths
  // exercised without any network traffic.
  validateUrlWithSoft404Detection: vi.fn(async (url: string) => url),
  validateUrlsWithSoft404Detection: vi.fn(async (urls: string[]) => urls),
  fetchViaJina: vi.fn(async () => null),
}));

import { buildApp } from "../../../app.js";
import { closeDatabase, initDatabase } from "../../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../../db/seedLocal.js";
import { seedAgents } from "../../../lib/agents/seed.js";
import { createAiAgentExecution, updateAiAgentExecution } from "../../../lib/agents/executions.js";
import { getAiAgentBySlug } from "../../../lib/agents/registry.js";
import { listEntityAgentTargets, runFeaturesScanForEntity, settleBackgroundTasks } from "../service.js";
import * as storage from "../storage.js";

let app: Express;
let productId: string;
let productBId: string;
let competitorId: string; // Acme's facet on product A
let acmeEntityId: string;

const api = (pid: string) => `/api/products/${pid}`;

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  await seedAgents();
  app = buildApp();
});

afterAll(async () => {
  await settleBackgroundTasks();
  await closeDatabase();
});

describe("Products collection (ADR 003 §1.1 — the products[0] convention is deleted)", () => {
  it("GET /api/products before onboarding → empty collection", async () => {
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ products: [] });
  });

  it("competitor routes under an unknown product id → 404, never a fallback product", async () => {
    const res = await request(app)
      .get("/api/products/00000000-0000-4000-8000-000000000099/competitors");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/product not found/i);
  });

  it("POST /api/products creates a product; GET detail and PATCH work", async () => {
    const res = await request(app)
      .post("/api/products")
      .send({ name: "Our Product", url: "https://ourproduct.example", description: "A context layer." });
    expect(res.status).toBe(201);
    expect(res.body.product.name).toBe("Our Product");
    expect(res.body.product.slug).toBe("our-product");
    productId = res.body.product.id;

    const list = await request(app).get("/api/products");
    expect(list.body.products).toHaveLength(1);

    const detail = await request(app).get(`/api/products/${productId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.product.id).toBe(productId);

    const patched = await request(app)
      .patch(`/api/products/${productId}`)
      .send({ description: "A local, agent-maintained context layer." });
    expect(patched.status).toBe(200);
    expect(patched.body.product.description).toBe("A local, agent-maintained context layer.");
  });

  it("POST /api/products without a name → 400", async () => {
    const res = await request(app).post("/api/products").send({ url: "https://x.example" });
    expect(res.status).toBe(400);
  });
});

describe("Competitors API (facet-id surface under the product path, §2.5)", () => {
  it("GET .../competitors on a fresh product → empty list", async () => {
    const res = await request(app).get(`${api(productId)}/competitors`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ competitors: [] });
  });

  it("POST .../competitors with an invalid body → 400 with Zod issues", async () => {
    const res = await request(app).post(`${api(productId)}/competitors`).send({ name: "", classification: "WRONG" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it("POST .../competitors → 201 PROPOSED card carrying entityId + lineage; a new entity is a root node", async () => {
    const res = await request(app)
      .post(`${api(productId)}/competitors`)
      .send({ name: "Acme", url: "https://acme.example", classification: "DIRECT" });
    expect(res.status).toBe(201);
    expect(res.body.adopted).toBe(false);
    const card = res.body.competitor;
    expect(card.id).toMatch(/[0-9a-f-]{36}/);
    expect(card).toMatchObject({
      name: "Acme",
      status: "proposed", // spec 2.4: nothing is tracked until the human accepts
      classification: "DIRECT",
      domain: "acme.example",
      alsoTrackedBy: [],
    });
    expect(card.entityId).toMatch(/[0-9a-f-]{36}/);
    // Company-grain default (§2.9.4): every add creates a root node until the
    // resolution agent ships.
    expect(card.entity).toEqual({ id: card.entityId, name: "Acme", parent: null });
    expect(["pending", "enriching", "completed"]).toContain(card.enrichmentStatus);
    competitorId = card.id;
    acmeEntityId = card.entityId;
  });

  it("POST a duplicate name (case-insensitive, normalised) → 409", async () => {
    const res = await request(app)
      .post(`${api(productId)}/competitors`)
      .send({ name: "ACME", classification: "ADJACENT" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it("background enrichment completes: entity facts + facet differentiators stored with provenance", async () => {
    await settleBackgroundTasks();

    const res = await request(app).get(`${api(productId)}/competitors/${competitorId}`);
    expect(res.status).toBe(200);
    const { competitor, changes, openThread, filedThreads } = res.body;

    expect(competitor.enrichmentStatus).toBe("completed");
    expect(competitor.summary).toMatch(/project management tool/);
    expect(competitor.lastVerifiedAt).toBeTruthy();
    expect(competitor.summarySourceUrl).toBe("https://acme.example/about");

    // Provenance-carrying differentiators (risk 6 ruling): [1] marker resolves
    // to the citation; unmarked text falls back to the summary source URL.
    expect(competitor.keyDifferentiators).toEqual([
      { text: "Cheaper for small teams [1]", sourceUrl: "https://cite.example/pricing-review" },
      { text: "Faster onboarding flow", sourceUrl: "https://acme.example/about" },
    ]);

    expect(competitor.keyFeatures).toEqual([
      { feature: "CSV export", sourceUrl: "https://acme.example/docs/csv" },
      { feature: "Kanban boards", sourceUrl: "https://acme.example/docs/kanban" },
    ]);

    expect(competitor.markets).toEqual([
      { market: "United Kingdom", sourceUrl: "https://acme.example/about" },
      { market: "United States", sourceUrl: "https://acme.example/about" },
    ]);

    // The entity/facet split held: facts landed on the entity, the
    // differentiators on the facet.
    const entity = await storage.getCompetitorEntityById(acmeEntityId);
    expect(entity!.description).toMatch(/project management tool/);
    expect((entity!.keyFeatures as unknown[]).length).toBe(2);
    expect(entity!.enrichmentStatus).toBe("completed");
    const facet = await storage.getCompetitorProfileById(competitorId);
    expect((facet!.keyDifferentiators as string[]).length).toBe(2);

    // FIRST observation establishes the baseline SILENTLY (§10a: detect
    // change, don't re-derive; live-user ruling): the feature inventory lives
    // in the Key Features section — no change rows duplicate it.
    expect(changes).toEqual([]);

    // Thread shape reserved for the strategy sprint
    expect(openThread).toBeNull();
    expect(filedThreads).toEqual([]);
  });

  it("proposed rows are hidden from the default list but returned by ?include=proposed (with status)", async () => {
    const defaultList = await request(app).get(`${api(productId)}/competitors`);
    expect(defaultList.status).toBe(200);
    expect(defaultList.body.competitors).toEqual([]);

    const withProposed = await request(app).get(`${api(productId)}/competitors?include=proposed`);
    expect(withProposed.status).toBe(200);
    expect(withProposed.body.competitors).toHaveLength(1);
    expect(withProposed.body.competitors[0]).toMatchObject({
      id: competitorId,
      name: "Acme",
      status: "proposed",
    });
  });

  it("POST /:id/accept flips proposed → tracked and is idempotent", async () => {
    const res = await request(app).post(`${api(productId)}/competitors/${competitorId}/accept`);
    expect(res.status).toBe(200);
    expect(res.body.competitor).toMatchObject({ id: competitorId, status: "tracked" });

    const again = await request(app).post(`${api(productId)}/competitors/${competitorId}/accept`);
    expect(again.status).toBe(200);
    expect(again.body.competitor).toMatchObject({ id: competitorId, status: "tracked" });
  });

  it("GET .../competitors lists the enriched card", async () => {
    const res = await request(app).get(`${api(productId)}/competitors`);
    expect(res.status).toBe(200);
    expect(res.body.competitors).toHaveLength(1);
    expect(res.body.competitors[0]).toMatchObject({
      id: competitorId,
      entityId: acmeEntityId,
      name: "Acme",
      status: "tracked",
      enrichmentStatus: "completed",
      sentiment: null, // reviews sprint — block stays unrendered
    });
  });

  it("PATCH threat level → history row written; PATCH classification → ADJACENT", async () => {
    const res = await request(app)
      .patch(`${api(productId)}/competitors/${competitorId}`)
      .send({ threatLevel: "big_threat" });
    expect(res.status).toBe(200);
    expect(res.body.competitor.threatLevel).toBe("big_threat");

    const history = await storage.getCompetitorThreatLevelHistory(competitorId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ previousLevel: "none", newLevel: "big_threat" });

    // Same level again → no extra history row
    await request(app).patch(`${api(productId)}/competitors/${competitorId}`).send({ threatLevel: "big_threat" });
    expect(await storage.getCompetitorThreatLevelHistory(competitorId)).toHaveLength(1);

    const reclass = await request(app)
      .patch(`${api(productId)}/competitors/${competitorId}`)
      .send({ classification: "ADJACENT" });
    expect(reclass.status).toBe(200);
    expect(reclass.body.competitor.classification).toBe("ADJACENT");

    // Restore for later assertions
    await request(app).patch(`${api(productId)}/competitors/${competitorId}`).send({ classification: "DIRECT" });
  });

  it("PATCH with an empty body → 400", async () => {
    const res = await request(app).patch(`${api(productId)}/competitors/${competitorId}`).send({});
    expect(res.status).toBe(400);
  });

  it("GET .../competitors/runs/active → false when idle, details when a run is live", async () => {
    const idle = await request(app).get(`${api(productId)}/competitors/runs/active`);
    expect(idle.status).toBe(200);
    expect(idle.body).toEqual({ active: false });

    // Simulate a live summary run (execution row with competitorName)
    const agent = await getAiAgentBySlug("competitor-summary-agent");
    const execution = await createAiAgentExecution({
      agentId: agent!.id,
      organizationId: LOCAL_ORGANIZATION_ID,
      productId,
      status: "running",
      inputParameters: { competitorName: "Acme" },
    });

    const active = await request(app).get(`${api(productId)}/competitors/runs/active`);
    expect(active.status).toBe(200);
    expect(active.body).toMatchObject({
      active: true,
      competitorId,
      competitorName: "Acme",
      agentLabel: "Competitor Profile",
    });
    expect(active.body.startedAt).toBeTruthy();

    // Refresh must refuse while the run is live — 409 with the active run attached
    const blocked = await request(app).post(`${api(productId)}/competitors/${competitorId}/refresh`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.activeRun).toMatchObject({ competitorName: "Acme" });

    await updateAiAgentExecution(execution.id, { status: "completed", completedAt: new Date() });
  });

  it("POST refresh → 202 { runId }; the entity-scoped updates scan records the detected change and clamps pre-tracking items", async () => {
    // The mocked scan returns an item dated 2026-07-15 — backdate the entity's
    // tracking start so it counts as observed-while-watching.
    await storage.updateCompetitorEntity(acmeEntityId, { createdAt: new Date("2026-01-01T00:00:00Z") });

    const res = await request(app).post(`${api(productId)}/competitors/${competitorId}/refresh`);
    expect(res.status).toBe(202);
    expect(res.body.runId).toMatch(/[0-9a-f-]{36}/);

    await settleBackgroundTasks();

    const detail = await request(app).get(`${api(productId)}/competitors/${competitorId}`);
    const titles = detail.body.changes.map((c: { title: string }) => c.title);
    expect(titles).toContain("v2.0 — AI summaries launched");
    // Post-tracking clamp (§10a ruling): the 2020 item sits inside the
    // agent's 180-day lookback framing but predates tracking — never
    // backfilled as a fresh change.
    expect(titles).not.toContain("Legacy 2020 announcement");
    // The refresh re-ran the features agent against an existing baseline with
    // an unchanged feature set — no feature change rows either.
    expect(titles.some((t: string) => t.includes("feature"))).toBe(false);

    // Release sources were probed and cached on the ENTITY
    const entity = await storage.getCompetitorEntityById(acmeEntityId);
    expect(entity!.validReleaseSources).toBeTruthy();

    // Running refresh again does NOT duplicate the change (dedupe by title+URL)
    const second = await request(app).post(`${api(productId)}/competitors/${competitorId}/refresh`);
    expect(second.status).toBe(202);
    await settleBackgroundTasks();
    const after = await request(app).get(`${api(productId)}/competitors/${competitorId}`);
    const matching = after.body.changes.filter((c: { title: string }) => c.title === "v2.0 — AI summaries launched");
    expect(matching).toHaveLength(1);
  });

  it("GET .../changes → paginated product-relevant feed with entity attribution", async () => {
    const res = await request(app).get(`${api(productId)}/changes?limit=1&offset=0`);
    expect(res.status).toBe(200);
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0].competitorName).toBe("Acme");
    expect(res.body.changes[0].entityId).toBe(acmeEntityId);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it("unknown /api route → JSON 404, never HTML", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});

describe("Feature baseline vs diff (§10a.2 — first observation is silent)", () => {
  it("a second features scan records ONLY the additions as one change row, then goes quiet", async () => {
    const before = await storage.getCompetitorChangesByEntity(acmeEntityId, 200);
    const baselineEntity = await storage.getCompetitorEntityById(acmeEntityId);
    expect((baselineEntity!.keyFeatures as unknown[]).length).toBe(2); // CSV export + Kanban

    // The competitor "ships" a new feature between scans.
    mockState.includeGanttFeature = true;
    try {
      await runFeaturesScanForEntity(LOCAL_ORGANIZATION_ID, acmeEntityId);

      const after = await storage.getCompetitorChangesByEntity(acmeEntityId, 200);
      expect(after.length).toBe(before.length + 1);
      const diffRow = after.find(c => c.changeTitle.includes("new feature"));
      expect(diffRow).toBeTruthy();
      expect(diffRow!.changeTitle).toBe("Acme: 1 new feature observed");
      expect(diffRow!.changeDescription).toBe("Gantt charts");
      expect(diffRow!.sourceUrl).toBe("https://acme.example/docs/gantt"); // evidence-cited
      expect(diffRow!.changeType).toBe("feature");

      // The inventory merged the addition into the entity baseline.
      const entity = await storage.getCompetitorEntityById(acmeEntityId);
      expect((entity!.keyFeatures as Array<{ feature: string }>).map(f => f.feature).sort()).toEqual(
        ["CSV export", "Gantt charts", "Kanban boards"],
      );

      // Re-scanning the SAME set is quiet — the diff, not the world, is recorded.
      await runFeaturesScanForEntity(LOCAL_ORGANIZATION_ID, acmeEntityId);
      expect((await storage.getCompetitorChangesByEntity(acmeEntityId, 200)).length).toBe(before.length + 1);
    } finally {
      mockState.includeGanttFeature = false;
    }
  });
});

describe("Review-before-save gate (spec 2.4, per-facet per ADR 003 §2.3)", () => {
  let zephyrId: string;
  let zephyrEntityId: string;
  let nimbusId: string;

  it("draft changes of a proposed competitor show on its detail view but never in the feed", async () => {
    const res = await request(app)
      .post(`${api(productId)}/competitors`)
      .send({ name: "Zephyr", url: "https://zephyr.example", classification: "DIRECT" });
    expect(res.status).toBe(201);
    zephyrId = res.body.competitor.id;
    zephyrEntityId = res.body.competitor.entityId;
    await settleBackgroundTasks();

    // First-run enrichment is baseline-silent (§10a ruling), so simulate a
    // scan-observed draft change against the proposed entity directly.
    await storage.createCompetitorChange({
      entityId: zephyrEntityId,
      sourceCategory: "competitor",
      changeType: "update",
      changeTitle: "Zephyr beta announced",
      changeDescription: "Draft change observed while the competitor is still proposed.",
      sourceUrl: "https://zephyr.example/blog/beta",
      sourceType: "agent",
    });

    // The draft change shows on the proposal's detail view…
    const detail = await request(app).get(`${api(productId)}/competitors/${zephyrId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.competitor.status).toBe("proposed");
    const draftTitles = detail.body.changes.map((c: { title: string }) => c.title);
    expect(draftTitles.some((t: string) => t.includes("Zephyr"))).toBe(true);

    // …but the product feed must never surface a proposed competitor — the
    // exclusion is the tracked-facet join predicate now.
    const feed = await request(app).get(`${api(productId)}/changes?limit=100`);
    expect(feed.status).toBe(200);
    const feedTitles = feed.body.changes.map((c: { title: string }) => c.title);
    expect(feedTitles.some((t: string) => t.includes("Zephyr"))).toBe(false);
    // Acme's tracked changes still flow
    expect(feed.body.changes.length).toBeGreaterThanOrEqual(1);
  });

  it("DELETE a proposed competitor discards facet + entity + changes — no rows left behind", async () => {
    // Give the proposal threat-level history to prove the purge covers it
    await request(app).patch(`${api(productId)}/competitors/${zephyrId}`).send({ threatLevel: "watch" });
    expect(await storage.getCompetitorThreatLevelHistory(zephyrId)).toHaveLength(1);
    expect((await storage.getCompetitorChangesByEntity(zephyrEntityId)).length).toBeGreaterThanOrEqual(1);

    const res = await request(app).delete(`${api(productId)}/competitors/${zephyrId}`);
    expect(res.status).toBe(204);

    // A proposal that was never accepted leaves no history — the entity GC
    // (§2.3 step 4) collected the node and its change rows too.
    expect(await storage.getCompetitorProfileById(zephyrId)).toBeUndefined();
    expect(await storage.getCompetitorEntityById(zephyrEntityId)).toBeUndefined();
    expect(await storage.getCompetitorChangesByEntity(zephyrEntityId)).toEqual([]);
    expect(await storage.getCompetitorThreatLevelHistory(zephyrId)).toEqual([]);
  });

  it("accept succeeds when enrichment failed (the save-unverified path)", async () => {
    const res = await request(app)
      .post(`${api(productId)}/competitors`)
      .send({ name: "Nimbus", classification: "ADJACENT" });
    expect(res.status).toBe(201);
    nimbusId = res.body.competitor.id;
    await settleBackgroundTasks();
    await storage.updateCompetitorProfile(nimbusId, { enrichmentStatus: "failed" });

    const accepted = await request(app).post(`${api(productId)}/competitors/${nimbusId}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.competitor).toMatchObject({
      id: nimbusId,
      status: "tracked",
      enrichmentStatus: "failed",
    });

    // Clean up so later entity-target assertions stay focused on Acme
    await request(app).delete(`${api(productId)}/competitors/${nimbusId}`);
  });
});

describe("Adoption flow across products (ADR 003 §2.3 step 2)", () => {
  let acmeOnBId: string;

  it("POST /api/products creates the second product", async () => {
    const res = await request(app)
      .post("/api/products")
      .send({ name: "Second Product", url: "https://second.example" });
    expect(res.status).toBe(201);
    productBId = res.body.product.id;
  });

  it("adding a competitor whose entity exists in the org → instant profile from the entity, facet-only enrichment", async () => {
    const entityBefore = await storage.getCompetitorEntityById(acmeEntityId);
    const changeCountBefore = (await storage.getCompetitorChangesByEntity(acmeEntityId, 200)).length;

    const res = await request(app)
      .post(`${api(productBId)}/competitors`)
      .send({ name: "acme", classification: "DIRECT" }); // case-insensitive dedup by normalised name
    expect(res.status).toBe(201);
    expect(res.body.adopted).toBe(true);
    const card = res.body.competitor;
    acmeOnBId = card.id;
    expect(card.entityId).toBe(acmeEntityId); // the SAME entity node — no duplicate research
    expect(card.status).toBe("proposed"); // the gate still applies at the facet
    // The proposal card renders the entity's existing profile instantly
    expect(card.summary).toMatch(/project management tool/);
    // The adoption signal (client contract): who already tracks this entity
    expect(card.alsoTrackedBy).toEqual([{ productId, productName: "Our Product" }]);

    await settleBackgroundTasks();

    // Facet-only enrichment: differentiators landed on B's facet…
    const facetB = await storage.getCompetitorProfileById(acmeOnBId);
    expect((facetB!.keyDifferentiators as string[]).length).toBeGreaterThanOrEqual(1);
    expect(facetB!.enrichmentStatus).toBe("completed");
    // …but NO entity re-research: entity untouched, no new feature-change rows
    const entityAfter = await storage.getCompetitorEntityById(acmeEntityId);
    expect(entityAfter!.updatedAt!.getTime()).toBe(entityBefore!.updatedAt!.getTime());
    expect((await storage.getCompetitorChangesByEntity(acmeEntityId, 200)).length).toBe(changeCountBefore);
  });

  it("the facet-grain 409 fires per (productId, entityId)", async () => {
    const res = await request(app)
      .post(`${api(productBId)}/competitors`)
      .send({ name: "Acme", classification: "ADJACENT" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it("entity-scoped agent targets: one target per entity, only while tracked facets exist", async () => {
    // Product B's facet is still proposed — only A's tracked facet counts,
    // and the entity appears exactly ONCE.
    let targets = await listEntityAgentTargets("competitorUpdates");
    expect(targets.filter(t => t.entityId === acmeEntityId)).toHaveLength(1);

    // Accept on B: still one target (monitoring runs once per entity, §2.7)
    await request(app).post(`${api(productBId)}/competitors/${acmeOnBId}/accept`);
    targets = await listEntityAgentTargets("competitorUpdates");
    expect(targets.filter(t => t.entityId === acmeEntityId)).toHaveLength(1);
    expect(targets.find(t => t.entityId === acmeEntityId)).toMatchObject({
      entityName: "Acme",
      organizationId: LOCAL_ORGANIZATION_ID,
    });
  });

  it("product B's feed serves the shared entity's changes through the join", async () => {
    const feed = await request(app).get(`${api(productBId)}/changes?limit=100`);
    expect(feed.status).toBe(200);
    const titles = feed.body.changes.map((c: { title: string }) => c.title);
    expect(titles).toContain("v2.0 — AI summaries launched");
  });

  it("org-level entity view lists the node with both product facets", async () => {
    const res = await request(app).get("/api/entities/competitors");
    expect(res.status).toBe(200);
    const acme = res.body.entities.find((e: { name: string }) => e.name === "Acme");
    expect(acme).toBeTruthy();
    expect(acme.facets).toHaveLength(2);
    const productNames = acme.facets.map((f: { productName: string }) => f.productName).sort();
    expect(productNames).toEqual(["Our Product", "Second Product"]);

    const detail = await request(app).get(`/api/entities/competitors/${acmeEntityId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.entity.name).toBe("Acme");
    // CSV export + Kanban boards from the baseline, + Gantt charts merged in
    // by the diff-scan test above.
    expect(detail.body.entity.keyFeatures).toHaveLength(3);
    expect(detail.body.children).toEqual([]);
  });

  it("deleting one product's tracked facet never collaterally damages the other's context", async () => {
    const res = await request(app).delete(`${api(productBId)}/competitors/${acmeOnBId}`);
    expect(res.status).toBe(204);

    // Entity + changes survive: product A still tracks the node
    expect(await storage.getCompetitorEntityById(acmeEntityId)).toBeDefined();
    expect((await storage.getCompetitorChangesByEntity(acmeEntityId, 200)).length).toBeGreaterThanOrEqual(1);
    const listA = await request(app).get(`${api(productId)}/competitors`);
    expect(listA.body.competitors.map((c: { name: string }) => c.name)).toContain("Acme");
  });

  it("deleting the LAST facet on the tree deletes the entity and its changes (§2.3 step 5)", async () => {
    const res = await request(app).delete(`${api(productId)}/competitors/${competitorId}`);
    expect(res.status).toBe(204);

    expect(await storage.getCompetitorProfileById(competitorId)).toBeUndefined();
    expect(await storage.getCompetitorEntityById(acmeEntityId)).toBeUndefined();
    expect(await storage.getCompetitorChangesByEntity(acmeEntityId)).toEqual([]);

    const gone = await request(app).get(`${api(productId)}/competitors/${competitorId}`);
    expect(gone.status).toBe(404);
    const patchGone = await request(app).patch(`${api(productId)}/competitors/${competitorId}`).send({ threatLevel: "none" });
    expect(patchGone.status).toBe(404);
  });
});

describe("Rename (ADR 003 §2.4: an entity-row update; tracked restriction lifted)", () => {
  let vellumId: string;
  let vellumEntityId: string;

  it("rename-proposed persists; entity-keyed change rows need no walking", async () => {
    const created = await request(app)
      .post(`${api(productId)}/competitors`)
      .send({ name: "Vellum", url: "https://vellum.example", classification: "DIRECT" });
    expect(created.status).toBe(201);
    vellumId = created.body.competitor.id;
    vellumEntityId = created.body.competitor.entityId;
    await settleBackgroundTasks();
    // First-run enrichment is baseline-silent — attach an observed change
    // directly to prove renames never orphan entity-keyed history.
    await storage.createCompetitorChange({
      entityId: vellumEntityId,
      sourceCategory: "competitor",
      changeType: "update",
      changeTitle: "Vellum pricing page updated",
      changeDescription: "Observed change used to verify rename-by-identity.",
      sourceUrl: "https://vellum.example/pricing",
      sourceType: "agent",
    });
    expect((await storage.getCompetitorChangesByEntity(vellumEntityId)).length).toBeGreaterThanOrEqual(1);

    const renamed = await request(app)
      .patch(`${api(productId)}/competitors/${vellumId}`)
      .send({ name: "Vellum Labs" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.competitor).toMatchObject({ id: vellumId, name: "Vellum Labs", status: "proposed" });

    // Change rows are FK'd to the entity — they follow the rename by identity,
    // not by a transactional name walk.
    expect((await storage.getCompetitorChangesByEntity(vellumEntityId)).length).toBeGreaterThanOrEqual(1);
    const detail = await request(app).get(`${api(productId)}/competitors/${vellumId}`);
    expect(detail.body.competitor.name).toBe("Vellum Labs");
    expect(detail.body.changes.length).toBeGreaterThanOrEqual(1);

    // The rename survives accept
    const accepted = await request(app).post(`${api(productId)}/competitors/${vellumId}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.competitor).toMatchObject({ name: "Vellum Labs", status: "tracked" });
  });

  it("renaming a TRACKED competitor now succeeds (the sprint-2 400 is lifted)", async () => {
    const res = await request(app)
      .patch(`${api(productId)}/competitors/${vellumId}`)
      .send({ name: "Vellum HQ" });
    expect(res.status).toBe(200);
    expect(res.body.competitor.name).toBe("Vellum HQ");
    // History stayed attached through the entity FK
    expect((await storage.getCompetitorChangesByEntity(vellumEntityId)).length).toBeGreaterThanOrEqual(1);
  });

  it("renaming onto an existing name → 409 (org-wide, case-insensitive)", async () => {
    const other = await request(app)
      .post(`${api(productId)}/competitors`)
      .send({ name: "Beacon", classification: "DIRECT" });
    expect(other.status).toBe(201);
    await settleBackgroundTasks();

    const res = await request(app)
      .patch(`${api(productId)}/competitors/${other.body.competitor.id}`)
      .send({ name: "vellum hq" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });
});

describe("Tree-aware GC on hierarchies (ADR 003 §2.3 step 4, ruling 4 Aug 2026)", () => {
  // No API creates children yet (resolution agent is post-3a), so the tree is
  // built through storage — the DELETE endpoint then exercises the real path.
  let rootId: string;
  let childXId: string;
  let childYId: string;
  let rootFacetId: string; // product B, tracked (company grain)
  let childXFacetId: string; // product A, proposed (child grain)

  it("set up: a company root with an enriched faceted child and an identity-only sibling", async () => {
    const root = await storage.createCompetitorEntity({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "Hierarchy Co",
      normalizedName: "hierarchy co",
      url: "https://hierarchy.example",
      domain: "hierarchy.example",
    });
    rootId = root.id;
    const childX = await storage.createCompetitorEntity({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "Hierarchy Co Payroll",
      normalizedName: "hierarchy co payroll",
      parentEntityId: rootId,
      url: "https://hierarchy.example/payroll",
      domain: "hierarchy.example",
    });
    childXId = childX.id;
    const childY = await storage.createCompetitorEntity({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "Hierarchy Co Tax",
      normalizedName: "hierarchy co tax",
      parentEntityId: rootId,
    });
    childYId = childY.id;

    // Child X carries enrichment; identity-only sibling Y carries none.
    await storage.updateCompetitorEntity(childXId, {
      description: "Payroll product of Hierarchy Co.",
      keyFeatures: [{ feature: "Payslips" }],
      enrichmentStatus: "completed",
      lastEnrichedAt: new Date(),
    });

    const rootFacet = await storage.createCompetitorFacet({
      productId: productBId,
      entityId: rootId,
      sourceCategory: "competitor",
      status: "tracked",
    });
    rootFacetId = rootFacet.id;
    const childFacet = await storage.createCompetitorFacet({
      productId,
      entityId: childXId,
      sourceCategory: "competitor",
      status: "proposed",
    });
    childXFacetId = childFacet.id;

    await storage.createCompetitorChange({
      entityId: childXId,
      changeType: "feature",
      changeTitle: "Payroll draft change",
      changeDescription: "Draft observed on the child node",
      sourceUrl: "https://hierarchy.example/payroll/changelog",
    });
    await storage.createCompetitorChange({
      entityId: rootId,
      changeType: "announcement",
      changeTitle: "Company-level announcement",
      changeDescription: "Observed on the root node",
      sourceUrl: "https://hierarchy.example/news",
    });
  });

  it("discarding a child's last facet while the tree survives DEMOTES the node to identity-only (not delete)", async () => {
    const res = await request(app).delete(`${api(productId)}/competitors/${childXFacetId}`);
    expect(res.status).toBe(204);

    // The node survives with its identity/matching set intact…
    const demoted = await storage.getCompetitorEntityById(childXId);
    expect(demoted).toBeDefined();
    expect(demoted!.name).toBe("Hierarchy Co Payroll");
    expect(demoted!.normalizedName).toBe("hierarchy co payroll");
    expect(demoted!.parentEntityId).toBe(rootId);
    expect(demoted!.url).toBe("https://hierarchy.example/payroll");
    expect(demoted!.domain).toBe("hierarchy.example");

    // …but every enriched column is cleared — it joins the identity-only siblings.
    expect(demoted!.description).toBeNull();
    expect(demoted!.keyFeatures).toBeNull();
    expect(demoted!.enrichmentStatus).toBe("pending");
    expect(demoted!.lastEnrichedAt).toBeNull();

    // Its draft change rows are purged; the root's changes are untouched.
    expect(await storage.getCompetitorChangesByEntity(childXId)).toEqual([]);
    expect((await storage.getCompetitorChangesByEntity(rootId)).length).toBe(1);

    // No collateral damage: root, its facet, and the identity-only sibling survive.
    expect(await storage.getCompetitorEntityById(rootId)).toBeDefined();
    expect(await storage.getCompetitorProfileById(rootFacetId)).toBeDefined();
    expect(await storage.getCompetitorEntityById(childYId)).toBeDefined();

    // A later add from any product matches the demoted node instantly (adoption).
    const readd = await request(app)
      .post(`${api(productId)}/competitors`)
      .send({ name: "Hierarchy Co Payroll", classification: "DIRECT" });
    expect(readd.status).toBe(201);
    expect(readd.body.adopted).toBe(true);
    expect(readd.body.competitor.entityId).toBe(childXId);
    expect(readd.body.competitor.entity.parent).toEqual({ id: rootId, name: "Hierarchy Co" });
    await settleBackgroundTasks();
    await request(app).delete(`${api(productId)}/competitors/${readd.body.competitor.id}`);
  });

  it("deleting the last facet on the tree deletes the WHOLE tree, identity-only children included", async () => {
    const res = await request(app).delete(`${api(productBId)}/competitors/${rootFacetId}`);
    expect(res.status).toBe(204);

    expect(await storage.getCompetitorEntityById(rootId)).toBeUndefined();
    expect(await storage.getCompetitorEntityById(childXId)).toBeUndefined();
    expect(await storage.getCompetitorEntityById(childYId)).toBeUndefined();
    expect(await storage.getCompetitorChangesByEntity(rootId)).toEqual([]);
    expect(await storage.getCompetitorChangesByEntity(childXId)).toEqual([]);
  });
});
