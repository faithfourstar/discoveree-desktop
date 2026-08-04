/**
 * Settings service — LLM key validation (sprint 3a minimal settings surface).
 *
 * `testProviderKey` makes ONE cheap provider call per validation:
 * - openai / claude / gemini / openrouter: an authenticated metadata GET
 *   (models list / key info) — free.
 * - perplexity: a 16-token sonar completion (Perplexity has no metadata
 *   endpoint) — fractions of a penny.
 *
 * Uses plain fetch (not the SDK clients) so validation never touches the
 * router's per-org client caches and tests can stub globalThis.fetch.
 */
export const LLM_KEY_PROVIDERS = ["openai", "gemini", "perplexity", "claude", "openrouter"] as const;
export type LlmKeyProvider = (typeof LLM_KEY_PROVIDERS)[number];

/**
 * Structured verdict so the client can distinguish "the key was judged"
 * (valid/rejected) from "no verdict was passed on the key" (rate-limited,
 * provider-error, network, timeout) — spec §2.4's honesty rule made machine-
 * readable. `ok` and `error` are kept for the pre-verdict client.
 */
export type KeyTestVerdict =
  | "valid"
  | "rejected"
  | "rate-limited"
  | "provider-error"
  | "network"
  | "timeout";

export interface KeyTestResult {
  ok: boolean;
  verdict: KeyTestVerdict;
  /** British-English, user-facing. Present only when ok is false. */
  error?: string;
  /**
   * Sanitised snippet of the provider's error body, on every non-ok HTTP
   * verdict (rejected / rate-limited / provider-error). Supplementary — the
   * user line stays flat; the client can use this to phrase precise help
   * (e.g. Google's SERVICE_DISABLED vs a genuinely bad key).
   */
  detail?: string;
}

/** Display names for user-facing lines — each result names the provider, never "the API". */
const PROVIDER_DISPLAY_NAMES: Record<LlmKeyProvider, string> = {
  openai: "OpenAI",
  gemini: "Google",
  perplexity: "Perplexity",
  claude: "Anthropic",
  openrouter: "OpenRouter",
};

const TEST_TIMEOUT_MS = 15_000;
const DETAIL_MAX_LENGTH = 200;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the human message out of a JSON error body when one exists. Google's
 * google.rpc shape additionally carries machine reasons in
 * `error.details[].reason` (e.g. SERVICE_DISABLED, API_KEY_INVALID,
 * API_KEY_HTTP_REFERRER_BLOCKED) — appended in parentheses so the client can
 * key help text off the code. Harmless elsewhere: no other provider we call
 * uses that shape.
 */
function extractErrorMessage(parsed: unknown): string | null {
  if (typeof parsed === "string") return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const nested = record["error"];
  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object") {
    const nestedRecord = nested as Record<string, unknown>;
    const message = nestedRecord["message"];
    const reasons = Array.isArray(nestedRecord["details"])
      ? [...new Set(
          (nestedRecord["details"] as unknown[])
            .map((d) => (d && typeof d === "object" ? (d as Record<string, unknown>)["reason"] : null))
            .filter((r): r is string => typeof r === "string" && r.length > 0),
        )]
      : [];
    if (typeof message === "string" && message) {
      return reasons.length > 0 ? `${message} (${reasons.join(", ")})` : message;
    }
    if (reasons.length > 0) return reasons.join(", ");
  }
  const message = record["message"] ?? record["detail"];
  return typeof message === "string" ? message : null;
}

/**
 * Sanitise a provider error body for display: prefer the JSON error message
 * field, redact anything shaped like an API key or bearer token (the request
 * key must never round-trip through an error body), collapse whitespace,
 * truncate to ~200 characters.
 */
export function sanitiseProviderDetail(body: string | null | undefined): string | undefined {
  if (!body) return undefined;
  let text = body.trim();
  try {
    const message = extractErrorMessage(JSON.parse(text));
    if (message) text = message;
  } catch {
    // Not JSON — use the raw body.
  }
  text = text
    .replace(/\b(?:sk-or-|sk-ant-|sk-|pplx-|AIza)[A-Za-z0-9_-]{6,}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > DETAIL_MAX_LENGTH ? `${text.slice(0, DETAIL_MAX_LENGTH)}…` : text;
}

async function safeBodyText(response: Response): Promise<string | null> {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

async function verdict(provider: LlmKeyProvider, response: Response): Promise<KeyTestResult> {
  if (response.ok) return { ok: true, verdict: "valid" };
  // Every non-ok answer carries the provider's own (sanitised) words as
  // `detail` — 401/403 bodies often hold the precise, actionable reason the
  // flat line can't (Google: SERVICE_DISABLED vs a genuinely bad key).
  const detail = sanitiseProviderDetail(await safeBodyText(response));
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      verdict: "rejected",
      error: "The provider rejected this key. Please check it and try again.",
      ...(detail ? { detail } : {}),
    };
  }
  if (response.status === 429) {
    return {
      ok: false,
      verdict: "rate-limited",
      error: "The provider rate-limited the check. The key may still be valid — try again shortly.",
      ...(detail ? { detail } : {}),
    };
  }
  // Any other HTTP answer is the provider talking, not a verdict on the key.
  // Surface what it actually said instead of a bare status code.
  const providerName = PROVIDER_DISPLAY_NAMES[provider];
  if (detail) {
    return { ok: false, verdict: "provider-error", error: `${providerName} answered with an error — ${detail}`, detail };
  }
  return { ok: false, verdict: "provider-error", error: `${providerName} answered with an error (HTTP ${response.status}).` };
}

export async function testProviderKey(provider: LlmKeyProvider, apiKey: string): Promise<KeyTestResult> {
  try {
    switch (provider) {
      case "openai": {
        const res = await timedFetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return verdict(provider, res);
      }
      case "gemini": {
        const res = await timedFetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
          {},
        );
        // Google returns 400 for malformed keys (API_KEY_INVALID), 403 for
        // valid-but-blocked ones (SERVICE_DISABLED, key restrictions) — the
        // body's error.details[].reason lands in `detail` either way.
        if (!res.ok && res.status === 400) {
          const detail = sanitiseProviderDetail(await safeBodyText(res));
          return {
            ok: false,
            verdict: "rejected",
            error: "The provider rejected this key. Please check it and try again.",
            ...(detail ? { detail } : {}),
          };
        }
        return verdict(provider, res);
      }
      case "claude": {
        const res = await timedFetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        });
        return verdict(provider, res);
      }
      case "perplexity": {
        // No metadata endpoint — one minimal sonar completion is the
        // cheapest authenticated call Perplexity offers. max_tokens is 16
        // because Perplexity enforces a floor: max_tokens: 1 draws
        // 400 "max_tokens must be at least 16" for VALID keys (confirmed
        // live, 3 Aug 2026) — still fractions of a penny. Known non-auth
        // answers from this endpoint (docs.perplexity.ai + observed):
        // - 402 Payment Required: the account's prepaid credit balance is
        //   empty — the KEY is valid; the account needs topping up. Reaches
        //   the client as verdict "provider-error" with Perplexity's own
        //   message in `detail`, so it can phrase "add credits", not
        //   "check your key".
        // - 400 Bad Request: a request-shape rejection (parameter floors
        //   like the max_tokens case above, model renamed, message-
        //   alternation rules), NOT a key verdict — if one recurs for valid
        //   keys, suspect this request body going stale against the API,
        //   not the customer's key.
        const res = await timedFetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 16,
          }),
        });
        return verdict(provider, res);
      }
      case "openrouter": {
        const res = await timedFetch("https://openrouter.ai/api/v1/key", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return verdict(provider, res);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, verdict: "timeout", error: "The provider did not respond in time. Please try again." };
    }
    return { ok: false, verdict: "network", error: "Could not reach the provider. Please check your connection and try again." };
  }
}
