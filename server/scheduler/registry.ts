/**
 * Scheduled-agent registry (ADR 002 §7). Modules register their agents here;
 * the tick and the catch-up pass iterate products × registered agents. This
 * replaces the SaaS scheduler's 1,000-line if-chain.
 *
 * The in-flight guard is per agent+product (generalised from the SaaS
 * `quickWinInFlight` idea) and is shared by the tick AND the catch-up pass,
 * so the two can never run the same agent+product concurrently.
 */
import type { Product, AgentSchedule } from "@shared/schema";

export interface ScheduledAgent {
  /** AgentSlugs value; execution-tracking key. */
  slug: string;
  /** Key in products.agentSchedules jsonb (e.g. "competitorUpdates"). */
  scheduleKey: string;
  /** Default schedule when the product has none configured. */
  defaultSchedule(product: Product): AgentSchedule;
  /** The work. Wrapped in trackAgentExecution by the tick/catch-up. */
  run(product: Product): Promise<unknown>;
}

const registeredAgents: ScheduledAgent[] = [];

export function registerScheduledAgent(agent: ScheduledAgent): void {
  const exists = registeredAgents.some(
    a => a.slug === agent.slug && a.scheduleKey === agent.scheduleKey,
  );
  if (exists) return; // idempotent — module registration may run more than once in tests
  registeredAgents.push(agent);
}

export function getScheduledAgents(): readonly ScheduledAgent[] {
  return registeredAgents;
}

/** Test helper. */
export function clearScheduledAgents(): void {
  registeredAgents.length = 0;
}

// ── In-flight guard (per agent+product) ─────────────────────────────────────

const inFlight = new Set<string>();

export function isAgentInFlight(slug: string, productId: string): boolean {
  return inFlight.has(`${slug}:${productId}`);
}

/**
 * Run `fn` with the agent+product in-flight guard held. Returns null without
 * running when the guard is already held (another tick/catch-up owns it).
 */
export async function withInFlightGuard<T>(
  slug: string,
  productId: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const key = `${slug}:${productId}`;
  if (inFlight.has(key)) return null;
  inFlight.add(key);
  try {
    return await fn();
  } finally {
    inFlight.delete(key);
  }
}
