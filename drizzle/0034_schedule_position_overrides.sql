CREATE TABLE "schedule_position_overrides" (
	"repository_id" integer PRIMARY KEY NOT NULL,
	"position" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_position_overrides_position_unique" UNIQUE("position")
);
--> statement-breakpoint
ALTER TABLE "schedule_position_overrides" ADD CONSTRAINT "schedule_position_overrides_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;