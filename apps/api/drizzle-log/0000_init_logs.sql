CREATE TABLE "app_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"feature" text DEFAULT 'api' NOT NULL,
	"request_id" text,
	"user_id" text,
	"company_id" uuid,
	"msg" text NOT NULL,
	"context" jsonb
);
--> statement-breakpoint
CREATE INDEX "app_logs_ts_idx" ON "app_logs" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "app_logs_request_id_idx" ON "app_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "app_logs_level_idx" ON "app_logs" USING btree ("level");