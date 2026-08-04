/**
 * Agent execution tracking (ADR 002 §3 — lib/agents/executions.ts).
 *
 * `trackAgentExecution` ported whole from the SaaS agentExecutionLogger.ts;
 * execution storage functions carved verbatim from DatabaseStorage.
 * Per-agent last-run tracking lives in the DATABASE (ai_agent_executions) —
 * exactly what a desktop app that is frequently closed needs (ADR 002 §7).
 */
import { and, desc, eq, getTableColumns, isNull, lte, or } from "drizzle-orm";
import {
  aiAgents,
  aiAgentExecutions,
  type AiAgentExecution,
  type InsertAiAgentExecution,
} from "@shared/schema";
import { getDb } from "../../db/index.js";
import { getAiAgentBySlug } from "./registry.js";

// ── Carved execution storage ─────────────────────────────────────────────────

export async function getAiAgentExecutionsByProduct(
  productId: string,
  limit: number = 50,
): Promise<Array<AiAgentExecution & { agentSlug: string | null }>> {
  const db = getDb();
  const rows = await db
    .select({
      ...getTableColumns(aiAgentExecutions),
      agentSlug: aiAgents.slug,
    })
    .from(aiAgentExecutions)
    .leftJoin(aiAgents, eq(aiAgentExecutions.agentId, aiAgents.id))
    .where(eq(aiAgentExecutions.productId, productId))
    .orderBy(desc(aiAgentExecutions.startedAt))
    .limit(limit);
  return rows as Array<AiAgentExecution & { agentSlug: string | null }>;
}

/**
 * Most recent execution for an agent across EVERY scope (product or entity).
 * The Settings agent-schedules view shows one row per agent, not per scope,
 * so its "last ran" stamp is the newest run anywhere.
 */
export async function getLastExecutionForAgent(
  agentId: string,
): Promise<AiAgentExecution | null> {
  const db = getDb();
  const [execution] = await db
    .select()
    .from(aiAgentExecutions)
    .where(eq(aiAgentExecutions.agentId, agentId))
    .orderBy(desc(aiAgentExecutions.startedAt))
    .limit(1);
  return execution || null;
}

export async function getLastExecutionForAgentAndProduct(
  agentId: string,
  productId: string,
): Promise<AiAgentExecution | null> {
  const db = getDb();
  const [execution] = await db
    .select()
    .from(aiAgentExecutions)
    .where(and(
      eq(aiAgentExecutions.agentId, agentId),
      eq(aiAgentExecutions.productId, productId),
    ))
    .orderBy(desc(aiAgentExecutions.startedAt))
    .limit(1);
  return execution || null;
}

export async function getRecentExecutionsForAgentAndProduct(
  agentId: string,
  productId: string,
  limit: number,
): Promise<AiAgentExecution[]> {
  const db = getDb();
  return db
    .select()
    .from(aiAgentExecutions)
    .where(and(
      eq(aiAgentExecutions.agentId, agentId),
      eq(aiAgentExecutions.productId, productId),
    ))
    .orderBy(desc(aiAgentExecutions.startedAt))
    .limit(limit);
}

/**
 * Entity twin of getLastExecutionForAgentAndProduct (ADR 003 §2.7): the
 * frequency gate for entity-scoped agents keys on (agent, entity), so
 * monitoring runs once per entity node regardless of how many products face
 * it.
 */
export async function getLastExecutionForAgentAndEntity(
  agentId: string,
  entityId: string,
): Promise<AiAgentExecution | null> {
  const db = getDb();
  const [execution] = await db
    .select()
    .from(aiAgentExecutions)
    .where(and(
      eq(aiAgentExecutions.agentId, agentId),
      eq(aiAgentExecutions.entityId, entityId),
    ))
    .orderBy(desc(aiAgentExecutions.startedAt))
    .limit(1);
  return execution || null;
}

/** Entity twin of getRecentExecutionsForAgentAndProduct (circuit breaker). */
export async function getRecentExecutionsForAgentAndEntity(
  agentId: string,
  entityId: string,
  limit: number,
): Promise<AiAgentExecution[]> {
  const db = getDb();
  return db
    .select()
    .from(aiAgentExecutions)
    .where(and(
      eq(aiAgentExecutions.agentId, agentId),
      eq(aiAgentExecutions.entityId, entityId),
    ))
    .orderBy(desc(aiAgentExecutions.startedAt))
    .limit(limit);
}

export async function createAiAgentExecution(
  insertExecution: InsertAiAgentExecution,
): Promise<AiAgentExecution> {
  const db = getDb();
  const [execution] = await db.insert(aiAgentExecutions).values(insertExecution).returning();
  return execution!;
}

export async function updateAiAgentExecution(
  id: string,
  updateData: Partial<InsertAiAgentExecution>,
): Promise<AiAgentExecution> {
  const db = getDb();
  const [execution] = await db
    .update(aiAgentExecutions)
    .set(updateData)
    .where(eq(aiAgentExecutions.id, id))
    .returning();
  return execution!;
}

/**
 * ADR 002 risk 7: at boot, mark `running` executions older than the threshold
 * as failed (interrupted) BEFORE the catch-up pass computes its gates, so a
 * lid-close mid-run cannot block the frequency gate or the active-run poll.
 */
export async function resetStaleRunningExecutions(
  thresholdMs: number = 2 * 60 * 60 * 1000,
): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - thresholdMs);
  const updated = await db
    .update(aiAgentExecutions)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorMessage: "Execution timed out (stale)",
    })
    .where(
      and(
        eq(aiAgentExecutions.status, "running"),
        or(
          isNull(aiAgentExecutions.startedAt),
          lte(aiAgentExecutions.startedAt, cutoff),
        ),
      ),
    )
    .returning({ id: aiAgentExecutions.id });
  return updated.length;
}

// ── trackAgentExecution (ported whole) ───────────────────────────────────────

export interface AgentExecutionContext {
  agentSlug: string;
  triggerType: "api" | "scheduled" | "manual";
  productId?: string | null;
  /** Competitor entity for entity-scoped runs (ADR 003 §2.7). */
  entityId?: string | null;
  opportunityId?: string | null;
  userId?: string | null;
  inputData?: unknown;
}

export async function trackAgentExecution<T>(
  context: AgentExecutionContext,
  executeFn: () => Promise<T>,
): Promise<T> {
  const startTime = Date.now();
  let executionId: string | null = null;

  try {
    const agent = await getAiAgentBySlug(context.agentSlug);
    if (!agent) {
      console.warn(`[Agent Execution] Agent not found: ${context.agentSlug}`);
      return await executeFn();
    }

    console.log(`[Agent: ${agent.name}] Starting execution (trigger: ${context.triggerType})`, {
      productId: context.productId || null,
      entityId: context.entityId || null,
      opportunityId: context.opportunityId || null,
    });

    const execution = await createAiAgentExecution({
      agentId: agent.id,
      triggerType: context.triggerType,
      triggerContext: context.productId
        ? `Product: ${context.productId}`
        : (context.entityId ? `Entity: ${context.entityId}` : (context.opportunityId ? `Opportunity: ${context.opportunityId}` : null)),
      inputParameters: context.inputData ? context.inputData : null,
      productId: context.productId || null,
      entityId: context.entityId || null,
      status: "running",
    });

    executionId = execution.id;

    const result = await executeFn();

    const durationMs = Date.now() - startTime;

    // Generate a summary of the result for logging
    let resultSummary = "Execution completed successfully";
    if (typeof result === "object" && result !== null) {
      const resultObj = result as Record<string, unknown>;
      if (resultObj["count"] !== undefined) {
        resultSummary = `Generated ${resultObj["count"]} items`;
      } else if (resultObj["length"] !== undefined) {
        resultSummary = `Returned ${resultObj["length"]} items`;
      } else if (resultObj["newEntriesCount"] !== undefined) {
        resultSummary = `Collected ${resultObj["newEntriesCount"]} new entries`;
      } else if (resultObj["themesCount"] !== undefined) {
        resultSummary = `Aggregated ${resultObj["themesCount"]} themes`;
      }
    }

    console.log(`[Agent: ${agent.name}] Completed in ${durationMs}ms - ${resultSummary}`);

    await updateAiAgentExecution(executionId, {
      status: "completed",
      completedAt: new Date(),
      durationMs,
      resultSummary,
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(`[Agent: ${context.agentSlug}] Failed after ${durationMs}ms: ${errorMessage}`);

    if (executionId) {
      await updateAiAgentExecution(executionId, {
        status: "failed",
        completedAt: new Date(),
        durationMs,
        errorMessage,
        resultSummary: `Failed: ${errorMessage.substring(0, 100)}`,
      });
    }

    throw error;
  }
}
