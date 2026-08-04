CREATE TABLE "intel_proposals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"product_id" varchar NOT NULL,
	"target_kind" text DEFAULT 'competitor_entity' NOT NULL,
	"target_entity_id" varchar,
	"target_name" text,
	"kind" text DEFAULT 'other' NOT NULL,
	"claim" text NOT NULL,
	"source_url" text,
	"effective_date" timestamp,
	"provenance" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp,
	"decided_by_user_id" varchar,
	"accepted_change_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mcp_activity" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_name" text,
	"client_version" text,
	"tool_name" text NOT NULL,
	"is_error" boolean DEFAULT false NOT NULL,
	"key_id" varchar,
	"called_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitor_changes" ADD COLUMN "provenance" jsonb;--> statement-breakpoint
ALTER TABLE "feedback_entries" ADD COLUMN "provenance" jsonb;--> statement-breakpoint
CREATE INDEX "idx_intel_proposals_product_status" ON "intel_proposals" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "idx_intel_proposals_entity" ON "intel_proposals" USING btree ("target_entity_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_activity_called_at" ON "mcp_activity" USING btree ("called_at");