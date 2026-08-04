/**
 * Discoveree Desktop schema.
 *
 * Ported from the SaaS repo's shared/schema.ts (main @ 823d979e) per
 * docs/design/001-db-seam.md §4:
 *
 * - Tables owned by CUT modules are stripped entirely: sessions,
 *   password_reset_tokens, team_invitations, team_members,
 *   organization_subscriptions, product_access, product_access_requests,
 *   all slack_* tables, analytics_widgets, inline_comments (+attachments),
 *   tasks, period_reflection_*, goal_proposals, problem_statement_comments,
 *   user_feedback_conversations (vendor feedback loop; depends on the cut
 *   inline_comments table).
 * - Tenancy scoping tables/columns are KEPT (organizations, users,
 *   organization_users, teams; organizationId/userId/productId FKs) with
 *   fixed rows seeded on first run — see server/db/seedLocal.ts.
 * - Billing/Slack/digest columns on surviving tables are omitted
 *   (organizations.stripeCustomerId + LLM budget columns, the users table's
 *   slack/digest columns, ai_agent_prompts.stripeSubscriptionId,
 *   llm_usage.billingPeriod, …).
 * - Reconciled against the raw DDL in the SaaS server/db.ts
 *   ensureSchemaColumns() (ADR risk 6): roadmap_recommendations and
 *   deleted_customer_segment_names existed ONLY in that raw SQL and are
 *   folded in here as first-class tables, along with raw-SQL-only indexes
 *   (market_reviews product+month unique, idea_assessments user+product,
 *   thought_partner_conversations org/product, shared_conversations org,
 *   competitor_threat_level_history profile/product,
 *   customer_call_recordings segment).
 *
 * ADR 003 (multi-product entities) baseline rewrite:
 * - `competitor_entities` (org-level canonical competitor identity + facts +
 *   monitoring state; two-level self-referencing tree via parentEntityId).
 * - `competitor_profiles` becomes the per-product FACET (entityId + productId;
 *   classification, gate status, threat, comparisons).
 * - `competitor_changes` re-keyed to entityId (drops productId/competitorName).
 * - `ai_agent_executions` gains nullable entityId (entity-scoped agent gates).
 * - Segment/persona tables reshaped ahead of the Customer Insights port:
 *   `segment_entities` (org) + facet-shaped `customer_segment_profiles`,
 *   `personas` (org identity) + `persona_facets` (per-product JTBD/goals);
 *   `customer_segment_personas` is replaced by the personas pair.
 */
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, jsonb, boolean, index, real, serial, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
// drizzle-zod ≥0.8 is typed against the zod v4 API; the zod 3.25+ package
// ships it as the "zod/v4" subpath (package pin stays ^3.x per ADR 001 §6).
import { z } from "zod/v4";

// Organizations — desktop has exactly one, seeded on first run ("Local workspace").
// The table (and organizationId scoping everywhere) survives so team mode shares
// this schema and solo→team migration is a data copy, not a schema transformation.
export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(), // URL-friendly identifier
  logoUrl: text("logo_url"),
  // LLM Configuration — desktop is BYO-keys by default
  useOwnLlmKeys: boolean("use_own_llm_keys").notNull().default(true),
  // LLM API Keys (encrypted at rest; desktop prefers OS keychain with DB fallback — see ADR risk 9)
  openaiApiKey: text("openai_api_key"),
  geminiApiKey: text("gemini_api_key"),
  perplexityApiKey: text("perplexity_api_key"),
  claudeApiKey: text("claude_api_key"),
  openrouterApiKey: text("openrouter_api_key"),
  llmKeyMode: text("llm_key_mode").notNull().default("individual"), // 'individual' | 'openrouter'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Users — desktop has exactly one, seeded on first run and filled in by onboarding.
// Auth/session/digest/Slack columns from the SaaS table are omitted (no login on
// desktop; the licence check is not a login).
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  firstLoginAt: timestamp("first_login_at"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Junction table linking users to organizations. Kept (one seeded row) because
// seatType is where the licensing/seat boundary lives in team mode (ADR risk 7).
export const organizationUsers = pgTable("organization_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  userId: varchar("user_id").notNull(),
  role: text("role").notNull().default("Executive"), // Leader, Product team, Executive
  isAdmin: boolean("is_admin").notNull().default(false),
  jobTitle: text("job_title"),
  joinedAt: timestamp("joined_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  seatType: text("seat_type").notNull().default("pro"), // 'pro' | 'collaborator'
});

export interface RoadmapColumn {
  id: string;
  label: string;
  isDefault: boolean;
  hidden: boolean;
}

export const DEFAULT_ROADMAP_COLUMNS: RoadmapColumn[] = [
  { id: 'define', label: 'Define', isDefault: true, hidden: false },
  { id: 'design', label: 'Design', isDefault: true, hidden: false },
  { id: 'build',  label: 'Build',  isDefault: true, hidden: false },
  { id: 'impact', label: 'Impact', isDefault: true, hidden: false },
];

export const NOW_NEXT_LATER_COLUMNS: RoadmapColumn[] = [
  { id: 'now',   label: 'Now',   isDefault: true, hidden: false },
  { id: 'next',  label: 'Next',  isDefault: true, hidden: false },
  { id: 'later', label: 'Later', isDefault: true, hidden: false },
];

export const LEGACY_STATUS_MAP: Record<string, string> = {
  'now':                 'design',
  'next':                'define',
  'later':               'define',
  'opportunity_created': 'define',
  'solution_ideas':      'define',
  'solution_design':     'design',
  'iteration':           'build',
  'backlog_on_hold':     'define',
  'active_opportunity':  'define',
  'planned':             'define',
  'delivery':            'define',
  'value_realisation':   'impact',
};

// Products - belong to an organization, represents different products the org manages
export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").unique(), // URL-friendly identifier auto-generated from name
  url: text("url"),
  logoUrl: text("logo_url"),
  description: text("description"),
  competitors: jsonb("competitors"), // Array of {name, url, type: 'competitor'|'adjacent'}
  markets: jsonb("markets"), // Array of market strings
  segments: jsonb("segments"), // Array of segment strings
  businessGoals: jsonb("business_goals"), // Array of goal objects
  reviewSites: jsonb("review_sites"), // Array of site URLs
  helpCenterUrl: text("help_center_url"), // URL to product's help center/documentation for AI context
  prioritizationWeights: jsonb("prioritization_weights"), // {revenueImpact, revenuePotential, sentiment, frequency}
  goalThemeOptions: jsonb("goal_theme_options"), // Array of custom goal theme strings
  goalMetricOptions: jsonb("goal_metric_options"), // Array of {value, label, prefix, suffix}
  goalPlanningFrequency: text("goal_planning_frequency"), // 6-week, monthly, quarterly - for team/layer goals
  currentPeriodEndDate: timestamp("current_period_end_date"), // End date of current goal planning period
  businessGoalPlanningFrequency: text("business_goal_planning_frequency"), // 6-month, annual - for business goals
  businessGoalPeriodEndDate: timestamp("business_goal_period_end_date"), // End date of current business goal period
  // Team/Layer goal period reminder tracking
  teamReminder25PercentShown: boolean("team_reminder_25_percent_shown").default(false),
  teamReminder2DaysShown: boolean("team_reminder_2_days_shown").default(false),
  teamReminderEndDayShown: boolean("team_reminder_end_day_shown").default(false),
  // Business goal period reminder tracking
  businessReminder25PercentShown: boolean("business_reminder_25_percent_shown").default(false),
  businessReminder2DaysShown: boolean("business_reminder_2_days_shown").default(false),
  businessReminderEndDayShown: boolean("business_reminder_end_day_shown").default(false),
  teamWeeklyCost: integer("team_weekly_cost"), // Average weekly cost per team for ROI calculations
  // Agent schedule configuration - stored as JSON object with schedule per agent
  agentSchedules: jsonb("agent_schedules"), // {feedbackCollection: {enabled, frequencyValue, frequencyUnit, timeOfDay}, themeAggregation: {...}, opportunities: {...}}
  audience: jsonb("audience"), // Array of strings: "B2C", "B2B (SMB)", "B2B (Enterprise)", "Partner/Reseller", "Other"
  distribution: jsonb("distribution"), // Array of strings: "Product-led", "Sales-led", "Other"
  businessModel: jsonb("business_model"), // Array of strings: "Subscription", "Credits", "Consumption", "Transaction fee", "% of total value", "Cost plus"
  isRegulated: boolean("is_regulated"), // Whether the product operates in a regulated industry (e.g. financial services, healthcare)
  customerInsightsSummary: text("customer_insights_summary"), // AI-generated cross-segment synthesis of strategic importance, growth opportunities, and priority needs
  dashboardSectionSummaries: jsonb("dashboard_section_summaries"), // { [sectionId]: { text: string, generatedAt: string } } — AI summaries per dashboard section
  purposeStatement: text("purpose_statement"), // AI-generated 2-sentence prose statement covering problem, audience, distribution, business model
  growthAmbition: text("growth_ambition"), // Free-text growth ambition statement
  periodAmbitions: jsonb("period_ambitions"), // Array of 3 strings for period-based ambitions
  periodTitles: jsonb("period_titles"), // Array of 3 short punchy titles (5-8 words) for period bands
  strategicPillars: jsonb("strategic_pillars"), // Array of {title, description}
  investmentProfile: jsonb("investment_profile"), // {bigBets: string[], competitorParity: string[], maintain: string[], knownGap: string[]}
  roadmapColumns: jsonb("roadmap_columns"), // Array of {id, label, isDefault, hidden} for Kanban workflow stages
  documentTemplates: jsonb("document_templates"), // { stakeholder: string[], product_designer: string[], engineer: string[], ai_agent: string[] } — ordered section name lists per audience
  workflowSettings: jsonb("workflow_settings"), // { scopingMode: "two-step" | "three-step", buildDestination?: string | null }
  timeInvestmentUnit: text("time_investment_unit").default("weeks"), // 'days', 'weeks', or 'months'
  // Onboarding Discovery — per-product configuration
  onboardingDiscoveryStatus: text("onboarding_discovery_status").notNull().default("not_started"), // 'not_started' | 'in_progress' | 'completed'
  userCompletedDiscovery: boolean("user_completed_discovery").notNull().default(false), // true only when the user personally completed the discovery conversation (not auto-healed)
  discoveryConversationHistory: jsonb("discovery_conversation_history"), // Array of { role, content } — persisted for resume
  discoveryProfile: jsonb("discovery_profile"), // Structured JSON produced when conversation completes
  // Strategy Assistant — per-product conversation
  strategyConversationHistory: jsonb("strategy_conversation_history"), // Array of { role, content } — persisted for resume
  strategyDocument: jsonb("strategy_document"), // Array of { id: string, title: string, content: string, order: number } — narrative strategy sections
  strategyStatus: text("strategy_status").default("draft"), // "draft" | "under_review" | "final"
  strategyViewers: jsonb("strategy_viewers"), // Array<{type: "user"|"group", id: string, name: string}> — null/empty = everyone
  strategyUpdatedAt: timestamp("strategy_updated_at"),
  constraintsAndRisks: jsonb("constraints_and_risks").$type<Array<{ title: string; description: string }>>(), // Array of {title, description} — structured risks from strategy conversation
  nextPeriodBusinessGoals: jsonb("next_period_business_goals").$type<BusinessGoal[]>(), // Staging area for next-period goals (accumulated from accepted proposals)
  businessGoalsUpdatedAt: timestamp("business_goals_updated_at"),
  competitiveLandscapeUpdatedAt: timestamp("competitive_landscape_updated_at"),
  customerInsightsSummaryUpdatedAt: timestamp("customer_insights_summary_updated_at"),
  // Product Financials Agent — commercial model context gathered from the Product Financials conversation
  // Stores: revenueModel, pricingStructure, keySegments, keyChannels, primaryKPIs, costDrivers
  productFinancialsContext: jsonb("product_financials_context"), // Structured commercial model context persisted between sessions
  // Lightweight tracking columns for What's Changed feed events
  sentimentLatestDataMonth: text("sentiment_latest_data_month"), // e.g. "2026-03" — latest feedback_entries month seen (#17)
  sentimentDataUpdatedAt: timestamp("sentiment_data_updated_at"), // When new sentiment month was first detected (#17)
  goalTrackingUpdatedAt: timestamp("goal_tracking_updated_at"), // When on-track status was last updated (#19)
  goalOnTrack: boolean("goal_on_track"), // Whether product is currently on track to meet goals (#19)
  roadmapViewFormat: text("roadmap_view_format"), // 'stage-progression' | 'now-next-later' | 'timeline' — product-level setting
  roadmapSyncConfig: jsonb("roadmap_sync_config").$type<{
    mode: 'one-time' | 'ongoing';
    sourceType: 'document' | 'mcp' | 'manual';
    mcpConnectionId?: string;
    externalProjectId?: string; // The board ID, project key, or team ID in the source tool
    externalProjectName?: string; // Human-readable label for the selected project/board/team
    lastImportedAt?: string; // ISO timestamp
    lastError?: string; // Error message from last failed sync
    lastErrorAt?: string; // ISO timestamp of last failure
    enabled?: boolean; // false = auto-disabled (e.g. connection deleted); scheduler skips until re-enabled
  } | null>(),
  lastSynced: timestamp("last_synced"),
  // Notion / Confluence linked pages — keyed by a pageType string
  notionConfluenceLinks: jsonb("notion_confluence_links").$type<Record<string, {
    connectionId: string;
    externalPageId: string;
    externalPageUrl: string;
    lastSyncedAt: string; // ISO timestamp
  }>>(),
  strategyMarketScanFindings: jsonb("strategy_market_scan_findings"), // Cached findings from the market review agent
  archivedInsightsRecommendations: jsonb("archived_insights_recommendations"),
  scoringConfig: jsonb("scoring_config"), // Optional per-product opportunity scoring weights (ScoringConfig)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Teams - belong to a product, represents different product domains.
// Team management UI is cut on desktop, but the table survives: roadmap items
// and feedback carry team_id, and Roadmap Review groups by team (ADR §4b).
export const teams = pgTable("teams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  name: text("name").notNull(),
  handle: text("handle"),
  description: text("description"),
  focusArea: text("focus_area"), // Defined area of focus for filtering opportunities
  features: jsonb("features"), // Array of feature areas
  featureAnalyticsLinks: jsonb("feature_analytics_links"), // {featureName: url} mapping for analytics dashboard links
  featureAnalyticsData: jsonb("feature_analytics_data"), // {featureName: {metrics, lastExtractedAt, source, summary}} extracted or manual metrics per feature
  focusCompetitors: jsonb("focus_competitors"), // Array of competitor names this team focuses on (subset of product competitors)
  customerSegments: jsonb("customer_segments"), // Array of customer segment names this team serves (subset of product segments)
  markets: jsonb("markets"), // Array of market/geography names this team covers (subset of product markets)
  goalText: text("goal_text"), // Team's goal description (e.g., "Create upgrade pathways")
  goalTarget: integer("goal_target"), // Team's goal target value (current/default period)
  goalBaseline: integer("goal_baseline").default(0), // Baseline value, defaults to 0
  goalMetric: text("goal_metric"), // Metric type: 'revenue', 'users', 'satisfaction'
  goalPeriodTargets: jsonb("goal_period_targets").$type<Record<string, number>>(), // Period-specific target overrides: { "Q2 2026": 50000 }
  goalPeriodId: varchar("goal_period_id"), // Links to goal period
  parentGoalId: varchar("parent_goal_id"), // Links to business goal, layer goal, or null
  parentGoalType: text("parent_goal_type"), // 'business', 'layer', or null
  groupingId: varchar("grouping_id"), // Links to a layer goal (grouping) for filtering
  weeklyCost: integer("weekly_cost"), // Average weekly cost for ROI calculations
  roiUpdatedAt: timestamp("roi_updated_at"), // When ROI data was last written for this team (#20 team_roi_change event)
  lastOpportunityGenerationAt: timestamp("last_opportunity_generation_at"), // Last time AI generated opportunities
  teamDiscoveryStatus: text("team_discovery_status").notNull().default("not_started"), // 'not_started' | 'in_progress' | 'complete'
  teamDiscoveryConversationHistory: jsonb("team_discovery_conversation_history"), // [{role, content}]
  workflowConfig: jsonb("workflow_config"), // Team workflow preferences from discovery agent
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Build Step — a single task within the Build stage for a solution idea
export type BuildStepStatus =
  | "not_started"
  | "brief_ready"
  | "sent_to_platform"
  | "plan_proposed"
  | "awaiting_approval"
  | "in_progress"
  | "done";

export interface BuildStep {
  id: string;
  label: string;
  description?: string | null;
  status: BuildStepStatus;
  briefType?: "Engineering" | "AI Agent" | "none" | null;
  briefContent?: string | null;
  briefAudience?: string | null;
  platformData?: { title?: string; content?: string; receivedAt?: string } | null;
  links: Array<{ title: string; url: string }>;
  dispatchedTo?: string | null;
  dispatchedAt?: string | null;
  order?: number;
  successCriteria?: string[] | null;
}

export interface BuildConnectionState {
  connectionId?: string;
  connectionName?: string;
  linkedIssueId?: string;
  linkedIssueUrl?: string;
  lastPolledAt?: string;
  completionSource?: "jira" | "linear" | "monday" | "asana" | "workflow" | "manual";
  pollingError?: string | null;
  pendingPlan?: { title: string; content: string; receivedAt: string } | null;
  planApprovalStatus?: "pending" | "auto-approved" | "approved" | "rejected" | null;
  planApprovedAt?: string | null;
  planRejectedAt?: string | null;
  autoApproved?: boolean;
  buildSummaryReceivedAt?: string | null;
  productionPushedAt?: string | null;
  productionDeploymentUrl?: string | null;
  productionNotes?: string | null;
  dispatchStatus?: "none" | "queued" | "sent" | "in_progress" | "done";
  queuedAt?: string | null;
}

// WorkflowSettings — per-product workflow configuration (stored as jsonb on products table)
export interface WorkflowSettings {
  scopingMode?: "two-step" | "three-step";
  buildDestination?: string | null;
}

// LaunchActivity — a single activity in the opportunity-level launch plan
export type LaunchActivityType =
  | "help-centre"
  | "marketing-copy"
  | "in-product-guidance"
  | "customer-comms"
  | "sales-enablement"
  | "launch-campaign"
  | "custom";

export type LaunchActivityStatus = "not_started" | "in_progress" | "done";

export interface LaunchActivity {
  id: string;
  type: LaunchActivityType;
  title: string;
  status: LaunchActivityStatus;
  draftInApp: boolean;
  draftedContent?: string | null;
  linkTitle?: string | null;
  linkUrl?: string | null;
  ideaId?: string | null;
  order: number;
  /** External wiki sync link — present after the first publish to Notion/Confluence. */
  syncLink?: BriefSyncLink | null;
}

// LaunchPlan — opportunity-level launch plan (stored as jsonb on opportunities table)
export interface LaunchPlan {
  mode: "shared" | "per-idea";
  activities: LaunchActivity[];
  chatMessages?: Array<{ role: string; content: string }>;
  planComplete?: boolean;
  launchDate?: string | null;
}

/** Per-brief external sync link stored in briefSyncLinks[briefKey] on a SolutionIdeaData. */
export interface BriefSyncLink {
  connectionId: string;
  externalPageId: string;
  externalPageUrl: string | null;
  lastSyncedAt: string;
  lastSyncedHash?: string;
  syncConflict?: boolean;
  /** Remote content stored during conflict detection so the user can choose which version to keep. */
  conflictRemoteContent?: string | null;
  /** URL of a thumbnail/preview image returned by the design tool (Figma/Miro). */
  previewImageUrl?: string | null;
  /** Short plain-text summary of the file/board contents returned by the design tool. */
  contentSummary?: string | null;
}

// SolutionIdeaData — typed shape for entries in the solutionIdeas jsonb array on opportunities
// (partial — only the fields actively used by the Build stage are fully typed here)
export interface SolutionIdeaData {
  id: string;
  idea?: string;
  title?: string;
  text?: string;
  inBuild?: boolean;
  isComplete?: boolean;
  buildSteps?: BuildStep[];
  buildChatMessages?: Array<{ role: string; content: string }>;
  buildChatDone?: boolean;
  workflowSteps?: Array<{ id: string; type: "brief" | "custom"; label: string; briefAudience?: string; links: Array<{ title: string; url: string }>; content?: string | null; syncLink?: BriefSyncLink | null }>;
  workflowChatMessages?: Array<{ role: string; content: string }>;
  workflowChatDone?: boolean;
  /** True once the scoping doc has been sent to at least one design platform. */
  designPhase?: boolean;
  /** Map of briefKey → external sync link (wiki page or design tool file/board). */
  briefSyncLinks?: Record<string, BriefSyncLink>;
  /** Roadmap / lifecycle status. 'declined' means the team chose not to proceed. */
  planStatus?: string;
  /** Optional reason captured when planStatus is set to 'declined'. */
  declinedReason?: string | null;
  /** ISO timestamp set when planStatus becomes 'declined'. */
  declinedAt?: string | null;
  /** True once the idea's build context has been dispatched to a coding platform. */
  sentToBuild?: boolean;
  /** ISO timestamp set when sentToBuild becomes true. */
  sentToBuildAt?: string | null;
}

// Opportunities - belong to a team (which belongs to a product) or directly to a product (strategic opportunities)
export const opportunities = pgTable("opportunities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  teamId: varchar("team_id"), // Optional - strategic opportunities have no team
  productId: varchar("product_id"), // Product ID for strategic opportunities without team
  title: text("title").notNull(),
  description: text("description"),
  sentiment: integer("sentiment").notNull(), // 0 to 100
  frequency: integer("frequency").notNull(),
  mentions: integer("mentions").notNull().default(0), // Number of customer mentions
  revenueImpact: integer("revenue_impact"), // in currency
  revenuePotential: integer("revenue_potential"), // in currency
  priorityScore: integer("priority_score"),
  status: text("status").notNull().default("backlog"), // backlog, now, next, later
  opportunityStatus: text("opportunity_status").notNull().default("active"), // active, planned, inactive
  timeInvestmentWeeks: integer("time_investment_weeks"),
  goalContributionPercent: integer("goal_contribution_percent"),
  suggestedGoalContributionPercent: integer("suggested_goal_contribution_percent"),
  goalContributionConfirmed: boolean("goal_contribution_confirmed").default(false),
  markets: jsonb("markets"),
  segments: jsonb("segments"),
  votes: jsonb("votes"), // {userId: 'high'|'medium'|'low'}
  comments: jsonb("comments"), // Array of comment objects
  sources: jsonb("sources"), // Array of source references
  relevanceToFocusArea: text("relevance_to_focus_area"), // Explanation of how opportunity maps to team's focus area
  impactHypothesis: text("impact_hypothesis"), // Team's hypothesis on impact
  hypothesisEvidence: jsonb("hypothesis_evidence"), // Array of {id, type: 'link'|'document', title, url, addedBy, addedAt}
  confidenceVotes: jsonb("confidence_votes"), // Array of {userId, userName, confidence: 0-100, votedAt}
  confidenceOverride: integer("confidence_override"), // Direct numeric override (0-100) for confidence, takes precedence over votes
  customerFeedback: jsonb("customer_feedback"), // {summary: string, quotes: Array<{id, text, source, sourceUrl, sentiment, createdAt}>}
  competitorSolutions: jsonb("competitor_solutions"), // Array of {competitorName, description, sentiment, mentions, helpLinks, feedbackQuotes}
  solutionIdeas: jsonb("solution_ideas"), // Array of {id, text, source: 'ai'|'manual', starred, comments, createdBy, createdAt}
  actions: jsonb("actions"), // Array of {id, text, source: 'ai'|'manual', completed, assignedTo, createdBy, createdAt}
  agentBuildApproval: jsonb("agent_build_approval"), // {ideaId, ideaTitle, audience, designContent, approvedAt, approvedBy}
  launchContent: jsonb("launch_content"), // { userManual: { content, generatedAt } | null, marketing: { content, generatedAt } | null }
  launchPlan: jsonb("launch_plan"), // LaunchPlan
  agentBuildResult: jsonb("agent_build_result"), // {summary, completedAt}
  // Plan card detail fields
  startDate: timestamp("start_date"), // When work begins
  valueRealizationDate: timestamp("value_realization_date"), // When delivery starts realizing value
  completionPercent: integer("completion_percent"), // 0-100 in 10% increments, manually set
  completionHistory: jsonb("completion_history"), // Array<{date: string, percent: number}>
  prioritizeAfter: varchar("prioritize_after"), // ID of opportunity above in the plan
  prioritizeBefore: varchar("prioritize_before"), // ID of opportunity below in the plan
  itemType: text("item_type").default("task"), // 'task' or 'epic'
  userStory: text("user_story"), // AI-generated user story (for tasks)
  prd: text("prd"), // AI-generated PRD (for epics)
  // Value change tracking fields
  previousValueRealizationDate: timestamp("previous_value_realization_date"), // Date before the change
  previousGoalContributionPercent: integer("previous_goal_contribution_percent"), // Contribution before the change
  valueChangeReason: text("value_change_reason"), // 'dependency_delay' | 'manual_date_change'
  valueChangedAt: timestamp("value_changed_at"), // When the value change was detected
  valueChangeDependencyId: varchar("value_change_dependency_id"), // ID of dependency that caused delay (if applicable)
  valueChangeAcceptedAt: timestamp("value_change_accepted_at"), // When user accepted the change
  valueChangeAcceptedBy: varchar("value_change_accepted_by"), // User ID who accepted
  // Value calculation fields for custom goal contribution calculations
  valueCalculationMode: text("value_calculation_mode").default("even"), // 'even' | 'custom'
  newCustomersPerMonth: integer("new_customers_per_month"),
  revenuePerCustomer: integer("revenue_per_customer"),
  existingCustomersPerMonth: integer("existing_customers_per_month"),
  revenueUpliftPerCustomer: integer("revenue_uplift_per_customer"),
  targetNewCustomersTotal: integer("target_new_customers_total"), // Cap for how many total new customers (limits months of contribution)
  targetExistingCustomersTotal: integer("target_existing_customers_total"), // Cap for how many total existing customers (limits months of contribution)
  researchItems: jsonb("research_items"), // Array of {title, type, linkedSegmentId, linkedSegmentName, attachments, addedBy, addedAt}
  // Market Review Agent fields
  opportunityType: text("opportunity_type").default("standard"), // "standard" | "market-review"
  marketReviewStatus: text("market_review_status"), // null | "researching" | "ready"
  marketReviewData: jsonb("market_review_data"), // { summary, sections: [{title, content}], marketName, searchedAt }
  marketReviewConversationHistory: jsonb("market_review_conversation_history"), // [{role, content}]
  opportunityViewers: jsonb("opportunity_viewers"), // Array<{type: "user"|"group", id: string, name: string}> — null/empty = everyone
  strategicPillar: text("strategic_pillar"), // Which strategic pillar this opportunity aligns to
  isMilestone: boolean("is_milestone").default(false), // Marked as a key milestone
  // Opportunity Definition Assistant fields
  definitionStatus: text("definition_status").default("not_started"), // "not_started" | "in_progress" | "complete"
  definitionConversationHistory: jsonb("definition_conversation_history"), // [{role, content}] — persisted chat history
  definitionDocument: jsonb("definition_document"), // { impactHypothesis?, strategicAlignment?, ... }
  // Specialist Assistant fields (e.g. acquisition assessment, unit economics)
  specialistAssistantType: text("specialist_assistant_type"), // "acquisition-assessment" | "unit-economics" | "new-market-entry" | null
  specialistAssistantConversationHistory: jsonb("specialist_assistant_conversation_history"), // [{role, content}] — persisted chat history
  specialistAssistantMessages: jsonb("specialist_assistant_messages"), // [{role, content}] — persisted chat history (alias)
  specialistAssistantReadyFlag: boolean("specialist_assistant_ready_flag").default(false), // true when assistant has finalised
  specialistAssistantSections: jsonb("specialist_assistant_sections"), // Array of {id, title, content, order} — structured output from finalization
  specialistPendingSectionTitle: text("specialist_pending_section_title"), // title of the section the AI has signalled as ready but not yet generated
  specialistPlatformContext: text("specialist_platform_context"), // cached platform context gathered for the specialist conversation
  specialistWebResearchContext: text("specialist_web_research_context"), // cached web research context gathered for the specialist conversation
  // Impact monitoring fields
  revenueTrackingUrl: text("revenue_tracking_url"),
  analyticsLinks: jsonb("analytics_links"), // Array of {label, url}
  impactInsights: jsonb("impact_insights"), // { revenue?: {text, generatedAt}, analytics?: {text, generatedAt}, feedback?: {text, generatedAt} }
  impactRecommendations: jsonb("impact_recommendations"), // { statusSignal, actualMetric, recommendations, generatedAt }
  impactMetrics: jsonb("impact_metrics"), // Array of { id, title, description, indicator, dashboardUrl?, insight? }
  impactMetricsSourceHash: text("impact_metrics_source_hash"), // SHA-256 (truncated) of definitionDocument.measurement when impactMetrics was last parsed; null = needs re-parse
  buildConnectionState: jsonb("build_connection_state").$type<BuildConnectionState>(),
  datesLastModifiedAt: timestamp("dates_last_modified_at"), // Set when startDate or valueRealizationDate changes
  isImportedUnassigned: boolean("is_imported_unassigned").default(false), // True for roadmap-imported items that couldn't be matched to a domain
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_opportunities_team_id").on(table.teamId),
  index("idx_opportunities_product_id").on(table.productId),
]);

// Problem Statements - belong to an opportunity, allow multiple problem definitions
export const problemStatements = pgTable("problem_statements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  opportunityId: varchar("opportunity_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  source: text("source").notNull().default("manual"), // 'ai' or 'manual'
  relatedFeatures: jsonb("related_features"), // Array of feature name strings from team's features
  relatedNeeds: jsonb("related_needs"), // Array of {segmentName, need} objects from customer segment profiles
  createdById: varchar("created_by_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Problem Statement Attachments - files attached to problem statements
export const problemStatementAttachments = pgTable("problem_statement_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  problemStatementId: varchar("problem_statement_id").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileType: text("file_type"), // MIME type
  fileSize: integer("file_size"), // Size in bytes
  uploadedById: varchar("uploaded_by_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProblemStatementSchema = createInsertSchema(problemStatements).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProblemStatementAttachmentSchema = createInsertSchema(problemStatementAttachments).omit({ id: true, createdAt: true });

// Insert schemas
export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOrganizationUserSchema = createInsertSchema(organizationUsers).omit({ id: true, createdAt: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTeamSchema = createInsertSchema(teams).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOpportunitySchema = createInsertSchema(opportunities).omit({ id: true, createdAt: true, updatedAt: true });

// Business Goal Type - includes description, target value, baseline, metric type, theme, and optional period label
export interface BusinessGoal {
  id: string;
  description: string;
  target: number | null;
  baseline: number | null; // Optional baseline value, defaults to 0
  goalMetric: string | null;
  theme: string | null;
  period?: string | null; // Optional period label e.g. "Q2 2026" — tags this goal to a specific planning period
}

// Goal Layers - Custom goal hierarchy levels between Business Goals and Team Goals
export const goalLayers = pgTable("goal_layers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  name: text("name").notNull(), // e.g., "Department", "Division", "Squad"
  displayOrder: integer("display_order").notNull().default(0), // Order in hierarchy (0 = closest to Business Goals)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Layer Goals - Individual goals within a custom goal layer
export const layerGoals = pgTable("layer_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  layerId: varchar("layer_id").notNull(), // Which goal layer this belongs to
  productId: varchar("product_id").notNull(),
  periodId: varchar("period_id"), // Links to goal period
  name: text("name").notNull(), // e.g., "Engineering Department", "Sales Division"
  goalText: text("goal_text"), // Goal description
  goalTarget: integer("goal_target"), // Target value
  goalBaseline: integer("goal_baseline").default(0), // Baseline value, defaults to 0
  goalMetric: text("goal_metric"), // Metric type
  parentGoalId: varchar("parent_goal_id"), // Links to business goal or layer goal above
  parentGoalType: text("parent_goal_type"), // 'business' or 'layer'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertGoalLayerSchema = createInsertSchema(goalLayers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLayerGoalSchema = createInsertSchema(layerGoals).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertGoalLayer = z.infer<typeof insertGoalLayerSchema>;
export type GoalLayer = typeof goalLayers.$inferSelect;
export type InsertLayerGoal = z.infer<typeof insertLayerGoalSchema>;
export type LayerGoal = typeof layerGoals.$inferSelect;

// Goal Period Types - unified for all goals (business and team)
export type GoalPeriodType = 'quarterly' | '6-month' | 'annual';

export const GOAL_PERIOD_OPTIONS: { value: GoalPeriodType; label: string; durationDays: number }[] = [
  { value: 'quarterly', label: 'Quarterly', durationDays: 90 },
  { value: '6-month', label: '6 Monthly', durationDays: 182 },
  { value: 'annual', label: 'Annual', durationDays: 365 },
];

// Goal Periods - Time-based containers for goals
export const goalPeriods = pgTable("goal_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  name: text("name").notNull(), // e.g., "Q1 2025" or "January 2025"
  periodType: text("period_type").notNull(), // 6-week, monthly, quarterly, annual
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  status: text("status").notNull().default("active"), // active, ended
  hasNextPeriodGoals: boolean("has_next_period_goals").notNull().default(false), // Whether next period goals have been set
  reminder25PercentShown: boolean("reminder_25_percent_shown").notNull().default(false),
  reminder2DaysShown: boolean("reminder_2_days_shown").notNull().default(false),
  reminderEndDayShown: boolean("reminder_end_day_shown").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertGoalPeriodSchema = createInsertSchema(goalPeriods).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertGoalPeriod = z.infer<typeof insertGoalPeriodSchema>;
export type GoalPeriod = typeof goalPeriods.$inferSelect;

// Goal Metric Format Types
export type GoalMetricFormatType = 'currency' | 'number' | 'percentage';

// Currency options for goal metrics
export const CURRENCY_OPTIONS = [
  { value: 'GBP', symbol: '£', label: 'British Pound (£)' },
  { value: 'USD', symbol: '$', label: 'US Dollar ($)' },
  { value: 'EUR', symbol: '€', label: 'Euro (€)' },
  { value: 'JPY', symbol: '¥', label: 'Japanese Yen (¥)' },
  { value: 'AUD', symbol: 'A$', label: 'Australian Dollar (A$)' },
  { value: 'CAD', symbol: 'C$', label: 'Canadian Dollar (C$)' },
  { value: 'CHF', symbol: 'CHF', label: 'Swiss Franc (CHF)' },
  { value: 'INR', symbol: '₹', label: 'Indian Rupee (₹)' },
];

// Goal Metric Option Type - for configurable team goal metrics
export interface GoalMetricOption {
  value: string;
  label: string;
  formatType: GoalMetricFormatType;
  currencySymbol?: string; // Only used when formatType is 'currency'
  requiresCumulativeTotal?: boolean; // Whether charts show cumulative line (e.g., Revenue/Users) vs just current value (e.g., Satisfaction)
  // Legacy support - old format template string
  format?: string;
}

// Default goal themes used when product has no custom themes
export const DEFAULT_GOAL_THEMES = [
  "Win more customers",
  "Expand revenue",
  "Mitigate churn",
  "Reduce cost to serve"
];

// Default goal metrics used when product has no custom metrics
export const DEFAULT_GOAL_METRICS: GoalMetricOption[] = [
  { value: 'revenue', label: 'Revenue', formatType: 'currency', currencySymbol: '£', requiresCumulativeTotal: true },
  { value: 'users', label: 'No. Users', formatType: 'number', requiresCumulativeTotal: true },
  { value: 'satisfaction', label: 'Satisfaction', formatType: 'percentage', requiresCumulativeTotal: false },
];

// Review source type for provenance tracking
export const reviewSourceTypeSchema = z.enum(["g2_api", "web_search", "ai_generated"]);
export type ReviewSourceType = z.infer<typeof reviewSourceTypeSchema>;

// Customer Feedback Validation Schema
export const customerFeedbackQuoteSchema = z.object({
  id: z.string().optional(), // Unique identifier for this quote
  feedbackEntryId: z.string().optional(), // Link to actual feedbackEntries table record
  text: z.string(),
  source: z.string(),
  sourceUrl: z.string(),
  sentiment: z.number().min(0).max(100),
  verified: z.boolean().optional().default(false),
  sourceType: reviewSourceTypeSchema.optional().default("ai_generated"),
  fetchedAt: z.string().optional(),
});

export const customerFeedbackSchema = z.object({
  summary: z.string(),
  quotes: z.array(customerFeedbackQuoteSchema).default([]),
}).optional();

// Competitor Solutions Validation Schema
export const competitorHelpLinkSchema = z.object({
  title: z.string(),
  url: z.string(),
  type: z.enum(["help_center", "documentation", "blog", "user_guide"]),
});

export const competitorFeedbackQuoteSchema = z.object({
  id: z.string().optional(), // Unique identifier for this quote
  feedbackEntryId: z.string().optional(), // Link to actual feedbackEntries table record
  text: z.string(),
  source: z.string(),
  sourceUrl: z.string(),
  sentiment: z.number().min(0).max(100),
  verified: z.boolean().optional().default(false),
  sourceType: reviewSourceTypeSchema.optional().default("ai_generated"),
  fetchedAt: z.string().optional(),
});

export const competitorSolutionSchema = z.object({
  competitorName: z.string(),
  description: z.string(),
  helpLinks: z.array(competitorHelpLinkSchema).default([]),
  feedbackQuotes: z.array(competitorFeedbackQuoteSchema).default([]),
});

export const competitorSolutionsSchema = z.array(competitorSolutionSchema).optional();

// Search provider options for web search agents
export const SEARCH_PROVIDER_OPTIONS = ["perplexity", "openai_web_search", "gemini"] as const;
export type SearchProviderType = typeof SEARCH_PROVIDER_OPTIONS[number];

// Available AI models with their providers - unified model selection for all agents
export const AI_MODEL_OPTIONS = [
  // Gemini models
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", provider: "gemini", supportsWebSearch: true },
  // OpenAI models
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", supportsWebSearch: true },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", supportsWebSearch: true },
  // Perplexity models (specialized for web search)
  { id: "sonar", name: "Perplexity Sonar", provider: "perplexity", supportsWebSearch: true },
  { id: "sonar-pro", name: "Perplexity Sonar Pro", provider: "perplexity", supportsWebSearch: true },
  // Claude models
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "claude", supportsWebSearch: false },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "claude", supportsWebSearch: false },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "claude", supportsWebSearch: false },
  // OpenRouter models (unified gateway — users type custom slugs; these are sensible defaults)
  { id: "openai/gpt-4o", name: "OpenRouter: GPT-4o", provider: "openrouter", supportsWebSearch: true },
  { id: "openai/gpt-4o-mini", name: "OpenRouter: GPT-4o Mini", provider: "openrouter", supportsWebSearch: true },
  { id: "anthropic/claude-sonnet-4-5", name: "OpenRouter: Claude Sonnet", provider: "openrouter", supportsWebSearch: false },
  { id: "perplexity/sonar", name: "OpenRouter: Perplexity Sonar", provider: "openrouter", supportsWebSearch: true },
] as const;

export type AiModelId = typeof AI_MODEL_OPTIONS[number]["id"];
export type AiModelProvider = typeof AI_MODEL_OPTIONS[number]["provider"];

// AI Agents - Registry of all AI agents in the system
export const aiAgents = pgTable("ai_agents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(), // Unique identifier (e.g., "opportunities-agent")
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull().default("general"), // onboarding, analysis, generation
  codePath: text("code_path"), // File path where agent logic lives
  defaultPrompt: text("default_prompt").notNull(), // The system's default prompt template
  modelProvider: text("model_provider").notNull().default("gemini"), // gemini, openai, perplexity, claude
  modelName: text("model_name").notNull().default("gemini-3.5-flash"),
  searchProvider: text("search_provider"), // For web search agents: perplexity, openai_web_search, gemini
  requiresWebSearch: boolean("requires_web_search").notNull().default(false), // Whether agent needs web search capability
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// AI Agent Prompts - Custom prompt versions created by organizations
export const aiAgentPrompts = pgTable("ai_agent_prompts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull(),
  organizationId: varchar("organization_id"), // Null for platform-wide defaults
  version: integer("version").notNull().default(1),
  prompt: text("prompt").notNull(),
  createdBy: varchar("created_by"), // userId
  sharingScope: text("sharing_scope").notNull().default("private"), // private, organization, platform
  githubPrUrl: text("github_pr_url"), // For platform sharing via PR
  githubPrStatus: text("github_pr_status"), // pending, merged, rejected
  isActive: boolean("is_active").notNull().default(false), // Whether this version is currently in use
  createdAt: timestamp("created_at").defaultNow(),
});

// AI Agent Executions - Execution history for each agent
export const aiAgentExecutions = pgTable("ai_agent_executions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull(),
  organizationId: varchar("organization_id"),
  productId: varchar("product_id"), // Which product this execution was for (product-scoped agents)
  entityId: varchar("entity_id"), // Which competitor entity this execution was for (entity-scoped agents, ADR 003 §2.7)
  promptId: varchar("prompt_id"), // Which prompt version was used
  triggerType: text("trigger_type").notNull().default("automatic"), // automatic, manual, test
  triggerContext: text("trigger_context"), // Description of what triggered the run
  inputParameters: jsonb("input_parameters"), // Input data sent to the agent
  status: text("status").notNull().default("running"), // running, completed, failed
  resultSummary: text("result_summary"), // Brief summary of results
  resultPayload: jsonb("result_payload"), // Full output data
  actionsTaken: jsonb("actions_taken"), // Array of actions the agent performed
  errorMessage: text("error_message"),
  tokensUsed: integer("tokens_used"),
  promptTokens: integer("prompt_tokens"), // Input tokens
  completionTokens: integer("completion_tokens"), // Output tokens
  modelProvider: text("model_provider"), // gemini, openai, perplexity, claude
  modelName: text("model_name"), // Actual model used (e.g., gemini-3.5-flash)
  usedWebSearch: boolean("used_web_search").default(false), // Whether web search was used
  durationMs: integer("duration_ms"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

// Competitor Entities — org-level canonical competitor identity (ADR 003 §2).
// One row per external referent per organisation; researched and monitored
// ONCE per org. Two-level tree: a root node (parentEntityId null) is the
// company; child nodes are its sub-branded products (§2.9). Facts live on the
// node where they are observed. The two-level invariant (a parent must itself
// be a root) is enforced in service code, not SQL — matching this schema's
// FK-less house style.
export const competitorEntities = pgTable("competitor_entities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  // Identity
  name: text("name").notNull(), // fully qualified for sub-brands ("Xero Payroll", never bare "Payroll")
  normalizedName: text("normalized_name").notNull(), // dedup key — unique per org across BOTH tree levels
  parentEntityId: varchar("parent_entity_id"), // nullable self-reference: company → their products (§2.9)
  url: text("url"),
  urlSource: text("url_source").default("ai-discovered"), // manual, ai-discovered, review-site
  domain: text("domain"), // second lookup key, extracted from url at write time (§2.2)
  parentCompany: text("parent_company"), // corporate ownership OUTSIDE the tracked tree (plain label, e.g. "Sage")
  description: text("description"),
  descriptionSourceUrl: text("description_source_url"),
  summaryCitations: jsonb("summary_citations"), // Array of source URLs; [n] markers refer to index n-1
  // Their product facts
  keyFeatures: jsonb("key_features"), // Array of {feature, description?, sourceUrl}
  markets: jsonb("markets"), // Array of {market, sourceUrl}
  customerSegments: jsonb("customer_segments"), // the competitor's own target segments
  integrations: jsonb("integrations"), // Array of {name, category, description, sourceUrl, integrationType, dataScope}
  // Pricing
  pricing: text("pricing"),
  pricingSourceUrl: text("pricing_source_url"),
  pricingTiers: jsonb("pricing_tiers"), // Array of {name, price, billingPeriod, features}
  pricingFreeTrial: boolean("pricing_free_trial"),
  pricingNotes: text("pricing_notes"),
  // Reviews (absolute)
  reviews: jsonb("reviews"), // Array of {text, source, sourceUrl, sentiment, date}
  reviewPlatforms: jsonb("review_platforms"), // Array of {name, url, rating, reviewCount}
  reviewPositiveThemes: jsonb("review_positive_themes"),
  reviewNegativeThemes: jsonb("review_negative_themes"),
  reviewAverageRating: real("review_average_rating"), // 0-5
  reviewTotalCount: integer("review_total_count"),
  // Monitoring state (company-level watches live on the node that carries the URL)
  helpCenterUrl: text("help_center_url"),
  helpCenterUrlSourceUrl: text("help_center_url_source_url"),
  changelogUrl: text("changelog_url"),
  changelogUrlSourceUrl: text("changelog_url_source_url"),
  changelogContentHash: text("changelog_content_hash"),
  changelogLastCheckedAt: timestamp("changelog_last_checked_at"),
  githubRepoUrl: text("github_repo_url"),
  githubStats: jsonb("github_stats"), // { stars, forks, openIssues, fetchedAt, previousStars? }
  validReleaseSources: jsonb("valid_release_sources"), // { urls: string[], checkedAt: string } | null
  announcements: jsonb("announcements"), // Array of { date, title, description, type, sourceUrl? }
  announcementsAnalysis: text("announcements_analysis"),
  investorRelations: jsonb("investor_relations"),
  // Entity enrichment meta (entity agents, §2.7)
  enrichmentStatus: text("enrichment_status").default("pending"), // pending, enriching, completed, failed
  lastEnrichedAt: timestamp("last_enriched_at"),
  // User fact-corrections — a correction of a fact about the competitor is
  // seen by every product (single-writer governance).
  userNews: jsonb("user_news"),
  userPricing: jsonb("user_pricing"),
  userFeatures: jsonb("user_features"),
  userIntegrations: jsonb("user_integrations"),
  userReviews: jsonb("user_reviews"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_competitor_entities_org_normalized").on(table.organizationId, table.normalizedName),
  index("idx_competitor_entities_org_domain").on(table.organizationId, table.domain),
  index("idx_competitor_entities_parent").on(table.parentEntityId),
]);

export const insertCompetitorEntitySchema = createInsertSchema(competitorEntities).omit({ id: true, createdAt: true, updatedAt: true });
export type CompetitorEntity = typeof competitorEntities.$inferSelect;
export type InsertCompetitorEntity = z.infer<typeof insertCompetitorEntitySchema>;

// Competitor Changes — observed once, about the ENTITY node (ADR 003 §2.4).
// Re-keyed from (productId, competitorName) to entityId: a product's feed is
// a join over its tracked facets, and the §9 feed-exclusion rule is the join
// predicate rather than a name filter.
export const competitorChanges = pgTable("competitor_changes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityId: varchar("entity_id").notNull(), // company or product node — wherever the change was observed
  sourceCategory: text("source_category").default("competitor"), // classification of the scan that observed it (feed filtering joins the facet instead)
  changeType: text("change_type").notNull().default("update"), // feature, pricing, update, announcement
  changeTitle: text("change_title").notNull(),
  changeDescription: text("change_description"),
  sourceUrl: text("source_url"),
  sourceType: text("source_type").default("ai_analysis"), // ai_analysis, changelog, press_release, review_site
  stream: text("stream"), // 'market' | 'product' — which signal stream this belongs to
  severity: text("severity"), // 'major' | 'minor' — for product stream only
  // false when the source URL could not be confirmed to exist. The item is still kept
  // and shown, but flagged in the UI. Null on rows created before this column existed.
  urlVerified: boolean("url_verified"),
  failureReason: text("failure_reason"), // structured failure code if agent run failed for this item
  detectedAt: timestamp("detected_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_competitor_changes_entity").on(table.entityId, table.detectedAt),
]);

// Competitor Profiles — the per-product FACET (ADR 003 §2.2): "the profile of
// this competitor AS SEEN BY THIS PRODUCT". Entity facts (identity, features,
// pricing, reviews, monitoring state) live on competitor_entities; everything
// here is relative to OUR product. The facet id remains the stable competitor
// id on the API/MCP surface (§2.5). entityId may reference either a company
// node or one of its product nodes (§2.9).
export const competitorProfiles = pgTable("competitor_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  entityId: varchar("entity_id").notNull(), // -> competitor_entities.id (company or product node)
  sourceCategory: text("source_category").default("competitor"), // competitor | adjacent | own_product — classification IS per product
  // Lifecycle status (spec 2.4 review-before-save gate): "proposed" rows are
  // drafts awaiting human accept — excluded from the default list, the changes
  // feed, and scheduled agent runs. POST creates "proposed" explicitly; the
  // default stays "tracked" so baseline seeds/imports are sane. The gate
  // applies AT THE FACET (ADR 003 §2.3) — never org-wide.
  status: text("status").notNull().default("tracked"), // proposed | tracked
  threatLevel: text("threat_level").default("none"), // none, watch, competitive, big_threat
  keyDifferentiators: jsonb("key_differentiators"), // Array of strings — theirs vs US
  featureStrengthSummary: text("feature_strength_summary"), // competitor's customer-validated feature strengths vs our product
  pricingAnalysis: text("pricing_analysis"), // strategic comparison of competitor pricing vs own product
  integrationAnalysis: jsonb("integration_analysis"), // {ecosystemStrategy, dataAccessSummary, notableGaps, vsOwnProduct}
  // JTBD & Persona Coverage mapping — against OUR personas
  featurePersonaMapping: jsonb("feature_persona_mapping"), // { groups: [{jtbd, personas, features}], gaps: [{jtbd, personas}], generatedAt }
  // User-editable overlay of the facet's rendered positioning/differentiators
  // view (fact-shaped user* corrections moved to the entity).
  userSummary: jsonb("user_summary"), // {positioning, differentiators, markets, customerSegments}
  // Facet enrichment meta (facet agents: differentiators, comparisons)
  enrichmentStatus: text("enrichment_status").default("pending"), // pending, enriching, completed, failed
  lastEnrichedAt: timestamp("last_enriched_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Facet-grain duplicate rule (ADR 003 §2.9.2): one facet per (product, node).
  uniqueIndex("idx_competitor_profiles_product_entity").on(table.productId, table.entityId),
  index("idx_competitor_profiles_entity").on(table.entityId),
]);

export const insertCompetitorProfileSchema = createInsertSchema(competitorProfiles).omit({ id: true, createdAt: true, updatedAt: true });

// Product Features - first-class inventory of the org's OWN product capabilities.
// Populated deterministically (help-centre crawler, GitHub releases) rather than
// sampled via web search. The scheduler prefers this over profile keyFeatures jsonb.
export const PRODUCT_FEATURE_SOURCES = ["help_center", "github", "roadmap", "manual", "web_search"] as const;
export const productFeatureSourceSchema = z.enum(PRODUCT_FEATURE_SOURCES);
export type ProductFeatureSource = z.infer<typeof productFeatureSourceSchema>;

export const productFeatures = pgTable("product_features", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(), // FK -> products.id
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(), // lowercased/collapsed name used for upsert-by-name dedupe
  description: text("description"),
  category: text("category"),
  source: text("source").notNull(), // 'help_center' | 'github' | 'roadmap' | 'manual' | 'web_search'
  evidenceUrl: text("evidence_url"), // Article / release / doc URL that evidences this feature
  contentHash: text("content_hash"), // sha256 of the evidence content that produced this feature
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  shippedAt: timestamp("shipped_at"), // Known ship date (e.g. GitHub release date); null when unknown
  status: text("status").notNull().default("active"), // 'active' | 'removed'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_product_features_product_id").on(table.productId),
  uniqueIndex("idx_product_features_product_normalized").on(table.productId, table.normalizedName),
]);

export const insertProductFeatureSchema = createInsertSchema(productFeatures)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({ source: productFeatureSourceSchema });
export type InsertProductFeature = z.infer<typeof insertProductFeatureSchema>;
export type ProductFeature = typeof productFeatures.$inferSelect;

// Product Help Articles - crawl state for the deterministic help-centre crawler.
// One row per discovered article; contentHash lets re-runs skip unchanged articles,
// and rows disappearing from a full crawl let us mark features 'removed'.
export const productHelpArticles = pgTable("product_help_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(), // FK -> products.id
  url: text("url").notNull(),
  title: text("title"),
  contentHash: text("content_hash"), // sha256 of last-fetched article content
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_product_help_articles_product_id").on(table.productId),
  uniqueIndex("idx_product_help_articles_product_url").on(table.productId, table.url),
]);

export const insertProductHelpArticleSchema = createInsertSchema(productHelpArticles).omit({ id: true, createdAt: true });
export type InsertProductHelpArticle = z.infer<typeof insertProductHelpArticleSchema>;
export type ProductHelpArticle = typeof productHelpArticles.$inferSelect;

// Shared Zod schema for the featurePersonaMapping JSONB column — used for LLM output validation and type safety
export const featureMappingEntrySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  coverage: z.enum(["Strong", "Partial", "Indirect"]),
});
export const featureMappingGroupSchema = z.object({
  jtbd: z.string(),
  personas: z.array(z.string()),
  features: z.array(featureMappingEntrySchema),
});
export const featureMappingGapSchema = z.object({
  jtbd: z.string(),
  personas: z.array(z.string()),
  reason: z.string().optional(),
});
export const segmentRatingSchema = z.object({
  segmentName: z.string(),
  rating: z.enum(['Strong', 'Moderate', 'Weak']),
  rationale: z.string(),
  segmentType: z.enum(['customer_segment', 'industry_vertical', 'primary_persona', 'partnership']).optional(),
});
export const featurePersonaMappingSchema = z.object({
  groups: z.array(featureMappingGroupSchema),
  gaps: z.array(featureMappingGapSchema),
  segmentRatings: z.array(segmentRatingSchema).optional(),
  generatedAt: z.string(),
});
export type FeatureMappingEntry = z.infer<typeof featureMappingEntrySchema>;
export type FeatureMappingGroup = z.infer<typeof featureMappingGroupSchema>;
export type FeatureMappingGap = z.infer<typeof featureMappingGapSchema>;
export type SegmentRating = z.infer<typeof segmentRatingSchema>;
export type FeaturePersonaMapping = z.infer<typeof featurePersonaMappingSchema>;

// Competitor Threat Level History - Records each time a competitor's threat level changes
export const competitorThreatLevelHistory = pgTable("competitor_threat_level_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  competitorProfileId: varchar("competitor_profile_id").notNull(),
  competitorName: text("competitor_name").notNull(),
  previousLevel: text("previous_level").notNull(), // none, watch, competitive, big_threat
  newLevel: text("new_level").notNull(), // none, watch, competitive, big_threat
  changedAt: timestamp("changed_at").defaultNow().notNull(),
}, (table) => [
  index("idx_threat_level_history_profile").on(table.competitorProfileId),
  index("idx_threat_level_history_product").on(table.productId, table.changedAt),
]);

export const insertCompetitorThreatLevelHistorySchema = createInsertSchema(competitorThreatLevelHistory).omit({ id: true, changedAt: true });
export type InsertCompetitorThreatLevelHistory = z.infer<typeof insertCompetitorThreatLevelHistorySchema>;
export type CompetitorThreatLevelHistory = typeof competitorThreatLevelHistory.$inferSelect;

export const competitiveAnalyses = pgTable("competitive_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  competitorName: text("competitor_name").notNull(),
  threatAssessment: jsonb("threat_assessment"), // {level, theyDoBetter[], theyGetRight[], urgency}
  opportunities: jsonb("opportunities"), // {weDoBetter[], theyAreCriticizedFor[], ourStrengths[]}
  strategicGaps: jsonb("strategic_gaps"), // [{gap, theyHave, impact}]
  recommendations: jsonb("recommendations"), // [{action, category, rationale, priority}]
  summary: text("summary"),
  generatedAt: timestamp("generated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCompetitiveAnalysisSchema = createInsertSchema(competitiveAnalyses).omit({ id: true, createdAt: true, updatedAt: true });

export const competitiveLandscapes = pgTable("competitive_landscapes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().unique(),
  positioning: jsonb("positioning"), // {ourPosition, directCompetitors[], adjacentPlayers[]}
  marketTrends: jsonb("market_trends"), // string[]
  strategicImperatives: jsonb("strategic_imperatives"), // string[]
  riskAreas: jsonb("risk_areas"), // [{risk, severity, mitigations[]}]
  keyChanges: jsonb("key_changes"), // [{competitorName, change, impact, recommendation}]
  summary: text("summary"),
  segmentCoverageMatrix: jsonb("segment_coverage_matrix"), // {columns: string[], rows: [{segmentName, ratings: {[name]: {rating, rationale}}}]}
  segmentCoverageUpdatedAt: timestamp("segment_coverage_updated_at"),
  generatedAt: timestamp("generated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCompetitiveLandscapeSchema = createInsertSchema(competitiveLandscapes).omit({ id: true, createdAt: true, updatedAt: true });

// Feedback Entries - Raw feedback comments from review sites
export const feedbackEntries = pgTable("feedback_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(), // The product this feedback is about
  teamId: varchar("team_id"), // Optional team assignment based on focus area
  isCompetitor: boolean("is_competitor").notNull().default(false), // Whether this is about a competitor
  competitorName: text("competitor_name"), // Name of competitor if isCompetitor=true
  sourceName: text("source_name").notNull(), // e.g., "G2", "Capterra", "TrustRadius"
  sourceUrl: text("source_url"), // Link to the original review
  sourceType: text("source_type").notNull().default("review"), // review, comparison, forum
  verified: boolean("verified").notNull().default(false), // Whether the sourceUrl has been verified to work
  collectedAt: timestamp("collected_at").notNull().defaultNow(), // When the feedback was collected
  topic: text("topic"), // Feature/topic this relates to
  quotedText: text("quoted_text").notNull(), // The actual feedback comment
  sentiment: integer("sentiment"), // 0-100 sentiment score
  reviewerName: text("reviewer_name"), // Optional reviewer attribution
  reviewDate: timestamp("review_date"), // Date of original review
  linkedOpportunityId: varchar("linked_opportunity_id"), // ID of linked opportunity (if entry was used to create one)
  archivedAt: timestamp("archived_at"), // When this entry was archived (null = active)
  imageUrl: text("image_url"), // Optional screenshot URL stored in object storage
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_feedback_entries_product_id").on(table.productId),
  index("idx_feedback_entries_team_id").on(table.teamId),
  index("idx_feedback_entries_product_is_competitor").on(table.productId, table.isCompetitor),
  index("idx_feedback_entries_is_competitor").on(table.isCompetitor),
  index("idx_feedback_entries_product_collected_at").on(table.productId, table.collectedAt),
  index("idx_feedback_entries_topic").on(table.topic),
]);

// Feedback Themes - Aggregated themes from raw feedback
export const feedbackThemes = pgTable("feedback_themes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  teamId: varchar("team_id"),
  isCompetitor: boolean("is_competitor").notNull().default(false),
  competitorName: text("competitor_name"),
  themeName: text("theme_name").notNull(),
  summary: text("summary"),
  status: text("status").notNull().default("needs_review"),
  priority: text("priority"), // 'low' | 'medium' | 'high' — set by Theme Aggregation Agent based on uplift
  mentionCount: integer("mention_count").notNull().default(0),
  averageSentiment: integer("average_sentiment"),
  feedbackEntryIds: jsonb("feedback_entry_ids"),
  linkedOpportunityId: varchar("linked_opportunity_id"), // ID of linked opportunity (if theme was used to create one)
  lastUpdatedAt: timestamp("last_updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertFeedbackEntrySchema = createInsertSchema(feedbackEntries).omit({ id: true, createdAt: true });
export const insertFeedbackThemeSchema = createInsertSchema(feedbackThemes).omit({ id: true, createdAt: true });

// Team Assignment Signals - Track user corrections to AI team allocation for learning
export const teamAssignmentSignals = pgTable("team_assignment_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  signalType: text("signal_type").notNull(), // 'theme_move' | 'feedback_assign' | 'opportunity_move'
  entityType: text("entity_type").notNull(), // 'theme' | 'feedback' | 'opportunity'
  entityId: varchar("entity_id").notNull(), // ID of the moved/assigned entity
  sourceTeamId: varchar("source_team_id"), // Original team (null if unassigned)
  targetTeamId: varchar("target_team_id").notNull(), // New team assignment
  themeName: text("theme_name"), // Theme name for theme/feedback signals (for pattern matching)
  keywords: jsonb("keywords"), // Extracted keywords from feedback/theme for matching
  userId: varchar("user_id").notNull(), // Who made the correction
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTeamAssignmentSignalSchema = createInsertSchema(teamAssignmentSignals).omit({ id: true, createdAt: true });

// Feedback Sources - Trusted review and comparison sites for feedback collection
export const feedbackSources = pgTable("feedback_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  productId: varchar("product_id"), // Product this source belongs to (null = org-level legacy)
  name: text("name").notNull(), // e.g., "G2", "Capterra", "TrustRadius"
  url: text("url").notNull(), // Base URL of the platform
  type: text("type").notNull().default("review"), // review, comparison
  isManual: boolean("is_manual").notNull().default(false), // true if added by user, false if discovered by AI
  productCount: integer("product_count"), // Number of products found on this platform
  lastScannedAt: timestamp("last_scanned_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertFeedbackSourceSchema = createInsertSchema(feedbackSources).omit({ id: true, createdAt: true });

// News Sources - Trusted news publications and sites
export const newsSources = pgTable("news_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  productId: varchar("product_id"), // Product this source belongs to (null = org-level legacy)
  name: text("name").notNull(), // e.g., "TechCrunch", "The Verge"
  url: text("url").notNull(), // Base URL of the publication
  type: text("type").notNull().default("news"), // news, blog, publication
  isManual: boolean("is_manual").notNull().default(false), // true if added by user, false if discovered by AI
  lastMentionDate: timestamp("last_mention_date"), // When product/competitor was last mentioned
  lastScannedAt: timestamp("last_scanned_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNewsSourceSchema = createInsertSchema(newsSources).omit({ id: true, createdAt: true });

// MCP Connections - stores user-configured MCP server endpoints
export const mcpConnections = pgTable("mcp_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  productId: varchar("product_id"), // Optional — scope to a specific product
  name: varchar("name").notNull(), // Display name e.g. "HubSpot CRM"
  serverUrl: varchar("server_url"), // e.g. https://mcp.hubspot.com/mcp — null when awaiting credentials or pull-mode
  transport: varchar("transport").notNull().default("http"), // 'http' | 'sse'
  authToken: varchar("auth_token"), // Bearer token or API key
  availableTools: jsonb("available_tools"), // Array of { name, description, inputSchema }
  status: varchar("status").notNull().default("pending_credentials"), // 'pending_credentials' | 'connected' | 'error'
  sectionType: varchar("section_type"), // 'csat' | 'nps' | 'customer_research' | 'analytics' — null = general connection
  briefTypes: text("brief_types").array(), // Array of brief types this connection receives: 'design' | 'stakeholder' | 'engineer' | 'ai_agent'
  connectionMode: varchar("connection_mode").notNull().default("push"), // 'push' | 'pull' — push = Discoveree calls external MCP server; pull = external MCP client calls Discoveree
  feedbackExtractionInstruction: text("feedback_extraction_instruction"), // Scoped query instruction applied when calling this connection's tools for feedback collection
  syncMetadata: jsonb("sync_metadata"), // Arbitrary sync state — e.g. Monday.com column maps keyed by board ID
  syncType: varchar("sync_type"), // 'ongoing' | 'one_off' | null — null = not set
  dataDirection: varchar("data_direction"), // 'one_way' | 'two_way' | null — null = not set
  source: varchar("source").default("user"), // 'user' | 'ai' — who created the connection
  lastError: text("last_error"),
  lastTestedAt: timestamp("last_tested_at"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMcpConnectionSchema = createInsertSchema(mcpConnections).omit({ id: true, createdAt: true });
export type McpConnection = typeof mcpConnections.$inferSelect;
export type InsertMcpConnection = z.infer<typeof insertMcpConnectionSchema>;

// MCP API Keys — org-scoped keys used to authenticate external MCP clients connecting TO Discoveree
export const mcpApiKeys = pgTable("mcp_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  name: varchar("name").notNull(),           // user-given label e.g. "Claude Desktop"
  keyHash: varchar("key_hash").notNull(),     // SHA-256 of full key, stored hex
  keyPrefix: varchar("key_prefix").notNull(), // first 8 chars for display e.g. "dsc_a1b2"
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: varchar("created_by_user_id"), // User who created the key (for attribution in save_conversation_insight)
  syncType: varchar("sync_type"), // 'ongoing' | 'one_off' | null — null = not set
  dataDirection: varchar("data_direction"), // 'one_way' | 'two_way' | null — null = not set
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMcpApiKeySchema = createInsertSchema(mcpApiKeys).omit({ id: true, createdAt: true });
export type McpApiKey = typeof mcpApiKeys.$inferSelect;
export type InsertMcpApiKey = z.infer<typeof insertMcpApiKeySchema>;

// Shared Conversations — conversations saved from external AI tools (e.g. Claude) into Discoveree
export const sharedConversations = pgTable("shared_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  title: text("title").notNull(),
  messages: jsonb("messages").$type<Array<{ role: string; content: string }>>().notNull().default([]),
  visibility: text("visibility").notNull().default("shared"), // "private" | "shared"
  createdByUserId: varchar("created_by_user_id"), // null when created via MCP without user attribution
  source: text("source").notNull().default("mcp"), // "mcp" | "web"
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_shared_conversations_org").on(table.organizationId),
]);

export const insertSharedConversationSchema = createInsertSchema(sharedConversations).omit({ id: true, createdAt: true });
export type SharedConversation = typeof sharedConversations.$inferSelect;
export type InsertSharedConversation = z.infer<typeof insertSharedConversationSchema>;

// G2 Product Catalog - Persistent registry of products known to exist (or not) on G2
// Internal only - not shown to users. Used by feedback sources agent to avoid redundant API calls.
export const g2ProductCatalog = pgTable("g2_product_catalog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  g2ProductId: text("g2_product_id"), // The G2 API product ID (null if not found)
  canonicalName: text("canonical_name").notNull(), // The official G2 product name
  slug: text("slug"), // The G2 slug
  domain: text("domain"),
  nameVariations: text("name_variations").array().notNull().default(sql`'{}'::text[]`), // All name strings that successfully resolve to this product
  reviewCount: integer("review_count").default(0),
  starRating: real("star_rating").default(0),
  productUrl: text("product_url"),
  status: text("status").notNull().default("found"), // "found" or "not_found"
  lastVerifiedAt: timestamp("last_verified_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertG2ProductCatalogSchema = createInsertSchema(g2ProductCatalog).omit({ id: true, createdAt: true });
export type G2ProductCatalogEntry = typeof g2ProductCatalog.$inferSelect;
export type InsertG2ProductCatalogEntry = z.infer<typeof insertG2ProductCatalogSchema>;

// LLM Usage Tracking - tracks API usage per organization (cost visibility for BYO keys)
export const llmUsage = pgTable("llm_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  provider: text("provider").notNull(), // 'gemini' or 'openai'
  model: text("model").notNull(), // e.g., 'gemini-3.5-flash', 'gpt-4o-mini'
  agentType: text("agent_type").notNull(), // e.g., 'opportunities', 'solution_ideas', 'onboarding_countries', etc.
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  costCents: integer("cost_cents").notNull().default(0), // Cost in cents (derived from token pricing)
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"), // Only populated on failure
  metadata: jsonb("metadata"), // Additional context (productId, teamId, etc.)
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLlmUsageSchema = createInsertSchema(llmUsage).omit({ id: true, createdAt: true });

// Insert schemas for AI agent tables
export const insertAiAgentSchema = createInsertSchema(aiAgents).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAiAgentPromptSchema = createInsertSchema(aiAgentPrompts).omit({ id: true, createdAt: true });
export const insertAiAgentExecutionSchema = createInsertSchema(aiAgentExecutions).omit({ id: true, startedAt: true });
export const insertCompetitorChangeSchema = createInsertSchema(competitorChanges).omit({ id: true, createdAt: true, detectedAt: true });

// Types
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertOrganizationUser = z.infer<typeof insertOrganizationUserSchema>;
export type OrganizationUser = typeof organizationUsers.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teams.$inferSelect;
export interface WorkflowSectionsEnabled {
  quickWins: boolean;
  solutionDesign: boolean;
  aiAutomation: boolean;
  adoption: boolean;
  roadmap: boolean;
  documentTemplates: boolean;
}

export interface WorkflowStepConnection {
  stepName: string;
  connectionType: string;
}

export interface DesignWorkflowStep {
  label: string;
  type: string;
  briefAudience?: string | null;
}

export interface BuildWorkflowStep {
  label: string;
  briefType: string;
}

export interface TeamWorkflowConfig {
  workNature?: "customer-facing" | "backend-infrastructure" | "incremental" | "mix" | null;
  teamComposition?: "engineers-only" | "engineers-and-designer" | "full-team" | null;
  adoptionIntensity?: "none" | "light" | "standard" | "thorough";
  roadmapView?: string[];
  sectionsEnabled?: WorkflowSectionsEnabled;
  designWorkflowSteps?: DesignWorkflowStep[];
  designMcpConnections?: WorkflowStepConnection[];
  buildWorkflowSteps?: BuildWorkflowStep[];
  buildMcpConnections?: WorkflowStepConnection[];
  workflowStepDestinations?: Record<string, string>;
  quickWinDestinationConfirmed?: boolean;
  [key: string]: unknown;
}
export type InsertOpportunity = z.infer<typeof insertOpportunitySchema>;
export type Opportunity = typeof opportunities.$inferSelect;

// AI Agent Types
export type InsertAiAgent = z.infer<typeof insertAiAgentSchema>;
export type AiAgent = typeof aiAgents.$inferSelect;
export type InsertAiAgentPrompt = z.infer<typeof insertAiAgentPromptSchema>;
export type AiAgentPrompt = typeof aiAgentPrompts.$inferSelect;
export type InsertAiAgentExecution = z.infer<typeof insertAiAgentExecutionSchema>;
export type AiAgentExecution = typeof aiAgentExecutions.$inferSelect;
export type InsertCompetitorChange = z.infer<typeof insertCompetitorChangeSchema>;
export type CompetitorChange = typeof competitorChanges.$inferSelect;
export type InsertCompetitorProfile = z.infer<typeof insertCompetitorProfileSchema>;
export type CompetitorProfile = typeof competitorProfiles.$inferSelect;
export type InsertCompetitiveAnalysis = z.infer<typeof insertCompetitiveAnalysisSchema>;
export type CompetitiveAnalysis = typeof competitiveAnalyses.$inferSelect;
export type InsertCompetitiveLandscape = z.infer<typeof insertCompetitiveLandscapeSchema>;
export type CompetitiveLandscape = typeof competitiveLandscapes.$inferSelect;

// Feedback Types
export type InsertFeedbackEntry = z.infer<typeof insertFeedbackEntrySchema>;
export type FeedbackEntry = typeof feedbackEntries.$inferSelect;
export type InsertFeedbackTheme = z.infer<typeof insertFeedbackThemeSchema>;
export type FeedbackTheme = typeof feedbackThemes.$inferSelect;

// Problem Statement Types
export type InsertProblemStatement = z.infer<typeof insertProblemStatementSchema>;
export type ProblemStatement = typeof problemStatements.$inferSelect;
export type InsertProblemStatementAttachment = z.infer<typeof insertProblemStatementAttachmentSchema>;
export type ProblemStatementAttachment = typeof problemStatementAttachments.$inferSelect;

// LLM Usage Types
export type InsertLlmUsage = z.infer<typeof insertLlmUsageSchema>;
export type LlmUsage = typeof llmUsage.$inferSelect;

// Team Assignment Signal Types
export type InsertTeamAssignmentSignal = z.infer<typeof insertTeamAssignmentSignalSchema>;
export type TeamAssignmentSignal = typeof teamAssignmentSignals.$inferSelect;

// Feedback Source Types
export type InsertFeedbackSource = z.infer<typeof insertFeedbackSourceSchema>;
export type FeedbackSource = typeof feedbackSources.$inferSelect;

// News Source Types
export type InsertNewsSource = z.infer<typeof insertNewsSourceSchema>;
export type NewsSource = typeof newsSources.$inferSelect;

// Agent Schedule Types
export const agentScheduleSchema = z.object({
  enabled: z.boolean().default(true),
  frequencyValue: z.number().min(1).max(168), // 1-168 hours (7 days)
  frequencyUnit: z.enum(['hours', 'days']),
  timeOfDay: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/), // HH:MM format
});

export const agentSchedulesSchema = z.object({
  feedbackCollection: agentScheduleSchema.optional(),
  themeAggregation: agentScheduleSchema.optional(),
  opportunities: agentScheduleSchema.optional(),
  quickWin: agentScheduleSchema.optional(), // Quick Win agent — scans feedback for small same-day improvements
  competitorUpdates: agentScheduleSchema.optional(), // Competitor news/updates monitoring
  competitorFeatures: agentScheduleSchema.optional(), // Competitor feature analysis
  competitorPricing: agentScheduleSchema.optional(), // Competitor pricing analysis
  competitorReviews: agentScheduleSchema.optional(), // Competitor review analysis
  competitorIntegrations: agentScheduleSchema.optional(), // Competitor integrations analysis
  reviewPlatforms: agentScheduleSchema.optional(), // Review platform discovery agent
  newsPublications: agentScheduleSchema.optional(), // News publications discovery agent
  competitorDiscovery: agentScheduleSchema.optional(), // Competitor discovery agent
  competitorSummary: agentScheduleSchema.optional(), // Competitor summary agent
  customerSegments: agentScheduleSchema.optional(), // Customer segments agent
  featureAnalytics: agentScheduleSchema.optional(), // Feature analytics agent
  marketReview: agentScheduleSchema.optional(), // Market review agent (monthly/quarterly)
  roadmapHealthSummary: agentScheduleSchema.optional(), // Roadmap health summary agent (daily)
  timezone: z.string().default('America/New_York'), // IANA timezone identifier
});

export type AgentSchedule = z.infer<typeof agentScheduleSchema>;
export type AgentSchedules = z.infer<typeof agentSchedulesSchema>;

// LLM API Keys update schema (for API input - accepts plain text keys)
export const llmApiKeysUpdateSchema = z.object({
  openaiApiKey: z.string().optional().nullable(),
  geminiApiKey: z.string().optional().nullable(),
  perplexityApiKey: z.string().optional().nullable(),
  claudeApiKey: z.string().optional().nullable(),
});

export type LlmApiKeysUpdate = z.infer<typeof llmApiKeysUpdateSchema>;

// Segment Entities — org-level canonical segment vocabulary (ADR 003 §2.6).
// One segment vocabulary, not two: commercial revenue-by-segment will
// reference segment_entities.id, never a name string. Deliberately FLAT — no
// parentEntityId (segment hierarchies had no evidence in the SaaS).
// normalizedName is produced by the ported segmentNormalization helper when
// the Customer Insights module lands (sprint 3b); nothing writes these rows
// in sprint 3a.
export const segmentEntities = pgTable("segment_entities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  segmentType: text("segment_type").default("customer_segment"), // customer_segment | industry_vertical | primary_persona | partnership
  description: text("description"),
  sourceUrl: text("source_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_segment_entities_org_normalized").on(table.organizationId, table.normalizedName),
]);

export const insertSegmentEntitySchema = createInsertSchema(segmentEntities).omit({ id: true, createdAt: true, updatedAt: true });
export type SegmentEntity = typeof segmentEntities.$inferSelect;
export type InsertSegmentEntity = z.infer<typeof insertSegmentEntitySchema>;

// Customer Segment Profiles — the per-product FACET (ADR 003 §2.6): keeps
// everything that only means something against a product. Identity columns
// (segmentName/segmentDescription/segmentType/sourceUrl) moved to
// segment_entities; the legacy single-persona columns are NOT ported (the
// multi-persona `personas` table is the real model).
export const customerSegmentProfiles = pgTable("customer_segment_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  organizationId: varchar("organization_id").notNull(),
  segmentEntityId: varchar("segment_entity_id").notNull(), // -> segment_entities.id

  // Needs Assessment
  needsSummary: text("needs_summary"),
  needs: jsonb("needs"), // Array of {need, importance: 1-5, satisfaction: 1-5, notes}
  overallSatisfaction: real("overall_satisfaction"), // 0-100

  // Jobs to be Done (JTBD framework) — per product by explicit owner requirement
  jobsToBeDone: jsonb("jobs_to_be_done"), // {coreJob, functionalJobs[], emotionalJobs[], socialJobs[], relatedJobs[], desiredOutcomes[], summary}

  // CSAT
  csatScore: real("csat_score"), // 0-100
  csatComments: jsonb("csat_comments"), // Array of {text, source, date, sentiment}
  csatDataSource: text("csat_data_source"), // "user" or "ai" - tracks whether score was user-provided

  // NPS
  npsScore: real("nps_score"), // -100 to 100
  npsComments: jsonb("nps_comments"), // Array of {text, source, date, sentiment}
  npsDataSource: text("nps_data_source"), // "user" or "ai" - tracks whether score was user-provided

  // Customer Analytics
  customerAnalyticsComments: jsonb("customer_analytics_comments"), // Array of {text, source, date, url, filePath, fileName}
  customerAnalyticsDataSource: text("customer_analytics_data_source"), // "user" or "ai"

  // Customer Research
  researchItems: jsonb("research_items"), // Array of {title, url, type, problemArea, notes, addedBy, addedAt}

  // Quotes & References
  quotes: jsonb("quotes"), // Array of {text, source, sourceUrl, attribution, date}

  // ICP & Opportunities
  icpFit: text("icp_fit"), // "strong", "moderate", "weak"
  isIcp: boolean("is_icp").default(false),
  opportunities: jsonb("opportunities"), // Array of {title, description, priority}

  // Product Recommendations
  recommendations: jsonb("recommendations"), // Array of {title, description, priority, type}

  // Segment Insights - AI-synthesized "so what" summary
  segmentInsights: text("segment_insights"), // Synthesized summary of why this segment matters, health signals, unmet needs, risks, and recommended focus

  // Satisfaction change tracking (for #10 segment_satisfaction_change event)
  previousNpsScore: real("previous_nps_score"), // NPS score before last enrichment cycle
  previousCsatScore: real("previous_csat_score"), // CSAT score before last enrichment cycle
  researchUpdatedAt: timestamp("research_updated_at"), // When researchItems array was last changed (for #11 customer_research event)

  // AI enrichment metadata
  lastEnrichedAt: timestamp("last_enriched_at"),
  enrichmentStatus: text("enrichment_status").default("pending"),
  enrichmentNotes: text("enrichment_notes"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // One facet per (product, segment entity) — mirrors the competitor facet grain.
  uniqueIndex("idx_customer_segment_profiles_product_entity").on(table.productId, table.segmentEntityId),
  index("idx_customer_segment_profiles_entity").on(table.segmentEntityId),
]);

export const insertCustomerSegmentProfileSchema = createInsertSchema(customerSegmentProfiles).omit({ id: true, createdAt: true, updatedAt: true });

export type CustomerSegmentProfile = typeof customerSegmentProfiles.$inferSelect;
export type InsertCustomerSegmentProfile = z.infer<typeof insertCustomerSegmentProfileSchema>;

// Personas — org-level persona IDENTITY (ADR 003 §2.6; replaces the SaaS
// customer_segment_personas). Attributes that describe the PERSON, not the
// relationship to a product.
export const personas = pgTable("personas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  segmentEntityId: varchar("segment_entity_id").notNull(), // -> segment_entities.id
  title: text("title").notNull(),
  description: text("description"),
  demographics: jsonb("demographics"), // {role, industry, companySize, experience}
  behaviours: jsonb("behaviours"), // Array of strings
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_personas_segment_entity").on(table.segmentEntityId),
]);

export const insertPersonaSchema = createInsertSchema(personas).omit({ id: true, createdAt: true, updatedAt: true });
export type Persona = typeof personas.$inferSelect;
export type InsertPersona = z.infer<typeof insertPersonaSchema>;

// Persona Facets — the per-product side of a persona (ADR 003 §2.6): "even
// when a persona is shared, its JTBD differ per product" made literal. A
// persona with no facet for a product is not part of that product's context.
export const personaFacets = pgTable("persona_facets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personaId: varchar("persona_id").notNull(), // -> personas.id
  productId: varchar("product_id").notNull(),
  goals: jsonb("goals"), // Array of strings
  painPoints: jsonb("pain_points"), // Array of strings
  jobsToBeDone: jsonb("jobs_to_be_done"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_persona_facets_persona_product").on(table.personaId, table.productId),
  index("idx_persona_facets_product").on(table.productId),
]);

export const insertPersonaFacetSchema = createInsertSchema(personaFacets).omit({ id: true, createdAt: true, updatedAt: true });
export type PersonaFacet = typeof personaFacets.$inferSelect;
export type InsertPersonaFacet = z.infer<typeof insertPersonaFacetSchema>;

// Deleted Customer Segment Names — blocklist preventing agents re-creating
// manually deleted segments ("merge, don't replace" governance).
// RECONCILED from raw DDL in the SaaS server/db.ts ensureSchemaColumns()
// (existed only there, never in shared/schema.ts — ADR risk 6).
export const deletedCustomerSegmentNames = pgTable("deleted_customer_segment_names", {
  id: serial("id").primaryKey(),
  productId: varchar("product_id").notNull(),
  normalizedName: text("normalized_name").notNull(),
  originalName: text("original_name").notNull(),
  deletedAt: timestamp("deleted_at").defaultNow(),
}, (table) => [
  index("idx_deleted_segments_product").on(table.productId),
  uniqueIndex("idx_deleted_segments_product_normalized").on(table.productId, table.normalizedName),
]);

export const insertDeletedCustomerSegmentNameSchema = createInsertSchema(deletedCustomerSegmentNames).omit({ id: true, deletedAt: true });
export type DeletedCustomerSegmentName = typeof deletedCustomerSegmentNames.$inferSelect;
export type InsertDeletedCustomerSegmentName = z.infer<typeof insertDeletedCustomerSegmentNameSchema>;

export const marketReviews = pgTable("market_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  reviewMonth: text("review_month").notNull(),
  content: jsonb("content"),
  sources: jsonb("sources"),
  runDate: timestamp("run_date").defaultNow(),
  previousReviewId: varchar("previous_review_id"),
  archivedRecommendations: jsonb("archived_recommendations"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Reconciled from raw DDL in the SaaS server/db.ts (ADR risk 6)
  index("idx_market_reviews_product").on(table.productId),
  uniqueIndex("idx_market_reviews_product_month").on(table.productId, table.reviewMonth),
]);

export const insertMarketReviewSchema = createInsertSchema(marketReviews).omit({ id: true, createdAt: true, updatedAt: true });
export type MarketReview = typeof marketReviews.$inferSelect;
export type InsertMarketReview = z.infer<typeof insertMarketReviewSchema>;

// Idea Assessments — saved ideas from "Test a product idea" conversations (private per user)
export const ideaAssessments = pgTable("idea_assessments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  productId: varchar("product_id").notNull(),
  title: text("title").notNull(),
  conversationHistory: jsonb("conversation_history").$type<Array<{ role: string; content: string }>>().default([]),
  readyFlag: boolean("ready_flag").notNull().default(false),
  outcomeType: text("outcome_type"), // "strong" | "promising" | "deferred" | "not_worth_pursuing"
  assessmentOutput: jsonb("assessment_output").$type<Record<string, unknown>>(), // structured finalized output
  opportunityId: varchar("opportunity_id"), // if created opportunity from conversation
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Reconciled from raw DDL in the SaaS server/db.ts (ADR risk 6)
  index("idx_idea_assessments_user_product").on(table.userId, table.productId),
]);

export const insertIdeaAssessmentSchema = createInsertSchema(ideaAssessments).omit({ id: true, createdAt: true, updatedAt: true });
export type IdeaAssessment = typeof ideaAssessments.$inferSelect;
export type InsertIdeaAssessment = z.infer<typeof insertIdeaAssessmentSchema>;

// Thought Partner Conversations — persisted conversations from the Thought Partner specialist mode
export const thoughtPartnerConversations = pgTable("thought_partner_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  organizationId: varchar("organization_id").notNull(),
  authorUserId: varchar("author_user_id").notNull(),
  authorName: text("author_name"),
  title: text("title"), // AI-generated short title
  topicTags: text("topic_tags").array(), // AI-generated 2-4 tags
  excerpt: text("excerpt"), // Short excerpt from first assistant message
  messages: jsonb("messages").$type<Array<{ role: string; content: string }>>().default([]),
  visibility: text("visibility").notNull().default("private"), // "private" | "shared"
  pinned: boolean("pinned").notNull().default(false),
  sourceType: text("source_type").notNull().default("thought-partner"), // allows future expansion
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Reconciled from raw DDL in the SaaS server/db.ts (ADR risk 6)
  index("idx_thought_partner_conversations_org").on(table.organizationId),
  index("idx_thought_partner_conversations_product").on(table.productId),
]);

export const insertThoughtPartnerConversationSchema = createInsertSchema(thoughtPartnerConversations).omit({ id: true, createdAt: true, updatedAt: true });
export type ThoughtPartnerConversation = typeof thoughtPartnerConversations.$inferSelect;
export type InsertThoughtPartnerConversation = z.infer<typeof insertThoughtPartnerConversationSchema>;

// Product Context Documents — supporting documents and links attached to a product's strategy
export const productContextDocuments = pgTable("product_context_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  sourceType: text("source_type").notNull(), // 'file' | 'url'
  fileName: text("file_name"), // original filename for file uploads
  pageTitle: text("page_title"), // page title for URL sources
  sourceUrl: text("source_url"), // URL for URL-sourced documents
  mcpConnectionId: varchar("mcp_connection_id"), // nullable FK to mcp_connections
  mimeType: text("mime_type"),
  documentLabel: text("document_label"), // AI-inferred descriptive title from content
  summary: text("summary"), // AI-generated one-paragraph summary
  extractedText: text("extracted_text"), // Extracted text content (for search and re-sync hashing)
  fileData: text("file_data"), // base64-encoded file bytes (nullable; only stored for small files)
  fileSize: integer("file_size"), // file size in bytes
  uploadedBy: varchar("uploaded_by"), // userId who added this document
  lastSyncedAt: timestamp("last_synced_at"), // when URL content was last fetched
  syncError: boolean("sync_error").default(false), // true when last sync failed
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProductContextDocumentSchema = createInsertSchema(productContextDocuments).omit({ id: true, createdAt: true });
export type ProductContextDocument = typeof productContextDocuments.$inferSelect;
export type InsertProductContextDocument = z.infer<typeof insertProductContextDocumentSchema>;

// LLM Model Pricing — synced daily from LiteLLM pricing JSON; hardcoded fallback on first startup
export const llmModelPricing = pgTable("llm_model_pricing", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull(), // "gemini" | "openai" | "perplexity" | "claude"
  modelName: text("model_name").notNull(),
  inputCentsPerMillion: real("input_cents_per_million").notNull(),
  outputCentsPerMillion: real("output_cents_per_million").notNull(),
  source: text("source").notNull().default("hardcoded"), // "hardcoded" | "litellm" | "openrouter"
  lastFetchedAt: timestamp("last_fetched_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [uniqueIndex("llm_model_pricing_provider_model_idx").on(table.provider, table.modelName)]);

export const insertLlmModelPricingSchema = createInsertSchema(llmModelPricing).omit({ id: true, updatedAt: true });
export type LlmModelPricing = typeof llmModelPricing.$inferSelect;
export type InsertLlmModelPricing = z.infer<typeof insertLlmModelPricingSchema>;

// Roadmap Summaries — AI-generated health summary per product, persisted between page visits
export const roadmapSummaries = pgTable("roadmap_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().unique(),
  summaryData: jsonb("summary_data").$type<{
    prioritisationHealth: string;
    progressMomentum: string;
    valueRealisation: string;
    attentionItems: string[];
  }>().notNull(),
  generatedAt: timestamp("generated_at").defaultNow(),
});

export const insertRoadmapSummarySchema = createInsertSchema(roadmapSummaries).omit({ id: true, generatedAt: true });
export type RoadmapSummary = typeof roadmapSummaries.$inferSelect;
export type InsertRoadmapSummary = z.infer<typeof insertRoadmapSummarySchema>;

// Roadmap Recommendations — unified source of truth for all recommendation state.
// RECONCILED from raw DDL in the SaaS server/db.ts ensureSchemaColumns() (the
// table existed only there; shared/schema.ts carried only a hand-written
// interface — ADR risk 6). Column set matches the raw DDL including the
// later ALTER TABLE additions (priority/impact/rationale/team/score/markets).
export const roadmapRecommendations = pgTable("roadmap_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  teamId: varchar("team_id"),
  title: text("title").notNull(),
  sourceType: text("source_type").notNull(), // 'market_review' | 'competitor' | 'customer_insight' | 'customer_feedback' | 'impact_monitoring' | 'wildcard'
  sourceContext: text("source_context"),
  status: text("status").notNull().default("active"), // 'active' | 'dismissed' | 'converted'
  dismissReason: text("dismiss_reason"),
  convertedOpportunityId: varchar("converted_opportunity_id"),
  priorityLevel: text("priority_level"), // 'high' | 'medium' | 'low' | null
  impactHypothesis: text("impact_hypothesis"),
  priorityRationale: text("priority_rationale"),
  suggestedTeamId: varchar("suggested_team_id"),
  markets: jsonb("markets").$type<string[]>(), // nullable array of market name strings
  computedScore: integer("computed_score"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_roadmap_recommendations_product").on(table.productId),
  index("idx_roadmap_recommendations_product_status").on(table.productId, table.status),
]);

export const insertRoadmapRecommendationSchema = createInsertSchema(roadmapRecommendations).omit({ id: true, createdAt: true, updatedAt: true });
export type RoadmapRecommendation = typeof roadmapRecommendations.$inferSelect;
export type InsertRoadmapRecommendation = z.infer<typeof insertRoadmapRecommendationSchema>;

// Skills — custom AI instruction files that inject additional context into prompts
export const SKILL_TARGETS = [
  'thought-partner',
  'briefing-documents',
  'workflow-steps',
  'strategy-assistant',
  'chief-of-staff',
  'market-review',
  'idea-testing',
  'analytics',
  'battlecard',
  'launch-planning',
  'period-reflection',
  'onboarding',
] as const;
export type SkillTarget = typeof SKILL_TARGETS[number];

export const skills = pgTable("skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id"), // null = platform skill (no org owner)
  productId: varchar("product_id"), // null = org-wide scope
  name: text("name").notNull(),
  description: text("description"),
  content: text("content").notNull().default(""),
  targets: text("targets").array().notNull().default(sql`ARRAY[]::text[]`),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSkillSchema = createInsertSchema(skills).omit({ id: true, createdAt: true, updatedAt: true });
export type Skill = typeof skills.$inferSelect;
export type InsertSkill = z.infer<typeof insertSkillSchema>;

// Customer Call Recordings — attached to a customer segment profile
export const CALL_CONTEXT_TYPES = ['sales_call', 'support', 'onboarding', 'discovery', 'qbr', 'other'] as const;
export type CallContextType = typeof CALL_CONTEXT_TYPES[number];

export const CALL_RECORDING_SOURCES = ['zoom', 'zoom_revenue_accelerator', 'fathom', 'granola', 'gong', 'fireflies', 'otter', 'chorus', 'manual'] as const;
export type CallRecordingSource = typeof CALL_RECORDING_SOURCES[number];

export const customerCallRecordings = pgTable("customer_call_recordings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // -> customer_segment_profiles.id (the FACET id — a call happens in the
  // context of a product conversation; ADR 003 §2.6)
  segmentId: varchar("segment_id").notNull(),
  customerName: text("customer_name").notNull(),
  contextType: text("context_type").notNull().default("other"),
  title: text("title"),
  recordingUrl: text("recording_url"),
  productFeedback: text("product_feedback").array().notNull().default(sql`ARRAY[]::text[]`),
  workflowNotes: text("workflow_notes").array().notNull().default(sql`ARRAY[]::text[]`),
  customerNeeds: text("customer_needs").array().notNull().default(sql`ARRAY[]::text[]`),
  fullTranscript: text("full_transcript"),
  source: text("source").notNull().default("manual"),
  recordedAt: timestamp("recorded_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // Reconciled from raw DDL in the SaaS server/db.ts (ADR risk 6)
  index("idx_call_recordings_segment").on(table.segmentId),
]);

export const insertCustomerCallRecordingSchema = createInsertSchema(customerCallRecordings)
  .omit({ id: true, createdAt: true })
  .extend({
    recordedAt: z.coerce.date(),
    contextType: z.enum(CALL_CONTEXT_TYPES).default('other'),
    source: z.enum(CALL_RECORDING_SOURCES).default('manual'),
  });
export type CustomerCallRecording = typeof customerCallRecordings.$inferSelect;
export type InsertCustomerCallRecording = z.infer<typeof insertCustomerCallRecordingSchema>;

// Platform skill suppressions — org-level suppression of platform skills
export const platformSkillSuppressions = pgTable(
  "platform_skill_suppressions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id").notNull(),
    skillId: varchar("skill_id").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [uniqueIndex("platform_skill_suppressions_org_skill_idx").on(table.orgId, table.skillId)],
);

export const insertPlatformSkillSuppressionSchema = createInsertSchema(platformSkillSuppressions).omit({ id: true, createdAt: true });
export type PlatformSkillSuppression = typeof platformSkillSuppressions.$inferSelect;
export type InsertPlatformSkillSuppression = z.infer<typeof insertPlatformSkillSuppressionSchema>;

// ── Opportunity Scoring Config ──────────────────────────────────────────────
// Per-product weights for computeOpportunityScore. Stored as JSON in products.scoringConfig.

export const scoringConfigSchema = z.object({
  // Base priority scores (0–100)
  basePriorityHigh: z.number().min(0).max(100),
  basePriorityMedium: z.number().min(0).max(100),
  basePriorityLow: z.number().min(0).max(100),
  // Competitor threat boosts (0–50)
  threatBoostBigThreat: z.number().min(0).max(50),
  threatBoostCompetitive: z.number().min(0).max(50),
  threatBoostWatch: z.number().min(0).max(50),
  // Strategy alignment boosts/penalties (0–50)
  strategyBigBetBoost: z.number().min(0).max(50),
  strategyAlignmentBoost: z.number().min(0).max(50),
  strategyParityBoost: z.number().min(0).max(50),
  strategyMaintainPenalty: z.number().min(0).max(50),
  // Caps (0–30)
  mentionFrequencyCap: z.number().min(0).max(30),
  sentimentStrengthCap: z.number().min(0).max(30),
  businessGoalCap: z.number().min(0).max(30),
  // Per-goal and north-star boosts (0–50)
  businessGoalBoostPerGoal: z.number().min(0).max(50),
  northStarBoost: z.number().min(0).max(50),
  // Deep Dive boost — applied when the opportunity has at least one specialist assistant section (0–50)
  deepDiveBoost: z.number().min(0).max(50),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export const SCORING_DEFAULTS: ScoringConfig = {
  basePriorityHigh: 85,
  basePriorityMedium: 65,
  basePriorityLow: 45,
  threatBoostBigThreat: 25,
  threatBoostCompetitive: 15,
  threatBoostWatch: 5,
  strategyBigBetBoost: 3,
  strategyAlignmentBoost: 2,
  strategyParityBoost: 1,
  strategyMaintainPenalty: 1,
  mentionFrequencyCap: 10,
  sentimentStrengthCap: 8,
  businessGoalCap: 6,
  businessGoalBoostPerGoal: 2,
  northStarBoost: 3,
  deepDiveBoost: 20,
};
