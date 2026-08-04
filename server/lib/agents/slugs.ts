/**
 * Agent slug registry — trimmed from the SaaS agentExecutionLogger.ts.
 * Only the slugs used by ported modules exist here; later sprints append
 * their entries as their modules port (ADR 002 §3 — lib/agents knows about
 * the ai_agents machinery, not module domains).
 */
export const AgentSlugs = {
  COMPETITOR_SUMMARY: "competitor-summary-agent",
  COMPETITOR_FEATURES: "competitor-features-agent",
  COMPETITOR_UPDATES: "competitor-updates-agent",
  // Used by lib/search/providers.ts (searchProviders port, whole per brief §3)
  PLATFORM_SEARCH: "platform-search-agent",
  NEWS_SEARCH: "news-search-agent",
  // Customer Insights & Feedback (ADR 004 §9)
  GATHER_FEEDBACK: "gather-feedback-agent",
  SENTIMENT_ANALYSIS: "sentiment-analysis-agent",
  THEME_AGGREGATION: "theme-aggregation-agent",
  CUSTOMER_QUOTES: "customer-quotes-agent",
  CUSTOMER_INSIGHTS: "customer-insights-agent",
  COMPETITOR_REVIEWS: "competitor-reviews-agent",
} as const;

export type AgentSlug = (typeof AgentSlugs)[keyof typeof AgentSlugs];
