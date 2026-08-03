/**
 * Scheduling gates — ported from the SaaS scheduler.ts:2246–2412, MINUS the
 * login gate (ADR 002 §7: on desktop the scheduler only runs while the app
 * is open, which IS the login; the catch-up pass supersedes it).
 *
 * Gate order in shouldRunAgentNow:
 *  1. enabled — if the schedule is disabled, always skip.
 *  2. passesFrequencyGate — skip if not enough time has elapsed since last run
 *     (any-status last execution, which keeps the retry-storm fix).
 *  3. circuit breaker — 3 consecutive failures → suppress for 2× frequency.
 *  4. shouldRunSchedule — for daily-or-longer cadences, skip until the
 *     configured timeOfDay window. Sub-daily (hours) agents skip this step.
 */
import type { AgentSchedule } from "@shared/schema";
import { getAiAgentBySlug } from "../lib/agents/registry.js";
import {
  getLastExecutionForAgentAndProduct,
  getRecentExecutionsForAgentAndProduct,
} from "../lib/agents/executions.js";

export function frequencyToMs(frequencyValue: number, frequencyUnit: "hours" | "days"): number {
  if (frequencyUnit === "days") return frequencyValue * 24 * 60 * 60 * 1000;
  return frequencyValue * 60 * 60 * 1000;
}

export async function passesFrequencyGate(
  agentSlug: string,
  productId: string,
  schedule: { frequencyValue: number; frequencyUnit: "hours" | "days" },
  productName: string,
): Promise<boolean> {
  try {
    const agent = await getAiAgentBySlug(agentSlug);
    if (!agent) return true;
    // Use any-status last execution so that failed/running attempts also count
    // against the frequency window. This prevents a retry storm when an agent
    // consistently fails: without this, getLastCompletedExecution returns null
    // every minute and the gate always opens.
    const lastExecution = await getLastExecutionForAgentAndProduct(agent.id, productId);
    if (!lastExecution || !lastExecution.startedAt) return true;
    const frequencyMs = frequencyToMs(schedule.frequencyValue, schedule.frequencyUnit);
    const msSinceLast = Date.now() - new Date(lastExecution.startedAt).getTime();
    if (msSinceLast < frequencyMs) {
      const hoursAgo = Math.round(msSinceLast / 3600000 * 10) / 10;
      const hoursLeft = Math.round((frequencyMs - msSinceLast) / 3600000 * 10) / 10;
      console.log(`[Scheduler] Skipping ${agentSlug} for ${productName} — last ran ${hoursAgo}h ago (status: ${lastExecution.status}), next run in ${hoursLeft}h`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Scheduler] Error checking frequency gate for ${agentSlug}:`, err);
    return true;
  }
}

export const CIRCUIT_BREAKER_THRESHOLD = 3;   // consecutive failures before suppression
export const CIRCUIT_BREAKER_MULTIPLIER = 2;  // suppress for 2× the configured frequency

/**
 * Consecutive-failure circuit breaker: if the last N executions for this
 * agent+product all failed, suppress for 2× the configured frequency to
 * avoid hammering the LLM with a broken agent after a relaunch resets
 * in-memory state. Applies during catch-up too (ADR 002 §7.5).
 */
export async function passesCircuitBreaker(
  agentSlug: string,
  productId: string,
  schedule: { frequencyValue: number; frequencyUnit: "hours" | "days" },
  productName: string,
): Promise<boolean> {
  try {
    const agent = await getAiAgentBySlug(agentSlug);
    if (!agent) return true;
    // Fetch executions scoped to this specific agent+product so results from
    // other agents on a busy product don't dilute or hide this agent's failures.
    const agentExecs = await getRecentExecutionsForAgentAndProduct(
      agent.id, productId, CIRCUIT_BREAKER_THRESHOLD,
    );

    if (agentExecs.length >= CIRCUIT_BREAKER_THRESHOLD) {
      const allFailed = agentExecs.every((e) => e.status === "failed");
      if (allFailed) {
        // Anchor suppression window to the most recent failure (index 0 since
        // results are ordered desc by startedAt). This guarantees 2× frequency
        // of cooldown from the latest failure rather than an earlier one.
        const mostRecentFailure = agentExecs[0]!;
        const suppressMs = frequencyToMs(schedule.frequencyValue, schedule.frequencyUnit) * CIRCUIT_BREAKER_MULTIPLIER;
        const msSinceMostRecent = mostRecentFailure.startedAt
          ? Date.now() - new Date(mostRecentFailure.startedAt).getTime()
          : 0;
        if (msSinceMostRecent < suppressMs) {
          const hoursLeft = Math.round((suppressMs - msSinceMostRecent) / 3600000 * 10) / 10;
          console.warn(
            `[Scheduler] Circuit breaker open for ${agentSlug}/${productName} — ` +
            `${CIRCUIT_BREAKER_THRESHOLD} consecutive failures. Suppressing for ${hoursLeft}h more.`,
          );
          return false;
        }
      }
    }
    return true;
  } catch (cbErr) {
    console.error(`[Scheduler] Circuit breaker check error for ${agentSlug}:`, cbErr);
    return true;
  }
}

/**
 * Single eligibility gate for a steady-state (tick) run. Catch-up uses
 * passesFrequencyGate + passesCircuitBreaker directly and IGNORES timeOfDay.
 */
export async function shouldRunAgentNow(
  agentSlug: string,
  productId: string,
  schedule: AgentSchedule,
  productName: string,
  timezone: string,
): Promise<boolean> {
  if (!schedule.enabled) return false;
  if (!await passesFrequencyGate(agentSlug, productId, schedule, productName)) return false;
  if (!await passesCircuitBreaker(agentSlug, productId, schedule, productName)) return false;

  if (schedule.frequencyUnit === "hours") return true;
  return shouldRunSchedule(schedule, timezone);
}

export function shouldRunSchedule(
  schedule: { enabled: boolean; frequencyValue: number; frequencyUnit: "hours" | "days"; timeOfDay: string },
  timezone: string,
): boolean {
  if (!schedule.enabled) return false;

  try {
    // Get current time in the specified timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const currentHour = parts.find(p => p.type === "hour")?.value || "00";
    const currentMinute = parts.find(p => p.type === "minute")?.value || "00";
    const currentTime = `${currentHour}:${currentMinute}`;

    // Check if current time matches the configured timeOfDay
    // We check if we're within the same minute window
    const [scheduleHour, scheduleMinute] = schedule.timeOfDay.split(":");
    const normalizedScheduleTime = `${(scheduleHour ?? "0").padStart(2, "0")}:${(scheduleMinute ?? "0").padStart(2, "0")}`;

    return currentTime === normalizedScheduleTime;
  } catch (error) {
    console.error("[Scheduler] Error checking schedule time:", error);
    return false;
  }
}
