CREATE TABLE "host_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"instance_id" text NOT NULL,
	"boot_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"sample_count" integer NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_rollups" (
	"bucket" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"instance_id" text NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"samples" integer NOT NULL,
	"fields" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"source" text NOT NULL,
	"instance_id" text NOT NULL,
	"boot_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingest_batches" ADD COLUMN "boot_id" text;--> statement-breakpoint
ALTER TABLE "ingest_batches" ADD COLUMN "sequence" integer;--> statement-breakpoint
ALTER TABLE "host_samples" ADD CONSTRAINT "host_samples_batch_id_host_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."host_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_batches_sequence_idx" ON "host_batches" USING btree ("source","instance_id","boot_id","sequence");--> statement-breakpoint
CREATE INDEX "host_batches_instance_idx" ON "host_batches" USING btree ("source","instance_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "host_rollups_key_idx" ON "host_rollups" USING btree ("bucket","source","instance_id","type","name");--> statement-breakpoint
CREATE INDEX "host_samples_series_idx" ON "host_samples" USING btree ("source","instance_id","type","at");--> statement-breakpoint
CREATE INDEX "host_samples_category_idx" ON "host_samples" USING btree ("category","at");--> statement-breakpoint
CREATE INDEX "host_samples_batch_idx" ON "host_samples" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_batches_sequence_idx" ON "ingest_batches" USING btree ("install_id","boot_id","sequence") WHERE boot_id IS NOT NULL AND sequence IS NOT NULL;