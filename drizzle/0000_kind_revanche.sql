CREATE TABLE "finding_occurrences" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" integer NOT NULL,
	"scan_id" integer NOT NULL,
	"state" text NOT NULL,
	"severity" text NOT NULL,
	"confidence" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"scanner_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"title" text NOT NULL,
	"severity" text NOT NULL,
	"confidence" text NOT NULL,
	"description" text NOT NULL,
	"why_it_matters" text NOT NULL,
	"recommendation" text NOT NULL,
	"effort" text NOT NULL,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen_scan_id" integer,
	"last_seen_scan_id" integer,
	"resolved_scan_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"cron_expression" text DEFAULT '0 3 * * *' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_scan_at" timestamp with time zone,
	"last_scan_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_knowledge" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"overview" text NOT NULL,
	"summary" jsonb DEFAULT '{"languages":[],"frameworks":[],"subsystems":[],"concepts":[]}'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commit_sha" text,
	"file_count" integer,
	"refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_knowledge_repository_id_unique" UNIQUE("repository_id")
);
--> statement-breakpoint
CREATE TABLE "scanner_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" integer NOT NULL,
	"scanner_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"score" real,
	"summary" text,
	"fix_prompt" text,
	"error" text,
	"eve_session_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"commit_sha" text,
	"branch" text,
	"file_count" integer,
	"phase" text,
	"eve_session_id" text,
	"gitnexus_used" boolean DEFAULT false NOT NULL,
	"knowledge_refreshed" boolean DEFAULT false NOT NULL,
	"overall_score" real,
	"grade" text,
	"counts" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finding_occurrences" ADD CONSTRAINT "finding_occurrences_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_occurrences" ADD CONSTRAINT "finding_occurrences_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_first_seen_scan_id_scans_id_fk" FOREIGN KEY ("first_seen_scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_last_seen_scan_id_scans_id_fk" FOREIGN KEY ("last_seen_scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_resolved_scan_id_scans_id_fk" FOREIGN KEY ("resolved_scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_knowledge" ADD CONSTRAINT "repository_knowledge_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scanner_runs" ADD CONSTRAINT "scanner_runs_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finding_occurrences_finding_scan_idx" ON "finding_occurrences" USING btree ("finding_id","scan_id");--> statement-breakpoint
CREATE INDEX "finding_occurrences_scan_idx" ON "finding_occurrences" USING btree ("scan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_repository_scanner_fingerprint_idx" ON "findings" USING btree ("repository_id","scanner_id","fingerprint");--> statement-breakpoint
CREATE INDEX "findings_repository_state_idx" ON "findings" USING btree ("repository_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "scanner_runs_scan_scanner_idx" ON "scanner_runs" USING btree ("scan_id","scanner_id");--> statement-breakpoint
CREATE INDEX "scans_repository_created_idx" ON "scans" USING btree ("repository_id","created_at");