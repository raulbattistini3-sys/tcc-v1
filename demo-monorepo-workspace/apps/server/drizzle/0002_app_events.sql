CREATE TABLE "app_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"instance_id" text NOT NULL,
	"boot_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"idx" integer NOT NULL,
	"service" text NOT NULL,
	"event_source" text NOT NULL,
	"type" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"ts" double precision NOT NULL,
	"ms" double precision,
	"user_hash" text,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "app_events_batch_idx" ON "app_events" USING btree ("source","instance_id","boot_id","sequence","idx");--> statement-breakpoint
CREATE INDEX "app_events_kind_idx" ON "app_events" USING btree ("service","event_source","type","at");--> statement-breakpoint
CREATE INDEX "app_events_at_idx" ON "app_events" USING btree ("at");