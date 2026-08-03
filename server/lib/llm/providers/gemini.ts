/**
 * Gemini client factory — ported from the SaaS gemini.ts:603–688
 * (getGeminiClient / clearGeminiClientCache / getGeminiKeySource).
 * The platform direct key (`GEMINI_API_KEY` env) path is DELETED: desktop is
 * BYO, keys come from the local org row only.
 */
import { GoogleGenAI } from "@google/genai";
import { getGeminiApiKey } from "../keys.js";

// Cache for organisation-specific clients
const orgAiClients = new Map<string, GoogleGenAI>();

/**
 * Get Gemini AI client for a specific organisation (BYO key only).
 */
export async function getGeminiClient(organizationId?: string): Promise<GoogleGenAI> {
  if (organizationId) {
    // Check cache first
    if (orgAiClients.has(organizationId)) {
      return orgAiClients.get(organizationId)!;
    }

    try {
      const decryptedKey = await getGeminiApiKey(organizationId);
      if (decryptedKey) {
        const orgClient = new GoogleGenAI({
          apiKey: decryptedKey,
        });
        orgAiClients.set(organizationId, orgClient);
        return orgClient;
      }
    } catch (error) {
      console.error("[Gemini] Error getting org key:", error);
    }
  }

  throw new Error("No Gemini API key configured. Please add your Gemini API key in Settings.");
}

/** Clear cached Gemini client for an organisation (call when API key is updated). */
export function clearGeminiClientCache(organizationId: string): void {
  orgAiClients.delete(organizationId);
}

/**
 * Get the active Gemini API key source for an organisation.
 */
export async function getGeminiKeySource(organizationId?: string): Promise<{
  source: "organization" | "none";
  description: string;
  configured: boolean;
}> {
  if (organizationId) {
    try {
      const key = await getGeminiApiKey(organizationId);
      if (key) {
        return {
          source: "organization",
          description: "Your Gemini API key",
          configured: true,
        };
      }
    } catch (error) {
      console.error("[Gemini] Error checking org key source:", error);
    }
  }

  return {
    source: "none",
    description: "No Gemini API key configured",
    configured: false,
  };
}
