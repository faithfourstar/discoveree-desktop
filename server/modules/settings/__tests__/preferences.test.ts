/**
 * Display-preferences settings surface (fixed contract for the parallel
 * client work): GET/PUT /api/settings/preferences round-trip, merge-don't-
 * replace with the scheduling block in the same organizations.settings
 * jsonb, and the synthesis-language seam — the resolved locale drives the
 * one-line language instruction the synthesis prompts append ("auto" and
 * nothing-stored resolve to en-GB on the server).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

// Capture prompts the synthesis agents send (house pattern: themes.test.ts).
const captured = vi.hoisted(() => ({ prompts: [] as string[] }));

vi.mock("../../../lib/llm/router.js", () => ({
  callLLM: vi.fn(async (config: { prompt?: string }) => {
    captured.prompts.push(config.prompt ?? "");
    return {
      text: JSON.stringify({ themes: [], analysisNotes: "" }),
      promptTokens: 1,
      completionTokens: 1,
      model: "mock",
      provider: "gemini" as const,
    };
  }),
  collectAllowedSourceUrls: () => new Set<string>(),
  enforceSourceUrlAllowList: (value: unknown) => ({ value, stripped: [] }),
  clearLlmClientCaches: vi.fn(),
}));

import { buildApp } from "../../../app.js";
import { closeDatabase, initDatabase } from "../../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../../db/seedLocal.js";
import {
  getSynthesisLanguageInstruction,
  resolveSynthesisLocale,
  synthesisLanguageInstruction,
  updateOrgPreferences,
} from "../../../lib/settings/preferences.js";
import { getOrgSchedulingSettings } from "../../../lib/settings/agentScheduling.js";
import { clusterResidueEntries } from "../../customers/agents/themes.js";

let app: Express;

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  app = buildApp();
});

afterAll(async () => {
  await closeDatabase();
});

describe("GET/PUT /api/settings/preferences", () => {
  it("Given nothing stored, When read, Then displayLocale is auto", async () => {
    const res = await request(app).get("/api/settings/preferences");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ displayLocale: "auto" });
  });

  it("Given a PUT of en-US, When read back, Then it persisted", async () => {
    const put = await request(app)
      .put("/api/settings/preferences")
      .send({ displayLocale: "en-US" });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ displayLocale: "en-US" });

    const get = await request(app).get("/api/settings/preferences");
    expect(get.body).toEqual({ displayLocale: "en-US" });
  });

  it("preferences and scheduling merge into the same jsonb without clobbering each other", async () => {
    // Write a scheduling value…
    const schedules = await request(app)
      .put("/api/settings/agent-schedules")
      .send({ pausedAll: true });
    expect(schedules.status).toBe(200);

    // …then a preferences value; both survive (merge, don't replace).
    await request(app).put("/api/settings/preferences").send({ displayLocale: "en-GB" });

    const prefs = await request(app).get("/api/settings/preferences");
    expect(prefs.body).toEqual({ displayLocale: "en-GB" });
    const scheduling = await getOrgSchedulingSettings(LOCAL_ORGANIZATION_ID);
    expect(scheduling.pausedAll).toBe(true);

    // And the reverse order also preserves preferences.
    await request(app).put("/api/settings/agent-schedules").send({ pausedAll: false });
    const prefsAfter = await request(app).get("/api/settings/preferences");
    expect(prefsAfter.body).toEqual({ displayLocale: "en-GB" });
  });

  it("an unknown locale → 400 (Zod)", async () => {
    const res = await request(app)
      .put("/api/settings/preferences")
      .send({ displayLocale: "fr-FR" });
    expect(res.status).toBe(400);
  });
});

describe("synthesis-language resolution", () => {
  it("'auto' resolves to en-GB on the server; en-US passes through", () => {
    expect(resolveSynthesisLocale("auto")).toBe("en-GB");
    expect(resolveSynthesisLocale("en-GB")).toBe("en-GB");
    expect(resolveSynthesisLocale("en-US")).toBe("en-US");
  });

  it("the instruction names the language and protects quoted verbatims", () => {
    expect(synthesisLanguageInstruction("en-GB")).toContain("British English");
    expect(synthesisLanguageInstruction("en-US")).toContain("American English");
    for (const locale of ["en-GB", "en-US"] as const) {
      expect(synthesisLanguageInstruction(locale)).toContain("Never rewrite");
    }
  });

  it("an empty organisation id defaults to British English (no read attempted)", async () => {
    const instruction = await getSynthesisLanguageInstruction("");
    expect(instruction).toContain("British English");
  });
});

describe("the synthesis prompt carries the stored locale's instruction", () => {
  const entry = {
    id: "entry-1",
    quotedText: "The colour picker crashes",
    topic: null,
    sentiment: 30,
    sourceName: "G2",
  };

  it("Given displayLocale en-US, When the residue clustering prompt is built, Then it mandates American English", async () => {
    await updateOrgPreferences(LOCAL_ORGANIZATION_ID, { displayLocale: "en-US" });
    captured.prompts.length = 0;

    await clusterResidueEntries([entry], "Acme", LOCAL_ORGANIZATION_ID);
    expect(captured.prompts).toHaveLength(1);
    expect(captured.prompts[0]).toContain(synthesisLanguageInstruction("en-US"));
    expect(captured.prompts[0]).not.toContain("British English");
  });

  it("Given displayLocale back to auto, When the prompt is built, Then it mandates British English (the server default)", async () => {
    await updateOrgPreferences(LOCAL_ORGANIZATION_ID, { displayLocale: "auto" });
    captured.prompts.length = 0;

    await clusterResidueEntries([entry], "Acme", LOCAL_ORGANIZATION_ID);
    expect(captured.prompts).toHaveLength(1);
    expect(captured.prompts[0]).toContain(synthesisLanguageInstruction("en-GB"));
    // The quoted verbatim itself is untouched input, whatever the locale.
    expect(captured.prompts[0]).toContain("The colour picker crashes");
  });
});
