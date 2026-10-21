import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db";
import { claimEvents, claims, shipments } from "../db/schema";
import { COMMISSION_RATE } from "./money";
import { HttpError, notFound } from "./http";
import { CARRIER_LABELS } from "./rules";

const eur = (n: number | string) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n));

async function explainFailure(db: Db, id: string, userId: string | null, expected: string): Promise<never> {
  const where = userId ? and(eq(claims.id, id), eq(claims.userId, userId)) : eq(claims.id, id);
  const [c] = await db.select({ status: claims.status }).from(claims).where(where).limit(1);
  if (!c) throw notFound("Réclamation");
  throw new HttpError(409, "invalid_state", `Action impossible : la réclamation est « ${c.status} » alors qu'elle devrait être « ${expected} ».`);
}

/** Passe des réclamations « pending » à « submitted » et trace l'envoi. */
async function submitPending(db: Db, extra: SQL | undefined, now: Date, detail: string | null) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(claims)
      .set({ status: "submitted", submittedAt: now })
      .where(and(eq(claims.status, "pending"), extra))
      .returning({ id: claims.id, shipmentId: claims.shipmentId, amount: claims.amount });
    if (!rows.length) return { count: 0, amount: 0 };
    const ships = await tx
      .select({ id: shipments.id, carrier: shipments.carrier })
      .from(shipments)
      .where(inArray(shipments.id, rows.map((r) => r.shipmentId)));
    const carrierOf = new Map(ships.map((s) => [s.id, s.carrier]));
    await tx.insert(claimEvents).values(
      rows.map((r) => ({
        claimId: r.id,
        title: `Réclamation envoyée à ${CARRIER_LABELS[carrierOf.get(r.shipmentId)!]}`,
        detail,
        occurredAt: now,
      })),
    );
    return { count: rows.length, amount: rows.reduce((s, r) => s + Number(r.amount), 0) };
  });
}

export async function sendClaim(db: Db, userId: string, id: string, now = new Date()) {
  const r = await submitPending(db, and(eq(claims.id, id), eq(claims.userId, userId)), now, null);
  if (r.count === 0) await explainFailure(db, id, userId, "pending");
}

export async function sendAllClaims(db: Db, userId: string, now = new Date()) {
  return submitPending(db, eq(claims.userId, userId), now, null);
}

/** Envoi automatique des réclamations détectées depuis plus de `delayHours` heures. */
export async function autoSendClaims(db: Db, delayHours: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - delayHours * 3_600_000);
  return submitPending(db, sql`${claims.detectedAt} <= ${cutoff.toISOString()}::timestamptz`, now, "Envoi automatique");
}

export async function contestClaim(db: Db, userId: string, id: string, now = new Date()) {
  const ok = await db.transaction(async (tx) => {
    const [c] = await tx
      .update(claims)
      .set({ status: "submitted", submittedAt: now, resolvedAt: null })
      .where(and(eq(claims.id, id), eq(claims.userId, userId), eq(claims.status, "rejected")))
      .returning({ shipmentId: claims.shipmentId });
    if (!c) return false;
    const [s] = await tx.select({ carrier: shipments.carrier }).from(shipments).where(eq(shipments.id, c.shipmentId));
    await tx.insert(claimEvents).values({ claimId: id, title: `Contestation envoyée à ${CARRIER_LABELS[s.carrier]}`, occurredAt: now });
    return true;
  });
  if (!ok) await explainFailure(db, id, userId, "rejected");
}

/**
 * Enregistre la réponse du transporteur (appelé par l'automatisation).
 * La commission de 25 % n'est calculée que sur un remboursement accordé.
 */
export async function resolveClaim(db: Db, id: string, status: "approved" | "rejected", note?: string | null, now = new Date()) {
  const ok = await db.transaction(async (tx) => {
    const commission = status === "approved" ? sql`round(${claims.amount} * ${sql.raw(String(COMMISSION_RATE))}, 2)` : sql`0`;
    const [c] = await tx
      .update(claims)
      .set({ status, resolvedAt: now, commission })
      .where(and(eq(claims.id, id), eq(claims.status, "submitted")))
      .returning({ shipmentId: claims.shipmentId, amount: claims.amount });
    if (!c) return false;
    const [s] = await tx.select({ carrier: shipments.carrier }).from(shipments).where(eq(shipments.id, c.shipmentId));
    await tx.insert(claimEvents).values(
      status === "approved"
        ? { claimId: id, title: "Remboursement accordé", detail: note ?? eur(c.amount), occurredAt: now }
        : { claimId: id, title: `Réclamation refusée par ${CARRIER_LABELS[s.carrier]}`, detail: note ?? null, occurredAt: now },
    );
    return true;
  });
  if (!ok) await explainFailure(db, id, null, "submitted");
}
