/**
 * Org-level agent scheduling settings (Settings spec §3, agent-schedules
 * block). Storage decision: a `settings` jsonb column on organizations —
 * NOT the products.agentSchedules jsonb the SaaS port uses per product —
 * because the Settings contract is org-level, pause-all is org-global, and
 * new products must inherit the org's choices without a fan-out write.
 *
 * Precedence when the scheduler resolves an effective schedule:
 *   org frequency override (this module) → product agentSchedules jsonb →
 *   audience-aware default.
 *
 * The contract's frequency vocabulary ("daily" | "every-3-days" | "weekly" |
 * "fortnightly" | "off") is coarser than AgentSchedule; the two mappers here
 * are the single translation point.
 */
import {
  organizationSettingsSchema,
  type AgentSchedule,
  type OrganizationSettings,
  type OrgSchedulingSettings,
  type ScheduleFrequency,
} from "@shared/schema";
import { getOrganization, updateOrganization } from "../llm/keys.js";

export const DEFAULT_SCHEDULING_SETTINGS: OrgSchedulingSettings = {
  pausedAll: false,
  frequencies: {},
};

/** Days per contract frequency (the "off" member carries no cadence). */
const FREQUENCY_DAYS: Record<Exclude<ScheduleFrequency, "off">, number> = {
  "daily": 1,
  "every-3-days": 3,
  "weekly": 7,
  "fortnightly": 14,
  "monthly": 30,
};

/**
 * Parse the org's settings jsonb, tolerating absent/invalid content (a bad
 * write must never take the scheduler down — defaults mean "run normally").
 */
function parseSettings(raw: unknown): OrganizationSettings {
  const parsed = organizationSettingsSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  console.warn("[Settings] Invalid organizations.settings jsonb — using defaults:", parsed.error.message);
  return organizationSettingsSchema.parse({});
}

export async function getOrgSchedulingSettings(
  organizationId: string,
): Promise<OrgSchedulingSettings> {
  const org = await getOrganization(organizationId);
  return parseSettings(org?.settings).scheduling;
}

export interface SchedulingSettingsPatch {
  pausedAll?: boolean;
  /** Merged per key — omitted slugs keep their stored override. */
  frequencies?: Record<string, ScheduleFrequency>;
}

/**
 * Merge-don't-replace update: unknown top-level keys in the jsonb survive
 * (future settings blocks), and frequency overrides merge per slug.
 */
export async function updateOrgSchedulingSettings(
  organizationId: string,
  patch: SchedulingSettingsPatch,
): Promise<OrgSchedulingSettings> {
  const org = await getOrganization(organizationId);
  const raw = (org?.settings ?? {}) as Record<string, unknown>;
  const current = parseSettings(raw).scheduling;

  const next: OrgSchedulingSettings = {
    pausedAll: patch.pausedAll ?? current.pausedAll,
    frequencies: { ...current.frequencies, ...(patch.frequencies ?? {}) },
  };

  await updateOrganization(organizationId, {
    settings: { ...raw, scheduling: next },
  });
  return next;
}

/**
 * Apply an org frequency override onto a resolved base schedule. "off"
 * disables; a cadence enables and replaces the interval, keeping the base
 * timeOfDay so the tick window is unchanged.
 */
export function applyFrequencyOverride(
  schedule: AgentSchedule,
  override: ScheduleFrequency | undefined,
): AgentSchedule {
  if (!override) return schedule;
  if (override === "off") return { ...schedule, enabled: false };
  return {
    ...schedule,
    enabled: true,
    frequencyValue: FREQUENCY_DAYS[override],
    frequencyUnit: "days",
  };
}

/**
 * Display mapping for the GET view: snap an AgentSchedule to the nearest
 * contract frequency. 30-day audience defaults (B2B Corporate / Government)
 * snap to "monthly", matching the spec's §3.3 vocabulary.
 */
export function scheduleToFrequency(schedule: AgentSchedule): ScheduleFrequency {
  if (!schedule.enabled) return "off";
  const days = schedule.frequencyUnit === "days"
    ? schedule.frequencyValue
    : schedule.frequencyValue / 24;
  if (days <= 1) return "daily";
  if (days <= 3) return "every-3-days";
  if (days <= 7) return "weekly";
  if (days <= 14) return "fortnightly";
  return "monthly";
}
