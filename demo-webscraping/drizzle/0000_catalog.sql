CREATE TABLE "catalog_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site" text NOT NULL,
	"item_key" text NOT NULL,
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
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"first_file" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_price" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_site_key_uq" ON "catalog_items" USING btree ("site","item_key");--> statement-breakpoint
CREATE INDEX "catalog_items_site_seen_idx" ON "catalog_items" USING btree ("site","first_seen_at");