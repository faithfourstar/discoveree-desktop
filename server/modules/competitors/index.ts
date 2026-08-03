/**
 * Competitors module registration (ADR 002 §7): registers the scheduled
 * agent pair — updates + features — matching the SaaS
 * schedules.competitorUpdates / schedules.competitorFeatures keys.
 * (Summary refresh folds into updates for scheduling purposes.)
 *
 * NOTE the profile-canonical rule (module README, ADR 002 risk 1): the
 * `products.competitors` jsonb is never written by this module; ported
 * functions read `profilesToCompetitorArray()` projections instead.
 */
import type { Product } from "@shared/schema";
import { AgentSlugs } from "../../lib/agents/slugs.js";
import { computeDefaultSchedules } from "../../scheduler/defaults.js";
import { registerScheduledAgent } from "../../scheduler/registry.js";
import { runFeaturesScanForProduct, runUpdatesScan } from "./service.js";

export function registerCompetitorAgents(): void {
  registerScheduledAgent({
    slug: AgentSlugs.COMPETITOR_UPDATES,
    scheduleKey: "competitorUpdates",
    defaultSchedule: (product: Product) => computeDefaultSchedules(product)["competitorUpdates"]!,
    run: (product: Product) => runUpdatesScan(product.organizationId, product),
  });

  registerScheduledAgent({
    slug: AgentSlugs.COMPETITOR_FEATURES,
    scheduleKey: "competitorFeatures",
    defaultSchedule: (product: Product) => computeDefaultSchedules(product)["competitorFeatures"]!,
    run: (product: Product) => runFeaturesScanForProduct(product.organizationId, product),
  });
}

export { registerCompetitorRoutes } from "./routes.js";
