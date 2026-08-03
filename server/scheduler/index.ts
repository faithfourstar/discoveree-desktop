/**
 * Scheduler (ADR 002 §7): a minute tick over products × registered agents.
 * The scheduler only runs while the app is open; the catch-up pass
 * (catchUp.ts) handles everything missed while it was closed.
 */
import type { AgentSchedule, Product } from "@shared/schema";
import { getAllProducts } from "../modules/products/storage.js";
import { trackAgentExecution } from "../lib/agents/executions.js";
import { shouldRunAgentNow } from "./gates.js";
import { getScheduledAgents, withInFlightGuard, type ScheduledAgent } from "./registry.js";

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

/** One tick: run every eligible agent for every product. Exported for tests. */
export async function runSchedulerTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const products = await getAllProducts();
    const agents = getScheduledAgents();
    for (const product of products) {
      const timezone = resolveTimezone(product);
      for (const agent of agents) {
        const schedule = resolveSchedule(agent, product);
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
