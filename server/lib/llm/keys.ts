/**
 * Org LLM key access (ADR 002 §4).
 *
 * Desktop is BYO-keys by definition (`useOwnLlmKeys` is seeded true): keys
 * live in the encrypted columns on the local organisation row. The SaaS
 * platform-key fallbacks (process.env.* lookups) are DELETED, not disabled —
 * no platform-key path is reachable on desktop.
 */
import { eq } from "drizzle-orm";
import { organizations, type Organization } from "@shared/schema";
import { getDb } from "../../db/index.js";
import { decrypt } from "../secrets.js";

/** Verbatim carve of DatabaseStorage.getOrganization (storage.ts:904). */
export async function getOrganization(id: string): Promise<Organization | undefined> {
  const db = getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
  return org || undefined;
}

export async function updateOrganization(
  id: string,
  updateData: Partial<typeof organizations.$inferInsert>,
): Promise<Organization | undefined> {
  const db = getDb();
  const [org] = await db
    .update(organizations)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(organizations.id, id))
    .returning();
  return org || undefined;
}

function safeDecrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const decrypted = decrypt(value);
    return decrypted || null;
  } catch (error) {
    console.error("[LLM Keys] Failed to decrypt a stored key:", error);
    return null;
  }
}

export async function getOpenAIApiKey(organizationId: string): Promise<string | null> {
  const org = await getOrganization(organizationId);
  return safeDecrypt(org?.openaiApiKey);
}

export async function getGeminiApiKey(organizationId: string): Promise<string | null> {
  const org = await getOrganization(organizationId);
  return safeDecrypt(org?.geminiApiKey);
}

export async function getPerplexityApiKey(organizationId: string): Promise<string | null> {
  const org = await getOrganization(organizationId);
  return safeDecrypt(org?.perplexityApiKey);
}

export async function getClaudeApiKey(organizationId: string): Promise<string | null> {
  const org = await getOrganization(organizationId);
  return safeDecrypt(org?.claudeApiKey);
}

export async function getOpenRouterApiKey(organizationId: string): Promise<string | null> {
  const org = await getOrganization(organizationId);
  return safeDecrypt(org?.openrouterApiKey);
}

/** Decrypted view of every stored key + key mode, for provider availability checks. */
export interface DecryptedOrgKeys {
  gemini: string;
  openai: string;
  perplexity: string;
  claude: string;
  openrouter: string;
  llmKeyMode: "individual" | "openrouter";
}

export async function getDecryptedOrgKeys(organizationId: string): Promise<DecryptedOrgKeys> {
  const org = await getOrganization(organizationId);
  return {
    gemini: safeDecrypt(org?.geminiApiKey) || "",
    openai: safeDecrypt(org?.openaiApiKey) || "",
    perplexity: safeDecrypt(org?.perplexityApiKey) || "",
    claude: safeDecrypt(org?.claudeApiKey) || "",
    openrouter: safeDecrypt(org?.openrouterApiKey) || "",
    llmKeyMode: (org?.llmKeyMode === "openrouter" ? "openrouter" : "individual"),
  };
}
