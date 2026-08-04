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

/**
 * One eligible run target for an entity-scoped agent (ADR 003 §2.7). The
 * registering module resolves the target list and the effective schedule —
 * the scheduler stays domain-agnostic. Monitoring runs once per entity node,
 * however many products hold facets on it.
 */
export interface EntityAgentTarget {
  entityId: string;
  entityName: string;
  organizationId: string;
  /** Effective schedule for this node (module-resolved across faceted products). */
  schedule: AgentSchedule;
  timezone: string;
}

/**
 * Entity-scoped registration kind (ADR 003 §2.7): iterated over org × entity
 * nodes with ≥1 tracked facet, frequency-gated per agent + entity node via
 * the entity twins of the execution lookups. Facet/product agents keep the
 * `ScheduledAgent` kind unchanged.
 */
export interface EntityScheduledAgent {
  /** AgentSlugs value; execution-tracking key. */
  slug: string;
  /** Schedule key in products.agentSchedules jsonb (shared with the module's settings). */
  scheduleKey: string;
  /** Resolve current run targets (entities with ≥1 tracked facet + effective schedule). */
  listTargets(): Promise<EntityAgentTarget[]>;
  /** The work. Wrapped in trackAgentExecution by the tick/catch-up. */
  run(target: EntityAgentTarget): Promise<unknown>;
}

const registeredAgents: ScheduledAgent[] = [];
const registeredEntityAgents: EntityScheduledAgent[] = [];

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

export function registerEntityScheduledAgent(agent: EntityScheduledAgent): void {
  const exists = registeredEntityAgents.some(
    a => a.slug === agent.slug && a.scheduleKey === agent.scheduleKey,
  );
  if (exists) return;
  registeredEntityAgents.push(agent);
}

export function getEntityScheduledAgents(): readonly EntityScheduledAgent[] {
  return registeredEntityAgents;
}

/** Test helper. */
export function clearScheduledAgents(): void {
  registeredAgents.length = 0;
  registeredEntityAgents.length = 0;
}

// ── In-flight guard (per agent + scope: productId or entityId) ──────────────

const inFlight = new Set<string>();

export function isAgentInFlight(slug: string, scopeId: string): boolean {
  return inFlight.has(`${slug}:${scopeId}`);
}

/**
 * Run `fn` with the agent+scope in-flight guard held (scope is the productId
 * for product agents, the entityId for entity agents). Returns null without
 * running when the guard is already held (another tick/catch-up owns it).
 */
export async function withInFlightGuard<T>(
  slug: string,
  scopeId: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const key = `${slug}:${scopeId}`;
  if (inFlight.has(key)) return null;
  inFlight.add(key);
  try {
    return await fn();
  } finally {
    inFlight.delete(key);
  }
}
