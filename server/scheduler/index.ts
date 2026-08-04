/**
 * Scheduler (ADR 002 §7, refined by ADR 003 §2.7): a minute tick over
 * products × product-scoped agents, then org entities × entity-scoped agents
 * (monitoring runs once per entity node, not per facet). The scheduler only
 * runs while the app is open; the catch-up pass (catchUp.ts) handles
 * everything missed while it was closed.
 */
import type { AgentSchedule, OrgSchedulingSettings, Product } from "@shared/schema";
import { getAllProducts } from "../modules/products/storage.js";
import { trackAgentExecution } from "../lib/agents/executions.js";
import {
  applyFrequencyOverride,
  DEFAULT_SCHEDULING_SETTINGS,
  getOrgSchedulingSettings,
} from "../lib/settings/agentScheduling.js";
import { shouldRunAgentNow, shouldRunEntityAgentNow } from "./gates.js";
import { getEntityScheduledAgents, getScheduledAgents, withInFlightGuard, type ScheduledAgent } from "./registry.js";

const TICK_INTERVAL_MS = 60_000;

let tickTimer: NodeJS.Timeout | null = null;
let tickRunning = false;

function resolveSchedule(agent: ScheduledAgent, product: Product): AgentSchedule {
  const schedules = (product.agentSchedules ?? {}) as Record<string, AgentSchedule | undefined>;
  return schedules[agent.scheduleKey] ?? agent.defaultSchedule(product);
}

function resolveTimezone(product: Product): string {
  const schedules = (product.agentSchedules ?? {}) as Record<string, unknown>;
  const tz = schedules["timezone"];
  return typeof tz === "string" && tz ? tz : "Europe/London";
}

/**
 * Per-pass cache of org scheduling settings (Settings §3.4): one DB read per
 * org per pass, failing OPEN to defaults (a settings read error must never
 * stop the scheduler — the gates share that philosophy).
 */
export function makeOrgSchedulingSettingsCache(): (organizationId: string) => Promise<OrgSchedulingSettings> {
  const cache = new Map<string, OrgSchedulingSettings>();
  return async (organizationId: string) => {
    const cached = cache.get(organizationId);
    if (cached) return cached;
    let settings = DEFAULT_SCHEDULING_SETTINGS;
    try {
      settings = await getOrgSchedulingSettings(organizationId);
    } catch (err) {
      console.error("[Scheduler] Could not read org scheduling settings — running with defaults:", err instanceof Error ? err.message : err);
    }
    cache.set(organizationId, settings);
    return settings;
  };
}

/** One tick: run every eligible agent for every product. Exported for tests. */
export async function runSchedulerTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const products = await getAllProducts();
    const agents = getScheduledAgents();
    const orgSettings = makeOrgSchedulingSettingsCache();
    for (const product of products) {
      const settings = await orgSettings(product.organizationId);
      // Pause-all (Settings §3.4): the user's choice suppresses the whole
      // tick for the org; stamps age truthfully and staleness shows amber.
      if (settings.pausedAll) continue;
      const timezone = resolveTimezone(product);
      for (const agent of agents) {
        const schedule = applyFrequencyOverride(
          resolveSchedule(agent, product),
          settings.frequencies[agent.slug],
        );
        try {
          if (!await shouldRunAgentNow(agent.slug, product.id, schedule, product.name, timezone)) {
            continue;
          }
          await withInFlightGuard(agent.slug, product.id, () =>
            trackAgentExecution(
              { agentSlug: agent.slug, triggerType: "scheduled", productId: product.id },
              () => agent.run(product),
            ),
          );
        } catch (err) {
          console.error(`[Scheduler] ${agent.slug} error for ${product.name}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    // Entity-scoped agents (ADR 003 §2.7): once per entity node with ≥1
    // tracked facet, however many products face it. The registering module
    // resolves targets and effective schedules; gates key on (agent, entity).
    for (const agent of getEntityScheduledAgents()) {
      let targets;
      try {
        targets = await agent.listTargets();
      } catch (err) {
        console.error(`[Scheduler] ${agent.slug} target resolution failed:`, err instanceof Error ? err.message : err);
        continue;
      }
      for (const target of targets) {
        try {
          const settings = await orgSettings(target.organizationId);
          if (settings.pausedAll) continue;
          const schedule = applyFrequencyOverride(target.schedule, settings.frequencies[agent.slug]);
          if (!await shouldRunEntityAgentNow(agent.slug, target.entityId, schedule, target.entityName, target.timezone)) {
            continue;
          }
          await withInFlightGuard(agent.slug, target.entityId, () =>
            trackAgentExecution(
              { agentSlug: agent.slug, triggerType: "scheduled", entityId: target.entityId },
              () => agent.run(target),
            ),
          );
        } catch (err) {
          console.error(`[Scheduler] ${agent.slug} error for entity ${target.entityName}:`, err instanceof Error ? err.message : err);
        }
      }
    }
  } finally {
    tickRunning = false;
  }
}

export function startScheduler(): void {
  if (tickTimer) return;
  console.log("[Scheduler] Started (minute tick)");
  tickTimer = setInterval(() => {
    runSchedulerTick().catch((err) => {
      console.error("[Scheduler] Tick failed:", err);
    });
  }, TICK_INTERVAL_MS);
  tickTimer.unref?.();
}

export function stopScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
    console.log("[Scheduler] Stopped");
  }
}
