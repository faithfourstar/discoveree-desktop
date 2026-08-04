/**
 * Agent-schedules settings surface (Settings spec §3, fixed API contract):
 *
 *   GET /api/settings/agent-schedules → { pausedAll, agents: [...] }
 *   PUT /api/settings/agent-schedules → same shape (round-trip)
 *
 * Rows come from the scheduler registry (product + entity kinds), presented
 * with audience names (§3.2: "named by the job, never the slug"). Frequency
 * shown/stored uses the contract vocabulary; persistence is the org-level
 * settings jsonb (lib/settings/agentScheduling.ts states the storage choice).
 *
 * lastRunAt comes from ai_agent_executions (newest run in any scope);
 * nextRunAt derives from the effective frequency gate + last run, clamped to
 * now when overdue (an overdue agent's next run is the next tick). timeOfDay
 * is deliberately NOT folded in — the contract derives from the frequency
 * gate only.
 */
import type { AgentSchedule, Product, ScheduleFrequency } from "@shared/schema";
import { getLastExecutionForAgent } from "../../lib/agents/executions.js";
import { getAiAgentBySlug } from "../../lib/agents/registry.js";
import { AgentSlugs } from "../../lib/agents/slugs.js";
import {
  applyFrequencyOverride,
  getOrgSchedulingSettings,
  scheduleToFrequency,
  updateOrgSchedulingSettings,
} from "../../lib/settings/agentScheduling.js";
import { BadRequestError } from "../../http/errors.js";
import { computeDefaultSchedules } from "../../scheduler/defaults.js";
import { frequencyToMs } from "../../scheduler/gates.js";
import { getEntityScheduledAgents, getScheduledAgents } from "../../scheduler/registry.js";
import { getAllProducts } from "../products/storage.js";

export interface AgentScheduleRow {
  slug: string;
  label: string;
  description: string;
  frequency: ScheduleFrequency;
  moduleGate: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface AgentSchedulesView {
  pausedAll: boolean;
  agents: AgentScheduleRow[];
}

/**
 * Audience naming (§3.2/§3.3 grammar) for the registered agents. Sprint 3a
 * registers the two competitor scans; later module sprints append rows here
 * as they register agents. Unmapped slugs fall back to a humanised slug so a
 * missing entry is visible in review, never a crash.
 */
const AGENT_PRESENTATION: Record<string, { label: string; description: string; moduleGate: string | null }> = {
  [AgentSlugs.COMPETITOR_UPDATES]: {
    label: "Competitor check",
    description: "Verifies each competitor profile against their site, changelog and reviews.",
    moduleGate: "competitive-intelligence",
  },
  [AgentSlugs.COMPETITOR_FEATURES]: {
    label: "Competitor feature watch",
    description: "Re-reads each competitor's documented features so comparisons stay current.",
    moduleGate: "competitive-intelligence",
  },
  // Sprint 3b (ADR 004 §9) registrants
  [AgentSlugs.COMPETITOR_REVIEWS]: {
    label: "Competitor review mining",
    description: "Gathers each competitor's customer reviews, ratings and buyer themes — once per competitor, shared across products.",
    moduleGate: "competitive-intelligence",
  },
  [AgentSlugs.GATHER_FEEDBACK]: {
    label: "Feedback collection",
    description: "Mines trusted review platforms for your product's customer feedback with verified sources.",
    moduleGate: "customer-insights",
  },
  [AgentSlugs.THEME_AGGREGATION]: {
    label: "Theme maintenance",
    description: "Files new feedback into your stable theme set and proposes genuinely new themes from the residue.",
    moduleGate: "customer-insights",
  },
  [AgentSlugs.CUSTOMER_QUOTES]: {
    label: "Customer voice gathering",
    description: "Finds authentic, source-linked customer quotes for each tracked segment.",
    moduleGate: "customer-insights",
  },
  [AgentSlugs.CUSTOMER_INSIGHTS]: {
    label: "Segment synthesis",
    description: "Builds personas and jobs-to-be-done strictly from gathered evidence — runs only when a segment has enough.",
    moduleGate: "customer-insights",
  },
};

function humaniseSlug(slug: string): string {
  const words = slug.replace(/-agent$/, "").split("-").filter(Boolean);
  const sentence = words.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

const GENERIC_WEEKLY: AgentSchedule = {
  enabled: true,
  frequencyValue: 7,
  frequencyUnit: "days",
  timeOfDay: "09:00",
};

/**
 * Base (pre-override) schedule for a registry row, mirroring the resolution
 * the scheduler itself performs: product agentSchedules jsonb → audience
 * default → generic weekly. Uses the first product (v1 is single-product per
 * instance); with no product yet, defaults still render honestly.
 */
function resolveBaseSchedule(
  scheduleKey: string,
  product: Product | undefined,
  defaultSchedule: ((product: Product) => AgentSchedule) | undefined,
): AgentSchedule {
  if (!product) return GENERIC_WEEKLY;
  const schedules = (product.agentSchedules ?? {}) as Record<string, AgentSchedule | undefined>;
  return schedules[scheduleKey]
    ?? defaultSchedule?.(product)
    ?? computeDefaultSchedules(product)[scheduleKey]
    ?? GENERIC_WEEKLY;
}

interface RegisteredRow {
  slug: string;
  scheduleKey: string;
  defaultSchedule?: (product: Product) => AgentSchedule;
}

/** Registry rows in registration (module priority) order: product kind first. */
function listRegisteredRows(): RegisteredRow[] {
  return [
    ...getScheduledAgents().map((a) => ({
      slug: a.slug,
      scheduleKey: a.scheduleKey,
      defaultSchedule: a.defaultSchedule,
    })),
    ...getEntityScheduledAgents().map((a) => ({
      slug: a.slug,
      scheduleKey: a.scheduleKey,
    })),
  ];
}

export async function getAgentSchedulesView(organizationId: string): Promise<AgentSchedulesView> {
  const settings = await getOrgSchedulingSettings(organizationId);
  const products = await getAllProducts();
  const product = products.find((p) => p.organizationId === organizationId) ?? products[0];
  const now = Date.now();

  const agents: AgentScheduleRow[] = [];
  for (const row of listRegisteredRows()) {
    const base = resolveBaseSchedule(row.scheduleKey, product, row.defaultSchedule);
    const effective = applyFrequencyOverride(base, settings.frequencies[row.slug]);
    const frequency = scheduleToFrequency(effective);

    const agentRow = await getAiAgentBySlug(row.slug);
    const lastExecution = agentRow ? await getLastExecutionForAgent(agentRow.id) : null;
    const lastRunAt = lastExecution?.startedAt ? lastExecution.startedAt.toISOString() : null;

    let nextRunAt: string | null = null;
    if (!settings.pausedAll && frequency !== "off") {
      const gateOpensAt = lastExecution?.startedAt
        ? lastExecution.startedAt.getTime() + frequencyToMs(effective.frequencyValue, effective.frequencyUnit)
        : now;
      // Overdue (or never run) → due on the next tick, i.e. now.
      nextRunAt = new Date(Math.max(gateOpensAt, now)).toISOString();
    }

    const presentation = AGENT_PRESENTATION[row.slug] ?? {
      label: humaniseSlug(row.slug),
      description: "Runs on the schedule shown here.",
      moduleGate: null,
    };

    agents.push({
      slug: row.slug,
      label: presentation.label,
      description: presentation.description,
      frequency,
      moduleGate: presentation.moduleGate,
      lastRunAt,
      nextRunAt,
    });
  }

  return { pausedAll: settings.pausedAll, agents };
}

export interface AgentSchedulesUpdate {
  pausedAll?: boolean;
  agents?: Array<{ slug: string; frequency: ScheduleFrequency }>;
}

export async function updateAgentSchedules(
  organizationId: string,
  update: AgentSchedulesUpdate,
): Promise<AgentSchedulesView> {
  const registered = new Set(listRegisteredRows().map((r) => r.slug));
  const frequencies: Record<string, ScheduleFrequency> = {};
  for (const agent of update.agents ?? []) {
    if (!registered.has(agent.slug)) {
      throw new BadRequestError(`There is no scheduled agent called "${agent.slug}".`);
    }
    frequencies[agent.slug] = agent.frequency;
  }

  await updateOrgSchedulingSettings(organizationId, {
    ...(update.pausedAll !== undefined ? { pausedAll: update.pausedAll } : {}),
    frequencies,
  });

  return getAgentSchedulesView(organizationId);
}
