/**
 * First-run seed for desktop solo mode (ADR 001 §4).
 *
 * Tenancy columns survive on every table so team mode shares the schema;
 * desktop simply only ever has one organisation to scope by. This seeds
 * exactly one organisation ("Local workspace"), one user (filled in properly
 * by onboarding), and one membership — with FIXED ids so every install is
 * identical and the solo→team upgrade is a mechanical id remap.
 *
 * Idempotent: safe to run on every launch.
 */
import { organizations, organizationUsers, users } from "@shared/schema";
import type { Db } from "./types.js";

export const LOCAL_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000002";
export const LOCAL_MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000003";

export const LOCAL_ORGANIZATION_NAME = "Local workspace";
export const LOCAL_ORGANIZATION_SLUG = "local-workspace";
/** Placeholder until onboarding captures the real user. */
export const LOCAL_USER_EMAIL = "you@localhost";
export const LOCAL_USER_NAME = "Local user";

export async function seedLocalData(db: Db): Promise<void> {
  await db
    .insert(organizations)
    .values({
      id: LOCAL_ORGANIZATION_ID,
      name: LOCAL_ORGANIZATION_NAME,
      slug: LOCAL_ORGANIZATION_SLUG,
      useOwnLlmKeys: true,
    })
    .onConflictDoNothing();

  await db
    .insert(users)
    .values({
      id: LOCAL_USER_ID,
      email: LOCAL_USER_EMAIL,
      name: LOCAL_USER_NAME,
    })
    .onConflictDoNothing();

  await db
    .insert(organizationUsers)
    .values({
      id: LOCAL_MEMBERSHIP_ID,
      organizationId: LOCAL_ORGANIZATION_ID,
      userId: LOCAL_USER_ID,
      role: "Leader",
      isAdmin: true,
      seatType: "pro",
    })
    .onConflictDoNothing();
}
