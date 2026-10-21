import { and, eq, inArray, like } from "drizzle-orm";
import type { Db } from "../db";
import { carrierRules, claimEvents, claims, shipments, stores, type Carrier, type ClaimType } from "../db/schema";
import { evaluateShipment } from "./detection";
import { commissionFor } from "./money";
import { CARRIER_LABELS } from "./rules";

/**
 * Données d'exemple : deux boutiques et quatre mois d'historique.
 * Les réclamations sont créées par le vrai moteur de détection, à la date où l'anomalie
 * serait réellement apparue. Les boutiques d'exemple ont une adresse en « .demo » :
 * c'est ce qui permet de les retrouver et de les supprimer sans toucher aux vraies données.
 */

export const DEMO_SUFFIX = ".demo";

function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FIRST = ["Camille", "Hugo", "Léa", "Nathan", "Inès", "Louis", "Manon", "Jules", "Chloé", "Adam", "Sarah", "Tom", "Emma", "Lucas", "Zoé", "Maxime", "Clara", "Théo", "Alice", "Yanis"];
const LAST = ["R.", "M.", "D.", "B.", "L.", "P.", "G.", "T.", "F.", "C.", "V.", "H."];
const CITIES = ["Lyon", "Marseille", "Lille", "Nantes", "Bordeaux", "Toulouse", "Strasbourg", "Rennes", "Nice", "Montpellier", "Dijon", "Tours", "Grenoble", "Angers", "Brest", "Metz"];
const MIX: [Carrier, number][] = [["colissimo", 45], ["mondial_relay", 22], ["chronopost", 16], ["dpd", 17]];

type NewShipment = typeof shipments.$inferInsert;

export interface DemoSummary {
  shipments: number;
  claims: number;
  pending: number;
  submitted: number;
  approved: number;
  rejected: number;
}

export async function hasDemoData(db: Db, userId: string): Promise<boolean> {
  const rows = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.userId, userId), like(stores.url, `%${DEMO_SUFFIX}`))).limit(1);
  return rows.length > 0;
}

/** Supprime les boutiques d'exemple de l'utilisateur, avec leurs colis et réclamations. */
export async function removeDemoData(db: Db, userId: string): Promise<number> {
  const removed = await db.delete(stores).where(and(eq(stores.userId, userId), like(stores.url, `%${DEMO_SUFFIX}`))).returning({ id: stores.id });
  return removed.length;
}

export async function seedDemoData(db: Db, userId: string, opts: { now?: Date; seed?: number } = {}): Promise<DemoSummary> {
  const now = opts.now ?? new Date();
  const rnd = mulberry(opts.seed ?? Math.floor(Math.random() * 2 ** 31));
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const wpick = <T,>(items: [T, number][]) => {
    let r = rnd() * items.reduce((s, i) => s + i[1], 0);
    for (const [v, w] of items) if ((r -= w) < 0) return v;
    return items[0][0];
  };
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join("");
  const tracking = (c: Carrier) => (c === "colissimo" ? "6A" + digits(11) : c === "mondial_relay" ? "MR" + digits(10) : c === "chronopost" ? "XW" + digits(9) + "FR" : digits(14));
  const shippingFor = (c: Carrier) => (c === "chronopost" ? pick([9.9, 11.5, 13.2, 14.8, 18.6]) : c === "colissimo" ? pick([5.95, 6.45, 6.95, 7.65, 8.35, 9.9]) : pick([4.9, 5.5, 6.2, 7.1]));

  const rules = await db.select().from(carrierRules);
  const storeRows = await db
    .insert(stores)
    .values([
      { userId, platform: "shopify", name: "Atelier Lumen", url: `atelier-lumen${DEMO_SUFFIX}`, status: "connected", lastSyncAt: now },
      { userId, platform: "woocommerce", name: "Lumen Maison", url: `lumen-maison${DEMO_SUFFIX}`, status: "connected", lastSyncAt: now },
    ])
    .onConflictDoNothing()
    .returning();
  if (storeRows.length < 2) throw new Error("Les données d'exemple existent déjà pour ce compte.");
  const storeFor = () => storeRows[rnd() < 0.65 ? 0 : 1].id;

  const make = (carrier: Carrier, shippedAt: Date, extra: Partial<NewShipment> = {}): NewShipment => ({
    userId,
    storeId: storeFor(),
    orderNumber: "#" + (3000 + Math.floor(rnd() * 2500)),
    trackingNumber: tracking(carrier),
    carrier,
    customerName: `${pick(FIRST)} ${pick(LAST)}`,
    city: pick(CITIES),
    weightKg: pick([0.6, 0.9, 1.2, 1.5, 2, 2.5, 3]).toFixed(2),
    shippingCost: shippingFor(carrier).toFixed(2),
    goodsValue: pick([34, 49, 59, 72, 89, 120, 148]).toFixed(2),
    shippedAt,
    status: "in_transit",
    lastCheckedAt: now,
    ...extra,
  });

  const normal: NewShipment[] = [];
  const incident: NewShipment[] = [];

  for (let age = 0; age < 120; age++) {
    for (let k = 0; k < 3 + Math.floor(rnd() * 4); k++) {
      const carrier = wpick(MIX);
      const shippedAt = new Date(now.getTime() - age * DAY - rnd() * DAY);
      const transit = (carrier === "chronopost" ? 12 + rnd() * 10 : 24 + rnd() * 21) * HOUR;
      const deliveredAt = shippedAt.getTime() + transit <= now.getTime() ? new Date(shippedAt.getTime() + transit) : null;
      normal.push(make(carrier, shippedAt, deliveredAt ? { deliveredAt, status: "delivered" } : { lastScanAt: new Date(now.getTime() - rnd() * 12 * HOUR) }));
    }
    if (rnd() < 0.85) {
      const carrier = wpick(MIX);
      const type: ClaimType =
        carrier === "colissimo" ? wpick<ClaimType>([["delay", 62], ["loss", 28], ["damage", 10]]) :
        carrier === "mondial_relay" ? wpick<ClaimType>([["loss", 85], ["damage", 15]]) :
        carrier === "chronopost" ? wpick<ClaimType>([["delay", 80], ["damage", 20]]) : "damage";
      const shippedAt = new Date(now.getTime() - age * DAY - 12 * HOUR - rnd() * 12 * HOUR);
      if (type === "delay") {
        const h = carrier === "colissimo" ? 56 + rnd() * 70 : 28 + rnd() * 50;
        incident.push(make(carrier, shippedAt, { deliveredAt: new Date(shippedAt.getTime() + h * HOUR), status: "delivered" }));
      } else if (type === "loss") {
        incident.push(make(carrier, shippedAt, carrier === "colissimo" ? { lastScanAt: new Date(shippedAt.getTime() + DAY) } : {}));
      } else {
        const deliveredAt = new Date(shippedAt.getTime() + (30 + rnd() * 20) * HOUR);
        incident.push(make(carrier, shippedAt, { deliveredAt, damageReportedAt: new Date(deliveredAt.getTime() + (5 + rnd() * 55) * HOUR), status: "delivered" }));
      }
    }
  }

  await db.insert(shipments).values(normal);
  const insertedIncident = await db.insert(shipments).values(incident).returning();

  // On avance le temps jusqu'au moment où le moteur de détection déclenche réellement.
  const planned: { s: (typeof insertedIncident)[number]; detectedAt: Date; type: ClaimType; amount: number; reason: string; basis: string }[] = [];
  for (const s of insertedIncident) {
    let t = Math.max(s.shippedAt.getTime(), s.deliveredAt?.getTime() ?? 0, s.damageReportedAt?.getTime() ?? 0, s.lastScanAt?.getTime() ?? 0);
    while (t <= now.getTime()) {
      const ev = evaluateShipment(s, rules, new Date(t));
      if (ev.kind === "incident") {
        planned.push({ s, detectedAt: new Date(t), type: ev.incident.type, amount: ev.incident.amount, reason: ev.incident.reason, basis: ev.incident.basis });
        break;
      }
      t += 6 * HOUR;
    }
  }
  planned.sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime());

  const statusFor = (ageDays: number) => {
    const r = rnd();
    if (ageDays <= 1) return r < 0.75 ? "pending" : "submitted";
    if (ageDays <= 8) return r < 0.8 ? "submitted" : r < 0.93 ? "approved" : "rejected";
    if (ageDays <= 25) return r < 0.35 ? "submitted" : r < 0.88 ? "approved" : "rejected";
    return r < 0.86 ? "approved" : "rejected";
  };

  const claimValues = planned.map((p) => {
    const status = statusFor((now.getTime() - p.detectedAt.getTime()) / DAY) as "pending" | "submitted" | "approved" | "rejected";
    const submittedAt = status === "pending" ? null : new Date(Math.min(now.getTime() - 60_000, p.detectedAt.getTime() + (0.5 + rnd() * 3) * HOUR));
    const resolvedAt = status === "approved" || status === "rejected" ? new Date(Math.min(now.getTime(), submittedAt!.getTime() + (1.5 + rnd() * 10) * DAY)) : null;
    return {
      userId,
      storeId: p.s.storeId,
      shipmentId: p.s.id,
      type: p.type,
      amount: p.amount.toFixed(2),
      commission: status === "approved" ? commissionFor(p.amount).toFixed(2) : "0",
      status,
      reason: p.reason,
      compensationBasis: p.basis,
      detectedAt: p.detectedAt,
      submittedAt,
      resolvedAt,
    };
  });

  const insertedClaims = claimValues.length ? await db.insert(claims).values(claimValues).returning({ id: claims.id, shipmentId: claims.shipmentId }) : [];
  const claimOf = new Map(insertedClaims.map((c) => [c.shipmentId, c.id]));
  const carrierOf = new Map(insertedIncident.map((s) => [s.id, s.carrier]));

  const events: (typeof claimEvents.$inferInsert)[] = [];
  for (const v of claimValues) {
    const claimId = claimOf.get(v.shipmentId)!;
    const label = CARRIER_LABELS[carrierOf.get(v.shipmentId)!];
    events.push({ claimId, title: "Anomalie détectée par ParcelGuard", detail: v.reason, occurredAt: v.detectedAt });
    if (v.submittedAt) events.push({ claimId, title: `Réclamation envoyée à ${label}`, detail: null, occurredAt: v.submittedAt });
    if (v.status === "approved") events.push({ claimId, title: "Remboursement accordé", detail: null, occurredAt: v.resolvedAt! });
    if (v.status === "rejected") events.push({ claimId, title: `Réclamation refusée par ${label}`, detail: null, occurredAt: v.resolvedAt! });
  }
  if (events.length) await db.insert(claimEvents).values(events);

  const shipStatus = { delay: "late", loss: "lost", damage: "damaged" } as const;
  for (const type of ["delay", "loss", "damage"] as const) {
    const ids = planned.filter((p) => p.type === type).map((p) => p.s.id);
    for (let i = 0; i < ids.length; i += 500) {
      await db.update(shipments).set({ status: shipStatus[type] }).where(inArray(shipments.id, ids.slice(i, i + 500)));
    }
  }

  const by = (st: string) => claimValues.filter((c) => c.status === st).length;
  return { shipments: normal.length + insertedIncident.length, claims: claimValues.length, pending: by("pending"), submitted: by("submitted"), approved: by("approved"), rejected: by("rejected") };
}
