import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ensureDefaultRules, type Db } from "../db";
import { carrierRules, claimEvents, claims, shipments, type ClaimType } from "../db/schema";
import { autoSendClaims } from "./claims";
import { evaluateShipment } from "./detection";

export interface DetectionSummary {
  scanned: number;
  created: number;
  missingData: number;
  autoSent: number;
}

const STATUS_FOR: Record<ClaimType, "late" | "lost" | "damaged"> = { delay: "late", loss: "lost", damage: "damaged" };

/**
 * Passe en revue les colis sans réclamation, crée les réclamations dues,
 * puis envoie automatiquement celles qui attendent depuis assez longtemps.
 * Peut être relancée sans risque : un colis n'a jamais plus d'une réclamation.
 */
export async function runDetection(
  db: Db,
  opts: { now?: Date; autoSendDelayHours?: number; batchSize?: number } = {},
): Promise<DetectionSummary> {
  const now = opts.now ?? new Date();
  const batch = opts.batchSize ?? 2000;
  await ensureDefaultRules(db);
  const rules = await db.select().from(carrierRules);

  const candidates = await db
    .select({ s: shipments })
    .from(shipments)
    .leftJoin(claims, eq(claims.shipmentId, shipments.id))
    .where(and(isNull(claims.id), inArray(shipments.status, ["in_transit", "delivered"])))
    .orderBy(sql`${shipments.lastCheckedAt} asc nulls first`)
    .limit(batch);

  let created = 0;
  let missingData = 0;

  for (const { s } of candidates) {
    const ev = evaluateShipment(s, rules, now);
    if (ev.kind === "missing_data") missingData++;
    if (ev.kind !== "incident") continue;
    const { incident } = ev;
    const made = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(claims)
        .values({
          userId: s.userId,
          storeId: s.storeId,
          shipmentId: s.id,
          type: incident.type,
          amount: incident.amount.toFixed(2),
          status: "pending",
          reason: incident.reason,
          compensationBasis: incident.basis,
          detectedAt: now,
        })
        .onConflictDoNothing({ target: claims.shipmentId })
        .returning({ id: claims.id });
      if (!c) return false;
      await tx.insert(claimEvents).values({ claimId: c.id, title: "Anomalie détectée par ParcelGuard", detail: incident.reason, occurredAt: now });
      await tx.update(shipments).set({ status: STATUS_FOR[incident.type] }).where(eq(shipments.id, s.id));
      return true;
    });
    if (made) created++;
  }

  if (candidates.length) {
    await db.update(shipments).set({ lastCheckedAt: now }).where(inArray(shipments.id, candidates.map((c) => c.s.id)));
  }

  const auto = await autoSendClaims(db, opts.autoSendDelayHours ?? 6, now);
  return { scanned: candidates.length, created, missingData, autoSent: auto.count };
}
