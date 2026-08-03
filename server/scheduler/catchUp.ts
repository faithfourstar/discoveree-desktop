/**
 * Catch-up-on-launch pass (ADR 002 §7).
 *
 * Concrete semantics of the brief's "catch up on launch if overdue":
 * 1. Runs once per process start, delayed (default 45 s) so launch isn't
 *    janked by LLM traffic.
 * 2. For each product × registered agent where enabled && overdue (or never
 *    run): run NOW, ignoring the time-of-day gate.
 * 3. Missed intervals collapse to ONE run — agents re-derive current state
 *    and diff against stored state; they are not tick-accumulators. The gap
 *    in the change feed is honest: nothing was observed while closed.
 * 4. Sequential by module priority (registration order), within a module
 *    through runAgentBatch with concurrency 3 (prevents the
 *    relaunch-after-holiday 429 stampede).
 * 5. The circuit breaker applies during catch-up too.
 * 6. Stale `running` executions (>2 h) are failed BEFORE gates are computed
 *    (risk 7), and the shared in-flight guard keeps tick-triggered runs from
 *    overlapping catch-up for the same agent+product.
 */
import type { AgentSchedule, Product } from "@shared/schema";
import { getAllProducts } from "../modules/products/storage.js";
import { runAgentBatch } from "../lib/agents/batch.js";
import {
  getLastExecutionForAgentAndProduct,
  resetStaleRunningExecutions,
  trackAgentExecution,
} from "../lib/agents/executions.js";
import { getAiAgentBySlug } from "../lib/agents/registry.js";
import { frequencyToMs, passesCircuitBreaker } from "./gates.js";
import { getScheduledAgents, withInFlightGuard, type ScheduledAgent } from "./registry.js";

export const DEFAULT_CATCH_UP_DELAY_MS = 45_000;

let catchUpTimer: NodeJS.Timeout | null = null;
let catchUpRunning = false;

function resolveSchedule(agent: ScheduledAgent, product: Product): AgentSchedule {
  const schedules = (product.agentSchedules ?? {}) as Record<string, AgentSchedule | undefined>;
  return schedules[agent.scheduleKey] ?? agent.defaultSchedule(product);
}

/** Is this agent overdue for this product (never ran, or ≥ one frequency ago)? */
export async function isAgentOverdue(
  agent: ScheduledAgent,
  product: Product,
  schedule: AgentSchedule,
): Promise<boolean> {
  const agentRow = await getAiAgentBySlug(agent.slug);
  if (!agentRow) return true; // no registry row yet — first-ever run
  const last = await getLastExecutionForAgentAndProduct(agentRow.id, product.id);
  if (!last || !last.startedAt) return true;
  const frequencyMs = frequencyToMs(schedule.frequencyValue, schedule.frequencyUnit);
  return Date.now() - new Date(last.startedAt).getTime() >= frequencyMs;
}

export interface CatchUpResult {
  ran: Array<{ slug: string; productId: string }>;
  skipped: Array<{ slug: string; productId: string; reason: "disabled" | "not-overdue" | "circuit-breaker" | "in-flight" }>;
}

/**
 * The single catch-up pass. Exported for tests; `scheduleCatchUpPass` wires
 * it to boot with a delay.
 */
export async function runCatchUpPass(): Promise<CatchUpResult> {
  if (catchUpRunning) return { ran: [], skipped: [] };
  catchUpRunning = true;
  const result: CatchUpResult = { ran: [], skipped: [] };
  try {
    // Risk 7: fail interrupted runs BEFORE gates are computed.
    const reset = await resetStaleRunningExecutions();
    if (reset > 0) {
      console.log(`[CatchUp] Marked ${reset} stale running execution(s) as failed (interrupted)`);
    }

    const products = await getAllProducts();
    const agents = getScheduledAgents();
    if (products.length === 0 || agents.length === 0) return result;

    console.log(`[CatchUp] Checking ${agents.length} agent(s) × ${products.length} product(s)…`);

    // Sequential by registration (module priority) order; batched per agent
    // across products with concurrency 3.
    for (const agent of agents) {
      const due: Product[] = [];
      for (const product of products) {
        const schedule = resolveSchedule(agent, product);
        if (!schedule.enabled) {
          result.skipped.push({ slug: agent.slug, productId: product.id, reason: "disabled" });
          continue;
        }
        // Overdue check — collapses any number of missed intervals to one run.
        // timeOfDay is deliberately IGNORED here.
        if (!await isAgentOverdue(agent, product, schedule)) {
          result.skipped.push({ slug: agent.slug, productId: product.id, reason: "not-overdue" });
          continue;
        }
        if (!await passesCircuitBreaker(agent.slug, product.id, schedule, product.name)) {
          result.skipped.push({ slug: agent.slug, productId: product.id, reason: "circuit-breaker" });
          continue;
        }
        due.push(product);
      }

      if (due.length === 0) continue;
      console.log(`[CatchUp] ${agent.slug}: ${due.length} product(s) overdue — running now`);

      await runAgentBatch(
        due,
        async (product) => {
          const outcome = await withInFlightGuard(agent.slug, product.id, () =>
            trackAgentExecution(
              { agentSlug: agent.slug, triggerType: "scheduled", productId: product.id },
              () => agent.run(product),
            ),
          );
          if (outcome === null) {
            result.skipped.push({ slug: agent.slug, productId: product.id, reason: "in-flight" });
          } else {
            result.ran.push({ slug: agent.slug, productId: product.id });
          }
        },
        { label: `CatchUp/${agent.slug}`, concurrency: 3 },
      );
    }

    console.log(`[CatchUp] Complete — ${result.ran.length} run(s), ${result.skipped.length} skipped`);
    return result;
  } finally {
    catchUpRunning = false;
  }
}

/** Schedule the once-per-boot catch-up pass. */
export function scheduleCatchUpPass(options: { delayMs?: number } = {}): void {
  const delayMs = options.delayMs ?? DEFAULT_CATCH_UP_DELAY_MS;
  if (catchUpTimer) return;
  catchUpTimer = setTimeout(() => {
    runCatchUpPass().catch((err) => {
      console.error("[CatchUp] Pass failed:", err);
    });
  }, delayMs);
  // Never keep the process alive just for catch-up.
  catchUpTimer.unref?.();
}

export function cancelCatchUpPass(): void {
  if (catchUpTimer) {
    clearTimeout(catchUpTimer);
    catchUpTimer = null;
  }
}
