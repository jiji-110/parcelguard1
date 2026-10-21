import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { claimEvents, claims, shipments, stores } from "../../../../db/schema";
import { requireUser } from "../../../../lib/auth";
import { handle, idParam, json, notFound } from "../../../../lib/http";
import { CARRIER_LABELS } from "../../../../lib/rules";
import { serializeClaim } from "../../../../lib/serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, ctx) => {
  const user = await requireUser(req);
  const id = await idParam(ctx);
  const db = await getDb();

  const [row] = await db
    .select({ c: claims, s: shipments, storeName: stores.name })
    .from(claims)
    .innerJoin(shipments, eq(shipments.id, claims.shipmentId))
    .innerJoin(stores, eq(stores.id, claims.storeId))
    .where(and(eq(claims.id, id), eq(claims.userId, user.id)))
    .limit(1);
  if (!row) throw notFound("Réclamation");

  const events = await db.select().from(claimEvents).where(eq(claimEvents.claimId, id)).orderBy(asc(claimEvents.occurredAt));
  const { s } = row;

  // Historique complet : étapes du colis (dates connues) puis étapes de la réclamation.
  const timeline: { at: Date; title: string; detail: string | null }[] = [
    { at: s.shippedAt, title: `Colis remis à ${CARRIER_LABELS[s.carrier]}`, detail: `Commande ${s.orderNumber}` },
  ];
  if (s.lastScanAt && !s.deliveredAt) timeline.push({ at: s.lastScanAt, title: "Dernier scan du colis", detail: null });
  if (s.deliveredAt) timeline.push({ at: s.deliveredAt, title: "Colis livré", detail: null });
  if (s.damageReportedAt) timeline.push({ at: s.damageReportedAt, title: "Avarie signalée", detail: null });
  for (const e of events) timeline.push({ at: e.occurredAt, title: e.title, detail: e.detail });
  timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

  const delayHours = Number(process.env.AUTO_SEND_DELAY_HOURS) || 6;
  return json({
    claim: serializeClaim(row.c, s, row.storeName),
    timeline,
    autoSendAt: row.c.status === "pending" ? new Date(row.c.detectedAt.getTime() + delayHours * 3_600_000) : null,
  });
});
