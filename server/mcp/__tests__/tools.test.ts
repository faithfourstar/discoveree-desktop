/**
 * The MCP surface (ADR 005): registry completeness, read tools serving the
 * EXISTING route serialisers (stable ids, citations, freshness stamps, honest
 * absence, _context envelope), ADR 003 §1.2 product semantics, the two write
 * tools (owner-seat direct add with provenance; intel ALWAYS queued), the
 * intel-proposal REST round-trip, the reader refusal shape, activity metrics
 * (payloads never logged), SDK integration over an in-memory transport, the
 * stateless HTTP endpoint with DNS-rebinding protection, and the structural
 * no-LLM import ban.
 *
 * No LLM is mocked because MCP handlers never call one — that is the point.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import type { Express } from "express";
import { z } from "zod/v4";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Product } from "@shared/schema";
import { buildApp } from "../../app.js";
import { closeDatabase, initDatabase } from "../../db/index.js";
import { LOCAL_ORGANIZATION_ID, LOCAL_USER_ID } from "../../db/seedLocal.js";
import { seedAgents } from "../../lib/agents/seed.js";
import { createProduct, getProduct } from "../../modules/products/storage.js";
import * as competitorsService from "../../modules/competitors/service.js";
import * as competitorsStorage from "../../modules/competitors/storage.js";
import * as customersService from "../../modules/customers/service.js";
import * as customersStorage from "../../modules/customers/storage.js";
import { getMcpActivitySummary, recordMcpActivity } from "../activity.js";
import { ReaderSeatError } from "../caller.js";
import { McpToolError } from "../payloads.js";
import { getToolDef, listToolDefs, type McpToolCtx } from "../registry.js";
import { buildMcpServer, MCP_INSTRUCTIONS } from "../server.js";

let app: Express;
let productA: Product;
let productB: Product;
let rivalFacetId: string;
let rivalEntityId: string;
let segmentFacetId: string;

const ownerCtx = (productPin: string | null = null): McpToolCtx => ({
  organizationId: LOCAL_ORGANIZATION_ID,
  caller: { seat: "full", userId: LOCAL_USER_ID, keyId: null, productScope: null },
  productPin,
  client: { name: "test-client", version: "1.0.0" },
});

async function call(tool: string, args: Record<string, unknown> = {}, ctx = ownerCtx()) {
  const def = getToolDef(tool);
  expect(def, `tool ${tool} must be registered`).toBeTruthy();
  return def!.handler(ctx, args);
}

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  await seedAgents();
  app = buildApp(); // default DNS-rebinding posture — tests set Host explicitly

  productA = await createProduct({
    organizationId: LOCAL_ORGANIZATION_ID,
    name: "Acme Product",
    slug: "acme-product",
    url: "https://acme.example",
    description: "A context layer.",
  });

  // Tracked competitor with entity facts, reviews and a change row.
  const added = await competitorsService.addCompetitor(LOCAL_ORGANIZATION_ID, productA, {
    name: "Rivalify",
    url: "https://rivalify.example",
    classification: "DIRECT",
  });
  rivalFacetId = added.profile.id;
  rivalEntityId = added.entity.id;
  await competitorsStorage.updateCompetitorProfile(rivalFacetId, {
    status: "tracked",
    keyDifferentiators: ["Cheaper for SMBs [1]"],
    lastEnrichedAt: new Date(),
  });
  await competitorsStorage.mergeCompetitorEntityFacts(rivalEntityId, {
    description: "Rivalify is a rival expense tool.",
    descriptionSourceUrl: "https://rivalify.example/about",
    summaryCitations: ["https://cite.example/one"],
    keyFeatures: [{ feature: "Multi-entity", sourceUrl: "https://rivalify.example/docs/multi" }],
    reviewAverageRating: 4.5,
    reviewTotalCount: 210,
    reviews: [{ text: "Support is quick.", source: "G2", sourceUrl: "https://g2.example/r1", sentiment: 90, verified: true }],
  });
  await competitorsStorage.createCompetitorChange({
    entityId: rivalEntityId,
    sourceCategory: "competitor",
    changeType: "pricing",
    changeTitle: "Rivalify raised Pro pricing",
    changeDescription: "Pro tier moved to $30.",
    sourceUrl: "https://rivalify.example/pricing",
    sourceType: "agent",
  });

  // Tracked segment with an owner persona and some feedback + a theme.
  const segment = await customersService.addSegment(LOCAL_ORGANIZATION_ID, productA, {
    name: "Accountants",
    provenance: "owner",
  });
  segmentFacetId = segment.facet.id;
  await customersService.createOwnerPersona(productA.id, segment.entity.id, {
    title: "Practice Accountant",
    facet: { goals: ["Close the books faster"] },
  });
  const e1 = await customersStorage.createFeedbackEntry({
    productId: productA.id, isCompetitor: false, sourceName: "G2", sourceType: "review",
    verified: true, collectedAt: new Date(), sourceCreatedAt: new Date("2026-06-01"),
    topic: "Exports", quotedText: "Exports are brilliant at quarter end.", sentiment: 85,
  });
  await customersStorage.createFeedbackEntry({
    productId: productA.id, isCompetitor: false, sourceName: "Interview", sourceType: "manual",
    verified: true, collectedAt: new Date(), sourceCreatedAt: new Date(),
    topic: "Imports", quotedText: "Bank imports failed twice this month.", sentiment: 30,
  });
  await customersStorage.createFeedbackTheme({
    productId: productA.id, themeName: "Unreliable Bank Imports", aliases: [], summary: "Imports fail.",
    status: "needs_review", mentionCount: 1, feedbackEntryIds: [e1.id], confidence: 90, coherence: 88,
  });
});

afterAll(async () => {
  await customersService.settleCustomerBackgroundTasks();
  await competitorsService.settleBackgroundTasks();
  await closeDatabase();
});

describe("the declarative registry (ADR 005 §6.1)", () => {
  it("serves all twelve tools with categories — 10 read, 2 write", () => {
    const defs = listToolDefs();
    const names = defs.map(d => d.name).sort();
    expect(names).toEqual([
      "get_competitor", "get_context_health", "get_product_profile", "get_segment",
      "list_competitor_changes", "list_competitors", "list_feedback",
      "list_feedback_themes", "list_products", "list_segments",
      "log_feedback", "propose_competitor_intel",
    ]);
    expect(defs.filter(d => d.category === "read")).toHaveLength(10);
    expect(defs.filter(d => d.category === "write")).toHaveLength(2);
  });

  it("the instructions ship the behaviour-shaping rules (§2.8)", () => {
    expect(MCP_INSTRUCTIONS).toContain("get_context_health");
    expect(MCP_INSTRUCTIONS).toContain("never invented");
    expect(MCP_INSTRUCTIONS).toContain("relay the refusal message verbatim");
  });
});

describe("read tools — serialiser shapes with citations and the envelope (§2.2/§2.4)", () => {
  it("list_products (org-level) with _context.generatedAt", async () => {
    const result = await call("list_products");
    expect((result["products"] as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((result["_context"] as Record<string, unknown>)["generatedAt"]).toBeTruthy();
  });

  it("get_context_health is computed, never synthesised (§2.6)", async () => {
    const result = await call("get_context_health");
    expect(result["competitors"]).toMatchObject({ tracked: 1, proposed: 0 });
    expect(result["themes"]).toMatchObject({ count: 1 });
    expect((result["themes"] as Record<string, unknown>)["unfiledCount"]).toBe(1);
    expect(result["intelProposals"]).toEqual({ pending: 0 });
    expect(result["seat"]).toEqual({ seat: "full" });
    expect((result["_context"] as Record<string, unknown>)["product"]).toMatchObject({ name: "Acme Product" });
  });

  it("list_competitors serves CompetitorCard verbatim — facet id, lineage, derived sentiment", async () => {
    const result = await call("list_competitors");
    const cards = result["competitors"] as Array<Record<string, unknown>>;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: rivalFacetId,
      entityId: rivalEntityId,
      name: "Rivalify",
      status: "tracked",
      sentiment: 90, // 4.5 × 20
      reviewCount: 210,
    });
  });

  it("get_competitor accepts the NAME, returns cited detail + reviews + monitoring stamps (§2.5)", async () => {
    const result = await call("get_competitor", { competitor: "rivalify" });
    const competitor = result["competitor"] as Record<string, unknown>;
    expect(competitor["id"]).toBe(rivalFacetId);
    expect(competitor["keyFeatures"]).toEqual([{ feature: "Multi-entity", sourceUrl: "https://rivalify.example/docs/multi" }]);
    expect((competitor["keyDifferentiators"] as Array<Record<string, unknown>>)[0]).toMatchObject({
      sourceUrl: "https://cite.example/one", // [1] marker → citation
    });
    const reviews = competitor["reviews"] as Record<string, unknown>;
    expect((reviews["quotes"] as Array<Record<string, unknown>>)[0]).toMatchObject({ verified: true, sourceUrl: "https://g2.example/r1" });
    expect(result["recentChanges"]).toHaveLength(1);
  });

  it("get_competitor with an unknown ref → deterministic error listing candidates", async () => {
    await expect(call("get_competitor", { competitor: "Nonexistent Co" }))
      .rejects.toSatisfy((err: unknown) =>
        err instanceof McpToolError &&
        err.payload["error"] === "competitor_not_found" &&
        (err.payload["candidates"] as Array<{ name: string }>).some(c => c.name === "Rivalify"));
  });

  it("list_competitor_changes serves the entity-joined feed with verification flags", async () => {
    const result = await call("list_competitor_changes", { limit: 10 });
    const changes = result["changes"] as Array<Record<string, unknown>>;
    expect(changes[0]).toMatchObject({
      entityId: rivalEntityId,
      competitorName: "Rivalify",
      changeType: "pricing",
      sourceUrl: "https://rivalify.example/pricing",
    });
    expect(changes[0]!["detectedAt"]).toMatch(/T.*Z$/); // ISO, never pre-formatted
  });

  it("list_segments serves evidenceStatus verbatim — honest absence (§2.4.4)", async () => {
    const result = await call("list_segments");
    const segments = result["segments"] as Array<Record<string, unknown>>;
    expect(segments[0]).toMatchObject({ id: segmentFacetId, name: "Accountants", personaCount: 1 });
    expect(segments[0]!["evidenceStatus"]).toMatchObject({
      thresholds: { persona: 3, insights: 5 },
    });
  });

  it("get_segment by name serves personas with provenance and owner evidence refs", async () => {
    const result = await call("get_segment", { segment: "Accountants" });
    const segment = result["segment"] as Record<string, unknown>;
    const personas = segment["personas"] as Array<Record<string, unknown>>;
    expect(personas[0]).toMatchObject({ title: "Practice Accountant", provenance: "owner", facetStatus: "tracked" });
    expect(((personas[0]!["goals"] as Array<Record<string, unknown>>)[0]!["evidenceRefs"] as Array<Record<string, unknown>>)[0])
      .toEqual({ kind: "owner" });
  });

  it("list_feedback_themes serves the catalogue + unfiledCount", async () => {
    const result = await call("list_feedback_themes");
    expect((result["themes"] as unknown[])).toHaveLength(1);
    expect(result["unfiledCount"]).toBe(1);
  });

  it("list_feedback paginates with total/nextOffset and filters by theme", async () => {
    const page = await call("list_feedback", { limit: 1, offset: 0 });
    expect(page["total"]).toBe(2);
    expect(page["nextOffset"]).toBe(1);

    const themes = await customersStorage.getFeedbackThemesByProduct(productA.id);
    const byTheme = await call("list_feedback", { theme_id: themes[0]!.id });
    expect((byTheme["entries"] as Array<Record<string, unknown>>).every(e => e["topic"] === "Exports")).toBe(true);
  });
});

describe("product parameter semantics (ADR 003 §1.2 — never a silent products[0])", () => {
  it("omitted + one product resolves; then a second product makes omission a deterministic failure", async () => {
    // Single-product default worked throughout the tests above. Add product B:
    productB = await createProduct({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "Second Product",
      slug: "second-product",
    });

    await expect(call("get_context_health")).rejects.toSatisfy((err: unknown) =>
      err instanceof McpToolError &&
      err.payload["error"] === "product_required" &&
      (err.payload["products"] as unknown[]).length === 2);

    // Explicit product (by slug) works.
    const result = await call("get_context_health", { product: "acme-product" });
    expect((result["_context"] as Record<string, unknown>)["product"]).toMatchObject({ slug: "acme-product" });
  });

  it("unknown product → product_not_found with the list", async () => {
    await expect(call("list_competitors", { product: "no-such" })).rejects.toSatisfy((err: unknown) =>
      err instanceof McpToolError && err.payload["error"] === "product_not_found");
  });

  it("resolves a display NAME, case-insensitively — a consuming AI passes what it just read", async () => {
    const exact = await call("get_context_health", { product: "Acme Product" });
    expect((exact["_context"] as Record<string, unknown>)["product"]).toMatchObject({ slug: "acme-product" });

    const cased = await call("get_context_health", { product: "acme product" });
    expect((cased["_context"] as Record<string, unknown>)["product"]).toMatchObject({ slug: "acme-product" });
  });

  it("a duplicate name is ambiguous → the current error, listing ids/slugs", async () => {
    await createProduct({ organizationId: LOCAL_ORGANIZATION_ID, name: "Twin Product", slug: "twin-one" });
    await createProduct({ organizationId: LOCAL_ORGANIZATION_ID, name: "Twin Product", slug: "twin-two" });

    await expect(call("get_context_health", { product: "Twin Product" }))
      .rejects.toSatisfy((err: unknown) =>
        err instanceof McpToolError &&
        err.payload["error"] === "product_not_found" &&
        String(err.payload["message"]).includes("more than one product") &&
        (err.payload["products"] as Array<{ slug: string }>).some(p => p.slug === "twin-one"));

    // The twins stay resolvable by slug — ids/slugs remain the stable path.
    const bySlug = await call("get_context_health", { product: "twin-two" });
    expect((bySlug["_context"] as Record<string, unknown>)["product"]).toMatchObject({ slug: "twin-two" });
  });

  it("a --product pin defaults the scope and REFUSES a mismatch (§2.3)", async () => {
    const pinned = ownerCtx("acme-product");
    const ok = await call("list_competitors", {}, pinned);
    expect((ok["_context"] as Record<string, unknown>)["product"]).toMatchObject({ slug: "acme-product" });

    await expect(call("list_competitors", { product: "second-product" }, pinned))
      .rejects.toSatisfy((err: unknown) =>
        err instanceof McpToolError && err.payload["error"] === "product_pinned");
  });
});

describe("log_feedback (ADR 005 §3.2 — owner-seat direct add)", () => {
  it("schema REQUIRES shared_by (attribution is the §4a promise)", () => {
    const def = getToolDef("log_feedback")!;
    const schema = z.object(def.inputSchema);
    expect(schema.safeParse({ quoted_text: "hello" }).success).toBe(false);
    expect(schema.safeParse({ quoted_text: "hello", shared_by: "unattributed" }).success).toBe(true);
  });

  it("direct add: mcp sourceType, null sentiment (never default-50), full provenance incl. `where`", async () => {
    const result = await call("log_feedback", {
      product: "acme-product",
      quoted_text: "The Slack thread says onboarding took a week.",
      shared_by: "Maria",
      where: "  #enterprise-deals \n thread ",
      source_name: "Slack #enterprise-deals",
    });
    expect(result["id"]).toBeTruthy();
    expect(result["message"]).toContain("shared by Maria");

    const entry = await customersStorage.getFeedbackEntryById(result["id"] as string);
    expect(entry).toMatchObject({ sourceType: "mcp", verified: false, sentiment: null, isCompetitor: false });
    expect(entry!.provenance).toMatchObject({
      via: "mcp",
      client: "test-client 1.0.0",
      sharedBy: "Maria",
      detail: "#enterprise-deals thread", // sanitised: whitespace collapsed
      keyId: null,
    });
  });

  it("`where` absent → provenance.detail stays null; overlong `where` is capped at 120", async () => {
    const bare = await call("log_feedback", {
      product: "acme-product", quoted_text: "No channel stated for this one.", shared_by: "unattributed",
    });
    const bareEntry = await customersStorage.getFeedbackEntryById(bare["id"] as string);
    expect((bareEntry!.provenance as Record<string, unknown>)["detail"]).toBeNull();

    const long = await call("log_feedback", {
      product: "acme-product", quoted_text: "Channel name of unusual length.", shared_by: "unattributed",
      where: "x".repeat(300),
    });
    const longEntry = await customersStorage.getFeedbackEntryById(long["id"] as string);
    expect(((longEntry!.provenance as Record<string, unknown>)["detail"] as string).length).toBe(120);
  });

  it("idempotency beats scolding: the dedup key returns the existing id with duplicate:true", async () => {
    const first = await call("log_feedback", {
      product: "acme-product", quoted_text: "Duplicate candidate feedback item.", shared_by: "unattributed",
    });
    const second = await call("log_feedback", {
      product: "acme-product", quoted_text: "Duplicate candidate feedback item.", shared_by: "unattributed",
    });
    expect(second["duplicate"]).toBe(true);
    expect(second["id"]).toBe(first["id"]);
  });

  it("competitor resolution: a TRACKED name sets isCompetitor + entity id; an unresolved name lands in topic — never an entity row", async () => {
    const tracked = await call("log_feedback", {
      product: "acme-product", quoted_text: "They said Rivalify's exports are faster.", shared_by: "unattributed",
      competitor: "Rivalify",
    });
    const trackedEntry = await customersStorage.getFeedbackEntryById(tracked["id"] as string);
    expect(trackedEntry).toMatchObject({ isCompetitor: true, competitorEntityId: rivalEntityId });

    const entitiesBefore = (await competitorsStorage.getCompetitorEntitiesByOrganization(LOCAL_ORGANIZATION_ID)).length;
    const loose = await call("log_feedback", {
      product: "acme-product", quoted_text: "Someone mentioned Ghost Co in passing.", shared_by: "unattributed",
      competitor: "Ghost Co",
    });
    const looseEntry = await customersStorage.getFeedbackEntryById(loose["id"] as string);
    expect(looseEntry).toMatchObject({ isCompetitor: false, competitorEntityId: null, topic: "Ghost Co" });
    expect((await competitorsStorage.getCompetitorEntitiesByOrganization(LOCAL_ORGANIZATION_ID)).length).toBe(entitiesBefore);
  });
});

describe("propose_competitor_intel + the intel_proposals queue (§3.3)", () => {
  let resolvedProposalId: string;
  let newCompetitorProposalId: string;

  it("a resolved competitor queues against the entity; nothing touches tracked context", async () => {
    const changesBefore = (await competitorsStorage.getCompetitorChangesByEntity(rivalEntityId, 100)).length;
    const result = await call("propose_competitor_intel", {
      product: "acme-product",
      competitor: rivalFacetId, // facet id resolves through to the entity
      intel: "Rivalify is dropping their free tier next month.",
      kind: "pricing",
      shared_by: "Tom (sales)",
      where: "#sales-eu",
      source_url: "https://rivalify.example/blog/pricing",
    });
    expect(result).toMatchObject({ status: "pending", competitor: { entityId: rivalEntityId } });
    expect(result["message"]).toContain("nothing changes until it is accepted");
    resolvedProposalId = result["proposalId"] as string;

    // `where` round-trips into provenance.detail on the queued proposal.
    const queuedProposal = await competitorsStorage.getIntelProposalById(resolvedProposalId);
    expect(queuedProposal!.provenance).toMatchObject({ via: "mcp", sharedBy: "Tom (sales)", detail: "#sales-eu" });

    expect((await competitorsStorage.getCompetitorChangesByEntity(rivalEntityId, 100)).length).toBe(changesBefore);
  });

  it("an unresolved name queues as new_competitor — MCP never creates entities", async () => {
    const result = await call("propose_competitor_intel", {
      product: "acme-product",
      competitor: "Stealthy Startup",
      intel: "They just launched an expense product aimed at accountants.",
      kind: "news",
      shared_by: "unattributed",
    });
    expect(result["competitor"]).toEqual({ name: "Stealthy Startup" });
    newCompetitorProposalId = result["proposalId"] as string;
    const proposal = await competitorsStorage.getIntelProposalById(newCompetitorProposalId);
    expect(proposal).toMatchObject({ targetKind: "new_competitor", targetName: "Stealthy Startup", targetEntityId: null });
    // `where` absent → provenance.detail stays null on intel too.
    expect((proposal!.provenance as Record<string, unknown>)["detail"]).toBeNull();
  });

  it("REST: pending list → accept materialises the internal_report change row with provenance", async () => {
    const list = await request(app).get(`/api/products/${productA.id}/intel-proposals?status=pending`);
    expect(list.status).toBe(200);
    expect(list.body.proposals.length).toBeGreaterThanOrEqual(2);

    const accept = await request(app).post(`/api/products/${productA.id}/intel-proposals/${resolvedProposalId}/accept`);
    expect(accept.status).toBe(200);
    expect(accept.body.proposal.status).toBe("accepted");
    const changeId = accept.body.acceptedChangeId as string;
    expect(changeId).toBeTruthy();
    expect(accept.body.proposal.acceptedChangeId).toBe(changeId);

    const changes = await competitorsStorage.getCompetitorChangesByEntity(rivalEntityId, 100);
    const materialised = changes.find(c => c.id === changeId)!;
    expect(materialised).toMatchObject({
      sourceType: "internal_report",
      changeType: "pricing",
      changeDescription: "Rivalify is dropping their free tier next month.",
      sourceUrl: "https://rivalify.example/blog/pricing",
    });
    expect(materialised.provenance).toMatchObject({ via: "mcp", sharedBy: "Tom (sales)" });

    // Accepted intel lands where every other observed change lands — the MCP feed serves it.
    const feed = await call("list_competitor_changes", { product: "acme-product", limit: 50 });
    expect((feed["changes"] as Array<Record<string, unknown>>).some(c => c["id"] === changeId)).toBe(true);

    // Deciding twice → 409.
    const again = await request(app).post(`/api/products/${productA.id}/intel-proposals/${resolvedProposalId}/accept`);
    expect(again.status).toBe(409);
  });

  it("REST: accepting a new_competitor proposal hands off to the standard add flow (proposed facet + gate)", async () => {
    const accept = await request(app).post(`/api/products/${productA.id}/intel-proposals/${newCompetitorProposalId}/accept`);
    expect(accept.status).toBe(200);

    const entity = await competitorsStorage.findCompetitorEntityByNormalizedName(
      LOCAL_ORGANIZATION_ID, "stealthy startup");
    expect(entity).toBeTruthy();
    const facet = await competitorsStorage.getCompetitorProfileByProductAndEntity(productA.id, entity!.id);
    expect(facet!.status).toBe("proposed"); // through its own gate, not auto-tracked
    // The claim survives as a change row on the new (proposed) entity.
    const changes = await competitorsStorage.getCompetitorChangesByEntity(entity!.id, 10);
    expect(changes.some(c => c.sourceType === "internal_report")).toBe(true);
    await competitorsService.settleBackgroundTasks();
  });

  it("REST: dismiss discards without materialising", async () => {
    const queued = await call("propose_competitor_intel", {
      product: "acme-product", competitor: "Rivalify", intel: "Unfounded rumour.", shared_by: "unattributed",
    });
    const changesBefore = (await competitorsStorage.getCompetitorChangesByEntity(rivalEntityId, 100)).length;
    const dismiss = await request(app).post(`/api/products/${productA.id}/intel-proposals/${queued["proposalId"]}/dismiss`);
    expect(dismiss.status).toBe(200);
    expect(dismiss.body.proposal.status).toBe("dismissed");
    expect((await competitorsStorage.getCompetitorChangesByEntity(rivalEntityId, 100)).length).toBe(changesBefore);
  });
});

describe("the reader refusal shape (§4.2 — built and tested now, enforced live in 5b)", () => {
  it("a reader seat is refused with the echoed write, the owner's name, and no content retained", async () => {
    const readerCtx: McpToolCtx = {
      ...ownerCtx(),
      caller: { seat: "reader", userId: "reader-user", keyId: "key-123", productScope: null },
    };
    const args = { product: "acme-product", quoted_text: "Reader-typed feedback", shared_by: "Reader" };

    let refusal: ReaderSeatError | null = null;
    try {
      await call("log_feedback", args, readerCtx);
    } catch (err) {
      refusal = err as ReaderSeatError;
    }
    expect(refusal).toBeInstanceOf(ReaderSeatError);
    const payload = refusal!.toPayload();
    expect(payload["error"]).toBe("reader_seat");
    expect(payload["message"]).toContain("Local user"); // names the owner
    expect(payload["message"]).not.toMatch(/\$|£|price/i); // no pricing in the machine payload
    expect(payload["requested_write"]).toEqual({ tool: "log_feedback", arguments: args }); // nothing lost

    // Nothing was retained server-side.
    const entries = await customersStorage.getFeedbackEntriesByProduct(productA.id, { includeArchived: true });
    expect(entries.some(e => e.quotedText === "Reader-typed feedback")).toBe(false);
  });
});

describe("mcp_activity (§2.7 — activity only, payloads never logged)", () => {
  it("SDK round-trip over an in-memory transport records client identity per call", async () => {
    const server = buildMcpServer({ organizationId: LOCAL_ORGANIZATION_ID });
    const client = new Client({ name: "claude-test", version: "9.9.9" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map(t => t.name)).toContain("get_context_health");

    const result = await client.callTool({ name: "list_products", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(JSON.parse(text)["products"]).toBeTruthy();

    await client.close();
    await server.close();

    const summary = await getMcpActivitySummary(1);
    const claude = summary.byClient.find(c => c.clientName === "claude-test");
    expect(claude).toBeTruthy();
    expect(summary.byTool.some(t => t.toolName === "list_products")).toBe(true);
  });

  it("rows carry activity fields only — there is no payload column to log into", async () => {
    await recordMcpActivity({ clientName: "x", clientVersion: "1", toolName: "list_products", isError: false, keyId: null });
    const { getDb } = await import("../../db/index.js");
    const { mcpActivity } = await import("@shared/schema");
    const [row] = await getDb().select().from(mcpActivity).limit(1);
    expect(Object.keys(row!).sort()).toEqual(["calledAt", "clientName", "clientVersion", "id", "isError", "keyId", "toolName"]);
  });
});

describe("the stateless HTTP endpoint (§1.5)", () => {
  it("answers an initialize POST on /mcp with the correct Host header", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Host", "127.0.0.1:7317")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "http-test", version: "1.0" } },
      });
    expect(res.status).toBe(200);
  });

  it("DNS-rebinding protection refuses a foreign Host header", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Host", "evil.example:7317")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x", version: "1" } } });
    expect(res.status).toBe(403);
  });
});

describe("the no-LLM import ban (§3.6 — structural)", () => {
  it("server/mcp/ and server/cli/ import nothing from server/lib/llm/", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const roots = [path.resolve(here, ".."), path.resolve(here, "../../cli")];
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "__tests__") scan(full);
          continue;
        }
        if (!name.endsWith(".ts")) continue;
        const source = readFileSync(full, "utf8");
        for (const line of source.split("\n")) {
          if (/^\s*import\b.*["'].*lib\/llm\//.test(line)) offenders.push(`${full}: ${line.trim()}`);
        }
      }
    };
    roots.forEach(scan);
    expect(offenders).toEqual([]);
  });
});
