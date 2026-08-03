/**
 * Claude client factory — ported from the SaaS server/claude.ts (client
 * factory only, per ADR 002 §5). Platform env-key fallback DELETED: desktop
 * is BYO, keys come from the local org row only.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getClaudeApiKey } from "../keys.js";

/*
<important_code_snippet_instructions>
The current Claude models are "claude-opus-4-6", "claude-sonnet-4-6", and "claude-haiku-4-5-20251001".
If the user doesn't specify a model, always prefer using "claude-opus-4-6" as it is the most capable model.
</important_code_snippet_instructions>
*/

// <important_do_not_delete>
export const DEFAULT_CLAUDE_MODEL = "claude-opus-4-6";
// </important_do_not_delete>

// Cache for Claude clients (keyed by org ID)
const claudeClientCache: Map<string, { client: Anthropic; expiresAt: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** The source of the Claude API key: BYO org key or nothing. */
export async function getClaudeKeySource(organizationId: string): Promise<"organization" | "none"> {
  try {
    const key = await getClaudeApiKey(organizationId);
    return key ? "organization" : "none";
  } catch (error) {
    console.error("[Claude] Error checking key source:", error);
    return "none";
  }
}

/**
 * Get or create a Claude client for an organisation.
 * Uses caching with 5-minute TTL to reduce key decryption overhead.
 */
export async function getClaudeClient(organizationId: string): Promise<Anthropic> {
  const cached = claudeClientCache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client;
  }

  const apiKey = await getClaudeApiKey(organizationId);

  if (!apiKey) {
    throw new Error("No Claude API key configured. Please add your Anthropic API key in Settings.");
  }

  const client = new Anthropic({ apiKey });

  claudeClientCache.set(organizationId, {
    client,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return client;
}

/** Clear the Claude client cache for an organisation (call when API keys are updated). */
export function clearClaudeClientCache(organizationId: string): void {
  claudeClientCache.delete(organizationId);
}

/** Check if Claude is available for an organisation. */
export async function isClaudeAvailable(organizationId: string): Promise<boolean> {
  const keySource = await getClaudeKeySource(organizationId);
  return keySource !== "none";
}
