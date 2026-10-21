import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../../db";
import { CARRIERS, shipments, stores } from "../../../../db/schema";
import { requireInternalKey } from "../../../../lib/auth";
import { HttpError, handle, json, readBody } from "../../../../lib/http";

export const dynamic = "force-dynamic";

const money = z.coerce.number().nonnegative().nullish();
const date = z.coerce.date().nullish();

const item = z.object({
  storeId: z.uuid(),
  orderNumber: z.string().min(1),
  trackingNumber: z.string().min(3),
  carrier: z.enum(CARRIERS),
  customerName: z.string().min(1),
  city: z.string().min(1),
  weightKg: money,
  shippingCost: money,
  goodsValue: money,
  shippedAt: z.coerce.date(),
  deliveredAt: date,
  lastScanAt: date,
  damageReportedAt: date,
  status: z.enum(["in_transit", "delivered"]).optional(),
});
const payload = z.union([z.object({ shipments: z.array(item).min(1).max(200) }), item]);

const str = (v: number | null | undefined) => (v === null || v === undefined ? v : v.toFixed(2));

/**
 * Création ou mise à jour de colis, appelée par Make.
 * Un objet seul ou { shipments: [...] } (200 maximum). Clé d'unicité : transporteur + numéro de suivi.
 * Champ absent = valeur conservée. Champ à null = valeur effacée.
 */
export const POST = handle(async (req) => {
  requireInternalKey(req);
  const parsed = await readBody(req, payload);
  const list = "shipments" in parsed ? parsed.shipments : [parsed];
  const db = await getDb();

  const storeIds = [...new Set(list.map((i) => i.storeId))];
  const owners = await db.select({ id: stores.id, userId: stores.userId }).from(stores).where(inArray(stores.id, storeIds));
  const ownerOf = new Map(owners.map((o) => [o.id, o.userId]));
  const missing = storeIds.filter((id) => !ownerOf.has(id));
  if (missing.length) throw new HttpError(404, "store_not_found", `Boutique(s) introuvable(s) : ${missing.join(", ")}`);

  let upserted = 0;
  const conflicts: string[] = [];
  for (const i of list) {
    const userId = ownerOf.get(i.storeId)!;
    const status = i.status ?? (i.deliveredAt ? "delivered" : undefined);
    const optional = {
      weightKg: str(i.weightKg),
      shippingCost: str(i.shippingCost),
      goodsValue: str(i.goodsValue),
      deliveredAt: i.deliveredAt,
      lastScanAt: i.lastScanAt,
      damageReportedAt: i.damageReportedAt,
    };
    const provided = Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined));

    const rows = await db
      .insert(shipments)
      .values({
        userId,
        storeId: i.storeId,
        orderNumber: i.orderNumber,
        trackingNumber: i.trackingNumber,
        carrier: i.carrier,
        customerName: i.customerName,
        city: i.city,
        shippedAt: i.shippedAt,
        status: status ?? "in_transit",
        ...provided,
      })
      .onConflictDoUpdate({
        target: [shipments.carrier, shipments.trackingNumber],
        set: {
          orderNumber: i.orderNumber,
          customerName: i.customerName,
          city: i.city,
          shippedAt: i.shippedAt,
          ...provided,
          // Un colis déjà en anomalie (retard, perte, avarie) garde son statut.
          ...(status
            ? { status: sql`CASE WHEN ${shipments.status} IN ('late','lost','damaged') THEN ${shipments.status} ELSE ${sql.raw(`'${status}'`)}::shipment_status END` }
            : {}),
        },
        setWhere: eq(shipments.userId, userId),
      })
      .returning({ id: shipments.id });
    if (rows.length) upserted++;
    else conflicts.push(`${i.carrier}:${i.trackingNumber}`);
  }

  const now = new Date();
  await db.update(stores).set({ lastSyncAt: now, status: "connected" }).where(inArray(stores.id, storeIds));
  return json({ upserted, conflicts }, conflicts.length && !upserted ? 409 : 200);
});
