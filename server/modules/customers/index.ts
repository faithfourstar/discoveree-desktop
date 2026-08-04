/**
 * Customers module registration (ADR 004 §9): four PRODUCT-kind scheduled
 * agents on the 3a registry — zero new scheduler infrastructure (the ADR 002
 * §8.10 proof-of-generality test). The entity-kind competitor-reviews-agent
 * registers in the competitors module (review mining is competitive
 * intelligence context); the sentiment agent is a pipeline stage, seeded for
 * prompt overrides but never independently scheduled.
 */
import type { Product } from "@shared/schema";
import { AgentSlugs } from "../../lib/agents/slugs.js";
import { computeDefaultSchedules } from "../../scheduler/defaults.js";
import { registerScheduledAgent } from "../../scheduler/registry.js";
import {
  runFeedbackCollection,
  runSegmentInsightsForProduct,
  runSegmentQuotesForProduct,
  runThemeAggregation,
} from "./service.js";

function defaultFor(key: string) {
  return (product: Product) => computeDefaultSchedules(product)[key]!;
}

export function registerCustomerAgents(): void {
  registerScheduledAgent({
    slug: AgentSlugs.GATHER_FEEDBACK,
    scheduleKey: "feedbackCollection",
    defaultSchedule: defaultFor("feedbackCollection"),
    run: (product: Product) => runFeedbackCollection(product.organizationId, product),
  });

  registerScheduledAgent({
    slug: AgentSlugs.THEME_AGGREGATION,
    scheduleKey: "themeAggregation",
    defaultSchedule: defaultFor("themeAggregation"),
    run: (product: Product) => runThemeAggregation(product.organizationId, product),
  });

  registerScheduledAgent({
    slug: AgentSlugs.CUSTOMER_QUOTES,
    scheduleKey: "segmentQuotes",
    defaultSchedule: defaultFor("segmentQuotes"),
    run: (product: Product) => runSegmentQuotesForProduct(product.organizationId, product),
  });

  registerScheduledAgent({
    slug: AgentSlugs.CUSTOMER_INSIGHTS,
    scheduleKey: "segmentInsights",
    defaultSchedule: defaultFor("segmentInsights"),
    run: (product: Product) => runSegmentInsightsForProduct(product.organizationId, product),
  });
}

export { registerCustomerRoutes } from "./routes.js";
