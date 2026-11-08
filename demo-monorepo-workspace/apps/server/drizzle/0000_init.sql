CREATE TABLE "ingest_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"kind" text NOT NULL,
	"install_id" text,
	"label" text,
	"ext_version" text,
	"user_agent" text,
	"sent_at" timestamp with time zone,
	"event_count" integer NOT NULL,
	"body_text" text NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"site" text NOT NULL,
	"start_url" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"pages_requested" integer NOT NULL,
	"pages_fetched" integer NOT NULL,
	"user_agent" text,
	"delay_ms" integer NOT NULL,
	"message" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scraped_listings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"site" text NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"url" text,
	"price" numeric(12, 2),
	"original_price" numeric(12, 2),
	"currency" text DEFAULT 'BRL' NOT NULL,
	"installments" text,
	"rating" real,
	"review_count" integer,
	"seller" text,
	"free_shipping" boolean,
	"image_url" text,
	"category" text,
	"page" integer NOT NULL,
	"position" integer NOT NULL,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sweep_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"rep" integer,
	"query_id" integer,
	"query_kind" text,
	"size" integer,
	"strategy" text,
	"target" text NOT NULL,
	"reason" text,
	"explored" boolean,
	"cold" boolean,
	"total" integer,
	"compute_to_result_ms" double precision NOT NULL,
	"main_blocked_ms" double precision NOT NULL,
	"to_paint_ms" double precision,
	"prepare_ms" double precision,
	"prepared" integer,
	"filter_ms" double precision,
	"sort_ms" double precision,
	"sort_class" text,
	"pred_main_ms" double precision,
	"pred_worker_ms" double precision,
	"budget_ms" double precision,
	"main_busy" double precision,
	"pressure" text,
	"post_ms" double precision,
	"queue_ms" double precision,
	"reply_ms" double precision,
	"tbt_ms" double precision,
	"loaf_count" integer,
	"transport" text,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sweep_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"app" text NOT NULL,
	"framework" text,
	"build_commit" text,
	"user_agent" text,
	"cores" integer,
	"memory_gb" real,
	"throttling" real DEFAULT 1 NOT NULL,
	"dataset_url" text,
	"dataset_rows" integer,
	"dataset_bytes" bigint,
	"condition" text,
	"strategy" text,
	"transport" text,
	"notes" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"install_id" text,
	"tab_id" integer,
	"page" text,
	"world" text,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"ts" double precision,
	"time_origin" double precision,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scraped_listings" ADD CONSTRAINT "scraped_listings_run_id_scrape_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sweep_results" ADD CONSTRAINT "sweep_results_run_id_sweep_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sweep_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_batch_id_ingest_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ingest_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_batches_received_at_idx" ON "ingest_batches" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "ingest_batches_install_idx" ON "ingest_batches" USING btree ("install_id");--> statement-breakpoint
CREATE INDEX "scrape_runs_site_idx" ON "scrape_runs" USING btree ("site","created_at");--> statement-breakpoint
CREATE INDEX "scraped_listings_run_idx" ON "scraped_listings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "scraped_listings_site_idx" ON "scraped_listings" USING btree ("site","external_id");--> statement-breakpoint
CREATE INDEX "sweep_results_run_idx" ON "sweep_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "sweep_results_cell_idx" ON "sweep_results" USING btree ("run_id","strategy","size","query_kind");--> statement-breakpoint
CREATE INDEX "sweep_runs_created_idx" ON "sweep_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sweep_runs_app_idx" ON "sweep_runs" USING btree ("app","framework");--> statement-breakpoint
CREATE INDEX "telemetry_events_kind_idx" ON "telemetry_events" USING btree ("source","type");--> statement-breakpoint
CREATE INDEX "telemetry_events_batch_idx" ON "telemetry_events" USING btree ("batch_id");