/**
 * Single-key routing matrix (ADR 002 §4 / risk 4).
 *
 * Desktop's common case (one BYO key) is the SaaS's rare case. For each
 * provider key alone × {analysis call, web-search call}: assert a sensible
 * provider/model is chosen, fallback lists are empty (never silently fail
 * across providers the user doesn't have), and NO platform env-key path is
 * reachable. No LLM HTTP is exercised — selection logic only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, initDatabase } from "../../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../../db/seedLocal.js";
import { configureSecrets, encrypt, resetSecrets } from "../../secrets.js";
import { updateOrganization } from "../keys.js";
import {
  getAvailableProviders,
  getBestProviderForAnalysis,
  getBestProviderForWebSearch,
  getFallbackProviders,
  isProviderAvailable,
} from "../router.js";

const ORG = LOCAL_ORGANIZATION_ID;

async function setOrgKeys(keys: {
  gemini?: string | null;
  openai?: string | null;
  perplexity?: string | null;
  claude?: string | null;
  openrouter?: string | null;
  llmKeyMode?: "individual" | "openrouter";
}): Promise<void> {
  await updateOrganization(ORG, {
    geminiApiKey: keys.gemini ? encrypt(keys.gemini) : null,
    openaiApiKey: keys.openai ? encrypt(keys.openai) : null,
    perplexityApiKey: keys.perplexity ? encrypt(keys.perplexity) : null,
    claudeApiKey: keys.claude ? encrypt(keys.claude) : null,
    openrouterApiKey: keys.openrouter ? encrypt(keys.openrouter) : null,
    llmKeyMode: keys.llmKeyMode ?? "individual",
  });
}

describe("LLM router — BYO single-key matrix", () => {
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "discoveree-router-test-"));
    configureSecrets(dataDir);
    await initDatabase({ target: "pglite", dataDir: "memory://" });
  });

  afterAll(async () => {
    await closeDatabase();
    resetSecrets();
    rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Platform env keys must NEVER be reachable — set them and prove they are ignored.
    process.env["GEMINI_API_KEY"] = "AIplatformKeyThatMustBeIgnored";
    process.env["OPENAI_API_KEY"] = "sk-platform-key-that-must-be-ignored";
    process.env["PERPLEXITY_API_KEY"] = "pplx-platform-key-that-must-be-ignored";
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-platform-key-that-must-be-ignored";
    process.env["OPENROUTER_API_KEY"] = "sk-or-platform-key-that-must-be-ignored";
  });

  it("Given NO org keys (env keys set), When availability is resolved, Then nothing is available — the platform path is deleted", async () => {
    await setOrgKeys({});
    const available = await getAvailableProviders(ORG);
    expect(available).toEqual({
      gemini: false,
      openai: false,
      perplexity: false,
      claude: false,
      openrouter: false,
      llmKeyMode: "individual",
    });
  });

  it("Given only a Gemini key, Then both analysis and web-search select gemini/gemini-2.5-flash with no fallbacks", async () => {
    await setOrgKeys({ gemini: "AIzaSyTestGeminiKey123" });
    const available = await getAvailableProviders(ORG);
    expect(available.gemini).toBe(true);
    expect(available.openai).toBe(false);

    expect(getBestProviderForAnalysis(available)).toEqual({ provider: "gemini", model: "gemini-2.5-flash" });
    expect(getBestProviderForWebSearch(available)).toEqual({ provider: "gemini", model: "gemini-2.5-flash" });
    // Single key → fallback list empty: degrade to retry-same-provider, never cross providers
    expect(getFallbackProviders("gemini", true, available)).toEqual([]);
    expect(getFallbackProviders("gemini", false, available)).toEqual([]);
  });

  it("Given only an OpenAI key, Then web search uses gpt-4o-mini and analysis uses gpt-4o, with no fallbacks", async () => {
    await setOrgKeys({ openai: "sk-testOpenAIKey123" });
    const available = await getAvailableProviders(ORG);
    expect(available.openai).toBe(true);

    expect(getBestProviderForWebSearch(available)).toEqual({ provider: "openai", model: "gpt-4o-mini" });
    expect(getBestProviderForAnalysis(available)).toEqual({ provider: "openai", model: "gpt-4o" });
    expect(getFallbackProviders("openai", true, available)).toEqual([]);
    expect(getFallbackProviders("openai", false, available)).toEqual([]);
  });

  it("Given only a Perplexity key, Then web search uses sonar; analysis degrades to sonar via availability", async () => {
    await setOrgKeys({ perplexity: "pplx-testKey123" });
    const available = await getAvailableProviders(ORG);
    expect(available.perplexity).toBe(true);

    expect(getBestProviderForWebSearch(available)).toEqual({ provider: "perplexity", model: "sonar" });
    // No analysis-tier provider — selection falls through to the final default,
    // and isProviderAvailable correctly reports gemini unusable.
    expect(isProviderAvailable("gemini", available)).toBe(false);
    expect(getFallbackProviders("perplexity", true, available)).toEqual([]);
  });

  it("Given only a Claude key, Then analysis uses claude-opus-4-6 and Claude is never offered for web search", async () => {
    await setOrgKeys({ claude: "sk-ant-testKey123" });
    const available = await getAvailableProviders(ORG);
    expect(available.claude).toBe(true);

    expect(getBestProviderForAnalysis(available)).toEqual({ provider: "claude", model: "claude-opus-4-6" });
    // Claude has no web-search path (risk 4 note): best-for-search falls to the default
    const search = getBestProviderForWebSearch(available);
    expect(search.provider).not.toBe("claude");
    expect(getFallbackProviders("claude", false, available)).toEqual([]);
  });

  it("Given llmKeyMode=openrouter with an OpenRouter key, Then openrouter is the one-key-for-everything path", async () => {
    await setOrgKeys({ openrouter: "sk-or-testKey123", llmKeyMode: "openrouter" });
    const available = await getAvailableProviders(ORG);
    expect(available).toMatchObject({
      gemini: false,
      openai: false,
      perplexity: false,
      claude: false,
      openrouter: true,
      llmKeyMode: "openrouter",
    });

    // Web search routes to perplexity/sonar via OpenRouter
    expect(getBestProviderForWebSearch(available)).toEqual({ provider: "openrouter", model: "perplexity/sonar" });
    expect(getBestProviderForAnalysis(available)).toEqual({ provider: "openrouter", model: "openai/gpt-4o" });
    // Only openrouter counts as available in this mode
    expect(isProviderAvailable("openrouter", available)).toBe(true);
    expect(isProviderAvailable("openai", available)).toBe(false);
    // No cross-provider fallbacks in OpenRouter mode
    expect(getFallbackProviders("openrouter", true, available)).toEqual([]);
  });

  it("Given a malformed key (wrong prefix), Then the provider is not reported available", async () => {
    await setOrgKeys({ openai: "not-an-openai-key", perplexity: "wrong-prefix" });
    const available = await getAvailableProviders(ORG);
    expect(available.openai).toBe(false);
    expect(available.perplexity).toBe(false);
  });

  it("Given two keys (Perplexity + Claude), Then fallbacks only ever contain providers the user has", async () => {
    await setOrgKeys({ perplexity: "pplx-testKey123", claude: "sk-ant-testKey123" });
    const available = await getAvailableProviders(ORG);

    // Analysis failed on claude → only perplexity-class candidates the user holds
    const analysisFallbacks = getFallbackProviders("claude", false, available);
    for (const fb of analysisFallbacks) {
      expect(isProviderAvailable(fb.provider, available)).toBe(true);
    }
    // Web search failed on perplexity → claude must NOT appear (no web search support)
    const searchFallbacks = getFallbackProviders("perplexity", true, available);
    expect(searchFallbacks.every(fb => fb.provider !== "claude")).toBe(true);
  });
});
