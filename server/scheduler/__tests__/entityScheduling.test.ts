/**
 * Entity-scoped scheduling (ADR 003 §2.7): entity agents run once per entity
 * node via targets the registering module resolves; the frequency gate and
 * circuit breaker key on (agent, entityId) through ai_agent_executions.entityId,
 * reusing the product machinery unchanged. Covers both the minute tick and
 * the catch-up pass.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { aiAgentExecutions } from "@shared/schema";
import { closeDatabase, getDb, initDatabase } from "../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../db/seedLocal.js";
import { createAiAgent, getAiAgentBySlug } from "../../lib/agents/registry.js";
import { runSchedulerTick } from "../index.js";
import { runCatchUpPass } from "../catchUp.js";
import {
  clearScheduledAgents,
  registerEntityScheduledAgent,
  type EntityAgentTarget,
} from "../registry.js";

import type { AgentSchedule } from "@shared/schema";

const HOURLY: AgentSchedule = { enabled: true, frequencyValue: 1, frequencyUnit: "hours", timeOfDay: "09:00" };
const WEEKLY: AgentSchedule = { enabled: true, frequencyValue: 7, frequencyUnit: "days", timeOfDay: "23:59" };

function target(entityId: string, schedule: AgentSchedule = HOURLY): EntityAgentTarget {
  return {
    entityId,
    entityName: `Entity ${entityId}`,
    organizationId: LOCAL_ORGANIZATION_ID,
    schedule,
    timezone: "Europe/London",
  };
}

async function seedAgentRow(slug: string): Promise<string> {
  const existing = await getAiAgentBySlug(slug);
  if (existing) return existing.id;
  const agent = await createAiAgent({
    slug,
    name: slug,
    category: "test",
    defaultPrompt: "test",
    modelProvider: "gemini",
    modelName: "gemini-2.5-flash",
    requiresWebSearch: false,
  });
  return agent.id;
}

async function seedEntityExecution(
  agentId: string,
  entityId: string,
  options: { status: string; ageMs: number },
): Promise<void> {
  await getDb().insert(aiAgentExecutions).values({
    agentId,
    organizationId: LOCAL_ORGANIZATION_ID,
    entityId,
    status: options.status,
    startedAt: new Date(Date.now() - options.ageMs),
  });
}

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(() => {
  clearScheduledAgents();
});

describe("runSchedulerTick with entity-scoped agents", () => {
  it("Given two entity targets, When the tick runs, Then the agent runs once per ENTITY and executions carry entityId", async () => {
    const agentId = await seedAgentRow("entity-tick-agent");
    const runs: string[] = [];
    registerEntityScheduledAgent({
      slug: "entity-tick-agent",
      scheduleKey: "testKey",
      listTargets: async () => [target("ent-tick-a"), target("ent-tick-b")],
      run: async (t) => { runs.push(t.entityId); },
    });

    await runSchedulerTick();
    expect(runs.sort()).toEqual(["ent-tick-a", "ent-tick-b"]);

    // The execution rows are entity-keyed (the §2.7 frequency-gate key).
    const rows = await getDb()
      .select()
      .from(aiAgentExecutions)
      .where(and(
        eq(aiAgentExecutions.agentId, agentId),
        eq(aiAgentExecutions.entityId, "ent-tick-a"),
      ));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("completed");
    expect(rows[0]?.productId).toBeNull();
  });

  it("Given a recent run for one entity, When the tick runs again, Then only the other entity runs (gate keyed per entity, not per product)", async () => {
    await seedAgentRow("entity-gate-agent");
    const agentId = (await getAiAgentBySlug("entity-gate-agent"))!.id;
    await seedEntityExecution(agentId, "ent-fresh", { status: "completed", ageMs: 5 * 60 * 1000 });

    const runs: string[] = [];
    registerEntityScheduledAgent({
      slug: "entity-gate-agent",
      scheduleKey: "testKey",
      listTargets: async () => [target("ent-fresh"), target("ent-stale")],
      run: async (t) => { runs.push(t.entityId); },
    });

    await runSchedulerTick();
    expect(runs).toEqual(["ent-stale"]);
  });

  it("Given a failing entity agent, When it fails, Then the failure is recorded against the entity and the tick survives", async () => {
    const agentId = await seedAgentRow("entity-fail-agent");
    registerEntityScheduledAgent({
      slug: "entity-fail-agent",
      scheduleKey: "testKey",
      listTargets: async () => [target("ent-broken")],
      run: async () => { throw new Error("boom"); },
    });

    await runSchedulerTick(); // must not throw

    const rows = await getDb()
      .select()
      .from(aiAgentExecutions)
      .where(and(
        eq(aiAgentExecutions.agentId, agentId),
        eq(aiAgentExecutions.entityId, "ent-broken"),
      ));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("failed");
  });
});

describe("runCatchUpPass with entity-scoped agents", () => {
  it("Given an entity agent that has NEVER run, When catch-up runs, Then it runs once per entity (timeOfDay ignored)", async () => {
    await seedAgentRow("entity-catchup-never");
    const runs: string[] = [];
    registerEntityScheduledAgent({
      slug: "entity-catchup-never",
      scheduleKey: "testKey",
      listTargets: async () => [target("ent-cu-a", WEEKLY), target("ent-cu-b", WEEKLY)],
      run: async (t) => { runs.push(t.entityId); },
    });

    const result = await runCatchUpPass();
    expect(runs.sort()).toEqual(["ent-cu-a", "ent-cu-b"]);
    expect(result.ran).toContainEqual({ slug: "entity-catchup-never", entityId: "ent-cu-a" });
    expect(result.ran).toContainEqual({ slug: "entity-catchup-never", entityId: "ent-cu-b" });
  });

  it("Given one fresh and one overdue entity, When catch-up runs, Then only the overdue entity runs", async () => {
    const agentId = await seedAgentRow("entity-catchup-mixed");
    await seedEntityExecution(agentId, "ent-cu-fresh", { status: "completed", ageMs: 60 * 60 * 1000 });
    await seedEntityExecution(agentId, "ent-cu-overdue", { status: "completed", ageMs: 8 * 24 * 60 * 60 * 1000 });

    const runs: string[] = [];
    registerEntityScheduledAgent({
      slug: "entity-catchup-mixed",
      scheduleKey: "testKey",
      listTargets: async () => [target("ent-cu-fresh", WEEKLY), target("ent-cu-overdue", WEEKLY)],
      run: async (t) => { runs.push(t.entityId); },
    });

    const result = await runCatchUpPass();
    expect(runs).toEqual(["ent-cu-overdue"]);
    expect(result.skipped).toContainEqual({ slug: "entity-catchup-mixed", entityId: "ent-cu-fresh", reason: "not-overdue" });
  });

  it("Given 3 consecutive failures for an entity, When catch-up runs, Then the circuit breaker suppresses that entity only", async () => {
    const agentId = await seedAgentRow("entity-catchup-breaker");
    await seedEntityExecution(agentId, "ent-cu-broken", { status: "failed", ageMs: 10 * 24 * 60 * 60 * 1000 });
    await seedEntityExecution(agentId, "ent-cu-broken", { status: "failed", ageMs: 9 * 24 * 60 * 60 * 1000 });
    await seedEntityExecution(agentId, "ent-cu-broken", { status: "failed", ageMs: 8 * 24 * 60 * 60 * 1000 });

    const runs: string[] = [];
    registerEntityScheduledAgent({
      slug: "entity-catchup-breaker",
      scheduleKey: "testKey",
      listTargets: async () => [target("ent-cu-broken", WEEKLY), target("ent-cu-healthy", WEEKLY)],
      run: async (t) => { runs.push(t.entityId); },
    });

    const result = await runCatchUpPass();
    expect(runs).toEqual(["ent-cu-healthy"]);
    expect(result.skipped).toContainEqual({ slug: "entity-catchup-breaker", entityId: "ent-cu-broken", reason: "circuit-breaker" });
  });

  it("Given a disabled schedule for an entity, When catch-up runs, Then it is skipped as disabled", async () => {
    await seedAgentRow("entity-catchup-disabled");
    const runs: string[] = [];
    registerEntityScheduledAgent({
      slug: "entity-catchup-disabled",
      scheduleKey: "testKey",
      listTargets: async () => [target("ent-cu-off", { ...WEEKLY, enabled: false })],
      run: async (t) => { runs.push(t.entityId); },
    });

    const result = await runCatchUpPass();
    expect(runs).toEqual([]);
    expect(result.skipped).toContainEqual({ slug: "entity-catchup-disabled", entityId: "ent-cu-off", reason: "disabled" });
  });
});
