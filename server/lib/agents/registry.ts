/**
 * ai_agents registry access (ADR 002 §3 — lib/agents/registry.ts).
 *
 * Carved storage functions (verbatim method bodies from the SaaS
 * DatabaseStorage) + `resolveAgentPrompt`/`getAgentConfig` from llmRouter.ts.
 */
import { and, desc, eq } from "drizzle-orm";
import {
  aiAgents,
  aiAgentPrompts,
  type AiAgent,
  type AiAgentPrompt,
  type InsertAiAgent,
} from "@shared/schema";
import { getDb } from "../../db/index.js";

export async function getAiAgent(id: string): Promise<AiAgent | undefined> {
  const db = getDb();
  const [agent] = await db.select().from(aiAgents).where(eq(aiAgents.id, id));
  return agent || undefined;
}

export async function getAiAgentBySlug(slug: string): Promise<AiAgent | undefined> {
  const db = getDb();
  const [agent] = await db.select().from(aiAgents).where(eq(aiAgents.slug, slug));
  return agent || undefined;
}

export async function createAiAgent(insertAgent: InsertAiAgent): Promise<AiAgent> {
  const db = getDb();
  const [agent] = await db.insert(aiAgents).values(insertAgent).returning();
  return agent!;
}

export async function updateAiAgent(id: string, updateData: Partial<InsertAiAgent>): Promise<AiAgent> {
  const db = getDb();
  const [agent] = await db
    .update(aiAgents)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(aiAgents.id, id))
    .returning();
  return agent!;
}

export async function getActivePromptForAgent(
  agentId: string,
  organizationId?: string,
): Promise<AiAgentPrompt | undefined> {
  const db = getDb();
  if (organizationId) {
    const [prompt] = await db
      .select()
      .from(aiAgentPrompts)
      .where(and(
        eq(aiAgentPrompts.agentId, agentId),
        eq(aiAgentPrompts.organizationId, organizationId),
        eq(aiAgentPrompts.isActive, true),
      ));
    if (prompt) return prompt;
  }
  // Fall back to default prompt (no organisation)
  const [defaultPrompt] = await db
    .select()
    .from(aiAgentPrompts)
    .where(and(
      eq(aiAgentPrompts.agentId, agentId),
      eq(aiAgentPrompts.isActive, true),
    ))
    .orderBy(desc(aiAgentPrompts.version));
  return defaultPrompt || undefined;
}

/**
 * Resolves the prompt for an agent with priority:
 * 1. Org-specific active prompt (ai_agent_prompts with isActive=true for this org)
 * 2. Platform-wide active prompt (ai_agent_prompts with isActive=true, no org)
 * 3. Agent's default prompt (ai_agents.defaultPrompt)
 * 4. Fallback hardcoded text
 */
export async function resolveAgentPrompt(
  agentSlug: string,
  organizationId: string,
  fallbackPrompt?: string,
): Promise<string> {
  const agent = await getAiAgentBySlug(agentSlug);
  if (!agent) {
    console.warn(`[LLMRouter] Agent not found: ${agentSlug}, using fallback prompt`);
    return fallbackPrompt || "";
  }

  // Check for org-specific or platform-wide active prompt
  const activePrompt = await getActivePromptForAgent(agent.id, organizationId);
  if (activePrompt?.prompt) {
    console.log(`[LLMRouter] Using active prompt for ${agentSlug} (version ${activePrompt.version})`);
    return activePrompt.prompt;
  }

  // Fall back to agent's default prompt
  if (agent.defaultPrompt) {
    return agent.defaultPrompt;
  }

  // Final fallback
  return fallbackPrompt || "";
}

export interface AgentConfig {
  model: string;
  provider: string;
  prompt: string;
  requiresWebSearch: boolean;
}

export async function getAgentConfig(agentSlug: string): Promise<AgentConfig | null> {
  const agent = await getAiAgentBySlug(agentSlug);
  if (!agent) return null;

  return {
    model: agent.modelName || "gemini-2.5-flash",
    provider: agent.modelProvider || "gemini",
    prompt: agent.defaultPrompt || "",
    requiresWebSearch: agent.requiresWebSearch || false,
  };
}
