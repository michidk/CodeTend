CREATE TABLE "finding_patches" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" integer NOT NULL,
	"source_scan_id" integer,
	"status" text DEFAULT 'proposed' NOT NULL,
	"diff" text NOT NULL,
	"summary" text NOT NULL,
	"verification" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_validations" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" integer NOT NULL,
	"occurrence_id" integer,
	"status" text NOT NULL,
	"method" text NOT NULL,
	"summary" text NOT NULL,
	"commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proof_gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"runner" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_security_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'generated' NOT NULL,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_security_profiles_repository_id_unique" UNIQUE("repository_id")
);
--> statement-breakpoint
CREATE TABLE "scan_artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" integer NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"contents" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finding_occurrences" ADD COLUMN "root_cause" text;--> statement-breakpoint
ALTER TABLE "finding_occurrences" ADD COLUMN "code_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "finding_occurrences" ADD COLUMN "attack_path" jsonb;--> statement-breakpoint
ALTER TABLE "finding_occurrences" ADD COLUMN "validation_plan" jsonb;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "root_cause" text;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "code_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "attack_path" jsonb;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "validation_plan" jsonb;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "remediation_tests" jsonb;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "preventive_controls" jsonb;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "mode" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "target" jsonb DEFAULT '{"kind":"repository"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "max_cost_usd" real;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "cancellation_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "coverage" jsonb;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "manifest" jsonb;--> statement-breakpoint
ALTER TABLE "finding_patches" ADD CONSTRAINT "finding_patches_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_patches" ADD CONSTRAINT "finding_patches_source_scan_id_scans_id_fk" FOREIGN KEY ("source_scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_validations" ADD CONSTRAINT "finding_validations_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_validations" ADD CONSTRAINT "finding_validations_occurrence_id_finding_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."finding_occurrences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_security_profiles" ADD CONSTRAINT "repository_security_profiles_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_artifacts" ADD CONSTRAINT "scan_artifacts_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_patches_finding_idx" ON "finding_patches" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "finding_validations_finding_idx" ON "finding_validations" USING btree ("finding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_artifacts_scan_kind_idx" ON "scan_artifacts" USING btree ("scan_id","kind");