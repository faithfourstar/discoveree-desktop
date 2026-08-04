/**
 * Entity/facet competitor storage against in-memory PGlite (ADR 003 §2):
 * dedup lookups span the org, entity-fact merges keep the "merge, don't
 * replace" guarantee, the facet-grain unique rule holds per (product, entity
 * node), the two-level hierarchy invariant is enforced in service code, and
 * the product change feed is a join over tracked facets.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeDatabase, initDatabase } from "../../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../../db/seedLocal.js";
import { createProduct } from "../../products/storage.js";
import * as storage from "../storage.js";

let productId: string;
let productBId: string;

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  const product = await createProduct({
    organizationId: LOCAL_ORGANIZATION_ID,
    name: "Test product",
    slug: "test-product",
  });
  productId = product.id;
  const productB = await createProduct({
    organizationId: LOCAL_ORGANIZATION_ID,
    name: "Second product",
    slug: "second-product",
  });
  productBId = productB.id;
});

afterAll(async () => {
  await closeDatabase();
});

describe("competitor entities (org-level identity + dedup keys)", () => {
  it("Given an entity, When looked up by normalised name or domain, Then the same row comes back", async () => {
    const entity = await storage.createCompetitorEntity({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "MergeCo",
      normalizedName: "mergeco",
      url: "https://mergeco.example",
      domain: "mergeco.example",
    });

    const byName = await storage.findCompetitorEntityByNormalizedName(LOCAL_ORGANIZATION_ID, "mergeco");
    expect(byName?.id).toBe(entity.id);

    const byDomain = await storage.findCompetitorEntityByDomain(LOCAL_ORGANIZATION_ID, "mergeco.example");
    expect(byDomain?.id).toBe(entity.id);
  });

  it("Given a duplicate normalised name in the same org, When created, Then the unique index rejects it", async () => {
    await expect(storage.createCompetitorEntity({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "MERGECO",
      normalizedName: "mergeco",
    })).rejects.toThrow();
  });

  it("Given enriched entity facts, When a partial agent run merges nulls and empty arrays, Then existing data survives (merge, don't replace)", async () => {
    const entity = await storage.findCompetitorEntityByNormalizedName(LOCAL_ORGANIZATION_ID, "mergeco");
    await storage.updateCompetitorEntity(entity!.id, {
      description: "Original description",
      keyFeatures: [{ feature: "Original feature" }],
    });

    const merged = await storage.mergeCompetitorEntityFacts(entity!.id, {
      description: null,
      keyFeatures: [],
      url: null,
      pricingNotes: "Real change comes through",
    });

    expect(merged.id).toBe(entity!.id); // same row — no silent duplicates
    expect(merged.description).toBe("Original description");
    expect(merged.keyFeatures).toEqual([{ feature: "Original feature" }]);
    expect(merged.url).toBe("https://mergeco.example");
    expect(merged.pricingNotes).toBe("Real change comes through");
  });
});

describe("two-level hierarchy invariant (ADR 003 §2.9.1, service-enforced)", () => {
  it("Given a root node, When a child is created under it, Then it succeeds; a grandchild is rejected", async () => {
    const root = await storage.createCompetitorEntity({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "Xero",
      normalizedName: "xero",
    });
    const child = await storage.createCompetitorEntity({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "Xero Payroll",
      normalizedName: "xero payroll",
      parentEntityId: root.id,
    });
    expect(child.parentEntityId).toBe(root.id);

    // A product node cannot have children of its own — depth is capped at 2.
    await expect(storage.createCompetitorEntity({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "Xero Payroll Add-on",
      normalizedName: "xero payroll add on",
      parentEntityId: child.id,
    })).rejects.toThrow(/two levels/i);

    // A missing parent is rejected too.
    await expect(storage.createCompetitorEntity({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "Orphan",
      normalizedName: "orphan",
      parentEntityId: "00000000-0000-4000-8000-00000000dead",
    })).rejects.toThrow(/not found/i);
  });
});

describe("facets (per-product grain)", () => {
  it("Given an entity, When two products face it, Then each holds its own facet but a product cannot hold two", async () => {
    const entity = await storage.findCompetitorEntityByNormalizedName(LOCAL_ORGANIZATION_ID, "mergeco");

    const facetA = await storage.createCompetitorFacet({
      productId,
      entityId: entity!.id,
      sourceCategory: "competitor",
      status: "tracked",
    });
    const facetB = await storage.createCompetitorFacet({
      productId: productBId,
      entityId: entity!.id,
      sourceCategory: "adjacent",
      status: "tracked",
    });
    expect(facetA.id).not.toBe(facetB.id);

    // Facet-grain unique rule per (productId, entityId) — §2.9.2.
    await expect(storage.createCompetitorFacet({
      productId,
      entityId: entity!.id,
      sourceCategory: "competitor",
    })).rejects.toThrow();

    expect(await storage.countFacetsForEntities([entity!.id])).toBe(2);

    const joined = await storage.getFacetsWithEntitiesByProduct(productId);
    expect(joined).toHaveLength(1);
    expect(joined[0]?.entity.name).toBe("MergeCo");
    expect(joined[0]?.profile.id).toBe(facetA.id);
  });

  it("getEntitiesWithTrackedFacets returns each entity once with its tracked facets", async () => {
    const rows = await storage.getEntitiesWithTrackedFacets(LOCAL_ORGANIZATION_ID);
    const mergeCo = rows.find(r => r.entity.name === "MergeCo");
    expect(mergeCo).toBeTruthy();
    expect(mergeCo!.trackedFacets).toHaveLength(2);
    // Xero tree has no facets — not a monitoring target.
    expect(rows.find(r => r.entity.name === "Xero")).toBeUndefined();
  });
});

describe("competitor changes (entity-keyed feed join, ADR 003 §2.4)", () => {
  it("Given entity-keyed changes, When the product feed is read, Then only tracked-facet entities appear with filters intact", async () => {
    const mergeCo = await storage.findCompetitorEntityByNormalizedName(LOCAL_ORGANIZATION_ID, "mergeco");
    const fresh = await storage.createCompetitorEntity({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "FreshCo",
      normalizedName: "freshco",
    });
    // FreshCo is only PROPOSED on product A — its changes must not reach the feed.
    await storage.createCompetitorFacet({
      productId,
      entityId: fresh.id,
      sourceCategory: "adjacent",
      status: "proposed",
    });

    for (let i = 0; i < 5; i++) {
      await storage.createCompetitorChange({
        entityId: i % 2 === 0 ? mergeCo!.id : fresh.id,
        sourceCategory: i % 2 === 0 ? "competitor" : "adjacent",
        changeType: "feature",
        changeTitle: `Change ${i}`,
        changeDescription: `Description ${i}`,
        sourceUrl: `https://example.com/change/${i}`,
        stream: "product",
        severity: "minor",
      });
    }

    // Product A: MergeCo tracked (3 changes), FreshCo proposed (excluded by the join predicate).
    const feed = await storage.getCompetitorChangesForProductPaginated(productId, { limit: 10, offset: 0 });
    expect(feed.total).toBe(3);
    expect(feed.changes.every(c => c.entityId === mergeCo!.id)).toBe(true);
    expect(feed.changes.every(c => c.competitorName === "MergeCo")).toBe(true);

    // Pagination
    const page1 = await storage.getCompetitorChangesForProductPaginated(productId, { limit: 2, offset: 0 });
    expect(page1.changes).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    const page2 = await storage.getCompetitorChangesForProductPaginated(productId, { limit: 2, offset: 2 });
    expect(page2.changes).toHaveLength(1);
    expect(page2.hasMore).toBe(false);

    // Classification filter joins the FACET, so it is per product: product B
    // tracks MergeCo as adjacent and sees the same changes under that filter.
    const adjacentOnA = await storage.getCompetitorChangesForProductPaginated(productId, {
      limit: 10, offset: 0, categoryFilter: "adjacent",
    });
    expect(adjacentOnA.total).toBe(0);
    const adjacentOnB = await storage.getCompetitorChangesForProductPaginated(productBId, {
      limit: 10, offset: 0, categoryFilter: "adjacent",
    });
    expect(adjacentOnB.total).toBe(3);

    // Search over title/description/entity name
    const searched = await storage.getCompetitorChangesForProductPaginated(productId, {
      limit: 10, offset: 0, search: "description 2",
    });
    expect(searched.total).toBe(1);
    expect(searched.changes[0]?.changeTitle).toBe("Change 2");

    // Detail view read: node-scoped changes
    const byEntity = await storage.getCompetitorChangesByEntity(fresh.id, 10);
    expect(byEntity).toHaveLength(2);
  });
});

describe("threat level history (facet-scoped, unchanged)", () => {
  it("Given recorded changes, When queried by profile and by recent window, Then rows come back newest-first", async () => {
    const entity = await storage.findCompetitorEntityByNormalizedName(LOCAL_ORGANIZATION_ID, "mergeco");
    const profile = await storage.getCompetitorProfileByProductAndEntity(productId, entity!.id);
    await storage.createCompetitorThreatLevelHistory({
      productId,
      competitorProfileId: profile!.id,
      competitorName: "MergeCo",
      previousLevel: "none",
      newLevel: "watch",
    });
    await storage.createCompetitorThreatLevelHistory({
      productId,
      competitorProfileId: profile!.id,
      competitorName: "MergeCo",
      previousLevel: "watch",
      newLevel: "big_threat",
    });

    const history = await storage.getCompetitorThreatLevelHistory(profile!.id);
    expect(history).toHaveLength(2);
    expect(history[0]?.newLevel).toBe("big_threat");

    const recent = await storage.getRecentThreatLevelChangesByProduct(productId, 30);
    expect(recent.length).toBeGreaterThanOrEqual(2);
  });
});

describe("delete by id (stable-ID surface)", () => {
  it("Given a facet, When deleted by id, Then it is gone and other rows survive", async () => {
    const entity = await storage.createCompetitorEntity({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "DoomedCo",
      normalizedName: "doomedco",
    });
    const doomed = await storage.createCompetitorFacet({
      productId,
      entityId: entity.id,
      sourceCategory: "competitor",
    });
    await storage.deleteCompetitorProfileById(doomed.id);
    expect(await storage.getCompetitorProfileById(doomed.id)).toBeUndefined();
    const mergeCo = await storage.findCompetitorEntityByNormalizedName(LOCAL_ORGANIZATION_ID, "mergeco");
    expect(await storage.getCompetitorProfileByProductAndEntity(productId, mergeCo!.id)).toBeDefined();
  });
});
