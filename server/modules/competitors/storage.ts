/**
 * Carved competitor storage (ADR 002 §3).
 *
 * Plain exported async functions whose bodies are copied verbatim from the
 * corresponding SaaS `DatabaseStorage` methods (storage.ts line refs in each
 * doc comment). Functions take organizationId/productId explicitly — never
 * import the seed constants here (only http/identity.ts and tests may).
 *
 * `competitor_profiles` is CANONICAL on desktop (ADR 002 §3): the
 * `products.competitors` jsonb is never written by this module.
 */
import { and, desc, eq, gte, notInArray, sql } from "drizzle-orm";
import {
  competitorChanges,
  competitorProfiles,
  competitorThreatLevelHistory,
  type CompetitorChange,
  type CompetitorProfile,
  type CompetitorThreatLevelHistory,
  type InsertCompetitorChange,
  type InsertCompetitorProfile,
  type InsertCompetitorThreatLevelHistory,
} from "@shared/schema";
import { getDb } from "../../db/index.js";

// ── Profiles ────────────────────────────────────────────────────────────────

/** NEW (stable-ID surface, ADR 002 §6): fetch one profile by primary key. */
export async function getCompetitorProfileById(id: string): Promise<CompetitorProfile | undefined> {
  const db = getDb();
  const [profile] = await db.select().from(competitorProfiles).where(eq(competitorProfiles.id, id));
  return profile || undefined;
}

/** storage.ts:2214 */
export async function getCompetitorProfile(
  productId: string,
  competitorName: string,
): Promise<CompetitorProfile | undefined> {
  const db = getDb();
  const [profile] = await db
    .select()
    .from(competitorProfiles)
    .where(
      and(
        eq(competitorProfiles.productId, productId),
        eq(competitorProfiles.competitorName, competitorName),
      ),
    );
  return profile || undefined;
}

/** storage.ts:2227 */
export async function getCompetitorProfilesByProduct(productId: string): Promise<CompetitorProfile[]> {
  const db = getDb();
  return db
    .select()
    .from(competitorProfiles)
    .where(eq(competitorProfiles.productId, productId))
    .orderBy(competitorProfiles.competitorName);
}

/**
 * storage.ts:2235 — "merge, don't replace": strips fields that are null,
 * undefined, or empty arrays so that a failed or partial agent run never
 * wipes data that was already there.
 */
export async function upsertCompetitorProfile(
  insertProfile: InsertCompetitorProfile,
): Promise<CompetitorProfile> {
  const db = getDb();
  // Check if profile exists
  const existing = await getCompetitorProfile(insertProfile.productId, insertProfile.competitorName);

  if (existing) {
    // "Merge, don't replace": strip any fields that are null, undefined, or empty arrays
    // so that a failed or partial agent run never wipes data that was already there.
    const safeUpdate: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(insertProfile)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      safeUpdate[key] = value;
    }
    const [profile] = await db
      .update(competitorProfiles)
      .set(safeUpdate)
      .where(eq(competitorProfiles.id, existing.id))
      .returning();
    return profile!;
  } else {
    // Create new profile
    const [profile] = await db.insert(competitorProfiles).values(insertProfile).returning();
    return profile!;
  }
}

/** storage.ts:2261 */
export async function updateCompetitorProfile(
  id: string,
  updateData: Partial<InsertCompetitorProfile>,
): Promise<CompetitorProfile> {
  const db = getDb();
  const [profile] = await db
    .update(competitorProfiles)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(competitorProfiles.id, id))
    .returning();
  return profile!;
}

/**
 * NEW (spec 2.4 inline-rename): rename a PROPOSED competitor and carry its
 * name-keyed rows along in the SAME transaction — `competitor_changes` has no
 * profile FK, so a rename outside the transaction would orphan the draft
 * changes from the discard-purge and the changes-feed exclusion. Threat-level
 * history (also name-carrying, though profile-FK'd) is renamed for
 * consistency. The route enforces the proposed-only rule; this function just
 * performs the atomic rename.
 */
export async function renameCompetitorProfile(
  profileId: string,
  productId: string,
  oldName: string,
  newName: string,
): Promise<CompetitorProfile> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .update(competitorProfiles)
      .set({ competitorName: newName, updatedAt: new Date() })
      .where(eq(competitorProfiles.id, profileId))
      .returning();
    await tx
      .update(competitorChanges)
      .set({ competitorName: newName })
      .where(and(
        eq(competitorChanges.productId, productId),
        eq(competitorChanges.competitorName, oldName),
      ));
    await tx
      .update(competitorThreatLevelHistory)
      .set({ competitorName: newName })
      .where(eq(competitorThreatLevelHistory.competitorProfileId, profileId));
    return profile!;
  });
}

/**
 * storage.ts:2274, adapted to the stable-ID surface: the SaaS deleted by
 * (productId, competitorName); profile-canonical desktop deletes by id.
 */
export async function deleteCompetitorProfileById(id: string): Promise<void> {
  const db = getDb();
  await db.delete(competitorProfiles).where(eq(competitorProfiles.id, id));
}

// ── Changes ─────────────────────────────────────────────────────────────────

/** storage.ts:2127 */
export async function getCompetitorChangesByProduct(
  productId: string,
  limit: number = 20,
): Promise<CompetitorChange[]> {
  const db = getDb();
  return db
    .select()
    .from(competitorChanges)
    .where(eq(competitorChanges.productId, productId))
    .orderBy(desc(competitorChanges.detectedAt))
    .limit(limit);
}

/** NEW (detail view): most recent changes for a single competitor name. */
export async function getCompetitorChangesByProductAndName(
  productId: string,
  competitorName: string,
  limit: number = 20,
): Promise<CompetitorChange[]> {
  const db = getDb();
  return db
    .select()
    .from(competitorChanges)
    .where(and(
      eq(competitorChanges.productId, productId),
      eq(competitorChanges.competitorName, competitorName),
    ))
    .orderBy(desc(competitorChanges.detectedAt))
    .limit(limit);
}

/**
 * storage.ts:2136, verbatim body except the pagination input: the desktop API
 * (§6) is limit/offset, so `offset` is taken directly instead of being
 * computed from a page number.
 */
export async function getCompetitorChangesByProductPaginated(
  productId: string,
  options: { limit: number; offset: number; daysLimit?: number; competitorFilter?: string; categoryFilter?: "competitor" | "adjacent"; search?: string; excludeCompetitorNames?: string[] },
): Promise<{ changes: CompetitorChange[]; total: number; hasMore: boolean }> {
  const db = getDb();
  const { limit, offset, daysLimit = 30, competitorFilter, categoryFilter, search, excludeCompetitorNames } = options;

  // Calculate date limit
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - daysLimit);

  // Build conditions
  const conditions = [
    eq(competitorChanges.productId, productId),
    gte(competitorChanges.detectedAt, dateLimit),
  ];

  // NEW (spec 2.4 gate): exclude changes belonging to proposed competitors —
  // the feed must never surface a competitor the user has not accepted.
  // Changes carry competitorName (no profile FK), so exclusion is by name.
  if (excludeCompetitorNames && excludeCompetitorNames.length > 0) {
    conditions.push(notInArray(competitorChanges.competitorName, excludeCompetitorNames));
  }

  // Filter by specific competitor name
  if (competitorFilter && competitorFilter !== "all") {
    conditions.push(eq(competitorChanges.competitorName, competitorFilter));
  }

  // Filter by category (competitor or adjacent)
  if (categoryFilter) {
    conditions.push(eq(competitorChanges.sourceCategory, categoryFilter));
  }

  // Add search filter for title and description
  if (search && search.trim()) {
    const searchLower = `%${search.toLowerCase().trim()}%`;
    conditions.push(
      sql`(LOWER(${competitorChanges.changeTitle}) LIKE ${searchLower} OR LOWER(${competitorChanges.changeDescription}) LIKE ${searchLower} OR LOWER(${competitorChanges.competitorName}) LIKE ${searchLower})`,
    );
  }

  // Get total count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(competitorChanges)
    .where(and(...conditions));

  const total = Number(countResult?.count || 0);

  // Get paginated results
  const changes = await db
    .select()
    .from(competitorChanges)
    .where(and(...conditions))
    .orderBy(desc(competitorChanges.detectedAt))
    .limit(limit)
    .offset(offset);

  return {
    changes,
    total,
    hasMore: offset + changes.length < total,
  };
}

/** storage.ts:2195 */
export async function createCompetitorChange(
  insertChange: InsertCompetitorChange,
): Promise<CompetitorChange> {
  const db = getDb();
  const [change] = await db.insert(competitorChanges).values(insertChange).returning();
  return change!;
}

/** storage.ts:2209 */
export async function deleteCompetitorChangesByProduct(productId: string): Promise<void> {
  const db = getDb();
  await db.delete(competitorChanges).where(eq(competitorChanges.productId, productId));
}

/**
 * NEW (spec 2.4 gate): discard the draft change rows of a proposed competitor.
 * A proposal that was never accepted leaves no history — only the
 * DELETE-proposed path may call this; tracked deletes keep their changes.
 */
export async function deleteCompetitorChangesByProductAndName(
  productId: string,
  competitorName: string,
): Promise<void> {
  const db = getDb();
  await db.delete(competitorChanges).where(and(
    eq(competitorChanges.productId, productId),
    eq(competitorChanges.competitorName, competitorName),
  ));
}

// ── Threat level history ────────────────────────────────────────────────────

/** storage.ts:2417 */
export async function createCompetitorThreatLevelHistory(
  entry: InsertCompetitorThreatLevelHistory,
): Promise<CompetitorThreatLevelHistory> {
  const db = getDb();
  const [record] = await db.insert(competitorThreatLevelHistory).values(entry).returning();
  return record!;
}

/** storage.ts:2422 */
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

/**
 * NEW (spec 2.4 gate): remove threat-level history for a discarded proposal —
 * pairs with deleteCompetitorChangesByProductAndName so a never-accepted
 * proposal leaves no rows behind.
 */
export async function deleteCompetitorThreatLevelHistoryByProfile(
  competitorProfileId: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(competitorThreatLevelHistory)
    .where(eq(competitorThreatLevelHistory.competitorProfileId, competitorProfileId));
}

/** storage.ts:2430 */
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
