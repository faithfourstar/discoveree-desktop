/**
 * Settings service — LLM key validation (sprint 3a minimal settings surface).
 *
 * `testProviderKey` makes ONE cheap provider call per validation:
 * - openai / claude / gemini / openrouter: an authenticated metadata GET
 *   (models list / key info) — free.
 * - perplexity: a 1-token sonar completion (Perplexity has no metadata
 *   endpoint) — fractions of a penny.
 *
 * Uses plain fetch (not the SDK clients) so validation never touches the
 * router's per-org client caches and tests can stub globalThis.fetch.
 */
export const LLM_KEY_PROVIDERS = ["openai", "gemini", "perplexity", "claude", "openrouter"] as const;
export type LlmKeyProvider = (typeof LLM_KEY_PROVIDERS)[number];

export interface KeyTestResult {
  ok: boolean;
  /** British-English, user-facing. Present only when ok is false. */
  error?: string;
}

const TEST_TIMEOUT_MS = 15_000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function verdict(response: Response): KeyTestResult {
  if (response.ok) return { ok: true };
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: "The provider rejected this key. Please check it and try again." };
  }
  if (response.status === 429) {
    return { ok: false, error: "The provider rate-limited the check. The key may still be valid — try again shortly." };
  }
  return { ok: false, error: `The provider returned an unexpected response (HTTP ${response.status}).` };
}

export async function testProviderKey(provider: LlmKeyProvider, apiKey: string): Promise<KeyTestResult> {
  try {
    switch (provider) {
      case "openai": {
        const res = await timedFetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return verdict(res);
      }
      case "gemini": {
        const res = await timedFetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
          {},
        );
        // Google returns 400 for malformed keys, 403 for invalid ones.
        if (!res.ok && res.status === 400) {
          return { ok: false, error: "The provider rejected this key. Please check it and try again." };
        }
        return verdict(res);
      }
      case "claude": {
        const res = await timedFetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        });
        return verdict(res);
      }
      case "perplexity": {
        // No metadata endpoint — one 1-token sonar completion is the cheapest
        // authenticated call Perplexity offers.
        const res = await timedFetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        });
        return verdict(res);
      }
      case "openrouter": {
        const res = await timedFetch("https://openrouter.ai/api/v1/key", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return verdict(res);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "The provider did not respond in time. Please try again." };
    }
    return { ok: false, error: "Could not reach the provider. Please check your connection and try again." };
  }
}
