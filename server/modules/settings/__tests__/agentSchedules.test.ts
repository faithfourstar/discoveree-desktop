/**
 * Agent-schedules settings API (fixed contract for the parallel client
 * build): GET view shape with audience-named rows, PUT round-trip for
 * frequencies and pause-all, nextRunAt derivation from the frequency gate +
 * last run, and validation of unknown slugs. The pause-all/override effect
 * on the scheduler itself is covered in scheduler/__tests__/pauseAll.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { aiAgentExecutions } from "@shared/schema";
import { buildApp } from "../../../app.js";
import { closeDatabase, getDb, initDatabase } from "../../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../../db/seedLocal.js";
import { seedAgents } from "../../../lib/agents/seed.js";
import { getAiAgentBySlug } from "../../../lib/agents/registry.js";
import { AgentSlugs } from "../../../lib/agents/slugs.js";
import { registerCompetitorAgents } from "../../competitors/index.js";
import { createProduct } from "../../products/storage.js";
import { clearScheduledAgents } from "../../../scheduler/registry.js";
import { scheduleToFrequency } from "../../../lib/settings/agentScheduling.js";
import { computeDefaultSchedules } from "../../../scheduler/defaults.js";

let app: Express;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  await seedAgents();
  registerCompetitorAgents();
  // B2C audience → audience-aware default cadence is DAILY (defaults.ts).
  await createProduct({
    organizationId: LOCAL_ORGANIZATION_ID,
    name: "Schedules product",
    slug: "schedules-product",
    audience: ["B2C"],
  });
  app = buildApp();
});

afterAll(async () => {
  clearScheduledAgents();
  await closeDatabase();
});

describe("GET /api/settings/agent-schedules", () => {
  it("Given the registered agents and a B2C product, When read, Then rows are audience-named with the audience-aware default frequency", async () => {
    const res = await request(app).get("/api/settings/agent-schedules");
    expect(res.status).toBe(200);
    expect(res.body.pausedAll).toBe(false);
    expect(res.body.agents).toHaveLength(2);

    const updates = res.body.agents.find((a: { slug: string }) => a.slug === AgentSlugs.COMPETITOR_UPDATES);
    expect(updates).toEqual({
      slug: AgentSlugs.COMPETITOR_UPDATES,
      label: "Competitor check",
      description: "Verifies each competitor profile against their site, changelog and reviews.",
      frequency: "daily",
      moduleGate: "competitive-intelligence",
      lastRunAt: null,
      nextRunAt: expect.any(String),
    });
    // No slug leaks into the label (spec §3.2: named by the job, never the slug).
    expect(updates.label).not.toContain("agent");

    const features = res.body.agents.find((a: { slug: string }) => a.slug === AgentSlugs.COMPETITOR_FEATURES);
    expect(features.label).toBe("Competitor feature watch");
    expect(features.frequency).toBe("daily");

    // Never run + enabled → due now: nextRunAt is a valid ISO stamp at ~now.
    const nextRun = new Date(updates.nextRunAt).getTime();
    expect(Math.abs(nextRun - Date.now())).toBeLessThan(60_000);
  });
});

describe("PUT /api/settings/agent-schedules", () => {
  it("Given a frequency change for one agent, When put, Then it round-trips and the other row is untouched", async () => {
    const res = await request(app)
      .put("/api/settings/agent-schedules")
      .send({ agents: [{ slug: AgentSlugs.COMPETITOR_UPDATES, frequency: "fortnightly" }] });
    expect(res.status).toBe(200);

    const updates = res.body.agents.find((a: { slug: string }) => a.slug === AgentSlugs.COMPETITOR_UPDATES);
    const features = res.body.agents.find((a: { slug: string }) => a.slug === AgentSlugs.COMPETITOR_FEATURES);
    expect(updates.frequency).toBe("fortnightly");
    expect(features.frequency).toBe("daily"); // merge, don't replace

    const get = await request(app).get("/api/settings/agent-schedules");
    expect(get.body.agents.find((a: { slug: string }) => a.slug === AgentSlugs.COMPETITOR_UPDATES).frequency)
      .toBe("fortnightly");
  });

  it("Given a last run 1 hour ago and a fortnightly frequency, When read, Then nextRunAt = lastRunAt + 14 days", async () => {
    const agent = await getAiAgentBySlug(AgentSlugs.COMPETITOR_UPDATES);
    const startedAt = new Date(Date.now() - 60 * 60 * 1000);
    await getDb().insert(aiAgentExecutions).values({
      agentId: agent!.id,
      organizationId: LOCAL_ORGANIZATION_ID,
      entityId: "schedules-entity",
      status: "completed",
      startedAt,
    });

    const res = await request(app).get("/api/settings/agent-schedules");
    const updates = res.body.agents.find((a: { slug: string }) => a.slug === AgentSlugs.COMPETITOR_UPDATES);
    expect(updates.lastRunAt).toBe(startedAt.toISOString());
    expect(updates.nextRunAt).toBe(new Date(startedAt.getTime() + 14 * DAY_MS).toISOString());
  });

  it("Given frequency 'monthly', When put, Then it round-trips and nextRunAt uses the true 30-day gate", async () => {
    const res = await request(app)
      .put("/api/settings/agent-schedules")
      .send({ agents: [{ slug: AgentSlugs.COMPETITOR_UPDATES, frequency: "monthly" }] });
    expect(res.status).toBe(200);

    const updates = res.body.agents.find((a: { slug: string }) => a.slug === AgentSlugs.COMPETITOR_UPDATES);
    expect(updates.frequency).toBe("monthly");
    // Display and next-run agree: the seeded last run + 30 days exactly.
    expect(updates.nextRunAt).toBe(new Date(new Date(updates.lastRunAt).getTime() + 30 * DAY_MS).toISOString());
  });

  it("Given frequency 'off', When put, Then the row reads off with no next run", async () => {
    const res = await request(app)
      .put("/api/settings/agent-schedules")
      .send({ agents: [{ slug: AgentSlugs.COMPETITOR_FEATURES, frequency: "off" }] });
    expect(res.status).toBe(200);
    const features = res.body.agents.find((a: { slug: string }) => a.slug === AgentSlugs.COMPETITOR_FEATURES);
    expect(features.frequency).toBe("off");
    expect(features.nextRunAt).toBeNull();
  });

  it("Given pausedAll true, When put, Then every nextRunAt is null and the state persists; resuming restores next runs", async () => {
    const paused = await request(app).put("/api/settings/agent-schedules").send({ pausedAll: true });
    expect(paused.status).toBe(200);
    expect(paused.body.pausedAll).toBe(true);
    for (const agent of paused.body.agents) {
      expect(agent.nextRunAt).toBeNull();
    }
    // Frequencies survive the pause (merge, don't replace).
    expect(paused.body.agents.find((a: { slug: string }) => a.slug === AgentSlugs.COMPETITOR_UPDATES).frequency)
      .toBe("monthly");

    const get = await request(app).get("/api/settings/agent-schedules");
    expect(get.body.pausedAll).toBe(true);

    const resumed = await request(app).put("/api/settings/agent-schedules").send({ pausedAll: false });
    expect(resumed.body.pausedAll).toBe(false);
    expect(resumed.body.agents.find((a: { slug: string }) => a.slug === AgentSlugs.COMPETITOR_UPDATES).nextRunAt)
      .toEqual(expect.any(String));
  });

  it("Given an unknown slug, When put, Then 400 and nothing is stored", async () => {
    const res = await request(app)
      .put("/api/settings/agent-schedules")
      .send({ agents: [{ slug: "not-a-real-agent", frequency: "daily" }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no scheduled agent/i);
  });

  it("Given an invalid frequency, When put, Then 400 (Zod)", async () => {
    const res = await request(app)
      .put("/api/settings/agent-schedules")
      .send({ agents: [{ slug: AgentSlugs.COMPETITOR_UPDATES, frequency: "hourly" }] });
    expect(res.status).toBe(400);
  });

  it("Given an empty body, When put, Then it is a no-op returning the current view", async () => {
    const res = await request(app).put("/api/settings/agent-schedules").send({});
    expect(res.status).toBe(200);
    expect(res.body.pausedAll).toBe(false);
    expect(res.body.agents).toHaveLength(2);
  });
});

describe("scheduleToFrequency snapping", () => {
  const schedule = (frequencyValue: number, frequencyUnit: "hours" | "days" = "days") =>
    ({ enabled: true, frequencyValue, frequencyUnit, timeOfDay: "09:00" });

  it("snaps day cadences to the contract vocabulary, with 30-day defaults reading as monthly", () => {
    expect(scheduleToFrequency(schedule(1))).toBe("daily");
    expect(scheduleToFrequency(schedule(3))).toBe("every-3-days");
    expect(scheduleToFrequency(schedule(7))).toBe("weekly");
    expect(scheduleToFrequency(schedule(14))).toBe("fortnightly");
    expect(scheduleToFrequency(schedule(30))).toBe("monthly");
    expect(scheduleToFrequency(schedule(12, "hours"))).toBe("daily");
    expect(scheduleToFrequency({ ...schedule(7), enabled: false })).toBe("off");
  });

  it("the B2B Corporate audience default (30 days, defaults.ts) reads as monthly, not fortnightly", () => {
    const defaults = computeDefaultSchedules({ audience: ["B2B (Corporate)"] });
    expect(scheduleToFrequency(defaults["competitorUpdates"]!)).toBe("monthly");
  });
});
