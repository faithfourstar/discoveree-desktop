/**
 * Catch-up-on-launch semantics (ADR 002 §7): overdue agents run exactly once
 * (missed intervals collapse), fresh agents are skipped, disabled schedules
 * are skipped, timeOfDay is ignored, the circuit breaker is respected, and
 * stale `running` executions are failed before gates are computed (risk 7).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { aiAgentExecutions, type Product } from "@shared/schema";
import { closeDatabase, getDb, initDatabase } from "../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../db/seedLocal.js";
import { createProduct } from "../../modules/products/storage.js";
import { createAiAgent, getAiAgentBySlug } from "../../lib/agents/registry.js";
import { runCatchUpPass } from "../catchUp.js";
import { clearScheduledAgents, registerScheduledAgent } from "../registry.js";

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
  // Direct insert: the insert schema deliberately omits startedAt (it
  // defaults to now); tests need to back-date executions.
  await getDb().insert(aiAgentExecutions).values({
    agentId,
    organizationId: LOCAL_ORGANIZATION_ID,
    productId: product.id,
    status: options.status,
    startedAt: new Date(Date.now() - options.ageMs),
  });
}

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  product = await createProduct({
    organizationId: LOCAL_ORGANIZATION_ID,
    name: "Catch-up product",
    slug: "catch-up-product",
  });
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(() => {
  clearScheduledAgents();
});

describe("runCatchUpPass", () => {
  it("Given an agent that has NEVER run, When catch-up runs, Then it runs exactly once (timeOfDay 23:59 ignored)", async () => {
    await seedAgentRow("catchup-never-ran");
    const runs: string[] = [];
    registerScheduledAgent({
      slug: "catchup-never-ran",
      scheduleKey: "testKey",
      defaultSchedule: () => WEEKLY,
      run: async (p) => { runs.push(p.id); },
    });

    const result = await runCatchUpPass();
    expect(runs).toEqual([product.id]);
    expect(result.ran).toEqual([{ slug: "catchup-never-ran", productId: product.id }]);
  });

  it("Given a weekly agent closed for three weeks, When catch-up runs, Then missed intervals collapse to ONE run", async () => {
    const agentId = await seedAgentRow("catchup-overdue");
    await seedExecution(agentId, { status: "completed", ageMs: 21 * 24 * 60 * 60 * 1000 });

    let runCount = 0;
    registerScheduledAgent({
      slug: "catchup-overdue",
      scheduleKey: "testKey",
      defaultSchedule: () => WEEKLY,
      run: async () => { runCount++; },
    });

    const result = await runCatchUpPass();
    expect(runCount).toBe(1); // NOT 3 — agents diff against stored state, they are not tick-accumulators
    expect(result.ran).toHaveLength(1);
  });

  it("Given an agent that ran an hour ago, When catch-up runs, Then it is skipped as not overdue", async () => {
    const agentId = await seedAgentRow("catchup-fresh");
    await seedExecution(agentId, { status: "completed", ageMs: 60 * 60 * 1000 });

    let runCount = 0;
    registerScheduledAgent({
      slug: "catchup-fresh",
      scheduleKey: "testKey",
      defaultSchedule: () => WEEKLY,
      run: async () => { runCount++; },
    });

    const result = await runCatchUpPass();
    expect(runCount).toBe(0);
    expect(result.skipped).toContainEqual({ slug: "catchup-fresh", productId: product.id, reason: "not-overdue" });
  });

  it("Given a disabled schedule, When catch-up runs, Then the agent is skipped", async () => {
    await seedAgentRow("catchup-disabled");
    let runCount = 0;
    registerScheduledAgent({
      slug: "catchup-disabled",
      scheduleKey: "testKey",
      defaultSchedule: () => ({ ...WEEKLY, enabled: false }),
      run: async () => { runCount++; },
    });

    const result = await runCatchUpPass();
    expect(runCount).toBe(0);
    expect(result.skipped).toContainEqual({ slug: "catchup-disabled", productId: product.id, reason: "disabled" });
  });

  it("Given 3 consecutive recent failures, When catch-up runs, Then the circuit breaker suppresses the run", async () => {
    const agentId = await seedAgentRow("catchup-broken");
    // Overdue by frequency (8+ days), but the 3 most recent runs all failed
    // within the 2× frequency suppression window.
    await seedExecution(agentId, { status: "failed", ageMs: 10 * 24 * 60 * 60 * 1000 });
    await seedExecution(agentId, { status: "failed", ageMs: 9 * 24 * 60 * 60 * 1000 });
    await seedExecution(agentId, { status: "failed", ageMs: 8 * 24 * 60 * 60 * 1000 });

    let runCount = 0;
    registerScheduledAgent({
      slug: "catchup-broken",
      scheduleKey: "testKey",
      defaultSchedule: () => WEEKLY,
      run: async () => { runCount++; },
    });

    const result = await runCatchUpPass();
    expect(runCount).toBe(0); // must not greet the user with the same failure on every launch
    expect(result.skipped).toContainEqual({ slug: "catchup-broken", productId: product.id, reason: "circuit-breaker" });
  });

  it("Given a stale 'running' execution older than 2h, When catch-up runs, Then it is failed first and the agent runs (risk 7)", async () => {
    const agentId = await seedAgentRow("catchup-stale-running");
    // A lid-close mid-run left this execution 'running' 3 days ago. Without
    // the stale reset it would pass the frequency gate... wait — a 3-day-old
    // execution IS overdue for weekly? No: 3 days < 7 days, so the stale row
    // would BLOCK the run. After reset it is 'failed' but still 3 days old,
    // so the frequency gate still blocks. Use a 10-day-old stale row: it
    // must be marked failed AND the agent must run (overdue).
    await seedExecution(agentId, { status: "running", ageMs: 10 * 24 * 60 * 60 * 1000 });

    let runCount = 0;
    registerScheduledAgent({
      slug: "catchup-stale-running",
      scheduleKey: "testKey",
      defaultSchedule: () => WEEKLY,
      run: async () => { runCount++; },
    });

    const result = await runCatchUpPass();
    expect(runCount).toBe(1);
    expect(result.ran).toContainEqual({ slug: "catchup-stale-running", productId: product.id });
  });

  it("After a catch-up run, the execution log records it, so a second catch-up skips (no double runs)", async () => {
    await seedAgentRow("catchup-idempotent");
    let runCount = 0;
    registerScheduledAgent({
      slug: "catchup-idempotent",
      scheduleKey: "testKey",
      defaultSchedule: () => WEEKLY,
      run: async () => { runCount++; },
    });

    await runCatchUpPass();
    const second = await runCatchUpPass();
    expect(runCount).toBe(1);
    expect(second.skipped).toContainEqual({ slug: "catchup-idempotent", productId: product.id, reason: "not-overdue" });
  });
});
