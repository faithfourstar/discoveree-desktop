/**
 * Carved customers storage (ADR 004 §5, verbatim SaaS bodies re-keyed to the
 * ADR 003 entity/facet shapes; storage.ts line refs in doc comments).
 * Functions take organizationId/productId explicitly — never import the seed
 * constants here.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  customerSegmentProfiles,
  deletedCustomerSegmentNames,
  feedbackEntries,
  feedbackSources,
  feedbackThemes,
  personaFacets,
  personas,
  segmentEntities,
  type CustomerSegmentProfile,
  type FeedbackEntry,
  type FeedbackSource,
  type FeedbackTheme,
  type Persona,
  type PersonaFacet,
  type SegmentEntity,
} from "@shared/schema";
import { getDb } from "../../db/index.js";
import { normalizeSegmentName } from "./normalization.js";

type SegmentEntityInsert = typeof segmentEntities.$inferInsert;
type SegmentFacetInsert = typeof customerSegmentProfiles.$inferInsert;
type PersonaInsert = typeof personas.$inferInsert;
type PersonaFacetInsert = typeof personaFacets.$inferInsert;
type FeedbackEntryInsert = typeof feedbackEntries.$inferInsert;
type FeedbackThemeInsert = typeof feedbackThemes.$inferInsert;
type FeedbackSourceInsert = typeof feedbackSources.$inferInsert;

export interface SegmentFacetWithEntity {
  facet: CustomerSegmentProfile;
  entity: SegmentEntity;
}

// ── Segment entities (org vocabulary, ADR 003 §2.6) ─────────────────────────

export async function getSegmentEntityById(id: string): Promise<SegmentEntity | undefined> {
  const db = getDb();
  const [entity] = await db.select().from(segmentEntities).where(eq(segmentEntities.id, id));
  return entity || undefined;
}

export async function getSegmentEntitiesByOrganization(organizationId: string): Promise<SegmentEntity[]> {
  const db = getDb();
  return db
    .select()
    .from(segmentEntities)
    .where(eq(segmentEntities.organizationId, organizationId))
    .orderBy(segmentEntities.name);
}

/** Entity dedup lookup via the ported normaliser (storage.ts:4138 re-keyed). */
export async function findSegmentEntityByNormalizedName(
  organizationId: string,
  normalizedName: string,
): Promise<SegmentEntity | undefined> {
  const db = getDb();
  const [entity] = await db
    .select()
    .from(segmentEntities)
    .where(and(
      eq(segmentEntities.organizationId, organizationId),
      eq(segmentEntities.normalizedName, normalizedName),
    ));
  return entity || undefined;
}

export async function createSegmentEntity(insert: SegmentEntityInsert): Promise<SegmentEntity> {
  const db = getDb();
  const [entity] = await db.insert(segmentEntities).values(insert).returning();
  return entity!;
}

export async function updateSegmentEntity(id: string, update: Partial<SegmentEntityInsert>): Promise<SegmentEntity> {
  const db = getDb();
  const [entity] = await db
    .update(segmentEntities)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(segmentEntities.id, id))
    .returning();
  return entity!;
}

export async function deleteSegmentEntityById(id: string): Promise<void> {
  const db = getDb();
  await db.delete(segmentEntities).where(eq(segmentEntities.id, id));
}

// ── Segment facets (customer_segment_profiles) ──────────────────────────────

export async function getSegmentFacetById(id: string): Promise<CustomerSegmentProfile | undefined> {
  const db = getDb();
  const [facet] = await db.select().from(customerSegmentProfiles).where(eq(customerSegmentProfiles.id, id));
  return facet || undefined;
}

export async function getSegmentFacetByProductAndEntity(
  productId: string,
  segmentEntityId: string,
): Promise<CustomerSegmentProfile | undefined> {
  const db = getDb();
  const [facet] = await db
    .select()
    .from(customerSegmentProfiles)
    .where(and(
      eq(customerSegmentProfiles.productId, productId),
      eq(customerSegmentProfiles.segmentEntityId, segmentEntityId),
    ));
  return facet || undefined;
}

export async function getSegmentFacetsWithEntitiesByProduct(productId: string): Promise<SegmentFacetWithEntity[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(customerSegmentProfiles)
    .innerJoin(segmentEntities, eq(customerSegmentProfiles.segmentEntityId, segmentEntities.id))
    .where(eq(customerSegmentProfiles.productId, productId))
    .orderBy(segmentEntities.name);
  return rows.map(r => ({ facet: r.customer_segment_profiles, entity: r.segment_entities }));
}

export async function getSegmentFacetsByEntity(segmentEntityId: string): Promise<CustomerSegmentProfile[]> {
  const db = getDb();
  return db
    .select()
    .from(customerSegmentProfiles)
    .where(eq(customerSegmentProfiles.segmentEntityId, segmentEntityId));
}

export async function createSegmentFacet(insert: SegmentFacetInsert): Promise<CustomerSegmentProfile> {
  const db = getDb();
  const [facet] = await db.insert(customerSegmentProfiles).values(insert).returning();
  return facet!;
}

export async function updateSegmentFacet(
  id: string,
  update: Partial<SegmentFacetInsert>,
): Promise<CustomerSegmentProfile> {
  const db = getDb();
  const [facet] = await db
    .update(customerSegmentProfiles)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(customerSegmentProfiles.id, id))
    .returning();
  return facet!;
}

export async function deleteSegmentFacetById(id: string): Promise<void> {
  const db = getDb();
  await db.delete(customerSegmentProfiles).where(eq(customerSegmentProfiles.id, id));
}

// ── Deleted-segment blocklist (product-scoped, ADR 003 §2.6) ────────────────

/** storage.ts:4340 (drizzle instead of raw pool). */
export async function recordDeletedSegmentName(productId: string, originalName: string): Promise<void> {
  const db = getDb();
  const normalized = normalizeSegmentName(originalName);
  await db
    .insert(deletedCustomerSegmentNames)
    .values({ productId, normalizedName: normalized, originalName })
    .onConflictDoUpdate({
      target: [deletedCustomerSegmentNames.productId, deletedCustomerSegmentNames.normalizedName],
      set: { originalName, deletedAt: new Date() },
    });
}

export async function isSegmentNameBlocked(productId: string, name: string): Promise<boolean> {
  const db = getDb();
  const normalized = normalizeSegmentName(name);
  const [row] = await db
    .select({ id: deletedCustomerSegmentNames.id })
    .from(deletedCustomerSegmentNames)
    .where(and(
      eq(deletedCustomerSegmentNames.productId, productId),
      eq(deletedCustomerSegmentNames.normalizedName, normalized),
    ))
    .limit(1);
  return !!row;
}

/** storage.ts:4350 */
export async function getBlockedSegmentsForProduct(productId: string) {
  const db = getDb();
  return db
    .select()
    .from(deletedCustomerSegmentNames)
    .where(eq(deletedCustomerSegmentNames.productId, productId))
    .orderBy(desc(deletedCustomerSegmentNames.deletedAt));
}

/** storage.ts:4363 */
export async function unblockSegment(id: number): Promise<void> {
  const db = getDb();
  await db.delete(deletedCustomerSegmentNames).where(eq(deletedCustomerSegmentNames.id, id));
}

export async function unblockSegmentName(productId: string, name: string): Promise<void> {
  const db = getDb();
  await db.delete(deletedCustomerSegmentNames).where(and(
    eq(deletedCustomerSegmentNames.productId, productId),
    eq(deletedCustomerSegmentNames.normalizedName, normalizeSegmentName(name)),
  ));
}

// ── Personas (org identity) + facets (per product) ──────────────────────────

export async function getPersonaById(id: string): Promise<Persona | undefined> {
  const db = getDb();
  const [persona] = await db.select().from(personas).where(eq(personas.id, id));
  return persona || undefined;
}

/** storage.ts:4374, re-keyed segmentEntityId. */
export async function getPersonasBySegmentEntity(segmentEntityId: string): Promise<Persona[]> {
  const db = getDb();
  return db
    .select()
    .from(personas)
    .where(eq(personas.segmentEntityId, segmentEntityId))
    .orderBy(personas.sortOrder);
}

export async function createPersona(insert: PersonaInsert): Promise<Persona> {
  const db = getDb();
  const [persona] = await db.insert(personas).values(insert).returning();
  return persona!;
}

export async function updatePersona(id: string, update: Partial<PersonaInsert>): Promise<Persona> {
  const db = getDb();
  const [persona] = await db
    .update(personas)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(personas.id, id))
    .returning();
  return persona!;
}

export async function deletePersonaById(id: string): Promise<void> {
  const db = getDb();
  await db.delete(personas).where(eq(personas.id, id));
}

export async function getPersonaFacet(personaId: string, productId: string): Promise<PersonaFacet | undefined> {
  const db = getDb();
  const [facet] = await db
    .select()
    .from(personaFacets)
    .where(and(eq(personaFacets.personaId, personaId), eq(personaFacets.productId, productId)));
  return facet || undefined;
}

export async function getPersonaFacetsByPersona(personaId: string): Promise<PersonaFacet[]> {
  const db = getDb();
  return db.select().from(personaFacets).where(eq(personaFacets.personaId, personaId));
}

export async function createPersonaFacet(insert: PersonaFacetInsert): Promise<PersonaFacet> {
  const db = getDb();
  const [facet] = await db.insert(personaFacets).values(insert).returning();
  return facet!;
}

export async function updatePersonaFacet(id: string, update: Partial<PersonaFacetInsert>): Promise<PersonaFacet> {
  const db = getDb();
  const [facet] = await db
    .update(personaFacets)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(personaFacets.id, id))
    .returning();
  return facet!;
}

export async function deletePersonaFacetById(id: string): Promise<void> {
  const db = getDb();
  await db.delete(personaFacets).where(eq(personaFacets.id, id));
}

/**
 * Personas of a segment entity WITH this product's facet — a persona with no
 * facet for the product is not part of that product's context (ADR 003 §2.6).
 */
export async function getPersonasWithFacetsForProduct(
  segmentEntityId: string,
  productId: string,
): Promise<Array<{ persona: Persona; facet: PersonaFacet }>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(personas)
    .innerJoin(personaFacets, and(
      eq(personaFacets.personaId, personas.id),
      eq(personaFacets.productId, productId),
    ))
    .where(eq(personas.segmentEntityId, segmentEntityId))
    .orderBy(personas.sortOrder);
  return rows.map(r => ({ persona: r.personas, facet: r.persona_facets }));
}

// ── Feedback entries (storage.ts:2956–3068, re-keyed) ───────────────────────

export async function getFeedbackEntriesByProduct(
  productId: string,
  options?: {
    isCompetitor?: boolean;
    competitorEntityId?: string;
    topic?: string;
    sourceName?: string;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<FeedbackEntry[]> {
  const db = getDb();
  const conditions = [eq(feedbackEntries.productId, productId)];

  if (options?.isCompetitor !== undefined) {
    conditions.push(eq(feedbackEntries.isCompetitor, options.isCompetitor));
  }
  if (options?.competitorEntityId) {
    conditions.push(eq(feedbackEntries.competitorEntityId, options.competitorEntityId));
  }
  if (options?.topic) {
    conditions.push(eq(feedbackEntries.topic, options.topic));
  }
  if (options?.sourceName) {
    conditions.push(eq(feedbackEntries.sourceName, options.sourceName));
  }
  if (!options?.includeArchived) {
    conditions.push(sql`${feedbackEntries.archivedAt} IS NULL`);
  }

  const q = db
    .select()
    .from(feedbackEntries)
    .where(and(...conditions))
    .orderBy(desc(feedbackEntries.collectedAt));

  if (typeof options?.limit === "number") {
    return q.limit(options.limit).offset(options.offset ?? 0);
  }
  return q;
}

export async function countFeedbackEntriesByProduct(productId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(feedbackEntries)
    .where(and(eq(feedbackEntries.productId, productId), sql`${feedbackEntries.archivedAt} IS NULL`));
  return Number(row?.count || 0);
}

export async function getFeedbackEntryById(id: string): Promise<FeedbackEntry | undefined> {
  const db = getDb();
  const [entry] = await db.select().from(feedbackEntries).where(eq(feedbackEntries.id, id));
  return entry || undefined;
}

export async function createFeedbackEntry(insert: FeedbackEntryInsert): Promise<FeedbackEntry> {
  const db = getDb();
  const [entry] = await db.insert(feedbackEntries).values(insert).returning();
  return entry!;
}

export async function updateFeedbackEntry(id: string, update: Partial<FeedbackEntryInsert>): Promise<FeedbackEntry> {
  const db = getDb();
  const [entry] = await db
    .update(feedbackEntries)
    .set(update)
    .where(eq(feedbackEntries.id, id))
    .returning();
  return entry!;
}

export async function deleteFeedbackEntry(id: string): Promise<void> {
  const db = getDb();
  await db.delete(feedbackEntries).where(eq(feedbackEntries.id, id));
}

// ── Feedback themes (storage.ts:3071–3143, competitor columns dropped) ──────

export async function getFeedbackThemesByProduct(productId: string): Promise<FeedbackTheme[]> {
  const db = getDb();
  return db
    .select()
    .from(feedbackThemes)
    .where(eq(feedbackThemes.productId, productId))
    .orderBy(desc(feedbackThemes.mentionCount));
}

export async function getFeedbackThemeById(id: string): Promise<FeedbackTheme | undefined> {
  const db = getDb();
  const [theme] = await db.select().from(feedbackThemes).where(eq(feedbackThemes.id, id));
  return theme || undefined;
}

export async function createFeedbackTheme(insert: FeedbackThemeInsert): Promise<FeedbackTheme> {
  const db = getDb();
  const [theme] = await db.insert(feedbackThemes).values(insert).returning();
  return theme!;
}

export async function updateFeedbackTheme(id: string, update: Partial<FeedbackThemeInsert>): Promise<FeedbackTheme> {
  const db = getDb();
  const [theme] = await db
    .update(feedbackThemes)
    .set({ ...update, lastUpdatedAt: new Date() })
    .where(eq(feedbackThemes.id, id))
    .returning();
  return theme!;
}

export async function deleteFeedbackTheme(id: string): Promise<void> {
  const db = getDb();
  await db.delete(feedbackThemes).where(eq(feedbackThemes.id, id));
}

// ── Feedback sources (storage.ts:3796–3843) ─────────────────────────────────

export async function getFeedbackSourcesByProduct(productId: string): Promise<FeedbackSource[]> {
  const db = getDb();
  return db
    .select()
    .from(feedbackSources)
    .where(eq(feedbackSources.productId, productId))
    .orderBy(feedbackSources.name);
}

export async function getFeedbackSourceById(id: string): Promise<FeedbackSource | undefined> {
  const db = getDb();
  const [source] = await db.select().from(feedbackSources).where(eq(feedbackSources.id, id));
  return source || undefined;
}

export async function createFeedbackSource(insert: FeedbackSourceInsert): Promise<FeedbackSource> {
  const db = getDb();
  const [source] = await db.insert(feedbackSources).values(insert).returning();
  return source!;
}

export async function deleteFeedbackSource(id: string): Promise<void> {
  const db = getDb();
  await db.delete(feedbackSources).where(eq(feedbackSources.id, id));
}

// ── Unfiled derivation (§3.6.1 step 1 — no column) ──────────────────────────

/**
 * Active, own-product entries referenced by NO theme's feedbackEntryIds.
 * Newest-first (per effective ordering by collectedAt; the run cap is applied
 * by the caller).
 */
export async function getUnfiledFeedbackEntries(productId: string): Promise<FeedbackEntry[]> {
  const entries = await getFeedbackEntriesByProduct(productId, { isCompetitor: false });
  const themes = await getFeedbackThemesByProduct(productId);
  const filed = new Set<string>();
  for (const theme of themes) {
    for (const id of (theme.feedbackEntryIds as string[] | null) ?? []) filed.add(id);
  }
  return entries.filter(e => !filed.has(e.id));
}

/** Batch-load entries by id (evidence verification, stat recomputation). */
export async function getFeedbackEntriesByIds(ids: string[]): Promise<FeedbackEntry[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  return db.select().from(feedbackEntries).where(inArray(feedbackEntries.id, ids));
}
