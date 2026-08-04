/**
 * Org-level display preferences (Settings preferences contract) — stored in
 * the organizations.settings jsonb beside the scheduling block, with the
 * same merge-don't-replace discipline: updating preferences never touches
 * scheduling (or any unknown future block), and vice versa.
 *
 * Locale resolution rule (fixed contract): "auto" means the CLIENT resolves
 * the display locale from its environment and may PUT the resolved value
 * back. The SERVER treats a stored "auto" — or nothing stored — as en-GB
 * for its own work, so scheduled agent runs synthesise in British English
 * until a client has stored a concrete resolution.
 *
 * The synthesis-language seam: agents whose output is their OWN prose
 * (theme names/summaries, segment insights, competitor summaries) append
 * `synthesisLanguageInstruction`. Mined verbatims and quoted evidence are
 * never rewritten — the instruction says so explicitly.
 */
import {
  organizationSettingsSchema,
  type DisplayLocale,
  type OrgPreferences,
} from "@shared/schema";
import { getOrganization, updateOrganization } from "../llm/keys.js";

export const DEFAULT_PREFERENCES: OrgPreferences = { displayLocale: "auto" };

function parsePreferences(raw: unknown): OrgPreferences {
  const parsed = organizationSettingsSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data.preferences;
  console.warn("[Settings] Invalid organizations.settings jsonb — using default preferences:", parsed.error.message);
  return { ...DEFAULT_PREFERENCES };
}

export async function getOrgPreferences(organizationId: string): Promise<OrgPreferences> {
  const org = await getOrganization(organizationId);
  return parsePreferences(org?.settings);
}

/** Merge-don't-replace: other settings blocks and unknown keys survive. */
export async function updateOrgPreferences(
  organizationId: string,
  patch: Partial<OrgPreferences>,
): Promise<OrgPreferences> {
  const org = await getOrganization(organizationId);
  const raw = (org?.settings ?? {}) as Record<string, unknown>;
  const current = parsePreferences(raw);
  const next: OrgPreferences = { ...current, ...patch };
  await updateOrganization(organizationId, {
    settings: { ...raw, preferences: next },
  });
  return next;
}

/** The server-side resolution of "auto" (see the module comment). */
export function resolveSynthesisLocale(displayLocale: DisplayLocale): "en-GB" | "en-US" {
  return displayLocale === "en-US" ? "en-US" : "en-GB";
}

/**
 * The one-line language instruction synthesis prompts append. Only the
 * agent's own prose changes with locale — quoted evidence is untouchable.
 */
export function synthesisLanguageInstruction(locale: "en-GB" | "en-US"): string {
  const language = locale === "en-US" ? "American English" : "British English";
  return `LANGUAGE: Write your own synthesised prose (names, summaries, descriptions, analysis) in ${language}. Never rewrite, translate or respell quoted customer or source text — quote it exactly as given.`;
}

/** Convenience for agents: stored locale → resolved instruction, one read. */
export async function getSynthesisLanguageInstruction(organizationId: string): Promise<string> {
  if (!organizationId) {
    return synthesisLanguageInstruction("en-GB");
  }
  try {
    const preferences = await getOrgPreferences(organizationId);
    return synthesisLanguageInstruction(resolveSynthesisLocale(preferences.displayLocale));
  } catch (err) {
    // A preferences read failure must never take an agent run down.
    console.error("[Settings] Could not read display preferences — defaulting to British English:", err instanceof Error ? err.message : err);
    return synthesisLanguageInstruction("en-GB");
  }
}
