/**
 * LLM usage tracking → the llm_usage table (ADR 002 §4).
 *
 * Ported from the SaaS gemini.ts:548–603 (`trackLlmUsage`) with ONE seam
 * change: the SaaS only recorded usage for platform-billed orgs
 * (`if (org?.useOwnLlmKeys) return`). Desktop is always BYO — the user's
 * spend is their own provider bill — but `llm_usage` still records every
 * call so Settings can display cost visibility. The guard is removed.
 *
 * Pricing: the SaaS synced a llm_model_pricing table daily from LiteLLM with
 * these hardcoded constants as fallback. Desktop keeps only the hardcoded
 * fallback (indicative cost, without the SaaS 10% platform markup removed —
 * figures are close enough for a local cost display; a pricing sync can land
 * later behind the same function).
 */
import { llmUsage, type LlmUsage, type InsertLlmUsage } from "@shared/schema";
import { getDb } from "../../db/index.js";

type PricedProvider = "gemini" | "openai" | "perplexity" | "claude";

export const GEMINI_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gemini-3.5-flash": { inputPer1M: 165, outputPer1M: 990 },
  "gemini-2.5-flash": { inputPer1M: 33, outputPer1M: 275 },
  "gemini-2.5-flash-lite": { inputPer1M: 11, outputPer1M: 44 },
  "default": { inputPer1M: 165, outputPer1M: 990 },
};

export const OPENAI_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gpt-4o": { inputPer1M: 275, outputPer1M: 1100 },
  "gpt-4o-mini": { inputPer1M: 16.5, outputPer1M: 66 },
  "gpt-4.1": { inputPer1M: 550, outputPer1M: 1650 },
  "gpt-4.1-mini": { inputPer1M: 44, outputPer1M: 176 },
  "gpt-4.1-nano": { inputPer1M: 11, outputPer1M: 44 },
  "default": { inputPer1M: 275, outputPer1M: 1100 },
};

export const PERPLEXITY_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "sonar": { inputPer1M: 110, outputPer1M: 110 },
  "sonar-pro": { inputPer1M: 330, outputPer1M: 1650 },
  "sonar-deep-research": { inputPer1M: 220, outputPer1M: 880 },
  "llama-3.1-sonar-large-128k-online": { inputPer1M: 110, outputPer1M: 110 },
  "llama-3.1-sonar-small-128k-online": { inputPer1M: 110, outputPer1M: 110 },
  "llama-3.1-sonar-huge-128k-online": { inputPer1M: 330, outputPer1M: 1650 },
  "default": { inputPer1M: 110, outputPer1M: 110 },
};

export const CLAUDE_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "claude-opus-4-6": { inputPer1M: 550, outputPer1M: 2750 },
  "claude-sonnet-4-6": { inputPer1M: 330, outputPer1M: 1650 },
  "claude-haiku-4-5-20251001": { inputPer1M: 88, outputPer1M: 440 },
  "default": { inputPer1M: 330, outputPer1M: 1650 },
};

function getHardcodedPricing(provider: PricedProvider, model: string): { inputPer1M: number; outputPer1M: number } {
  switch (provider) {
    case "openai":
      return OPENAI_PRICING[model] || OPENAI_PRICING["default"]!;
    case "perplexity":
      return PERPLEXITY_PRICING[model] || PERPLEXITY_PRICING["default"]!;
    case "claude":
      return CLAUDE_PRICING[model] || CLAUDE_PRICING["default"]!;
    case "gemini":
    default:
      return GEMINI_PRICING[model] || GEMINI_PRICING["default"]!;
  }
}

export function calculateCostCents(
  provider: PricedProvider,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  if (promptTokens === 0 && completionTokens === 0) return 0;
  const pricing = getHardcodedPricing(provider, model);
  const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;
  const totalCents = inputCost + outputCost;
  if (totalCents > 0 && totalCents < 1) return 1;
  return Math.round(totalCents);
}

/** Verbatim carve of DatabaseStorage.createLlmUsage (storage.ts:3566). */
export async function createLlmUsage(usage: InsertLlmUsage): Promise<LlmUsage> {
  const db = getDb();
  const [created] = await db.insert(llmUsage).values(usage).returning();
  return created!;
}

/**
 * Track LLM usage for the local organisation (never throws — usage tracking
 * must not fail an LLM call).
 */
export async function trackLlmUsage(
  organizationId: string | undefined,
  provider: "gemini" | "openai" | "perplexity" | "claude" | "openrouter",
  model: string,
  agentType: string,
  promptTokens: number,
  completionTokens: number,
  success: boolean,
  errorMessage?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!organizationId) return;

  try {
    const totalTokens = promptTokens + completionTokens;
    // OpenRouter proxies many models; we cannot price it reliably — record 0 cents.
    const costCents =
      provider === "openrouter"
        ? 0
        : calculateCostCents(provider, model, promptTokens, completionTokens);

    await createLlmUsage({
      organizationId,
      provider,
      model,
      agentType,
      promptTokens,
      completionTokens,
      totalTokens,
      costCents,
      success,
      errorMessage: errorMessage || null,
      metadata: metadata || null,
    });

    console.log(
      `[LLM Usage] Tracked ${provider}/${model} for org ${organizationId}: ${totalTokens} tokens, $${(costCents / 100).toFixed(4)}`,
    );
  } catch (error) {
    console.error("[LLM Usage] Failed to track usage:", error);
  }
}
