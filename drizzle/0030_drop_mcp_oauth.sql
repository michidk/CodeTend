ALTER TABLE "oauth_authorization_codes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_clients" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "oauth_authorization_codes" CASCADE;--> statement-breakpoint
DROP TABLE "oauth_clients" CASCADE;--> statement-breakpoint
DROP TABLE "oauth_tokens" CASCADE;--> statement-breakpoint
DROP INDEX "mcp_audit_events_registration_source_idx";--> statement-breakpoint
ALTER TABLE "mcp_audit_events" DROP COLUMN "client_id";--> statement-breakpoint
ALTER TABLE "mcp_audit_events" DROP COLUMN "source_ip";