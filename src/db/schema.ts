import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const PLATFORMS = ["shopify", "woocommerce", "sendcloud", "boxtal"] as const;
export const CARRIERS = ["colissimo", "mondial_relay", "chronopost", "dpd"] as const;
export const SHIPMENT_STATUSES = ["in_transit", "delivered", "late", "lost", "damaged"] as const;
export const CLAIM_TYPES = ["delay", "loss", "damage"] as const;
export const CLAIM_STATUSES = ["pending", "submitted", "approved", "rejected"] as const;
export const COMPENSATION_TYPES = ["shipping_cost", "per_kg", "fixed", "goods_value"] as const;
export const THRESHOLD_UNITS = ["hours", "business_days"] as const;

export const platformEnum = pgEnum("platform", PLATFORMS);
export const storeStatusEnum = pgEnum("store_status", ["syncing", "connected", "error"]);
export const carrierEnum = pgEnum("carrier", CARRIERS);
export const shipmentStatusEnum = pgEnum("shipment_status", SHIPMENT_STATUSES);
export const claimTypeEnum = pgEnum("claim_type", CLAIM_TYPES);
export const claimStatusEnum = pgEnum("claim_status", CLAIM_STATUSES);
export const compensationTypeEnum = pgEnum("compensation_type", COMPENSATION_TYPES);
export const thresholdUnitEnum = pgEnum("threshold_unit", THRESHOLD_UNITS);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    accessToken: text("access_token"),
    status: storeStatusEnum("status").notNull().default("syncing"),
    lastSyncAt: ts("last_sync_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("stores_user_url_unique").on(t.userId, t.url)],
);

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    orderNumber: text("order_number").notNull(),
    trackingNumber: text("tracking_number").notNull(),
    carrier: carrierEnum("carrier").notNull(),
    customerName: text("customer_name").notNull(),
    city: text("city").notNull(),
    weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
    shippingCost: numeric("shipping_cost", { precision: 10, scale: 2 }),
    goodsValue: numeric("goods_value", { precision: 10, scale: 2 }),
    shippedAt: ts("shipped_at").notNull(),
    deliveredAt: ts("delivered_at"),
    lastScanAt: ts("last_scan_at"),
    damageReportedAt: ts("damage_reported_at"),
    status: shipmentStatusEnum("status").notNull().default("in_transit"),
    lastCheckedAt: ts("last_checked_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("shipments_carrier_tracking_unique").on(t.carrier, t.trackingNumber),
    index("shipments_user_status_idx").on(t.userId, t.status),
    index("shipments_store_idx").on(t.storeId),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Numéro lisible affiché dans l'interface : R-1000, R-1001...
    number: integer("number").notNull().generatedAlwaysAsIdentity({ startWith: 1000 }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    shipmentId: uuid("shipment_id").notNull().unique().references(() => shipments.id, { onDelete: "cascade" }),
    type: claimTypeEnum("type").notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    commission: numeric("commission", { precision: 10, scale: 2 }).notNull().default(sql`0`),
    status: claimStatusEnum("status").notNull().default("pending"),
    reason: text("reason").notNull(),
    compensationBasis: text("compensation_basis").notNull(),
    detectedAt: ts("detected_at").notNull(),
    submittedAt: ts("submitted_at"),
    resolvedAt: ts("resolved_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("claims_user_status_idx").on(t.userId, t.status, t.detectedAt)],
);

export const claimEvents = pgTable(
  "claim_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    detail: text("detail"),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [index("claim_events_claim_idx").on(t.claimId)],
);

export const carrierRules = pgTable(
  "carrier_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    carrier: carrierEnum("carrier").notNull(),
    incidentType: claimTypeEnum("incident_type").notNull(),
    thresholdValue: integer("threshold_value").notNull(),
    thresholdUnit: thresholdUnitEnum("threshold_unit").notNull().default("hours"),
    compensationType: compensationTypeEnum("compensation_type").notNull(),
    compensationValue: numeric("compensation_value", { precision: 10, scale: 2 }).notNull().default(sql`0`),
    basisLabel: text("basis_label").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [unique("carrier_rules_unique").on(t.carrier, t.incidentType)],
);

export type User = typeof users.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type Shipment = typeof shipments.$inferSelect;
export type Claim = typeof claims.$inferSelect;
export type CarrierRule = typeof carrierRules.$inferSelect;
export type Carrier = (typeof CARRIERS)[number];
export type ClaimType = (typeof CLAIM_TYPES)[number];
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
