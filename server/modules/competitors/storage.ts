/**
 * Competitor storage (ADR 002 §3 conventions, reshaped by ADR 003 §2).
 *
 * Entity + facet are jointly canonical: `competitor_entities` carries
 * org-level identity/facts/monitoring state (researched once per org);
 * `competitor_profiles` is the per-product facet and remains the API's stable
 * id. Functions take organizationId/productId explicitly — never import the
 * seed constants here (only http/identity.ts and tests may).
 *
 * The two-level hierarchy invariant (§2.9.1: a parent must itself be a root)
 * is enforced HERE in service code, not SQL — this create function is the
 * single choke point for entity creation.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  competitorChanges,
  competitorEntities,
  competitorProfiles,
  competitorThreatLevelHistory,
  intelProposals,
  type CompetitorChange,
  type CompetitorEntity,
  type CompetitorProfile,
  type CompetitorThreatLevelHistory,
  type InsertCompetitorChange,
  type InsertCompetitorEntity,
  type InsertCompetitorThreatLevelHistory,
  type IntelProposal,
} from "@shared/schema";
import { getDb } from "../../db/index.js";

// drizzle's native insert types — the drizzle-zod Insert* types widen jsonb
// columns to Json, which drizzle's typed insert/update rejects under strict tsc.
type FacetInsert = typeof competitorProfiles.$inferInsert;
type EntityInsert = typeof competitorEntities.$inferInsert;

/** A facet joined with its entity node (and the node's company root, if any). */
export interface FacetWithEntity {
  profile: CompetitorProfile;
  entity: CompetitorEntity;
  /** The company root when the facet points at a child node (§2.9.2 fallback source). */
  parent: CompetitorEntity | null;
}

// ── Entities ────────────────────────────────────────────────────────────────

export async function getCompetitorEntityById(id: string): Promise<CompetitorEntity | undefined> {
  const db = getDb();
  const [entity] = await db.select().from(competitorEntities).where(eq(competitorEntities.id, id));
  return entity || undefined;
}

export async function getCompetitorEntitiesByOrganization(
  organizationId: string,
): Promise<CompetitorEntity[]> {
  const db = getDb();
  return db
    .select()
    .from(competitorEntities)
    .where(eq(competitorEntities.organizationId, organizationId))
    .orderBy(competitorEntities.name);
}

/**
 * Dedup lookup by normalised name (ADR 003 §2.3 step 1). Spans BOTH tree
 * levels — sub-brand names are stored fully qualified, so the org-wide unique
 * index makes this a single lookup.
 */
export async function findCompetitorEntityByNormalizedName(
  organizationId: string,
  normalizedName: string,
): Promise<CompetitorEntity | undefined> {
  const db = getDb();
  const [entity] = await db
    .select()
    .from(competitorEntities)
    .where(and(
      eq(competitorEntities.organizationId, organizationId),
      eq(competitorEntities.normalizedName, normalizedName),
    ));
  return entity || undefined;
}

/** Dedup lookup by domain — checked BEFORE the name (ADR 003 §2.3 step 1). */
export async function findCompetitorEntityByDomain(
  organizationId: string,
  domain: string,
): Promise<CompetitorEntity | undefined> {
  const db = getDb();
  const [entity] = await db
    .select()
    .from(competitorEntities)
    .where(and(
      eq(competitorEntities.organizationId, organizationId),
      eq(competitorEntities.domain, domain),
    ))
    .orderBy(competitorEntities.createdAt)
    .limit(1);
  return entity || undefined;
}

/**
 * Create an entity node, enforcing the two-level invariant (§2.9.1): a parent
 * must exist and must itself be a root node. Divisions-of-divisions is
 * corporate genealogy, not competitive intelligence.
 */
export async function createCompetitorEntity(insert: EntityInsert): Promise<CompetitorEntity> {
  const db = getDb();
  if (insert.parentEntityId) {
    const parent = await getCompetitorEntityById(insert.parentEntityId);
    if (!parent) {
      throw new Error("Parent competitor entity not found.");
    }
    if (parent.organizationId !== insert.organizationId) {
      throw new Error("Parent competitor entity belongs to a different organisation.");
    }
    if (parent.parentEntityId !== null) {
      throw new Error(
        "Competitor hierarchies are limited to two levels: a company and its products. A product node cannot have children of its own.",
      );
    }
  }
  const [entity] = await db.insert(competitorEntities).values(insert).returning();
  return entity!;
}

export async function updateCompetitorEntity(
  id: string,
  updateData: Partial<EntityInsert>,
): Promise<CompetitorEntity> {
  const db = getDb();
  const [entity] = await db
    .update(competitorEntities)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(competitorEntities.id, id))
    .returning();
  return entity!;
}

/**
 * "Merge, don't replace" write path for entity facts: strips fields that are
 * null, undefined, or empty arrays so that a failed or partial agent run
 * never wipes data that was already there (the sprint-2
 * upsertCompetitorProfile semantics, moved to the entity where the facts now
 * live).
 */
export async function mergeCompetitorEntityFacts(
  id: string,
  update: Partial<EntityInsert>,
): Promise<CompetitorEntity> {
  const safeUpdate: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(update)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    safeUpdate[key] = value;
  }
  const db = getDb();
  const [entity] = await db
    .update(competitorEntities)
    .set(safeUpdate)
    .where(eq(competitorEntities.id, id))
    .returning();
  return entity!;
}

export async function getChildCompetitorEntities(parentEntityId: string): Promise<CompetitorEntity[]> {
  const db = getDb();
  return db
    .select()
    .from(competitorEntities)
    .where(eq(competitorEntities.parentEntityId, parentEntityId))
    .orderBy(competitorEntities.name);
}

export async function deleteCompetitorEntitiesByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db.delete(competitorEntities).where(inArray(competitorEntities.id, ids));
}

/**
 * Demote a node to an IDENTITY-ONLY row (ADR 003 §2.3 step 4 / §2.9.3 ruling,
 * 4 Aug 2026): when a child's last facet is discarded while the tree survives,
 * the node is kept — the org's knowledge of the competitor's portfolio shape
 * must not regress on a tracking decision — but every enriched column is
 * cleared. What survives is exactly the identity/matching set: name,
 * normalizedName, parentEntityId, url/urlSource, domain, parentCompany.
 * The demoted node joins the identity-only siblings and is GC'd only with the
 * whole tree.
 */
export async function demoteCompetitorEntityToIdentity(id: string): Promise<CompetitorEntity> {
  const db = getDb();
  const [entity] = await db
    .update(competitorEntities)
    .set({
      description: null,
      descriptionSourceUrl: null,
      summaryCitations: null,
      keyFeatures: null,
      markets: null,
      customerSegments: null,
      integrations: null,
      pricing: null,
      pricingSourceUrl: null,
      pricingTiers: null,
      pricingFreeTrial: null,
      pricingNotes: null,
      reviews: null,
      reviewPlatforms: null,
      reviewPositiveThemes: null,
      reviewNegativeThemes: null,
      reviewAverageRating: null,
      reviewTotalCount: null,
      helpCenterUrl: null,
      helpCenterUrlSourceUrl: null,
      changelogUrl: null,
      changelogUrlSourceUrl: null,
      changelogContentHash: null,
      changelogLastCheckedAt: null,
      githubRepoUrl: null,
      githubStats: null,
      validReleaseSources: null,
      announcements: null,
      announcementsAnalysis: null,
      investorRelations: null,
      enrichmentStatus: "pending",
      lastEnrichedAt: null,
      userNews: null,
      userPricing: null,
      userFeatures: null,
      userIntegrations: null,
      userReviews: null,
      updatedAt: new Date(),
    })
    .where(eq(competitorEntities.id, id))
    .returning();
  return entity!;
}

/** Rename an entity node (ADR 003 §2.4: change rows are FK'd — nothing to walk). */
export async function renameCompetitorEntity(
  id: string,
  name: string,
  normalizedName: string,
): Promise<CompetitorEntity> {
  return updateCompetitorEntity(id, { name, normalizedName });
}

// ── Facets (competitor_profiles) ────────────────────────────────────────────

export async function getCompetitorProfileById(id: string): Promise<CompetitorProfile | undefined> {
  const db = getDb();
  const [profile] = await db.select().from(competitorProfiles).where(eq(competitorProfiles.id, id));
  return profile || undefined;
}

/** Facet-grain duplicate lookup (§2.9.2): one facet per (product, entity node). */
export async function getCompetitorProfileByProductAndEntity(
  productId: string,
  entityId: string,
): Promise<CompetitorProfile | undefined> {
  const db = getDb();
  const [profile] = await db
    .select()
    .from(competitorProfiles)
    .where(and(
      eq(competitorProfiles.productId, productId),
      eq(competitorProfiles.entityId, entityId),
    ));
  return profile || undefined;
}

export async function getCompetitorProfilesByProduct(productId: string): Promise<CompetitorProfile[]> {
  const db = getDb();
  return db
    .select()
    .from(competitorProfiles)
    .where(eq(competitorProfiles.productId, productId));
}

export async function getCompetitorProfilesByEntity(entityId: string): Promise<CompetitorProfile[]> {
  const db = getDb();
  return db
    .select()
    .from(competitorProfiles)
    .where(eq(competitorProfiles.entityId, entityId));
}

export async function getCompetitorProfilesByEntities(entityIds: string[]): Promise<CompetitorProfile[]> {
  if (entityIds.length === 0) return [];
  const db = getDb();
  return db
    .select()
    .from(competitorProfiles)
    .where(inArray(competitorProfiles.entityId, entityIds));
}

/**
 * Facets of a product joined to their entity node (and the node's company
 * root where one exists), ordered by entity name — the read the card list and
 * detail views are built from (§2.5).
 */
export async function getFacetsWithEntitiesByProduct(productId: string): Promise<FacetWithEntity[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(competitorProfiles)
    .innerJoin(competitorEntities, eq(competitorProfiles.entityId, competitorEntities.id))
    .where(eq(competitorProfiles.productId, productId))
    .orderBy(competitorEntities.name);

  const parentIds = [...new Set(
    rows.map(r => r.competitor_entities.parentEntityId).filter((v): v is string => v !== null),
  )];
  const parents = parentIds.length > 0
    ? await db.select().from(competitorEntities).where(inArray(competitorEntities.id, parentIds))
    : [];
  const parentById = new Map(parents.map(p => [p.id, p]));

  return rows.map(r => ({
    profile: r.competitor_profiles,
    entity: r.competitor_entities,
    parent: r.competitor_entities.parentEntityId
      ? parentById.get(r.competitor_entities.parentEntityId) ?? null
      : null,
  }));
}

/** One facet joined to entity + company root (detail reads). */
export async function getFacetWithEntityById(id: string): Promise<FacetWithEntity | undefined> {
  const profile = await getCompetitorProfileById(id);
  if (!profile) return undefined;
  const entity = await getCompetitorEntityById(profile.entityId);
  if (!entity) return undefined;
  const parent = entity.parentEntityId
    ? (await getCompetitorEntityById(entity.parentEntityId)) ?? null
    : null;
  return { profile, entity, parent };
}

export async function createCompetitorFacet(insert: FacetInsert): Promise<CompetitorProfile> {
  const db = getDb();
  const [profile] = await db.insert(competitorProfiles).values(insert).returning();
  return profile!;
}

export async function updateCompetitorProfile(
  id: string,
  updateData: Partial<FacetInsert>,
): Promise<CompetitorProfile> {
  const db = getDb();
  const [profile] = await db
    .update(competitorProfiles)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(competitorProfiles.id, id))
    .returning();
  return profile!;
}

export async function deleteCompetitorProfileById(id: string): Promise<void> {
  const db = getDb();
  await db.delete(competitorProfiles).where(eq(competitorProfiles.id, id));
}

/** Number of facets referencing any of the given entity nodes (GC input, §2.3). */
export async function countFacetsForEntities(entityIds: string[]): Promise<number> {
  if (entityIds.length === 0) return 0;
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(competitorProfiles)
    .where(inArray(competitorProfiles.entityId, entityIds));
  return Number(row?.count || 0);
}

/**
 * Entity nodes of an org carrying at least one TRACKED, non-own-product facet
 * — the iteration set for entity-scoped agents (ADR 003 §2.7).
 */
export async function getEntitiesWithTrackedFacets(
  organizationId: string,
): Promise<Array<{ entity: CompetitorEntity; trackedFacets: CompetitorProfile[] }>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(competitorProfiles)
    .innerJoin(competitorEntities, eq(competitorProfiles.entityId, competitorEntities.id))
    .where(and(
      eq(competitorEntities.organizationId, organizationId),
      eq(competitorProfiles.status, "tracked"),
    ))
    .orderBy(competitorEntities.name);

  const byEntity = new Map<string, { entity: CompetitorEntity; trackedFacets: CompetitorProfile[] }>();
  for (const row of rows) {
    if (row.competitor_profiles.sourceCategory === "own_product") continue;
    const existing = byEntity.get(row.competitor_entities.id);
    if (existing) {
      existing.trackedFacets.push(row.competitor_profiles);
    } else {
      byEntity.set(row.competitor_entities.id, {
        entity: row.competitor_entities,
        trackedFacets: [row.competitor_profiles],
      });
    }
  }
  return [...byEntity.values()];
}

// ── Changes (entity-keyed, ADR 003 §2.4) ────────────────────────────────────

/** Most recent change rows for a single entity node (detail view). */
export async function getCompetitorChangesByEntity(
  entityId: string,
  limit: number = 20,
): Promise<CompetitorChange[]> {
  const db = getDb();
  return db
    .select()
    .from(competitorChanges)
    .where(eq(competitorChanges.entityId, entityId))
    .orderBy(desc(competitorChanges.detectedAt))
    .limit(limit);
}

export interface ProductChangeRow extends CompetitorChange {
  /** Entity name resolved through the feed join (attribution). */
  competitorName: string;
}

/**
 * The product-relevant change feed (ADR 003 §2.4): changes of entity nodes
 * for which this product holds a TRACKED facet. The §9 feed-exclusion rule
 * ("never show changes for proposed competitors") is the join predicate, not
 * a name filter. The parent-company changes join (§2.9.3) is additive,
 * post-3a.
 */
export async function getCompetitorChangesForProductPaginated(
  productId: string,
  options: {
    limit: number;
    offset: number;
    daysLimit?: number;
    entityFilter?: string;
    categoryFilter?: "competitor" | "adjacent";
    search?: string;
  },
): Promise<{ changes: ProductChangeRow[]; total: number; hasMore: boolean }> {
  const db = getDb();
  const { limit, offset, daysLimit = 30, entityFilter, categoryFilter, search } = options;

  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - daysLimit);

  const conditions = [
    eq(competitorProfiles.productId, productId),
    eq(competitorProfiles.status, "tracked"),
    gte(competitorChanges.detectedAt, dateLimit),
  ];

  if (entityFilter && entityFilter !== "all") {
    conditions.push(eq(competitorChanges.entityId, entityFilter));
  }

  // Classification is a facet concept (per product) — filter on the joined
  // facet, never on the change row's observing-scan category.
  if (categoryFilter) {
    conditions.push(eq(competitorProfiles.sourceCategory, categoryFilter));
  }

  if (search && search.trim()) {
    const searchLower = `%${search.toLowerCase().trim()}%`;
    conditions.push(
      sql`(LOWER(${competitorChanges.changeTitle}) LIKE ${searchLower} OR LOWER(${competitorChanges.changeDescription}) LIKE ${searchLower} OR LOWER(${competitorEntities.name}) LIKE ${searchLower})`,
    );
  }

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(competitorChanges)
    .innerJoin(competitorProfiles, eq(competitorChanges.entityId, competitorProfiles.entityId))
    .innerJoin(competitorEntities, eq(competitorChanges.entityId, competitorEntities.id))
    .where(and(...conditions));

  const total = Number(countResult?.count || 0);

  const rows = await db
    .select()
    .from(competitorChanges)
    .innerJoin(competitorProfiles, eq(competitorChanges.entityId, competitorProfiles.entityId))
    .innerJoin(competitorEntities, eq(competitorChanges.entityId, competitorEntities.id))
    .where(and(...conditions))
    .orderBy(desc(competitorChanges.detectedAt))
    .limit(limit)
    .offset(offset);

  const changes = rows.map(r => ({
    ...r.competitor_changes,
    competitorName: r.competitor_entities.name,
  }));

  return { changes, total, hasMore: offset + changes.length < total };
}

export async function createCompetitorChange(
  insertChange: InsertCompetitorChange,
): Promise<CompetitorChange> {
  const db = getDb();
  const [change] = await db.insert(competitorChanges).values(insertChange).returning();
  return change!;
}

/** Delete every change row for the given entity nodes (tree GC, §2.3). */
export async function deleteCompetitorChangesByEntities(entityIds: string[]): Promise<void> {
  if (entityIds.length === 0) return;
  const db = getDb();
  await db.delete(competitorChanges).where(inArray(competitorChanges.entityId, entityIds));
}

// ── Intel proposals (ADR 005 §3.3 — the MCP proposal queue) ─────────────────

export async function createIntelProposal(insert: typeof intelProposals.$inferInsert): Promise<IntelProposal> {
  const db = getDb();
  const [proposal] = await db.insert(intelProposals).values(insert).returning();
  return proposal!;
}

export async function getIntelProposalById(id: string): Promise<IntelProposal | undefined> {
  const db = getDb();
  const [proposal] = await db.select().from(intelProposals).where(eq(intelProposals.id, id));
  return proposal || undefined;
}

export async function getIntelProposalsByProduct(
  productId: string,
  status?: string,
): Promise<IntelProposal[]> {
  const db = getDb();
  const conditions = [eq(intelProposals.productId, productId)];
  if (status) conditions.push(eq(intelProposals.status, status));
  return db
    .select()
    .from(intelProposals)
    .where(and(...conditions))
    .orderBy(desc(intelProposals.createdAt));
}

export async function countPendingIntelProposals(productId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(intelProposals)
    .where(and(eq(intelProposals.productId, productId), eq(intelProposals.status, "pending")));
  return Number(row?.count || 0);
}

export async function updateIntelProposal(
  id: string,
  update: Partial<typeof intelProposals.$inferInsert>,
): Promise<IntelProposal> {
  const db = getDb();
  const [proposal] = await db
    .update(intelProposals)
    .set(update)
    .where(eq(intelProposals.id, id))
    .returning();
  return proposal!;
}

// ── Threat level history (unchanged: threat is a facet concept) ─────────────

export async function createCompetitorThreatLevelHistory(
  entry: InsertCompetitorThreatLevelHistory,
): Promise<CompetitorThreatLevelHistory> {
  const db = getDb();
  const [record] = await db.insert(competitorThreatLevelHistory).values(entry).returning();
  return record!;
}

export async function getCompetitorThreatLevelHistory(
  competitorProfileId: string,
): Promise<CompetitorThreatLevelHistory[]> {
  const db = getDb();
  return db
    .select()
    .from(competitorThreatLevelHistory)
    .where(eq(competitorThreatLevelHistory.competitorProfileId, competitorProfileId))
    .orderBy(desc(competitorThreatLevelHistory.changedAt));
}

export async function deleteCompetitorThreatLevelHistoryByProfile(
  competitorProfileId: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(competitorThreatLevelHistory)
    .where(eq(competitorThreatLevelHistory.competitorProfileId, competitorProfileId));
}

export async function getRecentThreatLevelChangesByProduct(
  productId: string,
  daysBack: number,
): Promise<CompetitorThreatLevelHistory[]> {
  const db = getDb();
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(competitorThreatLevelHistory)
    .where(
      and(
        eq(competitorThreatLevelHistory.productId, productId),
        gte(competitorThreatLevelHistory.changedAt, since),
      ),
    )
    .orderBy(desc(competitorThreatLevelHistory.changedAt));
}
