import { and, eq, gte } from "drizzle-orm";
import type { Db } from "../db";
import { claims, shipments, CARRIERS } from "../db/schema";
import { commissionFor, round2 } from "./money";

const TZ = "Europe/Paris";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export const PERIOD_DAYS = [30, 90, 180] as const;

/**
 * Chiffres du tableau de bord. La période compte des jours calendaires (fuseau Paris),
 * aujourd'hui inclus, et rattache chaque réclamation au jour de sa détection.
 */
export async function buildDashboard(db: Db, userId: string, days: number, now = new Date()) {
  const [y, m, d] = dayKey(now).split("-").map(Number);
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  const fromKey = keys[0];
  const margin = new Date(Date.UTC(y, m - 1, d - days - 1));

  const rows = await db
    .select({ c: claims, carrier: shipments.carrier })
    .from(claims)
    .innerJoin(shipments, eq(shipments.id, claims.shipmentId))
    .where(and(eq(claims.userId, userId), gte(claims.detectedAt, margin)));

  const inPeriod = rows.filter((r) => dayKey(r.c.detectedAt) >= fromKey);
  const approved = inPeriod.filter((r) => r.c.status === "approved");
  const rejected = inPeriod.filter((r) => r.c.status === "rejected");
  const open = inPeriod.filter((r) => r.c.status === "pending" || r.c.status === "submitted");

  const sum = (list: typeof rows, f: (r: (typeof rows)[number]) => number) => round2(list.reduce((s, r) => s + f(r), 0));
  const approvedAmount = sum(approved, (r) => Number(r.c.amount));
  const commission = sum(approved, (r) => Number(r.c.commission));
  const resolved = approved.length + rejected.length;

  const answered = inPeriod.filter((r) => r.c.resolvedAt && r.c.submittedAt);
  const avgDays = answered.length
    ? answered.reduce((s, r) => s + (r.c.resolvedAt!.getTime() - r.c.submittedAt!.getTime()), 0) / answered.length / 86_400_000
    : null;

  const perDay = new Map<string, number>();
  for (const r of approved) {
    const k = dayKey(r.c.detectedAt);
    perDay.set(k, (perDay.get(k) ?? 0) + Number(r.c.amount));
  }
  let run = 0;
  const dailyCumulative = keys.map((date) => {
    run += perDay.get(date) ?? 0;
    return { date, cumulative: round2(run) };
  });

  const byCarrier = CARRIERS.map((carrier) => {
    const l = inPeriod.filter((r) => r.carrier === carrier);
    const ap = l.filter((r) => r.c.status === "approved");
    const rj = l.filter((r) => r.c.status === "rejected");
    return {
      carrier,
      incidents: l.length,
      approvedCount: ap.length,
      rejectedCount: rj.length,
      acceptanceRate: ap.length + rj.length ? ap.length / (ap.length + rj.length) : null,
      approvedAmount: sum(ap, (r) => Number(r.c.amount)),
    };
  }).sort((a, b) => b.incidents - a.incidents);

  // « À traiter » ne dépend pas de la période : ce sont toutes les réclamations en attente d'envoi.
  const pending = rows.filter((r) => r.c.status === "pending");

  return {
    period: { days, from: fromKey, to: keys[days - 1] },
    totals: {
      incidentCount: inPeriod.length,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      approvedAmount,
      commission,
      netPaid: round2(approvedAmount - commission),
      pendingAmount: sum(open, (r) => Number(r.c.amount)),
      pendingCount: open.length,
      acceptanceRate: resolved ? approved.length / resolved : null,
      averageResponseDays: avgDays === null ? null : Math.round(avgDays * 10) / 10,
    },
    dailyCumulative,
    byCarrier,
    toSend: { count: pending.length, amount: sum(pending, (r) => Number(r.c.amount)), potentialCommission: round2(pending.reduce((s, r) => s + commissionFor(r.c.amount), 0)) },
  };
}
