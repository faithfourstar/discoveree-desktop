/**
 * Settings API (ADR 003 §1.1 keeps settings org-scoped and flat).
 *
 *   GET  /api/settings/llm-keys        → masked keys (maskApiKey; never raw)
 *   PUT  /api/settings/llm-keys        → store keys (encrypted via lib/secrets)
 *   POST /api/settings/llm-keys/test   → one cheap provider call to validate
 *   GET  /api/settings/agent-schedules → pause-all + audience-named agent rows
 *   PUT  /api/settings/agent-schedules → persist pause-all / frequencies; same shape back
 *   GET  /api/settings/preferences     → { displayLocale: "auto" | "en-GB" | "en-US" }
 *   PUT  /api/settings/preferences     → persist displayLocale; same shape back
 *   GET  /api/settings/about           → data dir, DB size, version, port
 *
 * llm-keys PUT semantics per field: omitted = unchanged, null = cleared,
 * string = encrypted and stored. Responses always return the masked view —
 * plaintext keys never leave the server after storage.
 */
import type { Express } from "express";
import { Router } from "express";
import { z } from "zod/v4";
import { displayLocaleSchema, scheduleFrequencySchema, type Organization } from "@shared/schema";
import { asyncHandler } from "../../http/asyncHandler.js";
import { BadRequestError } from "../../http/errors.js";
import { encrypt, maskApiKey } from "../../lib/secrets.js";
import { getDecryptedOrgKeys, getOrganization, updateOrganization } from "../../lib/llm/keys.js";
import { getOrgPreferences, updateOrgPreferences } from "../../lib/settings/preferences.js";
import { clearLlmClientCaches } from "../../lib/llm/router.js";
import { getAboutInfo } from "./about.js";
import { getAgentSchedulesView, updateAgentSchedules } from "./schedules.js";
import { LLM_KEY_PROVIDERS, testProviderKey } from "./service.js";

const putLlmKeysBodySchema = z.object({
  openaiApiKey: z.string().trim().min(1).nullish(),
  geminiApiKey: z.string().trim().min(1).nullish(),
  perplexityApiKey: z.string().trim().min(1).nullish(),
  claudeApiKey: z.string().trim().min(1).nullish(),
  openrouterApiKey: z.string().trim().min(1).nullish(),
  llmKeyMode: z.enum(["individual", "openrouter"]).optional(),
});

const putAgentSchedulesBodySchema = z.object({
  pausedAll: z.boolean().optional(),
  agents: z
    .array(z.object({
      slug: z.string().trim().min(1),
      frequency: scheduleFrequencySchema,
    }))
    .optional(),
});

const putPreferencesBodySchema = z.object({
  displayLocale: displayLocaleSchema,
});

const testLlmKeyBodySchema = z.object({
  provider: z.enum(LLM_KEY_PROVIDERS),
  /** When omitted, the stored key for the provider is tested. */
  apiKey: z.string().trim().min(1).optional(),
});

interface LlmKeysView {
  keys: {
    openai: string | null;
    gemini: string | null;
    perplexity: string | null;
    claude: string | null;
    openrouter: string | null;
  };
  llmKeyMode: "individual" | "openrouter";
}

function toMaskedView(org: Organization | undefined): LlmKeysView {
  return {
    keys: {
      openai: maskApiKey(org?.openaiApiKey),
      gemini: maskApiKey(org?.geminiApiKey),
      perplexity: maskApiKey(org?.perplexityApiKey),
      claude: maskApiKey(org?.claudeApiKey),
      openrouter: maskApiKey(org?.openrouterApiKey),
    },
    llmKeyMode: org?.llmKeyMode === "openrouter" ? "openrouter" : "individual",
  };
}

const KEY_COLUMNS = [
  ["openaiApiKey", "openaiApiKey"],
  ["geminiApiKey", "geminiApiKey"],
  ["perplexityApiKey", "perplexityApiKey"],
  ["claudeApiKey", "claudeApiKey"],
  ["openrouterApiKey", "openrouterApiKey"],
] as const;

export function registerSettingsRoutes(app: Express): void {
  const router = Router();

  router.get("/settings/llm-keys", asyncHandler(async (req, res) => {
    const org = await getOrganization(req.ctx.organizationId);
    res.json(toMaskedView(org));
  }));

  router.put("/settings/llm-keys", asyncHandler(async (req, res) => {
    const body = putLlmKeysBodySchema.parse(req.body);

    const update: Record<string, string | null> = {};
    for (const [bodyField, column] of KEY_COLUMNS) {
      const value = body[bodyField];
      if (value === undefined) continue; // omitted → unchanged
      update[column] = value === null ? null : encrypt(value);
    }
    if (body.llmKeyMode !== undefined) {
      update["llmKeyMode"] = body.llmKeyMode;
    }

    if (Object.keys(update).length === 0) {
      throw new BadRequestError("Provide at least one key or the key mode to update.");
    }

    const org = await updateOrganization(req.ctx.organizationId, update);
    // Stored keys changed — drop the router's per-org provider clients.
    clearLlmClientCaches(req.ctx.organizationId);
    res.json(toMaskedView(org));
  }));

  router.post("/settings/llm-keys/test", asyncHandler(async (req, res) => {
    const body = testLlmKeyBodySchema.parse(req.body);

    let apiKey = body.apiKey;
    if (!apiKey) {
      const stored = await getDecryptedOrgKeys(req.ctx.organizationId);
      apiKey = stored[body.provider] || undefined;
    }
    if (!apiKey) {
      throw new BadRequestError("There is no stored key for this provider. Provide a key to test.");
    }

    const result = await testProviderKey(body.provider, apiKey);
    res.json(result);
  }));

  router.get("/settings/agent-schedules", asyncHandler(async (req, res) => {
    res.json(await getAgentSchedulesView(req.ctx.organizationId));
  }));

  // PUT is a partial update (both fields optional per the contract); an empty
  // body is a no-op that still returns the current view.
  router.put("/settings/agent-schedules", asyncHandler(async (req, res) => {
    const body = putAgentSchedulesBodySchema.parse(req.body);
    res.json(await updateAgentSchedules(req.ctx.organizationId, body));
  }));

  router.get("/settings/preferences", asyncHandler(async (req, res) => {
    res.json(await getOrgPreferences(req.ctx.organizationId));
  }));

  // "auto" is a legitimate stored value (client-resolved display); the
  // server itself resolves "auto" to en-GB — see lib/settings/preferences.
  router.put("/settings/preferences", asyncHandler(async (req, res) => {
    const body = putPreferencesBodySchema.parse(req.body);
    res.json(await updateOrgPreferences(req.ctx.organizationId, body));
  }));

  router.get("/settings/about", asyncHandler(async (_req, res) => {
    res.json(await getAboutInfo());
  }));

  // MCP connection snippets (ADR 005 §5.1/§5.2) — copy-paste-true for THIS
  // install via the one resolver; never a hardcoded string.
  router.get("/settings/mcp-config", asyncHandler(async (_req, res) => {
    const { buildMcpConfigSnippets } = await import("../../mcp/cliInvocation.js");
    res.json(buildMcpConfigSnippets());
  }));

  // MCP consumption summary (ADR 005 §2.7) — org-level activity for the
  // Connections/Context Health panels. Payloads are never included; the
  // table never stores them.
  router.get("/settings/mcp-activity", asyncHandler(async (_req, res) => {
    const { getMcpActivitySummary } = await import("../../mcp/activity.js");
    res.json(await getMcpActivitySummary(7));
  }));

  app.use("/api", router);
}
