-- 0000_baseline — Discoveree Desktop squashed baseline (regenerated).
--
-- REGENERATED IN PLACE (ADR 002 risk 8 ruling, zero installs existed — the
-- baseline's one free rewrite): the three battlecard columns on
-- competitor_profiles (battlecard_messages, battlecard_ready_flag,
-- battlecard_output) were DROPPED. Battlecards are a CUT module (build brief
-- §3: MCP replaces them); desktop code must never write these columns.
--
-- REGENERATED AGAIN (same zero-installs rewrite window, ADR 002 §9 addendum):
-- competitor_profiles gained a lifecycle "status" column
-- (text, NOT NULL, DEFAULT 'tracked'; values: proposed | tracked) for the
-- review-before-save gate (competitors-module-spec §2.4). POST creates
-- "proposed" explicitly; the tracked default keeps future imports/seeds sane.
CREATE TABLE "ai_agent_executions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"organization_id" varchar,
	"product_id" varchar,
	"prompt_id" varchar,
	"trigger_type" text DEFAULT 'automatic' NOT NULL,
	"trigger_context" text,
	"input_parameters" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"result_summary" text,
	"result_payload" jsonb,
	"actions_taken" jsonb,
	"error_message" text,
	"tokens_used" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"model_provider" text,
	"model_name" text,
	"used_web_search" boolean DEFAULT false,
	"duration_ms" integer,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ai_agent_prompts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"organization_id" varchar,
	"version" integer DEFAULT 1 NOT NULL,
	"prompt" text NOT NULL,
	"created_by" varchar,
	"sharing_scope" text DEFAULT 'private' NOT NULL,
	"github_pr_url" text,
	"github_pr_status" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_agents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general' NOT NULL,
	"code_path" text,
	"default_prompt" text NOT NULL,
	"model_provider" text DEFAULT 'gemini' NOT NULL,
	"model_name" text DEFAULT 'gemini-3.5-flash' NOT NULL,
	"search_provider" text,
	"requires_web_search" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ai_agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "competitive_analyses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"competitor_name" text NOT NULL,
	"threat_assessment" jsonb,
	"opportunities" jsonb,
	"strategic_gaps" jsonb,
	"recommendations" jsonb,
	"summary" text,
	"generated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "competitive_landscapes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"positioning" jsonb,
	"market_trends" jsonb,
	"strategic_imperatives" jsonb,
	"risk_areas" jsonb,
	"key_changes" jsonb,
	"summary" text,
	"segment_coverage_matrix" jsonb,
	"segment_coverage_updated_at" timestamp,
	"generated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "competitive_landscapes_product_id_unique" UNIQUE("product_id")
);
--> statement-breakpoint
CREATE TABLE "competitor_changes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"competitor_name" text NOT NULL,
	"source_category" text DEFAULT 'competitor',
	"change_type" text DEFAULT 'update' NOT NULL,
	"change_title" text NOT NULL,
	"change_description" text,
	"source_url" text,
	"source_type" text DEFAULT 'ai_analysis',
	"stream" text,
	"severity" text,
	"url_verified" boolean,
	"failure_reason" text,
	"detected_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "competitor_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"competitor_name" text NOT NULL,
	"competitor_url" text,
	"competitor_url_source" text DEFAULT 'ai-discovered',
	"source_category" text DEFAULT 'competitor',
	"status" text DEFAULT 'tracked' NOT NULL,
	"description" text,
	"description_source_url" text,
	"help_center_url" text,
	"help_center_url_source_url" text,
	"key_features" jsonb,
	"pricing" text,
	"pricing_source_url" text,
	"pricing_tiers" jsonb,
	"pricing_free_trial" boolean,
	"pricing_notes" text,
	"markets" jsonb,
	"customer_segments" jsonb,
	"key_differentiators" jsonb,
	"summary_citations" jsonb,
	"integrations" jsonb,
	"integration_analysis" jsonb,
	"reviews" jsonb,
	"review_platforms" jsonb,
	"review_positive_themes" jsonb,
	"review_negative_themes" jsonb,
	"review_average_rating" real,
	"review_total_count" integer,
	"enrichment_status" text DEFAULT 'pending',
	"last_enriched_at" timestamp,
	"user_summary" jsonb,
	"user_news" jsonb,
	"user_pricing" jsonb,
	"user_features" jsonb,
	"user_integrations" jsonb,
	"user_reviews" jsonb,
	"investor_relations" jsonb,
	"feature_strength_summary" text,
	"pricing_analysis" text,
	"threat_level" text DEFAULT 'none',
	"parent_company" text,
	"feature_persona_mapping" jsonb,
	"announcements" jsonb,
	"announcements_analysis" text,
	"valid_release_sources" jsonb,
	"github_repo_url" text,
	"github_stats" jsonb,
	"changelog_url" text,
	"changelog_url_source_url" text,
	"changelog_content_hash" text,
	"changelog_last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "competitor_threat_level_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"competitor_profile_id" varchar NOT NULL,
	"competitor_name" text NOT NULL,
	"previous_level" text NOT NULL,
	"new_level" text NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_call_recordings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" varchar NOT NULL,
	"customer_name" text NOT NULL,
	"context_type" text DEFAULT 'other' NOT NULL,
	"title" text,
	"recording_url" text,
	"product_feedback" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"workflow_notes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"customer_needs" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"full_transcript" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"recorded_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "customer_segment_personas" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_profile_id" varchar NOT NULL,
	"product_id" varchar NOT NULL,
	"persona_title" text NOT NULL,
	"persona_description" text,
	"persona_demographics" jsonb,
	"persona_goals" jsonb,
	"persona_pain_points" jsonb,
	"persona_behaviors" jsonb,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "customer_segment_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"segment_name" text NOT NULL,
	"segment_description" text,
	"segment_type" text DEFAULT 'customer_segment',
	"source_url" text,
	"needs_summary" text,
	"needs" jsonb,
	"overall_satisfaction" real,
	"jobs_to_be_done" jsonb,
	"persona_title" text,
	"persona_description" text,
	"persona_demographics" jsonb,
	"persona_goals" jsonb,
	"persona_pain_points" jsonb,
	"persona_behaviors" jsonb,
	"csat_score" real,
	"csat_comments" jsonb,
	"csat_data_source" text,
	"nps_score" real,
	"nps_comments" jsonb,
	"nps_data_source" text,
	"customer_analytics_comments" jsonb,
	"customer_analytics_data_source" text,
	"research_items" jsonb,
	"quotes" jsonb,
	"icp_fit" text,
	"is_icp" boolean DEFAULT false,
	"opportunities" jsonb,
	"recommendations" jsonb,
	"segment_insights" text,
	"previous_nps_score" real,
	"previous_csat_score" real,
	"research_updated_at" timestamp,
	"last_enriched_at" timestamp,
	"enrichment_status" text DEFAULT 'pending',
	"enrichment_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deleted_customer_segment_names" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" varchar NOT NULL,
	"normalized_name" text NOT NULL,
	"original_name" text NOT NULL,
	"deleted_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "feedback_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"team_id" varchar,
	"is_competitor" boolean DEFAULT false NOT NULL,
	"competitor_name" text,
	"source_name" text NOT NULL,
	"source_url" text,
	"source_type" text DEFAULT 'review' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"collected_at" timestamp DEFAULT now() NOT NULL,
	"topic" text,
	"quoted_text" text NOT NULL,
	"sentiment" integer,
	"reviewer_name" text,
	"review_date" timestamp,
	"linked_opportunity_id" varchar,
	"archived_at" timestamp,
	"image_url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "feedback_sources" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"product_id" varchar,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"type" text DEFAULT 'review' NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"product_count" integer,
	"last_scanned_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "feedback_themes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"team_id" varchar,
	"is_competitor" boolean DEFAULT false NOT NULL,
	"competitor_name" text,
	"theme_name" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'needs_review' NOT NULL,
	"priority" text,
	"mention_count" integer DEFAULT 0 NOT NULL,
	"average_sentiment" integer,
	"feedback_entry_ids" jsonb,
	"linked_opportunity_id" varchar,
	"last_updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "g2_product_catalog" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"g2_product_id" text,
	"canonical_name" text NOT NULL,
	"slug" text,
	"domain" text,
	"name_variations" text[] DEFAULT '{}'::text[] NOT NULL,
	"review_count" integer DEFAULT 0,
	"star_rating" real DEFAULT 0,
	"product_url" text,
	"status" text DEFAULT 'found' NOT NULL,
	"last_verified_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "goal_layers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "goal_periods" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"name" text NOT NULL,
	"period_type" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"has_next_period_goals" boolean DEFAULT false NOT NULL,
	"reminder_25_percent_shown" boolean DEFAULT false NOT NULL,
	"reminder_2_days_shown" boolean DEFAULT false NOT NULL,
	"reminder_end_day_shown" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "idea_assessments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"product_id" varchar NOT NULL,
	"title" text NOT NULL,
	"conversation_history" jsonb DEFAULT '[]'::jsonb,
	"ready_flag" boolean DEFAULT false NOT NULL,
	"outcome_type" text,
	"assessment_output" jsonb,
	"opportunity_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "layer_goals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layer_id" varchar NOT NULL,
	"product_id" varchar NOT NULL,
	"period_id" varchar,
	"name" text NOT NULL,
	"goal_text" text,
	"goal_target" integer,
	"goal_baseline" integer DEFAULT 0,
	"goal_metric" text,
	"parent_goal_id" varchar,
	"parent_goal_type" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "llm_model_pricing" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model_name" text NOT NULL,
	"input_cents_per_million" real NOT NULL,
	"output_cents_per_million" real NOT NULL,
	"source" text DEFAULT 'hardcoded' NOT NULL,
	"last_fetched_at" timestamp,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"agent_type" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "market_reviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"review_month" text NOT NULL,
	"content" jsonb,
	"sources" jsonb,
	"run_date" timestamp DEFAULT now(),
	"previous_review_id" varchar,
	"archived_recommendations" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mcp_api_keys" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"key_hash" varchar NOT NULL,
	"key_prefix" varchar NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" varchar,
	"sync_type" varchar,
	"data_direction" varchar,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_connections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"product_id" varchar,
	"name" varchar NOT NULL,
	"server_url" varchar,
	"transport" varchar DEFAULT 'http' NOT NULL,
	"auth_token" varchar,
	"available_tools" jsonb,
	"status" varchar DEFAULT 'pending_credentials' NOT NULL,
	"section_type" varchar,
	"brief_types" text[],
	"connection_mode" varchar DEFAULT 'push' NOT NULL,
	"feedback_extraction_instruction" text,
	"sync_metadata" jsonb,
	"sync_type" varchar,
	"data_direction" varchar,
	"source" varchar DEFAULT 'user',
	"last_error" text,
	"last_tested_at" timestamp,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_sources" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"product_id" varchar,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"type" text DEFAULT 'news' NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"last_mention_date" timestamp,
	"last_scanned_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" varchar,
	"product_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"sentiment" integer NOT NULL,
	"frequency" integer NOT NULL,
	"mentions" integer DEFAULT 0 NOT NULL,
	"revenue_impact" integer,
	"revenue_potential" integer,
	"priority_score" integer,
	"status" text DEFAULT 'backlog' NOT NULL,
	"opportunity_status" text DEFAULT 'active' NOT NULL,
	"time_investment_weeks" integer,
	"goal_contribution_percent" integer,
	"suggested_goal_contribution_percent" integer,
	"goal_contribution_confirmed" boolean DEFAULT false,
	"markets" jsonb,
	"segments" jsonb,
	"votes" jsonb,
	"comments" jsonb,
	"sources" jsonb,
	"relevance_to_focus_area" text,
	"impact_hypothesis" text,
	"hypothesis_evidence" jsonb,
	"confidence_votes" jsonb,
	"confidence_override" integer,
	"customer_feedback" jsonb,
	"competitor_solutions" jsonb,
	"solution_ideas" jsonb,
	"actions" jsonb,
	"agent_build_approval" jsonb,
	"launch_content" jsonb,
	"launch_plan" jsonb,
	"agent_build_result" jsonb,
	"start_date" timestamp,
	"value_realization_date" timestamp,
	"completion_percent" integer,
	"completion_history" jsonb,
	"prioritize_after" varchar,
	"prioritize_before" varchar,
	"item_type" text DEFAULT 'task',
	"user_story" text,
	"prd" text,
	"previous_value_realization_date" timestamp,
	"previous_goal_contribution_percent" integer,
	"value_change_reason" text,
	"value_changed_at" timestamp,
	"value_change_dependency_id" varchar,
	"value_change_accepted_at" timestamp,
	"value_change_accepted_by" varchar,
	"value_calculation_mode" text DEFAULT 'even',
	"new_customers_per_month" integer,
	"revenue_per_customer" integer,
	"existing_customers_per_month" integer,
	"revenue_uplift_per_customer" integer,
	"target_new_customers_total" integer,
	"target_existing_customers_total" integer,
	"research_items" jsonb,
	"opportunity_type" text DEFAULT 'standard',
	"market_review_status" text,
	"market_review_data" jsonb,
	"market_review_conversation_history" jsonb,
	"opportunity_viewers" jsonb,
	"strategic_pillar" text,
	"is_milestone" boolean DEFAULT false,
	"definition_status" text DEFAULT 'not_started',
	"definition_conversation_history" jsonb,
	"definition_document" jsonb,
	"specialist_assistant_type" text,
	"specialist_assistant_conversation_history" jsonb,
	"specialist_assistant_messages" jsonb,
	"specialist_assistant_ready_flag" boolean DEFAULT false,
	"specialist_assistant_sections" jsonb,
	"specialist_pending_section_title" text,
	"specialist_platform_context" text,
	"specialist_web_research_context" text,
	"revenue_tracking_url" text,
	"analytics_links" jsonb,
	"impact_insights" jsonb,
	"impact_recommendations" jsonb,
	"impact_metrics" jsonb,
	"impact_metrics_source_hash" text,
	"build_connection_state" jsonb,
	"dates_last_modified_at" timestamp,
	"is_imported_unassigned" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organization_users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" text DEFAULT 'Executive' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"job_title" text,
	"joined_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"seat_type" text DEFAULT 'pro' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"use_own_llm_keys" boolean DEFAULT true NOT NULL,
	"openai_api_key" text,
	"gemini_api_key" text,
	"perplexity_api_key" text,
	"claude_api_key" text,
	"openrouter_api_key" text,
	"llm_key_mode" text DEFAULT 'individual' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform_skill_suppressions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"skill_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "problem_statement_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_statement_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_type" text,
	"file_size" integer,
	"uploaded_by_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "problem_statements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"related_features" jsonb,
	"related_needs" jsonb,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_context_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"source_type" text NOT NULL,
	"file_name" text,
	"page_title" text,
	"source_url" text,
	"mcp_connection_id" varchar,
	"mime_type" text,
	"document_label" text,
	"summary" text,
	"extracted_text" text,
	"file_data" text,
	"file_size" integer,
	"uploaded_by" varchar,
	"last_synced_at" timestamp,
	"sync_error" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_features" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"description" text,
	"category" text,
	"source" text NOT NULL,
	"evidence_url" text,
	"content_hash" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"shipped_at" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_help_articles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"content_hash" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"url" text,
	"logo_url" text,
	"description" text,
	"competitors" jsonb,
	"markets" jsonb,
	"segments" jsonb,
	"business_goals" jsonb,
	"review_sites" jsonb,
	"help_center_url" text,
	"prioritization_weights" jsonb,
	"goal_theme_options" jsonb,
	"goal_metric_options" jsonb,
	"goal_planning_frequency" text,
	"current_period_end_date" timestamp,
	"business_goal_planning_frequency" text,
	"business_goal_period_end_date" timestamp,
	"team_reminder_25_percent_shown" boolean DEFAULT false,
	"team_reminder_2_days_shown" boolean DEFAULT false,
	"team_reminder_end_day_shown" boolean DEFAULT false,
	"business_reminder_25_percent_shown" boolean DEFAULT false,
	"business_reminder_2_days_shown" boolean DEFAULT false,
	"business_reminder_end_day_shown" boolean DEFAULT false,
	"team_weekly_cost" integer,
	"agent_schedules" jsonb,
	"audience" jsonb,
	"distribution" jsonb,
	"business_model" jsonb,
	"is_regulated" boolean,
	"customer_insights_summary" text,
	"dashboard_section_summaries" jsonb,
	"purpose_statement" text,
	"growth_ambition" text,
	"period_ambitions" jsonb,
	"period_titles" jsonb,
	"strategic_pillars" jsonb,
	"investment_profile" jsonb,
	"roadmap_columns" jsonb,
	"document_templates" jsonb,
	"workflow_settings" jsonb,
	"time_investment_unit" text DEFAULT 'weeks',
	"onboarding_discovery_status" text DEFAULT 'not_started' NOT NULL,
	"user_completed_discovery" boolean DEFAULT false NOT NULL,
	"discovery_conversation_history" jsonb,
	"discovery_profile" jsonb,
	"strategy_conversation_history" jsonb,
	"strategy_document" jsonb,
	"strategy_status" text DEFAULT 'draft',
	"strategy_viewers" jsonb,
	"strategy_updated_at" timestamp,
	"constraints_and_risks" jsonb,
	"next_period_business_goals" jsonb,
	"business_goals_updated_at" timestamp,
	"competitive_landscape_updated_at" timestamp,
	"customer_insights_summary_updated_at" timestamp,
	"product_financials_context" jsonb,
	"sentiment_latest_data_month" text,
	"sentiment_data_updated_at" timestamp,
	"goal_tracking_updated_at" timestamp,
	"goal_on_track" boolean,
	"roadmap_view_format" text,
	"roadmap_sync_config" jsonb,
	"last_synced" timestamp,
	"notion_confluence_links" jsonb,
	"strategy_market_scan_findings" jsonb,
	"archived_insights_recommendations" jsonb,
	"scoring_config" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "roadmap_recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"team_id" varchar,
	"title" text NOT NULL,
	"source_type" text NOT NULL,
	"source_context" text,
	"status" text DEFAULT 'active' NOT NULL,
	"dismiss_reason" text,
	"converted_opportunity_id" varchar,
	"priority_level" text,
	"impact_hypothesis" text,
	"priority_rationale" text,
	"suggested_team_id" varchar,
	"markets" jsonb,
	"computed_score" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "roadmap_summaries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"summary_data" jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now(),
	CONSTRAINT "roadmap_summaries_product_id_unique" UNIQUE("product_id")
);
--> statement-breakpoint
CREATE TABLE "shared_conversations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"title" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" text DEFAULT 'shared' NOT NULL,
	"created_by_user_id" varchar,
	"source" text DEFAULT 'mcp' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar,
	"product_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"content" text DEFAULT '' NOT NULL,
	"targets" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "team_assignment_signals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"signal_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" varchar NOT NULL,
	"source_team_id" varchar,
	"target_team_id" varchar NOT NULL,
	"theme_name" text,
	"keywords" jsonb,
	"user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"name" text NOT NULL,
	"handle" text,
	"description" text,
	"focus_area" text,
	"features" jsonb,
	"feature_analytics_links" jsonb,
	"feature_analytics_data" jsonb,
	"focus_competitors" jsonb,
	"customer_segments" jsonb,
	"markets" jsonb,
	"goal_text" text,
	"goal_target" integer,
	"goal_baseline" integer DEFAULT 0,
	"goal_metric" text,
	"goal_period_targets" jsonb,
	"goal_period_id" varchar,
	"parent_goal_id" varchar,
	"parent_goal_type" text,
	"grouping_id" varchar,
	"weekly_cost" integer,
	"roi_updated_at" timestamp,
	"last_opportunity_generation_at" timestamp,
	"team_discovery_status" text DEFAULT 'not_started' NOT NULL,
	"team_discovery_conversation_history" jsonb,
	"workflow_config" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "thought_partner_conversations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"author_user_id" varchar NOT NULL,
	"author_name" text,
	"title" text,
	"topic_tags" text[],
	"excerpt" text,
	"messages" jsonb DEFAULT '[]'::jsonb,
	"visibility" text DEFAULT 'private' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"source_type" text DEFAULT 'thought-partner' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"first_login_at" timestamp,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "idx_threat_level_history_profile" ON "competitor_threat_level_history" USING btree ("competitor_profile_id");--> statement-breakpoint
CREATE INDEX "idx_threat_level_history_product" ON "competitor_threat_level_history" USING btree ("product_id","changed_at");--> statement-breakpoint
CREATE INDEX "idx_call_recordings_segment" ON "customer_call_recordings" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "idx_deleted_segments_product" ON "deleted_customer_segment_names" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_deleted_segments_product_normalized" ON "deleted_customer_segment_names" USING btree ("product_id","normalized_name");--> statement-breakpoint
CREATE INDEX "idx_feedback_entries_product_id" ON "feedback_entries" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_feedback_entries_team_id" ON "feedback_entries" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_feedback_entries_product_is_competitor" ON "feedback_entries" USING btree ("product_id","is_competitor");--> statement-breakpoint
CREATE INDEX "idx_feedback_entries_is_competitor" ON "feedback_entries" USING btree ("is_competitor");--> statement-breakpoint
CREATE INDEX "idx_feedback_entries_product_collected_at" ON "feedback_entries" USING btree ("product_id","collected_at");--> statement-breakpoint
CREATE INDEX "idx_feedback_entries_topic" ON "feedback_entries" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "idx_idea_assessments_user_product" ON "idea_assessments" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_model_pricing_provider_model_idx" ON "llm_model_pricing" USING btree ("provider","model_name");--> statement-breakpoint
CREATE INDEX "idx_market_reviews_product" ON "market_reviews" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_market_reviews_product_month" ON "market_reviews" USING btree ("product_id","review_month");--> statement-breakpoint
CREATE INDEX "idx_opportunities_team_id" ON "opportunities" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_opportunities_product_id" ON "opportunities" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_skill_suppressions_org_skill_idx" ON "platform_skill_suppressions" USING btree ("org_id","skill_id");--> statement-breakpoint
CREATE INDEX "idx_product_features_product_id" ON "product_features" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_features_product_normalized" ON "product_features" USING btree ("product_id","normalized_name");--> statement-breakpoint
CREATE INDEX "idx_product_help_articles_product_id" ON "product_help_articles" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_help_articles_product_url" ON "product_help_articles" USING btree ("product_id","url");--> statement-breakpoint
CREATE INDEX "idx_roadmap_recommendations_product" ON "roadmap_recommendations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_roadmap_recommendations_product_status" ON "roadmap_recommendations" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "idx_shared_conversations_org" ON "shared_conversations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_thought_partner_conversations_org" ON "thought_partner_conversations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_thought_partner_conversations_product" ON "thought_partner_conversations" USING btree ("product_id");