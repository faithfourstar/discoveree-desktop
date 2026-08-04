/**
 * Competitors module registration (ADR 002 §7, refined by ADR 003 §2.7):
 * the updates and features scans are ENTITY-scoped agents — monitoring and
 * entity research run once per entity node with ≥1 tracked facet, however
 * many products face it ("track Mixpanel from five products, research it
 * once"). Facet-scoped agents (differentiators, comparisons) would register
 * with the product-scoped kind; sprint 3a has none scheduled.
 *
 * The registering module resolves targets + effective schedules
 * (service.listEntityAgentTargets) so the scheduler stays domain-agnostic.
 */
import { AgentSlugs } from "../../lib/agents/slugs.js";
import { registerEntityScheduledAgent, type EntityAgentTarget } from "../../scheduler/registry.js";
import {
  listEntityAgentTargets,
  runFeaturesScanForEntity,
  runReviewsScanForEntity,
  runUpdatesScanForEntity,
} from "./service.js";

export function registerCompetitorAgents(): void {
  registerEntityScheduledAgent({
    slug: AgentSlugs.COMPETITOR_UPDATES,
    scheduleKey: "competitorUpdates",
    listTargets: () => listEntityAgentTargets("competitorUpdates"),
    run: (target: EntityAgentTarget) => runUpdatesScanForEntity(target.organizationId, target.entityId),
  });

  registerEntityScheduledAgent({
    slug: AgentSlugs.COMPETITOR_FEATURES,
    scheduleKey: "competitorFeatures",
    listTargets: () => listEntityAgentTargets("competitorFeatures"),
    run: (target: EntityAgentTarget) => runFeaturesScanForEntity(target.organizationId, target.entityId),
  });

  // Third registrant of the 3a entity kind (ADR 004 §2/§9): review mining runs
  // once per org per entity node — the most expensive scan, deduplicated.
  registerEntityScheduledAgent({
    slug: AgentSlugs.COMPETITOR_REVIEWS,
    scheduleKey: "competitorReviews",
    listTargets: () => listEntityAgentTargets("competitorReviews"),
    run: (target: EntityAgentTarget) => runReviewsScanForEntity(target.organizationId, target.entityId),
  });
}

export { registerCompetitorRoutes } from "./routes.js";
