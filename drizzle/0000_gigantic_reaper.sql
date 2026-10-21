CREATE TYPE "public"."carrier" AS ENUM('colissimo', 'mondial_relay', 'chronopost', 'dpd');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('pending', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('delay', 'loss', 'damage');--> statement-breakpoint
CREATE TYPE "public"."compensation_type" AS ENUM('shipping_cost', 'per_kg', 'fixed', 'goods_value');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('shopify', 'woocommerce', 'sendcloud', 'boxtal');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('in_transit', 'delivered', 'late', 'lost', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('syncing', 'connected', 'error');--> statement-breakpoint
CREATE TYPE "public"."threshold_unit" AS ENUM('hours', 'business_days');--> statement-breakpoint
CREATE TABLE "carrier_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier" "carrier" NOT NULL,
	"incident_type" "claim_type" NOT NULL,
	"threshold_value" integer NOT NULL,
	"threshold_unit" "threshold_unit" DEFAULT 'hours' NOT NULL,
	"compensation_type" "compensation_type" NOT NULL,
	"compensation_value" numeric(10, 2) DEFAULT 0 NOT NULL,
	"basis_label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "carrier_rules_unique" UNIQUE("carrier","incident_type")
);
--> statement-breakpoint
CREATE TABLE "claim_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "claims_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1000 CACHE 1),
	"user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"type" "claim_type" NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"commission" numeric(10, 2) DEFAULT 0 NOT NULL,
	"status" "claim_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"compensation_basis" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_shipment_id_unique" UNIQUE("shipment_id")
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"tracking_number" text NOT NULL,
	"carrier" "carrier" NOT NULL,
	"customer_name" text NOT NULL,
	"city" text NOT NULL,
	"weight_kg" numeric(6, 2),
	"shipping_cost" numeric(10, 2),
	"goods_value" numeric(10, 2),
	"shipped_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_scan_at" timestamp with time zone,
	"damage_reported_at" timestamp with time zone,
	"status" "shipment_status" DEFAULT 'in_transit' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_carrier_tracking_unique" UNIQUE("carrier","tracking_number")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"access_token" text,
	"status" "store_status" DEFAULT 'syncing' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_user_url_unique" UNIQUE("user_id","url")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_events_claim_idx" ON "claim_events" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claims_user_status_idx" ON "claims" USING btree ("user_id","status","detected_at");--> statement-breakpoint
CREATE INDEX "shipments_user_status_idx" ON "shipments" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "shipments_store_idx" ON "shipments" USING btree ("store_id");