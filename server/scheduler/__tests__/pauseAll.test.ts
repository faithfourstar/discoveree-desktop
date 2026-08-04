/**
 * Org scheduling settings actually gate the scheduler (Settings spec §3.4):
 * pause-all suppresses BOTH the minute tick and the launch catch-up pass
 * (for product- and entity-scoped agents), resuming restores runs, and
 * per-agent frequency overrides change what the catch-up considers overdue.
 * Extends the catch-up/entity test harness pattern.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { aiAgentExecutions, type Product } from "@shared/schema";
import { closeDatabase, getDb, initDatabase } from "../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../db/seedLocal.js";
import { createProduct } from "../../modules/products/storage.js";
import { createAiAgent, getAiAgentBySlug } from "../../lib/agents/registry.js";
import { updateOrgSchedulingSettings } from "../../lib/settings/agentScheduling.js";
import { runSchedulerTick } from "../index.js";
import { runCatchUpPass } from "../catchUp.js";
import {
  clearScheduledAgents,
  registerEntityScheduledAgent,
  registerScheduledAgent,
  type EntityAgentTarget,
} from "../registry.js";

// Hours unit so the tick's timeOfDay window never interferes (gates.ts).
const HOURLY = { enabled: true, frequencyValue: 1, frequencyUnit: "hours" as const, timeOfDay: "09:00" };
const WEEKLY = { enabled: true, frequencyValue: 7, frequencyUnit: "days" as const, timeOfDay: "23:59" };

let product: Product;

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

async function seedExecution(agentId: string, options: { status: string; ageMs: number }): Promise<void> {
  await getDb().insert(aiAgentExecutions).values({
    agentId,
    organizationId: LOCAL_ORGANIZATION_ID,
    productId: product.id,
    status: options.status,
    startedAt: new Date(Date.now() - options.ageMs),
  });
}

function entityTarget(entityId: string): EntityAgentTarget {
  return {
    entityId,
    entityName: `Entity ${entityId}`,
    organizationId: LOCAL_ORGANIZATION_ID,
    schedule: HOURLY,
    timezone: "Europe/London",
  };
}

async function setPausedAll(pausedAll: boolean): Promise<void> {
  await updateOrgSchedulingSettings(LOCAL_ORGANIZATION_ID, { pausedAll });
}

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  product = await createProduct({
    organizationId: LOCAL_ORGANIZATION_ID,
    name: "Pause product",
    slug: "pause-product",
  });
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  clearScheduledAgents();
  await setPausedAll(false);
});

describe("pause-all gates the minute tick", () => {
  it("Given pausedAll, When the tick runs, Then neither product nor entity agents run; resuming restores both", async () => {
    await seedAgentRow("pause-tick-product");
    await seedAgentRow("pause-tick-entity");
    const runs: string[] = [];
    registerScheduledAgent({
      slug: "pause-tick-product",
      scheduleKey: "testKey",
      defaultSchedule: () => HOURLY,
      run: async () => { runs.push("product"); },
    });
    registerEntityScheduledAgent({
      slug: "pause-tick-entity",
      scheduleKey: "testEntityKey",
      listTargets: async () => [entityTarget("ent-pause-tick")],
      run: async () => { runs.push("entity"); },
    });

    await setPausedAll(true);
    await runSchedulerTick();
    expect(runs).toEqual([]); // nothing is being checked — the §3.4 contract

    await setPausedAll(false);
    await runSchedulerTick();
    expect(runs.sort()).toEqual(["entity", "product"]);
  });
});

describe("pause-all gates the launch catch-up pass", () => {
  it("Given pausedAll and an overdue agent, When catch-up runs, Then it is skipped as paused and runs after resume", async () => {
    await seedAgentRow("pause-catchup");
    let runCount = 0;
    registerScheduledAgent({
      slug: "pause-catchup",
      scheduleKey: "testKey",
      defaultSchedule: () => WEEKLY,
      run: async () => { runCount++; },
    });

    await setPausedAll(true);
    const paused = await runCatchUpPass();
    expect(runCount).toBe(0);
    expect(paused.skipped).toContainEqual({ slug: "pause-catchup", productId: product.id, reason: "paused" });

    await setPausedAll(false);
    const resumed = await runCatchUpPass();
    expect(runCount).toBe(1);
    expect(resumed.ran).toContainEqual({ slug: "pause-catchup", productId: product.id });
  });

  it("Given pausedAll and an entity agent, When catch-up runs, Then the entity is skipped as paused", async () => {
    await seedAgentRow("pause-catchup-entity");
    let runCount = 0;
    registerEntityScheduledAgent({
      slug: "pause-catchup-entity",
      scheduleKey: "testEntityKey",
      listTargets: async () => [entityTarget("ent-pause-cu")],
      run: async () => { runCount++; },
    });

    await setPausedAll(true);
    const result = await runCatchUpPass();
    expect(runCount).toBe(0);
    expect(result.skipped).toContainEqual({ slug: "pause-catchup-entity", entityId: "ent-pause-cu", reason: "paused" });
  });
});

describe("org frequency overrides gate real runs", () => {
  it("Given a weekly default and a run 2 days ago, When the override says daily, Then catch-up treats it as overdue (and not before)", async () => {
    const agentId = await seedAgentRow("override-cadence");
    await seedExecution(agentId, { status: "completed", ageMs: 2 * 24 * 60 * 60 * 1000 });

    let runCount = 0;
    registerScheduledAgent({
      slug: "override-cadence",
      scheduleKey: "testKey",
      defaultSchedule: () => WEEKLY,
      run: async () => { runCount++; },
    });

    // Default weekly: 2 days ago is fresh.
    const before = await runCatchUpPass();
    expect(runCount).toBe(0);
    expect(before.skipped).toContainEqual({ slug: "override-cadence", productId: product.id, reason: "not-overdue" });

    // Org override daily: 2 days ago is overdue.
    await updateOrgSchedulingSettings(LOCAL_ORGANIZATION_ID, {
      frequencies: { "override-cadence": "daily" },
    });
    const after = await runCatchUpPass();
    expect(runCount).toBe(1);
    expect(after.ran).toContainEqual({ slug: "override-cadence", productId: product.id });
  });

  it("Given an 'off' override, When catch-up runs, Then the agent is skipped as disabled", async () => {
    await seedAgentRow("override-off");
    let runCount = 0;
    registerScheduledAgent({
      slug: "override-off",
      scheduleKey: "testKey",
      defaultSchedule: () => WEEKLY,
      run: async () => { runCount++; },
    });

    await updateOrgSchedulingSettings(LOCAL_ORGANIZATION_ID, {
      frequencies: { "override-off": "off" },
    });
    const result = await runCatchUpPass();
    expect(runCount).toBe(0);
    expect(result.skipped).toContainEqual({ slug: "override-off", productId: product.id, reason: "disabled" });
  });
});
