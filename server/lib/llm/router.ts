/**
 * Multi-provider LLM router — ported from the SaaS server/llmRouter.ts
 * (TAKE-PARTIAL per ADR 002 §5).
 *
 * DELETED during port (not disabled):
 * - `enforceOrgBudget` / `LLMBudgetExceededError` + llmCredits — platform-
 *   billed credits don't exist on desktop; the user's spend is their own
 *   provider bill (trackLlmUsage still records it for Settings).
 * - Langfuse spans — platform observability.
 * - The /tmp/llm_debug.log file logger — replaced with console logging.
 * - Platform-key fallbacks (process.env lookups) and the platform key-health
 *   checker — desktop is BYO; `getAvailableProviders` reads only the local
 *   org row's encrypted keys.
 * - `resolveAgentPrompt`/`getAgentConfig` — moved to lib/agents/registry.ts.
 *
 * Everything else — provider call functions, two-phase web-search+schema
 * approaches, selection/fallback logic, retry, validation — ports verbatim.
 */
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AsyncLocalStorage } from "node:async_hooks";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getAiAgentBySlug } from "../agents/registry.js";
import { createAiAgentExecution, updateAiAgentExecution } from "../agents/executions.js";
import { isGroundingRedirectUrl } from "../web/urls.js";
import { sanitizeJsonResponse } from "./json.js";
import { trackLlmUsage } from "./usage.js";
import { getGeminiClient, getGeminiKeySource } from "./providers/gemini.js";
import { getClaudeClient, DEFAULT_CLAUDE_MODEL } from "./providers/claude.js";
import {
  getOpenAIApiKey,
  getPerplexityApiKey,
  getOpenRouterApiKey,
  getDecryptedOrgKeys,
} from "./keys.js";

function toJsonSchema(schema: any): any {
  if (schema && typeof schema === "object" && "_def" in schema) {
    const converted = zodToJsonSchema(schema, { target: "openApi3" }) as any;
    const { $schema, ...rest } = converted;
    return rest;
  }
  return schema;
}

/**
 * Converts a response schema (Gemini-style `Type.OBJECT`, Zod, or plain JSON Schema)
 * into an OpenAI *strict* JSON Schema suitable for the Responses API `json_schema`
 * format. Strict mode is what lets OpenAI do web search AND structured output in one
 * call. Returns null when the schema can't be represented strictly, signalling the
 * caller to fall back to the two-phase approach.
 */
export function toStrictOpenAISchema(schema: any): any | null {
  try {
    const normalised = toJsonSchema(schema);
    const walk = (node: any): any => {
      if (!node || typeof node !== "object") return node;
      const out: any = Array.isArray(node) ? [] : {};

      for (const [k, v] of Object.entries(node)) {
        if (k === "type" && typeof v === "string") {
          out.type = v.toLowerCase();
        } else if (k === "type" && Array.isArray(v)) {
          out.type = v.map(t => (typeof t === "string" ? t.toLowerCase() : t));
        } else if (k === "properties" && v && typeof v === "object") {
          out.properties = Object.fromEntries(
            Object.entries(v).map(([pk, pv]) => [pk, walk(pv)]),
          );
        } else if (k === "items") {
          out.items = walk(v);
        } else {
          out[k] = walk(v);
        }
      }

      const nodeType = out.type;
      if (nodeType === "object" && out.properties) {
        const keys = Object.keys(out.properties);
        const originallyRequired: string[] = Array.isArray(node.required) ? node.required : [];
        // Strict mode: everything must be required. Preserve true optionality by
        // making originally-optional fields nullable.
        for (const key of keys) {
          if (!originallyRequired.includes(key)) {
            const prop = out.properties[key];
            const t = prop.type;
            if (typeof t === "string" && t !== "null") {
              prop.type = [t, "null"];
            } else if (Array.isArray(t) && !t.includes("null")) {
              prop.type = [...t, "null"];
            }
          }
        }
        out.required = keys;
        out.additionalProperties = false;
      }
      return out;
    };
    return walk(normalised);
  } catch {
    return null;
  }
}

// ============================================================================
// GROUNDED CITATIONS — extraction + allow-list enforcement (evidence gate).
//
// The Gemini web-search+schema path previously read the grounded response for
// TEXT only: phase 2 "extracted" sourceUrl fields from phase-1 prose, so
// citations were model-reconstructed, not real (owner-reported, 4 Aug 2026).
// These helpers make Gemini citations real: pull the grounding chunks out of
// the response, feed them to phase 2 as an explicit allow-list, and STRIP any
// URL-shaped output field that is not on it. Exported so agent-level evidence
// gates (ADR 004) can reuse the enforcement.
// ============================================================================

/**
 * Extract real web URLs from a Gemini response's grounding metadata
 * (candidates[0].groundingMetadata.groundingChunks[].web.uri, per the
 * @google/genai GroundingChunkWeb type). Google's vertexaisearch redirect
 * URLs are DROPPED, matching the house rule everywhere else (lib/web/urls.ts
 * isGroundingRedirectUrl: "must never be stored as official/source URLs";
 * agents reject them, nothing in the codebase resolves them).
 */
export function extractGeminiGroundingCitations(response: unknown): string[] {
  const chunks = (response as any)?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const urls: string[] = [];
  let redirectCount = 0;
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    if (typeof uri !== "string" || !/^https?:\/\//i.test(uri.trim())) continue;
    const cleaned = uri.trim();
    if (isGroundingRedirectUrl(cleaned)) {
      redirectCount++;
      continue;
    }
    if (!urls.includes(cleaned)) urls.push(cleaned);
  }
  if (redirectCount > 0) {
    console.log(`[LLMRouter] Grounding: dropped ${redirectCount} vertexaisearch redirect URL(s) — redirects are never stored as sources`);
  }
  return urls;
}

const URL_IN_TEXT_REGEX = /https?:\/\/[^\s"'<>()\[\]{}]+/g;

/** Comparison key for allow-list membership: trimmed, trailing punctuation/slash removed, lower-cased. */
function normaliseUrlForAllowList(url: string): string {
  return url.trim().replace(/[.,;:!?]+$/, "").replace(/\/+$/, "").toLowerCase();
}

/**
 * Build the citation allow-list for an extraction pass: the grounded
 * citations plus every URL verbatim-present in the research text.
 */
export function collectAllowedSourceUrls(
  citations: string[] | undefined,
  researchText: string | undefined,
): Set<string> {
  const allowed = new Set<string>();
  for (const c of citations ?? []) {
    if (!isGroundingRedirectUrl(c)) allowed.add(normaliseUrlForAllowList(c));
  }
  for (const match of (researchText ?? "").match(URL_IN_TEXT_REGEX) ?? []) {
    if (!isGroundingRedirectUrl(match)) allowed.add(normaliseUrlForAllowList(match));
  }
  return allowed;
}

/**
 * Enforcement, not hope: deep-walk a parsed JSON value and strip every
 * URL-shaped STRING FIELD whose URL is not in the allow-list — object fields
 * become null, array elements are removed (a null hole would fail the
 * agents' Zod array-of-string schemas). Prose strings that merely CONTAIN a
 * URL are left alone — only fields that ARE a URL are subject to the gate.
 * Grounding redirect URLs are always stripped, allow-listed or not.
 * Exported for reuse by agent-level evidence gates (ADR 004).
 */
export function enforceSourceUrlAllowList<T>(
  value: T,
  allowed: ReadonlySet<string> | string[],
): { value: T; stripped: string[] } {
  const allowedSet = allowed instanceof Set
    ? allowed
    : new Set([...allowed].map(normaliseUrlForAllowList));
  const stripped: string[] = [];

  const isUrlField = (s: string): boolean => /^https?:\/\/\S+$/i.test(s.trim());
  const isAllowed = (s: string): boolean =>
    !isGroundingRedirectUrl(s.trim()) && allowedSet.has(normaliseUrlForAllowList(s));

  const walk = (node: any): any => {
    if (typeof node === "string") {
      if (isUrlField(node) && !isAllowed(node)) {
        stripped.push(node.trim());
        return null;
      }
      return node;
    }
    if (Array.isArray(node)) {
      return node
        .map(item => {
          if (typeof item === "string" && isUrlField(item) && !isAllowed(item)) {
            stripped.push(item.trim());
            return STRIP_SENTINEL;
          }
          return walk(item);
        })
        .filter(item => item !== STRIP_SENTINEL);
    }
    if (node && typeof node === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  };

  return { value: walk(value) as T, stripped };
}

const STRIP_SENTINEL = Symbol("stripped-url");

/**
 * Whether this Gemini model supports googleSearch grounding AND structured
 * output (responseSchema) in ONE call. Checked 4 Aug 2026 against
 * ai.google.dev/gemini-api/docs/structured-output: "Gemini 3 lets you combine
 * Structured Outputs with built-in tools, including Grounding with Google
 * Search". Gemini 2.5 and earlier still REJECT the combination ("controlled
 * generation is not supported with google_search tool" — see
 * googleapis/python-genai#665), so those models use the hardened two-phase
 * path directly.
 */
export function supportsGroundedStructuredOutput(model: string): boolean {
  const match = model.match(/^gemini-(\d+(?:\.\d+)?)/);
  if (!match) return false;
  return parseFloat(match[1]!) >= 3;
}

/** Shared phase-2 instruction: cite only from the allow-list, never construct URLs. */
function buildSourcesBlock(citations: string[]): string {
  if (citations.length === 0) {
    return "\n\nCITATION RULE: any sourceUrl/websiteUrl/citation field may ONLY contain a URL that appears verbatim in the research text below. If no such URL supports a field, use null. NEVER construct, guess, or complete URLs.";
  }
  return `\n\nSOURCES — the only URLs you may cite:\n${citations.map((u, i) => `${i + 1}. ${u}`).join("\n")}\nAny sourceUrl/websiteUrl/citation field MUST be copied verbatim from this list (or from a URL appearing verbatim in the research text). If no listed source supports a field, use null. NEVER construct, guess, or complete URLs.`;
}

// ============================================================================
// REQUEST CONTEXT — propagated via AsyncLocalStorage so callLLM can log the
// originating endpoint path without requiring every call site to pass it.
// ============================================================================
interface RequestContext {
  path: string;
  method: string;
}
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

// ============================================================================
// LLM DEBUG LOGGING — console-only on desktop (the SaaS file logger is gone).
// ============================================================================

const LLM_DEBUG_ENABLED = process.env["NODE_ENV"] !== "production" || process.env["LLM_DEBUG"] === "true";

type LLMProviderDebug = "openai" | "gemini" | "perplexity" | "claude" | "openrouter";

function generateLLMCorrelationId(provider: LLMProviderDebug): string {
  const prefix = {
    openai: "oai",
    gemini: "gem",
    perplexity: "pplx",
    claude: "claud",
    openrouter: "or",
  }[provider];
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function logLLMDebug(provider: LLMProviderDebug, correlationId: string, event: string, data: unknown): void {
  if (!LLM_DEBUG_ENABLED && !event.includes("ERROR") && event !== "SUCCESS") {
    return;
  }
  console.log(`[${provider.toUpperCase()} Debug] ${correlationId} - ${event}:`, JSON.stringify(data));
}

// Helper to truncate content for logging
function truncateForLog(content: string, maxLength: number = 500): string {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + `... [truncated, total ${content.length} chars]`;
}

// Sanitize prompt for logging - remove potential PII patterns
function sanitizePromptForLogging(prompt: string, maxLength: number = 100): string {
  if (process.env["NODE_ENV"] === "production") {
    return `[${prompt.length} chars]`;
  }
  const truncated = prompt.substring(0, maxLength);
  const sanitized = truncated.replace(/[\w.-]+@[\w.-]+\.\w+/g, "[EMAIL]");
  return sanitized + (prompt.length > maxLength ? "..." : "");
}

// Gemini safety settings - use BLOCK_ONLY_HIGH to minimize false positives
const GEMINI_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

export type LLMProvider = "gemini" | "openai" | "perplexity" | "claude" | "openrouter";

export interface VisionImage {
  mimeType: string;
  data: string; // base64-encoded
  title?: string;
}

export interface LLMRequestConfig {
  organizationId: string;
  productId?: string;
  agentSlug?: string;
  prompt?: string;
  systemPrompt?: string;
  messages?: Array<{ role: string; content: any }>;
  useWebSearch?: boolean;
  responseSchema?: any;
  temperature?: number;
  maxTokens?: number;
  triggerType?: "automatic" | "manual" | "test";
  triggerContext?: string;
  inputSummary?: Record<string, any>;
  visionImages?: VisionImage[];
  requestPath?: string;
  tools?: object[];
  toolChoice?: string | object;
  forceProvider?: LLMProvider;
  forceModel?: string;
}

export interface LLMResponse {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  provider: LLMProvider;
  toolCalls?: OpenAI.Chat.ChatCompletionMessageToolCall[];
  // Real source URLs. Perplexity: numbered [n] citation markers in the text
  // ([1] refers to citations[0]). Gemini web-search calls: the grounding
  // chunks' web URLs (redirects dropped) in chunk order. Undefined for
  // providers/calls without citations.
  citations?: string[];
}

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_PROVIDER: LLMProvider = "gemini";

const openAIClientCache = new Map<string, { client: OpenAI; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getOpenAIClient(organizationId: string): Promise<OpenAI> {
  const cached = openAIClientCache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client;
  }

  const apiKey = await getOpenAIApiKey(organizationId);
  if (!apiKey) {
    throw new Error("No OpenAI API key configured. Please add your OpenAI API key in Settings.");
  }

  const client = new OpenAI({ apiKey });
  openAIClientCache.set(organizationId, {
    client,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return client;
}

// ============================================================================
// OPENROUTER SUPPORT — OpenAI-compatible API at https://openrouter.ai/api/v1
// ============================================================================

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT_MODEL = "openai/gpt-4o";

const openRouterClientCache = new Map<string, { client: OpenAI; expiresAt: number }>();

async function getOpenRouterClient(organizationId: string): Promise<OpenAI> {
  const cached = openRouterClientCache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client;
  }

  const apiKey = await getOpenRouterApiKey(organizationId);
  if (!apiKey) {
    throw new Error("No OpenRouter API key configured. Please add your OpenRouter API key in Settings.");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://discoveree.io",
      "X-Title": "Discoveree",
    },
  });
  openRouterClientCache.set(organizationId, {
    client,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return client;
}

/** Clear per-org client caches (call when API keys change in Settings). */
export function clearLlmClientCaches(organizationId: string): void {
  openAIClientCache.delete(organizationId);
  openRouterClientCache.delete(organizationId);
}

async function callOpenRouter(
  organizationId: string,
  model: string,
  prompt: string,
  systemPrompt?: string,
  responseSchema?: any,
  temperature?: number,
  maxTokens?: number,
  nativeMessages?: Array<{ role: string; content: string }>,
): Promise<LLMResponse> {
  const correlationId = generateLLMCorrelationId("openrouter");
  const startTime = Date.now();

  logLLMDebug("openrouter", correlationId, "REQUEST_START", {
    organizationId,
    model,
    promptLength: prompt.length,
    hasResponseSchema: !!responseSchema,
  });

  const client = await getOpenRouterClient(organizationId);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (nativeMessages && nativeMessages.length > 0) {
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    for (const m of nativeMessages) {
      messages.push({ role: m.role as "user" | "assistant", content: m.content });
    }
  } else {
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });
  }

  const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
    model,
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens,
  };

  if (responseSchema) {
    requestParams.response_format = { type: "json_object" };
  }

  let response: OpenAI.Chat.ChatCompletion;
  const fetchStartTime = Date.now();

  try {
    response = (await client.chat.completions.create(requestParams)) as OpenAI.Chat.ChatCompletion;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logLLMDebug("openrouter", correlationId, "API_ERROR", {
      latencyMs: Date.now() - startTime,
      fetchLatencyMs: Date.now() - fetchStartTime,
      error: errorMessage,
      model,
    });
    throw error;
  }

  const text = response.choices?.[0]?.message?.content || "";
  const usage = response.usage;

  logLLMDebug("openrouter", correlationId, "SUCCESS", {
    latencyMs: Date.now() - startTime,
    model,
    textLength: text.length,
    usage: { promptTokens: usage?.prompt_tokens || 0, completionTokens: usage?.completion_tokens || 0 },
  });

  return {
    text,
    promptTokens: usage?.prompt_tokens || 0,
    completionTokens: usage?.completion_tokens || 0,
    model,
    provider: "openrouter",
  };
}

async function callGemini(
  organizationId: string,
  model: string,
  prompt: string | undefined,
  systemPrompt?: string,
  useWebSearch?: boolean,
  responseSchema?: any,
  temperature?: number,
  messages?: Array<{ role: string; content: string }>,
  visionImages?: VisionImage[],
): Promise<LLMResponse> {
  const correlationId = generateLLMCorrelationId("gemini");
  const startTime = Date.now();

  let contents: any;
  if (messages && messages.length > 0) {
    contents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  } else {
    const textContent = systemPrompt
      ? `${systemPrompt}\n\n${prompt ?? ""}`
      : (prompt ?? "");
    if (visionImages && visionImages.length > 0) {
      const parts: any[] = [{ text: textContent }];
      for (const img of visionImages) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
      contents = [{ role: "user", parts }];
    } else {
      contents = textContent;
    }
  }

  const promptLength = typeof contents === "string" ? contents.length : (messages || []).reduce((acc, m) => acc + m.content.length, 0);
  const estimatedTokens = Math.ceil(promptLength / 4);

  // Web search + structured JSON on Gemini:
  //
  // Preferred (Gemini 3+ only — see supportsGroundedStructuredOutput): ONE
  // call doing googleSearch grounding AND responseSchema, mirroring the
  // OpenAI single-call pattern; any error (or unverifiable grounding) falls
  // back to the hardened two-phase path. Correctness never depends on
  // single-call succeeding.
  //
  // Two-phase (Gemini ≤2.5, and the fallback): Phase 1 runs with web search
  // to get grounded research text; its groundingMetadata is extracted into a
  // REAL citation list. Phase 2 extracts structured JSON with that list as an
  // explicit citation allow-list, and the output is enforced against it —
  // URL fields the model reconstructed rather than grounded are stripped to
  // null (evidence gate, ADR 004).
  if (useWebSearch && responseSchema) {
    if (supportsGroundedStructuredOutput(model)) {
      try {
        logLLMDebug("gemini", correlationId, "SINGLE_CALL_GROUNDED_SCHEMA_START", { model });
        const client = await getGeminiClient(organizationId);
        const singleConfig: any = {
          temperature: temperature ?? 0.7,
          safetySettings: GEMINI_SAFETY_SETTINGS,
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: toJsonSchema(responseSchema),
        };
        if (messages && messages.length > 0 && systemPrompt) {
          singleConfig.systemInstruction = systemPrompt;
        }
        const singleResponse: any = await client.models.generateContent({ model, contents, config: singleConfig });
        const singleText: string = singleResponse.text || "";
        if (!singleText.trim()) {
          throw new Error("Grounded single call returned no text");
        }
        const singleCitations = extractGeminiGroundingCitations(singleResponse);
        if (singleCitations.length === 0) {
          // No verifiable grounding → the evidence gate cannot hold; use the
          // hardened two-phase path instead of returning unverifiable URLs.
          throw new Error("Grounded single call returned no verifiable grounding citations");
        }
        let enforcedText = singleText;
        try {
          const parsed = JSON.parse(sanitizeJsonResponse(singleText) || "");
          const { value, stripped } = enforceSourceUrlAllowList(parsed, collectAllowedSourceUrls(singleCitations, undefined));
          if (stripped.length > 0) {
            logLLMDebug("gemini", correlationId, "CITATION_ALLOWLIST_STRIPPED", {
              phase: "single-call",
              strippedCount: stripped.length,
              stripped: stripped.slice(0, 5),
            });
          }
          enforcedText = JSON.stringify(value);
        } catch {
          // Not parseable JSON — leave for the caller's own Zod validation.
        }
        const singleUsage = singleResponse.usageMetadata || {};
        return {
          text: enforcedText,
          promptTokens: singleUsage.promptTokenCount || 0,
          completionTokens: (singleUsage.candidatesTokenCount || 0) + (singleUsage.thoughtsTokenCount || 0),
          model,
          provider: "gemini",
          citations: singleCitations,
        };
      } catch (singleErr) {
        const msg = singleErr instanceof Error ? singleErr.message : String(singleErr);
        logLLMDebug("gemini", correlationId, "SINGLE_CALL_GROUNDED_SCHEMA_FALLBACK", { model, error: msg.slice(0, 200) });
      }
    }

    logLLMDebug("gemini", correlationId, "TWO_PHASE_START", {
      reason: "Gemini web search and responseSchema are mutually exclusive on this model — using hardened two-phase approach",
      model,
    });

    // Phase 1: grounded research (web search, no schema). The recursive call
    // extracts groundingMetadata into phase1Result.citations.
    const phase1Result = await callGemini(
      organizationId, model, prompt, systemPrompt,
      true, undefined, temperature, messages, visionImages,
    );

    const phase1Text = phase1Result.text;

    if (!phase1Text || phase1Text.trim() === "") {
      logLLMDebug("gemini", correlationId, "TWO_PHASE_PHASE1_EMPTY", { model });
      return phase1Result;
    }

    const groundedCitations = phase1Result.citations ?? [];
    if (groundedCitations.length === 0) {
      logLLMDebug("gemini", correlationId, "TWO_PHASE_NO_GROUNDING_CITATIONS", {
        model,
        note: "phase 1 returned no grounding chunks — only URLs verbatim in the research text may survive enforcement",
      });
    }

    // Phase 2: schema extraction (no web search, with schema) with the real
    // grounded sources as an explicit citation allow-list.
    const extractionPrompt = `You are a data extraction assistant. Below is research gathered from the web. Extract and structure the information into the required JSON format. Return only valid JSON — no markdown, no explanation.${buildSourcesBlock(groundedCitations)}

RESEARCH:
${phase1Text}`;

    const phase2Result = await callGemini(
      organizationId, model, extractionPrompt, undefined,
      false, responseSchema, 0.2, undefined, undefined,
    );

    // Enforcement, not hope: strip every URL-shaped field the model produced
    // that is neither a grounded citation nor verbatim-present in phase 1.
    let enforcedText = phase2Result.text;
    try {
      const parsed = JSON.parse(sanitizeJsonResponse(phase2Result.text) || "");
      const { value, stripped } = enforceSourceUrlAllowList(
        parsed,
        collectAllowedSourceUrls(groundedCitations, phase1Text),
      );
      if (stripped.length > 0) {
        logLLMDebug("gemini", correlationId, "CITATION_ALLOWLIST_STRIPPED", {
          phase: "two-phase",
          strippedCount: stripped.length,
          stripped: stripped.slice(0, 5),
        });
      }
      enforcedText = JSON.stringify(value);
    } catch {
      // Not parseable JSON — leave for the caller's own Zod validation.
    }

    return {
      text: enforcedText,
      promptTokens: (phase1Result.promptTokens || 0) + (phase2Result.promptTokens || 0),
      completionTokens: (phase1Result.completionTokens || 0) + (phase2Result.completionTokens || 0),
      model,
      provider: "gemini",
      ...(groundedCitations.length > 0 ? { citations: groundedCitations } : {}),
    };
  }

  logLLMDebug("gemini", correlationId, "REQUEST_START", {
    organizationId,
    model,
    promptLength,
    useWebSearch: !!useWebSearch,
    hasResponseSchema: !!responseSchema,
  });

  try {
    const keySource = await getGeminiKeySource(organizationId);
    if (!keySource.configured) {
      console.warn(`[LLMRouter] Gemini API key not configured: ${keySource.description}`);
    }
  } catch {
    // Non-blocking - continue even if we can't check key source
  }

  const client = await getGeminiClient(organizationId);

  const config: any = {
    temperature: temperature ?? 0.7,
    safetySettings: GEMINI_SAFETY_SETTINGS,
  };

  if (messages && messages.length > 0 && systemPrompt) {
    config.systemInstruction = systemPrompt;
  }

  if (useWebSearch) {
    config.tools = [{ googleSearch: {} }];
  }

  if (responseSchema && !useWebSearch) {
    config.responseMimeType = "application/json";
    config.responseSchema = toJsonSchema(responseSchema);
  }

  const fetchStartTime = Date.now();
  let response: any;

  const maxRetries = 1;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      response = await client.models.generateContent({
        model,
        contents,
        config,
      });
      break;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTransientError = /502|503|429|Bad Gateway|Service Unavailable|overloaded|rate.limit/i.test(errorMessage);

      if (isTransientError && attempt < maxRetries) {
        const backoffMs = 3000 * (attempt + 1);
        console.warn(`[LLMRouter] Gemini transient error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoffMs}ms: ${errorMessage.substring(0, 150)}`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      logLLMDebug("gemini", correlationId, "API_ERROR", {
        latencyMs: Date.now() - startTime,
        fetchLatencyMs: Date.now() - fetchStartTime,
        error: errorMessage,
        model,
        attempt: attempt + 1,
      });
      throw error;
    }
  }

  // Check for safety blocks or other finish reasons in candidates
  const candidates = (response as any).candidates;
  if (candidates && candidates.length > 0) {
    const candidate = candidates[0];
    const finishReason = candidate.finishReason;

    // Handle safety blocks gracefully - return empty response instead of throwing
    if (finishReason === "SAFETY") {
      const blockReason = (response as any).promptFeedback?.blockReason || "UNKNOWN";
      logLLMDebug("gemini", correlationId, "SAFETY_BLOCK_ERROR", {
        latencyMs: Date.now() - startTime,
        blockReason,
      });
      return {
        text: JSON.stringify({
          error: "content_filtered",
          message: "The AI could not process this request due to content safety guidelines.",
          reason: blockReason,
        }),
        promptTokens: (response as any).usageMetadata?.promptTokenCount || estimatedTokens,
        completionTokens: 0,
        model,
        provider: "gemini",
      };
    }

    // Handle recitation blocks gracefully
    if (finishReason === "RECITATION") {
      logLLMDebug("gemini", correlationId, "RECITATION_BLOCK_ERROR", {
        latencyMs: Date.now() - startTime,
      });
      return {
        text: JSON.stringify({
          error: "recitation_filtered",
          message: "The AI response was filtered to avoid potential copyright issues.",
        }),
        promptTokens: (response as any).usageMetadata?.promptTokenCount || estimatedTokens,
        completionTokens: 0,
        model,
        provider: "gemini",
      };
    }
  }

  // Check for prompt-level blocks - return graceful response
  const promptFeedback = (response as any).promptFeedback;
  if (promptFeedback?.blockReason) {
    logLLMDebug("gemini", correlationId, "PROMPT_BLOCKED_ERROR", {
      latencyMs: Date.now() - startTime,
      blockReason: promptFeedback.blockReason,
    });
    return {
      text: JSON.stringify({
        error: "prompt_blocked",
        message: "The request could not be processed due to content guidelines.",
        reason: promptFeedback.blockReason,
      }),
      promptTokens: estimatedTokens,
      completionTokens: 0,
      model,
      provider: "gemini",
    };
  }

  const text = response.text || "";
  const usage = response.usageMetadata || {};

  // Handle successful vs empty response
  if (!text) {
    const diagnosticInfo = {
      correlationId,
      latencyMs: Date.now() - startTime,
      model,
      promptLength,
      estimatedTokens,
      usage,
      candidatesCount: (response as any).candidates?.length || 0,
      finishReason: (response as any).candidates?.[0]?.finishReason,
    };

    logLLMDebug("gemini", correlationId, "EMPTY_RESPONSE_ERROR", diagnosticInfo);

    throw new LLMEmptyResponseError(
      `Gemini returned no text. Model: ${model}, Finish reason: ${(response as any).candidates?.[0]?.finishReason || "unknown"}, CorrelationId: ${correlationId}`,
      "gemini",
      model,
      diagnosticInfo,
    );
  }

  logLLMDebug("gemini", correlationId, "SUCCESS", {
    latencyMs: Date.now() - startTime,
    model,
    textLength: text.length,
    textPreview: truncateForLog(text, 200),
  });

  // Gemini 3.5+ models return thinkingTokenCount as part of usageMetadata.
  // These are billed as OUTPUT tokens, so they MUST be added to completionTokens
  // or cost tracking will under-report by a large factor.
  const visibleOutput = usage.candidatesTokenCount || 0;
  const thinkingTokens = (usage as any).thoughtsTokenCount || 0;
  const totalCompletionTokens = visibleOutput + thinkingTokens;

  // Grounded calls carry their REAL sources: extract groundingChunks web URLs
  // (redirects dropped) so callers — and the two-phase extraction above — get
  // verifiable citations instead of model-reconstructed ones.
  const groundingCitations = useWebSearch ? extractGeminiGroundingCitations(response) : [];

  return {
    text,
    promptTokens: usage.promptTokenCount || 0,
    completionTokens: totalCompletionTokens,
    model,
    provider: "gemini",
    ...(groundingCitations.length > 0 ? { citations: groundingCitations } : {}),
  };
}

async function callOpenAI(
  organizationId: string,
  model: string,
  prompt: string | undefined,
  systemPrompt?: string,
  useWebSearch?: boolean,
  responseSchema?: any,
  temperature?: number,
  maxTokens?: number,
  nativeMessages?: Array<{ role: string; content: any }>,
  tools?: object[],
  toolChoice?: string | object,
): Promise<LLMResponse> {
  const correlationId = generateLLMCorrelationId("openai");
  const startTime = Date.now();
  const promptText = prompt ?? "";

  logLLMDebug("openai", correlationId, "REQUEST_START", {
    organizationId,
    model,
    promptLength: promptText.length,
    useWebSearch: !!useWebSearch,
    hasResponseSchema: !!responseSchema,
  });

  const client = await getOpenAIClient(organizationId);

  // Use Responses API when web search is enabled
  if (useWebSearch && responseSchema) {
    // Preferred path: ONE call doing web search + strict structured output.
    const strictSchema = toStrictOpenAISchema(responseSchema);
    if (strictSchema) {
      try {
        logLLMDebug("openai", correlationId, "SINGLE_CALL_WEB_SEARCH_SCHEMA_START", { model });
        const single = await callOpenAIWithWebSearch(
          client, model, promptText, systemPrompt, responseSchema, temperature, maxTokens, correlationId,
        );
        if (single.text && single.text.trim() !== "") return single;
        logLLMDebug("openai", correlationId, "SINGLE_CALL_EMPTY_FALLING_BACK_TO_TWO_PHASE", { model });
      } catch (err) {
        // Fall through to two-phase on ANY error. Correctness never depends on
        // single-call succeeding.
        const msg = err instanceof Error ? err.message : String(err);
        logLLMDebug("openai", correlationId, "SINGLE_CALL_FAILED_FALLING_BACK_TO_TWO_PHASE", { model, error: msg.slice(0, 200) });
      }
    }

    // Fallback: two-phase — Phase 1 web search (no schema) → Phase 2 JSON extraction.
    const phase1 = await callOpenAIWithWebSearch(client, model, promptText, systemPrompt, undefined, temperature, maxTokens, correlationId);
    const phase1Text = phase1.text;
    if (!phase1Text || phase1Text.trim() === "") {
      logLLMDebug("openai", correlationId, "TWO_PHASE_PHASE1_EMPTY_ERROR", { model });
      return phase1;
    }
    const extractionPrompt = `You are a data extraction assistant. Below is research gathered from the web. Extract and structure the information into the required JSON format. Return only valid JSON — no markdown, no explanation.\n\nRESEARCH:\n${phase1Text}`;
    return callOpenAI(organizationId, model, extractionPrompt, undefined, false, responseSchema, 0.2, maxTokens, undefined);
  }
  if (useWebSearch) {
    return callOpenAIWithWebSearch(client, model, promptText, systemPrompt, undefined, temperature, maxTokens, correlationId);
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (nativeMessages && nativeMessages.length > 0) {
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    for (const m of nativeMessages) {
      messages.push({ role: m.role as "user" | "assistant", content: m.content });
    }
  } else {
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: promptText });
  }

  const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
    model,
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens,
  };

  if (responseSchema) {
    requestParams.response_format = { type: "json_object" };
  }

  if (tools && tools.length > 0) {
    (requestParams as any).tools = tools;
    if (toolChoice !== undefined) {
      (requestParams as any).tool_choice = toolChoice;
    }
  }

  let response: OpenAI.Chat.ChatCompletion;
  const fetchStartTime = Date.now();

  try {
    response = (await client.chat.completions.create(requestParams)) as OpenAI.Chat.ChatCompletion;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logLLMDebug("openai", correlationId, "API_ERROR", {
      latencyMs: Date.now() - startTime,
      fetchLatencyMs: Date.now() - fetchStartTime,
      error: errorMessage,
      model,
    });
    throw error;
  }

  const text = response.choices[0]?.message?.content || "";
  const responseToolCalls = response.choices[0]?.message?.tool_calls;

  if (!text) {
    // Tool-call responses have empty text — this is a valid outcome
    if (responseToolCalls && responseToolCalls.length > 0) {
      return {
        text: "",
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        model,
        provider: "openai",
        toolCalls: responseToolCalls,
      };
    }

    const diagnosticInfo = {
      correlationId,
      latencyMs: Date.now() - startTime,
      model,
      promptLength: promptText.length,
      finishReason: response.choices[0]?.finish_reason,
      refusal: response.choices[0]?.message?.refusal,
      choicesCount: response.choices?.length || 0,
      usage: response.usage,
    };

    logLLMDebug("openai", correlationId, "EMPTY_RESPONSE_ERROR", diagnosticInfo);

    // Check for refusal
    if (response.choices[0]?.message?.refusal) {
      throw new Error(`OpenAI refused the request: ${response.choices[0].message.refusal}`);
    }

    throw new LLMEmptyResponseError(
      `OpenAI Chat Completions returned no text. Model: ${model}, Finish reason: ${response.choices[0]?.finish_reason || "unknown"}, CorrelationId: ${correlationId}`,
      "openai",
      model,
      diagnosticInfo,
    );
  }

  logLLMDebug("openai", correlationId, "SUCCESS", {
    latencyMs: Date.now() - startTime,
    model: response.model,
    textLength: text.length,
    usage: response.usage,
  });

  return {
    text,
    promptTokens: response.usage?.prompt_tokens || 0,
    completionTokens: response.usage?.completion_tokens || 0,
    model,
    provider: "openai",
    ...(responseToolCalls?.length ? { toolCalls: responseToolCalls } : {}),
  };
}

// Valid Perplexity models for reference
const VALID_PERPLEXITY_MODELS = ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro"];

// Custom error class for LLM failures
export class LLMEmptyResponseError extends Error {
  constructor(
    message: string,
    public provider: LLMProvider,
    public model: string,
    public details?: Record<string, any>,
  ) {
    super(message);
    this.name = "LLMEmptyResponseError";
  }
}

// Known error patterns in LLM responses that indicate failure
const LLM_ERROR_PATTERNS = [
  { field: "error", values: ["content_filtered", "recitation_filtered", "prompt_blocked"] },
];

/**
 * Validates an LLM response to ensure it contains valid content
 * Returns an error message if invalid, null if valid
 */
export function validateLLMResponse(response: LLMResponse): string | null {
  // Tool-call responses legitimately have empty text — skip text validation
  if (response.toolCalls && response.toolCalls.length > 0) {
    return null;
  }

  // Check for empty text
  if (!response.text || response.text.trim() === "") {
    return "LLM response text is empty";
  }

  // Check for very short responses that are likely errors (less than 10 chars)
  if (response.text.trim().length < 10) {
    return `LLM response too short (${response.text.trim().length} chars): "${response.text.trim()}"`;
  }

  // Try to parse as JSON and check for error payloads (Gemini safety/recitation blocks)
  try {
    const parsed = JSON.parse(response.text);

    // Check for known error patterns
    for (const pattern of LLM_ERROR_PATTERNS) {
      if (parsed[pattern.field] && pattern.values.includes(parsed[pattern.field])) {
        return `LLM returned error payload: ${parsed[pattern.field]} - ${parsed.message || "no message"}`;
      }
    }

    // Check for generic error field
    if (parsed.error && typeof parsed.error === "string") {
      return `LLM returned error in response: ${parsed.error}`;
    }
  } catch {
    // Not JSON, that's fine - it's regular text
  }

  return null; // Valid response
}

// OpenAI Responses API for web search support
async function callOpenAIWithWebSearch(
  client: OpenAI,
  model: string,
  prompt: string,
  systemPrompt?: string,
  responseSchema?: any,
  temperature?: number,
  maxTokens?: number,
  correlationId?: string,
): Promise<LLMResponse> {
  const corrId = correlationId || generateLLMCorrelationId("openai");
  const startTime = Date.now();

  // Build input with correct content part structure for Responses API
  const input: any[] = [];

  if (systemPrompt) {
    input.push({
      role: "system",
      content: [{ type: "input_text", text: systemPrompt }],
    });
  }

  input.push({
    role: "user",
    content: [{ type: "input_text", text: prompt }],
  });

  // Responses API request with web search tool
  const requestBody: any = {
    model,
    input,
    tools: [{ type: "web_search" }],
    temperature: temperature ?? 0.7,
  };

  if (maxTokens) {
    requestBody.max_output_tokens = maxTokens;
  }

  // Enable JSON mode when responseSchema is provided
  if (responseSchema) {
    requestBody.text = { format: { type: "json_object" } };
  }

  let response: any;
  const fetchStartTime = Date.now();

  try {
    response = await (client as any).responses.create(requestBody);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logLLMDebug("openai", corrId, "WEB_SEARCH_API_ERROR", {
      latencyMs: Date.now() - startTime,
      fetchLatencyMs: Date.now() - fetchStartTime,
      error: errorMessage,
      model,
    });

    // Check for rate limit errors
    if (errorMessage.includes("429") || errorMessage.includes("rate") || errorMessage.includes("quota")) {
      throw new Error(`OpenAI rate limit exceeded: ${errorMessage}`);
    }

    // Check for permission errors
    if (errorMessage.includes("403") || errorMessage.includes("permission") || errorMessage.includes("access")) {
      throw new Error(`OpenAI permission denied for model ${model}: ${errorMessage}`);
    }

    throw error;
  }

  // Extract text from Responses API - comprehensive extraction approach
  let text = "";

  // Method 1: Try the SDK helper property first (newer SDK versions have output_text)
  if (typeof response.output_text === "string" && response.output_text) {
    text = response.output_text;
  }
  // Method 2: Try response.text if available
  else if (typeof response.text === "string" && response.text) {
    text = response.text;
  }
  // Method 3: Iterate through output array
  else if (response.output && Array.isArray(response.output)) {
    for (const item of response.output) {
      if (item.type === "message" && item.content && Array.isArray(item.content)) {
        for (const contentItem of item.content) {
          if (contentItem.type === "output_text" && contentItem.text) {
            text += contentItem.text;
          } else if (contentItem.type === "text" && contentItem.text) {
            text += contentItem.text;
          }
        }
      } else if (item.text) {
        text += item.text;
      } else if (item.content && typeof item.content === "string") {
        text += item.content;
      }
    }
  }

  // Method 4: Try to find text in the first output's content
  if (!text && response.output?.[0]?.content) {
    const firstContent = response.output[0].content;
    if (typeof firstContent === "string") {
      text = firstContent;
    } else if (Array.isArray(firstContent) && firstContent[0]?.text) {
      text = firstContent[0].text;
    }
  }

  // Handle empty responses
  if (!text) {
    const diagnosticInfo = {
      correlationId: corrId,
      latencyMs: Date.now() - startTime,
      model,
      promptLength: prompt.length,
      responseStatus: response.status,
      finishReason: response.finish_reason,
      outputItems: response.output?.length || 0,
      usage: response.usage,
    };

    logLLMDebug("openai", corrId, "WEB_SEARCH_EMPTY_RESPONSE_ERROR", diagnosticInfo);

    throw new LLMEmptyResponseError(
      `OpenAI Responses API returned no text. Status: ${response.status}, Finish reason: ${response.finish_reason}, CorrelationId: ${corrId}`,
      "openai",
      model,
      diagnosticInfo,
    );
  }

  logLLMDebug("openai", corrId, "SUCCESS", {
    latencyMs: Date.now() - startTime,
    model,
    textLength: text.length,
    usage: response.usage,
  });

  return {
    text,
    promptTokens: response.usage?.input_tokens || 0,
    completionTokens: response.usage?.output_tokens || 0,
    model,
    provider: "openai",
  };
}

async function callPerplexity(
  organizationId: string,
  model: string,
  prompt: string | undefined,
  systemPrompt?: string,
  temperature?: number,
  maxTokens?: number,
  responseSchema?: any,
  nativeMessages?: Array<{ role: string; content: string }>,
): Promise<LLMResponse> {
  const correlationId = generateLLMCorrelationId("perplexity");
  const startTime = Date.now();
  const promptText = prompt ?? "";

  logLLMDebug("perplexity", correlationId, "REQUEST_START", {
    organizationId,
    model,
    promptLength: promptText.length,
    hasResponseSchema: !!responseSchema,
  });

  const apiKey = await getPerplexityApiKey(organizationId);
  if (!apiKey) {
    logLLMDebug("perplexity", correlationId, "ERROR_NO_API_KEY", {
      latencyMs: Date.now() - startTime,
      organizationId,
    });
    throw new Error("No Perplexity API key configured. Please add your Perplexity API key in Settings.");
  }

  // Validate and normalize model name
  let actualModel = model;
  if (!VALID_PERPLEXITY_MODELS.includes(model)) {
    actualModel = "sonar";
  }

  const messages: any[] = [];
  if (nativeMessages && nativeMessages.length > 0) {
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    for (const m of nativeMessages) {
      messages.push({ role: m.role, content: m.content });
    }
  } else {
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: promptText });
  }

  const requestBody: any = {
    model: actualModel,
    messages,
    temperature: temperature ?? 0.7,
  };

  if (maxTokens) {
    requestBody.max_tokens = maxTokens;
  }

  // Note: Perplexity's sonar models may not support response_format.
  // Instead of using response_format, we modify the prompt to request JSON.
  if (responseSchema) {
    const lastMessageIndex = messages.length - 1;
    if (messages[lastMessageIndex].role === "user") {
      messages[lastMessageIndex].content += "\n\nIMPORTANT: You MUST respond with a valid JSON object only, no other text.";
    }
  }

  let response: Response;
  const fetchStartTime = Date.now();
  try {
    response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (networkError) {
    const errorMessage = networkError instanceof Error ? networkError.message : String(networkError);
    logLLMDebug("perplexity", correlationId, "NETWORK_ERROR", {
      latencyMs: Date.now() - startTime,
      fetchLatencyMs: Date.now() - fetchStartTime,
      error: errorMessage,
    });
    throw new Error(`Perplexity network error: ${errorMessage}`);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logLLMDebug("perplexity", correlationId, "API_ERROR", {
      latencyMs: Date.now() - startTime,
      status: response.status,
      errorBody: errorBody.substring(0, 2000),
      model: actualModel,
    });

    // Specific error handling
    if (response.status === 401) {
      throw new Error(`Perplexity API key is invalid or expired. Please check your API key configuration.`);
    }
    if (response.status === 429) {
      throw new Error(`Perplexity rate limit exceeded. Please wait and try again.`);
    }
    if (response.status === 400) {
      throw new Error(`Perplexity bad request for model "${actualModel}": ${errorBody.substring(0, 200)}`);
    }

    throw new Error(`Perplexity API error (${response.status}): ${errorBody.substring(0, 200)}`);
  }

  const data = await response.json() as any;
  const totalLatencyMs = Date.now() - startTime;

  const text = data.choices?.[0]?.message?.content || "";

  if (!text) {
    const diagnosticInfo = {
      correlationId,
      latencyMs: totalLatencyMs,
      model: actualModel,
      promptLength: promptText.length,
      finishReason: data.choices?.[0]?.finish_reason,
      choicesCount: data.choices?.length || 0,
    };

    logLLMDebug("perplexity", correlationId, "EMPTY_RESPONSE_ERROR", diagnosticInfo);

    throw new LLMEmptyResponseError(
      `Perplexity API returned no text. Model: ${actualModel}, Finish reason: ${data.choices?.[0]?.finish_reason || "unknown"}, CorrelationId: ${correlationId}`,
      "perplexity",
      actualModel,
      diagnosticInfo,
    );
  }

  logLLMDebug("perplexity", correlationId, "SUCCESS", {
    latencyMs: totalLatencyMs,
    model: actualModel,
    textLength: text.length,
    usage: data.usage,
  });

  return {
    text,
    promptTokens: data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0,
    model: actualModel,
    provider: "perplexity",
    citations: Array.isArray(data.citations) ? data.citations.filter((c: any) => typeof c === "string") : undefined,
  };
}

async function callClaude(
  organizationId: string,
  model: string,
  prompt: string | undefined,
  systemPrompt?: string,
  temperature?: number,
  maxTokens?: number,
  nativeMessages?: Array<{ role: string; content: string }>,
  responseSchema?: any,
): Promise<LLMResponse> {
  const correlationId = generateLLMCorrelationId("claude");
  const startTime = Date.now();
  const actualModel = model || DEFAULT_CLAUDE_MODEL;

  logLLMDebug("claude", correlationId, "REQUEST_START", {
    organizationId,
    model: actualModel,
    promptLength: prompt?.length ?? 0,
    hasResponseSchema: !!responseSchema,
  });

  const client = await getClaudeClient(organizationId);

  // When responseSchema is provided, build a JSON instruction to append to the prompt
  // so Claude knows to return structured JSON matching the schema shape
  let jsonInstruction = "";
  if (responseSchema) {
    try {
      const exampleJson = JSON.stringify(responseSchema, null, 2);
      jsonInstruction = `\n\nIMPORTANT: You MUST respond with a valid JSON object only, with no other text, markdown, or explanation. Your response must conform to this JSON schema:\n${exampleJson}`;
    } catch {
      jsonInstruction = "\n\nIMPORTANT: You MUST respond with a valid JSON object only, with no other text, markdown, or explanation.";
    }
  }

  let response: Anthropic.Message;
  const fetchStartTime = Date.now();

  try {
    const claudeMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (nativeMessages && nativeMessages.length > 0) {
      for (const m of nativeMessages) {
        claudeMessages.push({ role: m.role as "user" | "assistant", content: m.content });
      }
      // Append JSON instruction when responseSchema is provided
      if (jsonInstruction) {
        const lastIdx = claudeMessages.length - 1;
        if (lastIdx >= 0 && claudeMessages[lastIdx]!.role === "user") {
          // Append to the last user message
          claudeMessages[lastIdx] = {
            ...claudeMessages[lastIdx]!,
            content: claudeMessages[lastIdx]!.content + jsonInstruction,
          };
        } else {
          // No trailing user message — add a new user message with the schema instruction
          claudeMessages.push({ role: "user", content: jsonInstruction.trim() });
        }
      }
    } else if (prompt) {
      claudeMessages.push({ role: "user", content: prompt + jsonInstruction });
    } else {
      throw new Error("callClaude requires either a prompt string or nativeMessages array");
    }
    response = await client.messages.create({
      model: actualModel,
      max_tokens: maxTokens || 4096,
      system: systemPrompt || undefined,
      messages: claudeMessages,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logLLMDebug("claude", correlationId, "API_ERROR", {
      latencyMs: Date.now() - startTime,
      fetchLatencyMs: Date.now() - fetchStartTime,
      error: errorMessage,
      model: actualModel,
    });
    throw error;
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map(block => block.text)
    .join("");

  // Handle empty response - this is an ERROR
  if (!text) {
    const diagnosticInfo = {
      correlationId,
      latencyMs: Date.now() - startTime,
      model: actualModel,
      promptLength: prompt?.length ?? 0,
      stopReason: response.stop_reason,
      contentBlocks: response.content?.length || 0,
      usage: response.usage,
    };

    logLLMDebug("claude", correlationId, "EMPTY_RESPONSE_ERROR", diagnosticInfo);

    throw new LLMEmptyResponseError(
      `Claude returned no text. Model: ${actualModel}, Stop reason: ${response.stop_reason || "unknown"}, CorrelationId: ${correlationId}`,
      "claude",
      actualModel,
      diagnosticInfo,
    );
  }

  logLLMDebug("claude", correlationId, "SUCCESS", {
    latencyMs: Date.now() - startTime,
    model: actualModel,
    textLength: text.length,
    usage: response.usage,
  });

  return {
    text,
    promptTokens: response.usage?.input_tokens || 0,
    completionTokens: response.usage?.output_tokens || 0,
    model: actualModel,
    provider: "claude",
  };
}

export function getProviderFromModel(modelName: string): LLMProvider {
  // OpenRouter models contain a "/" (e.g. "openai/gpt-4o", "anthropic/claude-sonnet-4-5")
  if (modelName.includes("/")) return "openrouter";
  if (modelName.startsWith("gemini")) return "gemini";
  if (modelName.startsWith("gpt")) return "openai";
  if (modelName.startsWith("sonar") || modelName.includes("perplexity")) return "perplexity";
  if (modelName.startsWith("claude")) return "claude";
  return "gemini";
}

export function modelSupportsWebSearch(modelName: string): boolean {
  return !modelName.startsWith("claude");
}

export interface AvailableProviders {
  gemini: boolean;
  openai: boolean;
  perplexity: boolean;
  claude: boolean;
  openrouter: boolean;
  llmKeyMode?: "individual" | "openrouter";
}

export function isValidOpenAIKey(key: string): boolean {
  return key.startsWith("sk-");
}

export function isValidPerplexityKey(key: string): boolean {
  return key.startsWith("pplx-");
}

export function isValidClaudeKey(key: string): boolean {
  return key.startsWith("sk-ant-");
}

export function isValidGeminiKey(key: string): boolean {
  return key.startsWith("AI");
}

export function isValidOpenRouterKey(key: string): boolean {
  return key.startsWith("sk-or-");
}

/**
 * Which providers have a usable BYO key on the local org row. The SaaS
 * platform-key branches (env lookups when `useOwnLlmKeys` was false) are
 * deleted — desktop reads the org's own keys only.
 * Exported for the single-key routing test matrix (ADR 002 §4/risk 4).
 */
export async function getAvailableProviders(organizationId: string): Promise<AvailableProviders> {
  try {
    const keys = await getDecryptedOrgKeys(organizationId);

    // When org uses OpenRouter mode, only openrouter is available
    if (keys.llmKeyMode === "openrouter") {
      return {
        gemini: false,
        openai: false,
        perplexity: false,
        claude: false,
        openrouter: isValidOpenRouterKey(keys.openrouter),
        llmKeyMode: "openrouter",
      };
    }

    return {
      gemini: isValidGeminiKey(keys.gemini),
      openai: isValidOpenAIKey(keys.openai),
      perplexity: isValidPerplexityKey(keys.perplexity),
      claude: isValidClaudeKey(keys.claude),
      openrouter: isValidOpenRouterKey(keys.openrouter),
      llmKeyMode: "individual",
    };
  } catch (error) {
    console.error("[LLMRouter] Error resolving available providers:", error);
    return { gemini: false, openai: false, perplexity: false, claude: false, openrouter: false, llmKeyMode: "individual" };
  }
}

export function getBestProviderForWebSearch(available: AvailableProviders): { provider: LLMProvider; model: string } {
  if (available.llmKeyMode === "openrouter") return { provider: "openrouter", model: "perplexity/sonar" };
  if (available.perplexity) return { provider: "perplexity", model: "sonar" };
  if (available.openai) return { provider: "openai", model: "gpt-4o-mini" };
  if (available.gemini) return { provider: "gemini", model: "gemini-2.5-flash" };
  if (available.openrouter) return { provider: "openrouter", model: OPENROUTER_DEFAULT_MODEL };
  return { provider: "gemini", model: "gemini-2.5-flash" };
}

export function getBestProviderForAnalysis(available: AvailableProviders): { provider: LLMProvider; model: string } {
  if (available.llmKeyMode === "openrouter") return { provider: "openrouter", model: OPENROUTER_DEFAULT_MODEL };
  if (available.claude) return { provider: "claude", model: "claude-opus-4-6" };
  if (available.openai) return { provider: "openai", model: "gpt-4o" };
  if (available.gemini) return { provider: "gemini", model: "gemini-2.5-flash" };
  if (available.openrouter) return { provider: "openrouter", model: OPENROUTER_DEFAULT_MODEL };
  return { provider: "gemini", model: "gemini-2.5-flash" };
}

export function isProviderAvailable(provider: LLMProvider, available: AvailableProviders): boolean {
  if (available.llmKeyMode === "openrouter") {
    // In OpenRouter mode, only openrouter is available
    return provider === "openrouter" && !!available.openrouter;
  }
  return available[provider] || false;
}

export function getRecitationFallbackProviders(
  failedProvider: LLMProvider,
  requiresWebSearch: boolean,
  available: AvailableProviders,
): Array<{ provider: LLMProvider; model: string }> {
  if (available.llmKeyMode === "openrouter") {
    return failedProvider !== "openrouter" && available.openrouter
      ? [{ provider: "openrouter", model: requiresWebSearch ? "perplexity/sonar" : OPENROUTER_DEFAULT_MODEL }]
      : [];
  }
  const candidates: Array<{ provider: LLMProvider; model: string }> = [
    { provider: "perplexity", model: "sonar-pro" },
    { provider: "openai", model: "gpt-4o" },
    ...(requiresWebSearch ? [] : [{ provider: "claude" as LLMProvider, model: "claude-sonnet-4-6" }]),
  ];
  return candidates.filter(c => c.provider !== failedProvider && available[c.provider]);
}

export function getFallbackProviders(
  failedProvider: LLMProvider,
  requiresWebSearch: boolean,
  available: AvailableProviders,
): Array<{ provider: LLMProvider; model: string }> {
  if (available.llmKeyMode === "openrouter") {
    // In OpenRouter mode, only openrouter is available — no cross-provider fallbacks
    return [];
  }
  const allAnalysis: Array<{ provider: LLMProvider; model: string }> = [
    { provider: "claude", model: "claude-sonnet-4-6" },
    { provider: "openai", model: "gpt-4o" },
    { provider: "gemini", model: "gemini-2.5-flash" },
  ];
  const allWebSearch: Array<{ provider: LLMProvider; model: string }> = [
    { provider: "perplexity", model: "sonar" },
    { provider: "openai", model: "gpt-4o-mini" },
    { provider: "gemini", model: "gemini-2.5-flash" },
  ];
  const candidates = requiresWebSearch ? allWebSearch : allAnalysis;
  return candidates.filter(c => c.provider !== failedProvider && available[c.provider]);
}

export async function callLLM(config: LLMRequestConfig): Promise<LLMResponse> {
  const { organizationId, productId, agentSlug, prompt, systemPrompt, messages: configMessages, useWebSearch, responseSchema, temperature, maxTokens, triggerType, triggerContext, inputSummary, visionImages, requestPath, tools, toolChoice } = config;

  let model = DEFAULT_MODEL;
  let provider: LLMProvider = DEFAULT_PROVIDER;
  const agentType = agentSlug || "unknown";
  let requiresWebSearch = useWebSearch || false;
  const startTime = Date.now();

  const availableProviders = await getAvailableProviders(organizationId);

  if (agentSlug) {
    const agent = await getAiAgentBySlug(agentSlug);
    if (agent) {
      const configuredModel = agent.modelName || DEFAULT_MODEL;
      const configuredProvider = (agent.modelProvider as LLMProvider) || getProviderFromModel(configuredModel);
      requiresWebSearch = agent.requiresWebSearch || useWebSearch || false;

      if (isProviderAvailable(configuredProvider, availableProviders)) {
        provider = configuredProvider;
        model = configuredModel;

        if (requiresWebSearch && !modelSupportsWebSearch(model)) {
          const webSearchBest = getBestProviderForWebSearch(availableProviders);
          console.warn(`[LLMRouter] Agent ${agentSlug} requires web search but configured ${model} doesn't support it. Switching to ${webSearchBest.provider}/${webSearchBest.model}`);
          model = webSearchBest.model;
          provider = webSearchBest.provider;
        }
      } else {
        const best = requiresWebSearch
          ? getBestProviderForWebSearch(availableProviders)
          : getBestProviderForAnalysis(availableProviders);
        console.log(`[LLMRouter] Configured provider ${configuredProvider} not available for org, using ${best.provider}/${best.model}`);
        provider = best.provider;
        model = best.model;
      }
    } else {
      // Agent not found - use best available based on web search requirement
      console.warn(`[LLMRouter] Agent not found for slug: ${agentSlug}. Using fallback.`);
      const best = requiresWebSearch
        ? getBestProviderForWebSearch(availableProviders)
        : getBestProviderForAnalysis(availableProviders);
      provider = best.provider;
      model = best.model;
    }
  } else {
    // No agentSlug provided — always use the cheapest available model to avoid
    // escalating unattributed calls to expensive providers.
    if (availableProviders.llmKeyMode === "openrouter") {
      provider = "openrouter";
      model = requiresWebSearch ? "perplexity/sonar" : OPENROUTER_DEFAULT_MODEL;
    } else if (isProviderAvailable(DEFAULT_PROVIDER, availableProviders)) {
      provider = DEFAULT_PROVIDER;
      model = DEFAULT_MODEL;
    } else {
      // DEFAULT_PROVIDER unavailable — pick the cheapest available alternative
      const cheapOrder: Array<{ provider: LLMProvider; model: string }> = [
        { provider: "gemini", model: "gemini-2.5-flash" },
        { provider: "openai", model: "gpt-4o-mini" },
        { provider: "claude", model: "claude-haiku-4-5-20251001" },
        { provider: "perplexity", model: "sonar" },
      ];
      const cheapest = cheapOrder.find(c => isProviderAvailable(c.provider, availableProviders));
      if (cheapest) {
        provider = cheapest.provider;
        model = cheapest.model;
      }
      // if nothing is available, keep defaults and let the call fail with a clear error
    }
    const reqCtx = requestContextStorage.getStore();
    const endpointPath = requestPath ?? reqCtx?.path ?? "unknown";
    console.warn(
      `[LLMRouter] callLLM called without agentSlug (agentType='unknown'). ` +
      `Forced to cheap default ${provider}/${model}. ` +
      `promptLength=${prompt?.length ?? 0}, orgId=${organizationId ?? "none"}, ` +
      `endpoint=${endpointPath}, triggerContext=${triggerContext ?? "none"}`,
    );
  }

  // In OpenRouter mode: override any remaining non-openrouter selection.
  if (availableProviders.llmKeyMode === "openrouter" && provider !== "openrouter") {
    provider = "openrouter";
    model = requiresWebSearch ? "perplexity/sonar" : OPENROUTER_DEFAULT_MODEL;
  }

  // When a call needs BOTH web search and a structured JSON response, apply optimal provider routing.
  // Perplexity handles this natively in one call; OpenAI/Gemini use two-phase approaches.
  if (requiresWebSearch && responseSchema && provider !== "perplexity" && availableProviders.llmKeyMode !== "openrouter") {
    if (availableProviders.perplexity) {
      console.log(`[LLMRouter] Switching from ${provider} to Perplexity for web search + structured JSON (agent: ${agentType})`);
      provider = "perplexity";
      model = "sonar";
    } else if (provider === "openai") {
      // OpenAI two-phase is handled inside callOpenAI — no provider switch needed
    } else if (availableProviders.openai) {
      const openAIKeyForSwitch = await getOpenAIApiKey(organizationId);
      if (openAIKeyForSwitch && isValidOpenAIKey(openAIKeyForSwitch)) {
        provider = "openai";
        model = "gpt-4o-mini";
      } else {
        provider = "gemini";
        model = "gemini-2.5-flash";
      }
    } else {
      provider = "gemini";
      model = "gemini-2.5-flash";
    }
  }

  console.log(`[LLMRouter] FINAL SELECTION: ${provider}/${model} for agent ${agentType}${requiresWebSearch ? " (web search enabled)" : ""}`);

  let response: LLMResponse;

  // Create persistent execution log for debugging (only if we have an agent)
  let executionId: string | null = null;

  if (agentSlug) {
    try {
      const agent = await getAiAgentBySlug(agentSlug);
      if (agent) {
        const execution = await createAiAgentExecution({
          agentId: agent.id,
          organizationId: organizationId || null,
          productId: productId || null,
          triggerType: triggerType || "automatic",
          triggerContext: triggerContext || null,
          inputParameters: inputSummary || null,
          status: "running",
          modelProvider: provider,
          modelName: model,
          usedWebSearch: requiresWebSearch,
        });
        executionId = execution.id;
      }
    } catch (logError) {
      console.error(`[LLMRouter] Failed to create execution log:`, logError);
      // Don't fail the LLM call just because logging failed
    }
  }

  try {
    // Warn when tools are requested for a provider that doesn't support function-calling yet
    if (tools && tools.length > 0 && provider !== "openai") {
      console.warn(`[LLMRouter] tools requested but provider "${provider}" does not support function-calling (agent: ${agentType}). Tools will be ignored.`);
    }

    switch (provider) {
      case "gemini":
        response = await callGemini(organizationId, model, prompt, systemPrompt, requiresWebSearch, responseSchema, temperature, configMessages, visionImages);
        break;
      case "openai":
        response = await callOpenAI(organizationId, model, prompt, systemPrompt, requiresWebSearch, responseSchema, temperature, maxTokens, configMessages, tools, toolChoice);
        break;
      case "perplexity":
        response = await callPerplexity(organizationId, model, prompt, systemPrompt, temperature, maxTokens, responseSchema, configMessages);
        break;
      case "claude":
        response = await callClaude(organizationId, model, prompt, systemPrompt, temperature, maxTokens, configMessages, responseSchema);
        break;
      case "openrouter":
        response = await callOpenRouter(organizationId, model, prompt ?? "", systemPrompt, responseSchema, temperature, maxTokens, configMessages);
        break;
      default:
        response = await callGemini(organizationId, model, prompt, systemPrompt, requiresWebSearch, responseSchema, temperature, configMessages, visionImages);
    }

    // FINAL VALIDATION: Ensure response is valid before returning
    const validationError = validateLLMResponse(response);
    if (validationError) {
      console.error(`[LLMRouter] Response validation FAILED for ${provider}/${model} agent "${agentType}":`, {
        error: validationError,
        responseTextPreview: response.text?.substring(0, 200),
      });

      // Update execution log with failure
      if (executionId) {
        try {
          await updateAiAgentExecution(executionId, {
            status: "failed",
            errorMessage: validationError,
            tokensUsed: response.promptTokens + response.completionTokens,
            promptTokens: response.promptTokens,
            completionTokens: response.completionTokens,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
          });
        } catch (logError) {
          console.error(`[LLMRouter] Failed to update execution log:`, logError);
        }
      }

      // Track as failure
      await trackLlmUsage(
        organizationId,
        provider,
        model,
        agentType,
        response.promptTokens,
        response.completionTokens,
        false,
        `[${agentType}] ${validationError}`,
      );

      throw new LLMEmptyResponseError(
        validationError,
        response.provider,
        response.model,
        { responseText: response.text?.substring(0, 500) },
      );
    }

    // Update execution log with success
    if (executionId) {
      try {
        // Extract a summary from the response (first 500 chars or parsed JSON structure)
        let resultSummary = "";
        try {
          const parsed = JSON.parse(response.text);
          if (Array.isArray(parsed)) {
            resultSummary = `Returned ${parsed.length} items`;
          } else if (typeof parsed === "object") {
            const keys = Object.keys(parsed);
            resultSummary = `Returned object with keys: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? "..." : ""}`;
          }
        } catch {
          resultSummary = response.text.substring(0, 200);
        }

        await updateAiAgentExecution(executionId, {
          status: "completed",
          resultSummary,
          resultPayload: { responseText: response.text.substring(0, 10000) }, // Limit stored response size
          tokensUsed: response.promptTokens + response.completionTokens,
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
          durationMs: Date.now() - startTime,
          completedAt: new Date(),
        });
      } catch (logError) {
        console.error(`[LLMRouter] Failed to update execution log:`, logError);
      }
    }

    await trackLlmUsage(
      organizationId,
      provider,
      model,
      agentType,
      response.promptTokens,
      response.completionTokens,
      true,
    );

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Enhanced error logging with agent context (sanitized prompt)
    console.error(`[LLMRouter] Error calling ${provider}/${model} for agent "${agentType}":`, {
      error: errorMessage,
      provider,
      model,
      agentType,
      promptLength: prompt?.length ?? 0,
      hasSystemPrompt: !!systemPrompt,
      requiresWebSearch,
      promptPreview: prompt ? sanitizePromptForLogging(prompt, 100) : "[no prompt]",
    });

    await trackLlmUsage(
      organizationId,
      provider,
      model,
      agentType,
      0,
      0,
      false,
      `[${agentType}] ${errorMessage}`,
    );

    // --- SAME-MODEL RETRY: Retry once with the same model for empty response errors ---
    const isEmptyResponseError = error instanceof LLMEmptyResponseError;
    if (isEmptyResponseError) {
      console.log(`[LLMRouter] RETRY: Empty response from ${provider}/${model} for "${agentType}" - retrying once with same model...`);

      try {
        let retryResponse: LLMResponse;
        switch (provider) {
          case "gemini":
            retryResponse = await callGemini(organizationId, model, prompt, systemPrompt, requiresWebSearch, responseSchema, temperature, configMessages, visionImages);
            break;
          case "openai":
            retryResponse = await callOpenAI(organizationId, model, prompt, systemPrompt, requiresWebSearch, responseSchema, temperature, maxTokens, configMessages);
            break;
          case "perplexity":
            retryResponse = await callPerplexity(organizationId, model, prompt, systemPrompt, temperature, maxTokens, responseSchema, configMessages);
            break;
          case "claude":
            retryResponse = await callClaude(organizationId, model, prompt, systemPrompt, temperature, maxTokens, configMessages, responseSchema);
            break;
          case "openrouter":
            retryResponse = await callOpenRouter(organizationId, model, prompt ?? "", systemPrompt, responseSchema, temperature, maxTokens, configMessages);
            break;
          default:
            retryResponse = await callGemini(organizationId, model, prompt, systemPrompt, requiresWebSearch, responseSchema, temperature, configMessages, visionImages);
        }

        const retryValidationError = validateLLMResponse(retryResponse);
        if (!retryValidationError) {
          console.log(`[LLMRouter] RETRY SUCCESS: ${provider}/${model} succeeded on retry for "${agentType}"`);

          let resultSummary = `Retry succeeded (same model)`;
          try {
            const parsed = JSON.parse(retryResponse.text);
            if (Array.isArray(parsed)) {
              resultSummary += ` - Returned ${parsed.length} items`;
            } else if (typeof parsed === "object") {
              const keys = Object.keys(parsed);
              resultSummary += ` - Keys: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? "..." : ""}`;
            }
          } catch {
            resultSummary += ` - ${retryResponse.text.substring(0, 100)}`;
          }

          if (executionId) {
            try {
              await updateAiAgentExecution(executionId, {
                status: "completed",
                resultSummary,
                resultPayload: { responseText: retryResponse.text.substring(0, 10000) },
                tokensUsed: retryResponse.promptTokens + retryResponse.completionTokens,
                promptTokens: retryResponse.promptTokens,
                completionTokens: retryResponse.completionTokens,
                durationMs: Date.now() - startTime,
                completedAt: new Date(),
              });
            } catch (logError) {
              console.error(`[LLMRouter] Failed to update execution log:`, logError);
            }
          }

          await trackLlmUsage(organizationId, provider, model, agentType, retryResponse.promptTokens, retryResponse.completionTokens, true);
          return retryResponse;
        } else {
          console.warn(`[LLMRouter] RETRY: ${provider}/${model} retry also returned invalid response, proceeding to fallback...`);
        }
      } catch (retryError) {
        const retryErrMsg = retryError instanceof Error ? retryError.message : String(retryError);
        console.warn(`[LLMRouter] RETRY: ${provider}/${model} retry also failed: ${retryErrMsg.substring(0, 200)}`);
      }
    }

    // --- AUTOMATIC FALLBACK: Try next best provider ---
    // For recitation_filtered errors, prefer Perplexity as it handles verbatim content better
    const isRecitationError = errorMessage.includes("recitation_filtered");
    const recitationFallbacks = isRecitationError
      ? getRecitationFallbackProviders(provider, requiresWebSearch, availableProviders)
      : [];
    const fallbacks = recitationFallbacks.length > 0
      ? recitationFallbacks
      : getFallbackProviders(provider, requiresWebSearch, availableProviders);
    if (fallbacks.length > 0) {
      for (const fb of fallbacks) {
        if (requiresWebSearch && !modelSupportsWebSearch(fb.model)) {
          console.warn(`[LLMRouter] FALLBACK: Skipping ${fb.provider}/${fb.model} - does not support web search`);
          continue;
        }
        console.log(`[LLMRouter] FALLBACK: Retrying with ${fb.provider}/${fb.model} after ${provider}/${model} failed`);

        try {
          let fallbackResponse: LLMResponse;
          switch (fb.provider) {
            case "gemini":
              fallbackResponse = await callGemini(organizationId, fb.model, prompt, systemPrompt, requiresWebSearch, responseSchema, temperature, configMessages, visionImages);
              break;
            case "openai":
              fallbackResponse = await callOpenAI(organizationId, fb.model, prompt, systemPrompt, requiresWebSearch, responseSchema, temperature, maxTokens, configMessages);
              break;
            case "perplexity":
              fallbackResponse = await callPerplexity(organizationId, fb.model, prompt, systemPrompt, temperature, maxTokens, responseSchema, configMessages);
              break;
            case "claude":
              fallbackResponse = await callClaude(organizationId, fb.model, prompt, systemPrompt, temperature, maxTokens, configMessages, responseSchema);
              break;
            case "openrouter":
              fallbackResponse = await callOpenRouter(organizationId, fb.model, prompt ?? "", systemPrompt, responseSchema, temperature, maxTokens, configMessages);
              break;
            default:
              continue;
          }

          const fbValidationError = validateLLMResponse(fallbackResponse);
          if (fbValidationError) {
            console.warn(`[LLMRouter] FALLBACK ${fb.provider}/${fb.model} returned invalid response, trying next...`);
            await trackLlmUsage(organizationId, fb.provider, fb.model, agentType, fallbackResponse.promptTokens, fallbackResponse.completionTokens, false, `[${agentType}] Fallback validation failed: ${fbValidationError}`);
            continue;
          }

          console.log(`[LLMRouter] FALLBACK SUCCESS: ${fb.provider}/${fb.model} succeeded for agent "${agentType}"`);

          let resultSummary = `Fallback from ${provider} to ${fb.provider}`;
          try {
            const parsed = JSON.parse(fallbackResponse.text);
            if (Array.isArray(parsed)) {
              resultSummary += ` - Returned ${parsed.length} items`;
            } else if (typeof parsed === "object") {
              const keys = Object.keys(parsed);
              resultSummary += ` - Keys: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? "..." : ""}`;
            }
          } catch {
            resultSummary += ` - ${fallbackResponse.text.substring(0, 100)}`;
          }

          if (executionId) {
            try {
              await updateAiAgentExecution(executionId, {
                status: "completed",
                resultSummary,
                resultPayload: { responseText: fallbackResponse.text.substring(0, 10000) },
                tokensUsed: fallbackResponse.promptTokens + fallbackResponse.completionTokens,
                promptTokens: fallbackResponse.promptTokens,
                completionTokens: fallbackResponse.completionTokens,
                modelProvider: fb.provider,
                modelName: fb.model,
                durationMs: Date.now() - startTime,
                completedAt: new Date(),
              });
            } catch (logError) {
              console.error(`[LLMRouter] Failed to update execution log:`, logError);
            }
          }

          await trackLlmUsage(organizationId, fb.provider, fb.model, agentType, fallbackResponse.promptTokens, fallbackResponse.completionTokens, true);

          return fallbackResponse;
        } catch (fbError) {
          const fbErrMsg = fbError instanceof Error ? fbError.message : String(fbError);
          console.warn(`[LLMRouter] FALLBACK ${fb.provider}/${fb.model} also failed: ${fbErrMsg.substring(0, 200)}`);
          await trackLlmUsage(organizationId, fb.provider, fb.model, agentType, 0, 0, false, `[${agentType}] Fallback failed: ${fbErrMsg.substring(0, 200)}`);
          continue;
        }
      }
      console.error(`[LLMRouter] All fallback providers exhausted for agent "${agentType}"`);
    }

    // Update execution log with final failure (no fallback succeeded)
    if (executionId) {
      try {
        await updateAiAgentExecution(executionId, {
          status: "failed",
          errorMessage: errorMessage.substring(0, 2000),
          durationMs: Date.now() - startTime,
          completedAt: new Date(),
        });
      } catch (logError) {
        console.error(`[LLMRouter] Failed to update execution log:`, logError);
      }
    }

    throw error;
  }
}

export async function callLLMWithModel(
  organizationId: string,
  provider: LLMProvider,
  model: string,
  prompt: string,
  options: {
    systemPrompt?: string;
    useWebSearch?: boolean;
    responseSchema?: any;
    temperature?: number;
    maxTokens?: number;
    agentType?: string;
  } = {},
): Promise<LLMResponse> {
  const { systemPrompt, useWebSearch, responseSchema, temperature, maxTokens, agentType = "unknown" } = options;

  console.log(`[LLMRouter] Direct call to ${provider}/${model}`);

  let response: LLMResponse;

  try {
    switch (provider) {
      case "gemini":
        response = await callGemini(organizationId, model, prompt, systemPrompt, useWebSearch, responseSchema, temperature);
        break;
      case "openai":
        response = await callOpenAI(organizationId, model, prompt, systemPrompt, useWebSearch, responseSchema, temperature, maxTokens);
        break;
      case "perplexity":
        response = await callPerplexity(organizationId, model, prompt, systemPrompt, temperature, maxTokens, responseSchema);
        break;
      case "claude":
        response = await callClaude(organizationId, model, prompt, systemPrompt, temperature, maxTokens, undefined, responseSchema);
        break;
      case "openrouter":
        response = await callOpenRouter(organizationId, model, prompt, systemPrompt, responseSchema, temperature, maxTokens);
        break;
      default:
        response = await callGemini(organizationId, model, prompt, systemPrompt, useWebSearch, responseSchema, temperature);
    }

    // FINAL VALIDATION: Ensure response is valid before returning
    const validationError = validateLLMResponse(response);
    if (validationError) {
      console.error(`[LLMRouter] Response validation FAILED for direct call ${provider}/${model} "${agentType}":`, {
        error: validationError,
        responseTextPreview: response.text?.substring(0, 200),
      });

      // Track as failure
      await trackLlmUsage(
        organizationId,
        provider,
        model,
        agentType,
        response.promptTokens,
        response.completionTokens,
        false,
        `[${agentType}] ${validationError}`,
      );

      throw new LLMEmptyResponseError(
        validationError,
        response.provider,
        response.model,
        { responseText: response.text?.substring(0, 500) },
      );
    }

    await trackLlmUsage(
      organizationId,
      provider,
      model,
      agentType,
      response.promptTokens,
      response.completionTokens,
      true,
    );

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Enhanced error logging with context (sanitized prompt)
    console.error(`[LLMRouter] Error in direct call to ${provider}/${model} for "${agentType}":`, {
      error: errorMessage,
      provider,
      model,
      agentType,
      promptLength: prompt?.length ?? 0,
      hasSystemPrompt: !!systemPrompt,
      useWebSearch,
      promptPreview: prompt ? sanitizePromptForLogging(prompt, 100) : "[no prompt]",
    });

    await trackLlmUsage(
      organizationId,
      provider,
      model,
      agentType,
      0,
      0,
      false,
      `[${agentType}] ${errorMessage}`, // Include agent type in error for tracking
    );

    throw error;
  }
}

/**
 * Stream LLM response tokens. Resolves agent config the same way as callLLM,
 * but yields text chunks progressively instead of waiting for full completion.
 * Falls back to callLLM (non-streaming) for providers without streaming support.
 */
export async function* callLLMStream(config: LLMRequestConfig): AsyncGenerator<string> {
  const {
    organizationId,
    agentSlug,
    prompt,
    systemPrompt,
    messages: configMessages,
    temperature,
    maxTokens,
    visionImages,
  } = config;

  // Resolve model/provider exactly like callLLM does
  let model = DEFAULT_MODEL;
  let provider: LLMProvider = DEFAULT_PROVIDER;
  const availableProviders = await getAvailableProviders(organizationId);

  if (agentSlug) {
    const agent = await getAiAgentBySlug(agentSlug);
    if (agent) {
      const configuredModel = agent.modelName || DEFAULT_MODEL;
      const configuredProvider = (agent.modelProvider as LLMProvider) || getProviderFromModel(configuredModel);
      if (isProviderAvailable(configuredProvider, availableProviders)) {
        provider = configuredProvider;
        model = configuredModel;
      } else {
        const best = getBestProviderForAnalysis(availableProviders);
        provider = best.provider;
        model = best.model;
      }
    } else {
      const best = getBestProviderForAnalysis(availableProviders);
      provider = best.provider;
      model = best.model;
    }
  } else {
    // No agentSlug — always use the cheapest available model to match callLLM behaviour
    if (isProviderAvailable(DEFAULT_PROVIDER, availableProviders)) {
      provider = DEFAULT_PROVIDER;
      model = DEFAULT_MODEL;
    } else {
      const cheapOrder: Array<{ provider: LLMProvider; model: string }> = [
        { provider: "gemini", model: "gemini-2.5-flash" },
        { provider: "openai", model: "gpt-4o-mini" },
        { provider: "claude", model: "claude-haiku-4-5-20251001" },
        { provider: "perplexity", model: "sonar" },
      ];
      const cheapest = cheapOrder.find(c => isProviderAvailable(c.provider, availableProviders));
      if (cheapest) {
        provider = cheapest.provider;
        model = cheapest.model;
      }
    }
  }

  const messages = configMessages ?? [];

  // ── Gemini streaming ──────────────────────────────────────────────────────
  if (provider === "gemini") {
    const client = await getGeminiClient(organizationId);

    let contents: any;
    if (messages.length > 0) {
      contents = messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    } else {
      const textContent = systemPrompt ? `${systemPrompt}\n\n${prompt}` : (prompt || "");
      if (visionImages && visionImages.length > 0) {
        const parts: any[] = [{ text: textContent }];
        for (const img of visionImages) {
          parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
        }
        contents = [{ role: "user", parts }];
      } else {
        contents = textContent;
      }
    }

    const geminiConfig: any = {
      temperature: temperature ?? 0.7,
      safetySettings: GEMINI_SAFETY_SETTINGS,
    };
    if (messages.length > 0 && systemPrompt) {
      geminiConfig.systemInstruction = systemPrompt;
    }

    try {
      const streamResponse = await client.models.generateContentStream({
        model,
        contents,
        config: geminiConfig,
      });

      for await (const chunk of streamResponse) {
        const finishReason = chunk.candidates?.[0]?.finishReason;
        if (finishReason === "SAFETY" || finishReason === "RECITATION") {
          const reason = `Gemini stream blocked — finishReason: ${finishReason}`;
          console.error(`[callLLMStream] ${model} failed: ${reason}`);
          throw new Error(reason);
        }
        const text = chunk.text;
        if (text) yield text;
      }
    } catch (err) {
      console.error(`[callLLMStream] gemini/${model} failed:`, err instanceof Error ? err.message : err);
      throw err;
    }
    return;
  }

  // ── Claude streaming ──────────────────────────────────────────────────────
  if (provider === "claude") {
    const client = await getClaudeClient(organizationId);
    const claudeMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

    if (messages.length > 0) {
      for (const m of messages) {
        claudeMessages.push({ role: m.role as "user" | "assistant", content: m.content });
      }
    } else {
      claudeMessages.push({ role: "user", content: prompt || "" });
    }

    try {
      const stream = client.messages.stream({
        model: model || DEFAULT_CLAUDE_MODEL,
        max_tokens: maxTokens || 4096,
        system: systemPrompt,
        messages: claudeMessages,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    } catch (err) {
      console.error(`[callLLMStream] claude/${model} failed:`, err instanceof Error ? err.message : err);
      throw err;
    }
    return;
  }

  // ── OpenAI streaming ──────────────────────────────────────────────────────
  if (provider === "openai") {
    const apiKey = await getOpenAIApiKey(organizationId);
    if (!apiKey) {
      // Fall through to non-streaming fallback
    } else {
      const openaiClient = new OpenAI({ apiKey });
      const oaiMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
      if (systemPrompt) oaiMessages.push({ role: "system", content: systemPrompt });
      if (messages.length > 0) {
        for (const m of messages) oaiMessages.push({ role: m.role as any, content: m.content });
      } else {
        oaiMessages.push({ role: "user", content: prompt || "" });
      }

      try {
        const stream = await openaiClient.chat.completions.create({
          model,
          messages: oaiMessages,
          temperature: temperature ?? 0.7,
          stream: true,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) yield delta;
        }
      } catch (err) {
        console.error(`[callLLMStream] openai/${model} failed:`, err instanceof Error ? err.message : err);
        throw err;
      }
      return;
    }
  }

  // ── Fallback: non-streaming ───────────────────────────────────────────────
  const result = await callLLM(config);
  yield result.text;
}
