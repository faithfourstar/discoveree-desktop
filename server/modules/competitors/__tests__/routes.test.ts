/**
 * Competitors API against in-memory PGlite with the seeded local org.
 * The LLM router and web-fetch modules are mocked (no live API calls) so the
 * FULL slice runs: add → background enrichment (summary → features, Zod →
 * merge-don't-replace) → provenance-stored profile → serve → refresh detects
 * change (updates scan → competitor_changes).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

// ── Mocks (must be declared before importing the app graph) ────────────────

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
        ],
        searchSummary: "Checked the confirmed changelog sources.",
      }),
    };
  }),
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
import type { Product } from "@shared/schema";
import { runFeaturesScanForProduct, runUpdatesScan, settleBackgroundTasks } from "../service.js";
import * as storage from "../storage.js";

let app: Express;
let competitorId: string;

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  await seedAgents();
  app = buildApp();
});

afterAll(async () => {
  await settleBackgroundTasks();
  await closeDatabase();
});

describe("Competitors API (stable-ID surface, §6)", () => {
  it("GET /api/competitors before any product exists → empty list", async () => {
    const res = await request(app).get("/api/competitors");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ competitors: [] });
  });

  it("POST /api/competitors before a product exists → 409 with a clear message", async () => {
    const res = await request(app)
      .post("/api/competitors")
      .send({ name: "Acme", classification: "DIRECT" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/product profile/i);
  });

  it("PATCH /api/product creates the product row", async () => {
    const res = await request(app)
      .patch("/api/product")
      .send({ name: "Our Product", url: "https://ourproduct.example", description: "A context layer." });
    expect(res.status).toBe(201);
    expect(res.body.product.name).toBe("Our Product");

    const get = await request(app).get("/api/product");
    expect(get.status).toBe(200);
    expect(get.body.product.id).toBe(res.body.product.id);
  });

  it("POST /api/competitors with an invalid body → 400 with Zod issues", async () => {
    const res = await request(app).post("/api/competitors").send({ name: "", classification: "WRONG" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it("POST /api/competitors → 201 PROPOSED card; profile row is canonical", async () => {
    const res = await request(app)
      .post("/api/competitors")
      .send({ name: "Acme", url: "https://acme.example", classification: "DIRECT" });
    expect(res.status).toBe(201);
    const card = res.body.competitor;
    expect(card.id).toMatch(/[0-9a-f-]{36}/);
    expect(card).toMatchObject({
      name: "Acme",
      status: "proposed", // spec 2.4: nothing is tracked until the human accepts
      classification: "DIRECT",
      domain: "acme.example",
    });
    // Created pending; enrichment runs in the background
    expect(["pending", "enriching", "completed"]).toContain(card.enrichmentStatus);
    competitorId = card.id;
  });

  it("POST a duplicate name (case-insensitive) → 409", async () => {
    const res = await request(app)
      .post("/api/competitors")
      .send({ name: "ACME", classification: "ADJACENT" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it("background enrichment completes: summary + features stored with provenance, merge-don't-replace", async () => {
    await settleBackgroundTasks();

    const res = await request(app).get(`/api/competitors/${competitorId}`);
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

    // Feature discovery is evidence-cited in the change feed
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[0]).toHaveProperty("sourceUrl");
    expect(changes[0]).toHaveProperty("detectedAt");

    // Thread shape reserved for the strategy sprint
    expect(openThread).toBeNull();
    expect(filedThreads).toEqual([]);
  });

  it("proposed rows are hidden from the default list but returned by ?include=proposed (with status)", async () => {
    // Still proposed at this point — the default list must not show it
    const defaultList = await request(app).get("/api/competitors");
    expect(defaultList.status).toBe(200);
    expect(defaultList.body.competitors).toEqual([]);

    const withProposed = await request(app).get("/api/competitors?include=proposed");
    expect(withProposed.status).toBe(200);
    expect(withProposed.body.competitors).toHaveLength(1);
    expect(withProposed.body.competitors[0]).toMatchObject({
      id: competitorId,
      name: "Acme",
      status: "proposed",
    });
  });

  it("POST /:id/accept flips proposed → tracked and is idempotent", async () => {
    const res = await request(app).post(`/api/competitors/${competitorId}/accept`);
    expect(res.status).toBe(200);
    expect(res.body.competitor).toMatchObject({ id: competitorId, status: "tracked" });

    // Accepting an already-tracked competitor is a no-op 200
    const again = await request(app).post(`/api/competitors/${competitorId}/accept`);
    expect(again.status).toBe(200);
    expect(again.body.competitor).toMatchObject({ id: competitorId, status: "tracked" });
  });

  it("GET /api/competitors lists the enriched card", async () => {
    const res = await request(app).get("/api/competitors");
    expect(res.status).toBe(200);
    expect(res.body.competitors).toHaveLength(1);
    expect(res.body.competitors[0]).toMatchObject({
      id: competitorId,
      name: "Acme",
      status: "tracked",
      enrichmentStatus: "completed",
      sentiment: null, // reviews sprint — block stays unrendered
    });
  });

  it("PATCH threat level → history row written; PATCH classification → ADJACENT", async () => {
    const res = await request(app)
      .patch(`/api/competitors/${competitorId}`)
      .send({ threatLevel: "big_threat" });
    expect(res.status).toBe(200);
    expect(res.body.competitor.threatLevel).toBe("big_threat");

    const history = await storage.getCompetitorThreatLevelHistory(competitorId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ previousLevel: "none", newLevel: "big_threat" });

    // Same level again → no extra history row
    await request(app).patch(`/api/competitors/${competitorId}`).send({ threatLevel: "big_threat" });
    expect(await storage.getCompetitorThreatLevelHistory(competitorId)).toHaveLength(1);

    const reclass = await request(app)
      .patch(`/api/competitors/${competitorId}`)
      .send({ classification: "ADJACENT" });
    expect(reclass.status).toBe(200);
    expect(reclass.body.competitor.classification).toBe("ADJACENT");
  });

  it("PATCH with an empty body → 400", async () => {
    const res = await request(app).patch(`/api/competitors/${competitorId}`).send({});
    expect(res.status).toBe(400);
  });

  it("GET /api/competitors/runs/active → false when idle, details when a run is live", async () => {
    const idle = await request(app).get("/api/competitors/runs/active");
    expect(idle.status).toBe(200);
    expect(idle.body).toEqual({ active: false });

    // Simulate a live summary run (execution row with competitorName)
    const agent = await getAiAgentBySlug("competitor-summary-agent");
    const product = (await request(app).get("/api/product")).body.product;
    const execution = await createAiAgentExecution({
      agentId: agent!.id,
      organizationId: LOCAL_ORGANIZATION_ID,
      productId: product.id,
      status: "running",
      inputParameters: { competitorName: "Acme" },
    });

    const active = await request(app).get("/api/competitors/runs/active");
    expect(active.status).toBe(200);
    expect(active.body).toMatchObject({
      active: true,
      competitorId,
      competitorName: "Acme",
      agentLabel: "Competitor Profile",
    });
    expect(active.body.startedAt).toBeTruthy();

    // Refresh must refuse while the run is live — 409 with the active run attached
    const blocked = await request(app).post(`/api/competitors/${competitorId}/refresh`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.activeRun).toMatchObject({ competitorName: "Acme" });

    await updateAiAgentExecution(execution.id, { status: "completed", completedAt: new Date() });
  });

  it("POST refresh → 202 { runId }; the updates scan records the detected change", async () => {
    const res = await request(app).post(`/api/competitors/${competitorId}/refresh`);
    expect(res.status).toBe(202);
    expect(res.body.runId).toMatch(/[0-9a-f-]{36}/);

    await settleBackgroundTasks();

    const detail = await request(app).get(`/api/competitors/${competitorId}`);
    const titles = detail.body.changes.map((c: { title: string }) => c.title);
    expect(titles).toContain("v2.0 — AI summaries launched");

    // Running refresh again does NOT duplicate the change (dedupe by title+URL)
    const second = await request(app).post(`/api/competitors/${competitorId}/refresh`);
    expect(second.status).toBe(202);
    await settleBackgroundTasks();
    const after = await request(app).get(`/api/competitors/${competitorId}`);
    const matching = after.body.changes.filter((c: { title: string }) => c.title === "v2.0 — AI summaries launched");
    expect(matching).toHaveLength(1);
  });

  it("GET /api/changes → paginated product-wide feed", async () => {
    const res = await request(app).get("/api/changes?limit=1&offset=0");
    expect(res.status).toBe(200);
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it("DELETE /api/competitors/:id → 204, then 404 on subsequent reads", async () => {
    const res = await request(app).delete(`/api/competitors/${competitorId}`);
    expect(res.status).toBe(204);

    const gone = await request(app).get(`/api/competitors/${competitorId}`);
    expect(gone.status).toBe(404);

    const patchGone = await request(app).patch(`/api/competitors/${competitorId}`).send({ threatLevel: "none" });
    expect(patchGone.status).toBe(404);
  });

  it("unknown /api route → JSON 404, never HTML", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});

describe("Review-before-save gate (spec 2.4 server implementation)", () => {
  let productRow: Product;
  let zephyrId: string;
  let nimbusId: string;

  it("draft changes of a proposed competitor show on its detail view but never in the feed", async () => {
    productRow = (await request(app).get("/api/product")).body.product as Product;

    const res = await request(app)
      .post("/api/competitors")
      .send({ name: "Zephyr", url: "https://zephyr.example", classification: "DIRECT" });
    expect(res.status).toBe(201);
    zephyrId = res.body.competitor.id;
    await settleBackgroundTasks();

    // Enrichment recorded a feature-discovery change against the draft…
    const detail = await request(app).get(`/api/competitors/${zephyrId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.competitor.status).toBe("proposed");
    const draftTitles = detail.body.changes.map((c: { title: string }) => c.title);
    expect(draftTitles.some((t: string) => t.includes("Zephyr"))).toBe(true);

    // …but the product-wide feed must never surface a proposed competitor
    const feed = await request(app).get("/api/changes?limit=100");
    expect(feed.status).toBe(200);
    const feedTitles = feed.body.changes.map((c: { title: string }) => c.title);
    expect(feedTitles.some((t: string) => t.includes("Zephyr"))).toBe(false);
    // Retained changes from the earlier (tracked) Acme delete still flow
    expect(feed.body.changes.length).toBeGreaterThanOrEqual(1);
  });

  it("DELETE a proposed competitor discards it completely — no rows left behind", async () => {
    // Give the proposal threat-level history to prove the purge covers it
    await request(app).patch(`/api/competitors/${zephyrId}`).send({ threatLevel: "watch" });
    expect(await storage.getCompetitorThreatLevelHistory(zephyrId)).toHaveLength(1);
    expect((await storage.getCompetitorChangesByProductAndName(productRow.id, "Zephyr")).length).toBeGreaterThanOrEqual(1);

    const res = await request(app).delete(`/api/competitors/${zephyrId}`);
    expect(res.status).toBe(204);

    // A proposal that was never accepted leaves no history
    expect(await storage.getCompetitorProfileById(zephyrId)).toBeUndefined();
    expect(await storage.getCompetitorChangesByProductAndName(productRow.id, "Zephyr")).toEqual([]);
    expect(await storage.getCompetitorThreatLevelHistory(zephyrId)).toEqual([]);
  });

  it("accept succeeds when enrichment failed (the save-unverified path)", async () => {
    const res = await request(app)
      .post("/api/competitors")
      .send({ name: "Nimbus", classification: "ADJACENT" });
    expect(res.status).toBe(201);
    nimbusId = res.body.competitor.id;
    await settleBackgroundTasks();
    await storage.updateCompetitorProfile(nimbusId, { enrichmentStatus: "failed" });

    const accepted = await request(app).post(`/api/competitors/${nimbusId}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.competitor).toMatchObject({
      id: nimbusId,
      status: "tracked",
      enrichmentStatus: "failed",
    });
  });

  it("scheduled runs skip proposed competitors", async () => {
    // Tracked: Nimbus (accepted above). Proposed: Quill.
    const res = await request(app)
      .post("/api/competitors")
      .send({ name: "Quill", classification: "DIRECT" });
    expect(res.status).toBe(201);
    const quillId = res.body.competitor.id;
    await settleBackgroundTasks();

    // Features scan touches only the tracked competitor
    const features = await runFeaturesScanForProduct(LOCAL_ORGANIZATION_ID, productRow);
    expect(features).toEqual({ processedCount: 1, failedCount: 0 });

    // Updates scan probes/caches release sources for tracked rows only
    await runUpdatesScan(LOCAL_ORGANIZATION_ID, productRow);
    const quill = await storage.getCompetitorProfileById(quillId);
    expect(quill!.validReleaseSources).toBeNull();
    const nimbus = await storage.getCompetitorProfileById(nimbusId);
    expect(nimbus!.validReleaseSources).toBeTruthy();

    // With only the proposed competitor remaining, the scheduled scan is a no-op
    await request(app).delete(`/api/competitors/${nimbusId}`);
    const idle = await runUpdatesScan(LOCAL_ORGANIZATION_ID, productRow);
    expect(idle).toMatchObject({ savedCount: 0, totalFound: 0, summary: "No competitors to scan" });
  });
});

describe("Inline-rename of proposed competitors (spec 2.4 proposal card)", () => {
  let productRow: Product;
  let vellumId: string;

  it("rename-proposed persists, draft change rows follow, and the name survives accept", async () => {
    productRow = (await request(app).get("/api/product")).body.product as Product;

    const created = await request(app)
      .post("/api/competitors")
      .send({ name: "Vellum", url: "https://vellum.example", classification: "DIRECT" });
    expect(created.status).toBe(201);
    vellumId = created.body.competitor.id;
    await settleBackgroundTasks();
    expect((await storage.getCompetitorChangesByProductAndName(productRow.id, "Vellum")).length).toBeGreaterThanOrEqual(1);

    const renamed = await request(app)
      .patch(`/api/competitors/${vellumId}`)
      .send({ name: "Vellum Labs" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.competitor).toMatchObject({ id: vellumId, name: "Vellum Labs", status: "proposed" });

    // Draft change rows followed the rename — nothing orphaned under the old name
    expect(await storage.getCompetitorChangesByProductAndName(productRow.id, "Vellum")).toEqual([]);
    expect((await storage.getCompetitorChangesByProductAndName(productRow.id, "Vellum Labs")).length).toBeGreaterThanOrEqual(1);

    // Detail view still carries the draft changes; the feed still excludes them
    const detail = await request(app).get(`/api/competitors/${vellumId}`);
    expect(detail.body.competitor.name).toBe("Vellum Labs");
    expect(detail.body.changes.length).toBeGreaterThanOrEqual(1);
    const feed = await request(app).get("/api/changes?limit=100");
    const feedTitles = feed.body.changes.map((c: { title: string }) => c.title);
    expect(feedTitles.some((t: string) => t.includes("Vellum"))).toBe(false);

    // The rename survives accept
    const accepted = await request(app).post(`/api/competitors/${vellumId}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.competitor).toMatchObject({ name: "Vellum Labs", status: "tracked" });
    const list = await request(app).get("/api/competitors");
    expect(list.body.competitors.map((c: { name: string }) => c.name)).toContain("Vellum Labs");
  });

  it("discard after rename purges the renamed draft change rows", async () => {
    const created = await request(app)
      .post("/api/competitors")
      .send({ name: "Willow", url: "https://willow.example", classification: "DIRECT" });
    expect(created.status).toBe(201);
    const willowId = created.body.competitor.id;
    await settleBackgroundTasks();

    const renamed = await request(app).patch(`/api/competitors/${willowId}`).send({ name: "Willow HQ" });
    expect(renamed.status).toBe(200);

    const res = await request(app).delete(`/api/competitors/${willowId}`);
    expect(res.status).toBe(204);
    expect(await storage.getCompetitorProfileById(willowId)).toBeUndefined();
    expect(await storage.getCompetitorChangesByProductAndName(productRow.id, "Willow")).toEqual([]);
    expect(await storage.getCompetitorChangesByProductAndName(productRow.id, "Willow HQ")).toEqual([]);
  });

  it("renaming a TRACKED competitor → 400 with a clear error", async () => {
    // Vellum Labs was accepted above
    const res = await request(app).patch(`/api/competitors/${vellumId}`).send({ name: "Beacon" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/proposed/i);
    // Name unchanged
    const detail = await request(app).get(`/api/competitors/${vellumId}`);
    expect(detail.body.competitor.name).toBe("Vellum Labs");
  });

  it("renaming a proposed competitor onto an existing name → 409 (case-insensitive, like POST)", async () => {
    // Quill is still proposed from the scheduler test
    const proposed = await request(app).get("/api/competitors?include=proposed");
    const quill = proposed.body.competitors.find((c: { name: string }) => c.name === "Quill");
    expect(quill).toBeTruthy();
    expect(quill.status).toBe("proposed");

    const res = await request(app).patch(`/api/competitors/${quill.id}`).send({ name: "vellum labs" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });
});
