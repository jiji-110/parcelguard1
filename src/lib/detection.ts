import type { CarrierRule, Shipment, ClaimType } from "../db/schema";
import { num, round2 } from "./money";

/**
 * Cœur métier : décide si un colis donne droit à une indemnisation.
 * Fonctions pures, sans base de données, faciles à tester.
 */

export type RuleLite = Pick<
  CarrierRule,
  "carrier" | "incidentType" | "thresholdValue" | "thresholdUnit" | "compensationType" | "compensationValue" | "basisLabel" | "active"
>;
export type ShipmentLite = Pick<
  Shipment,
  "carrier" | "weightKg" | "shippingCost" | "goodsValue" | "shippedAt" | "deliveredAt" | "lastScanAt" | "damageReportedAt"
>;

export interface Incident {
  type: ClaimType;
  amount: number;
  reason: string;
  basis: string;
}

export type Evaluation =
  | { kind: "none" }
  | { kind: "incident"; incident: Incident }
  // Le colis est éligible mais il manque une donnée pour calculer le montant.
  | { kind: "missing_data"; type: ClaimType; field: "shippingCost" | "weightKg" | "goodsValue" };

const HOUR = 3_600_000;
const TZ = "Europe/Paris";

function localYmd(d: Date): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("-");
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Jours ouvrés (lundi à vendredi) écoulés entre deux dates, jours fériés non pris en compte. */
export function businessDaysBetween(from: Date, to: Date): number {
  const [fy, fm, fd] = localYmd(from);
  const [ty, tm, td] = localYmd(to);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  let count = 0;
  for (let t = start + 86_400_000; t <= end; t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function elapsed(rule: RuleLite, from: Date, to: Date): number {
  return rule.thresholdUnit === "business_days" ? businessDaysBetween(from, to) : (to.getTime() - from.getTime()) / HOUR;
}

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;

function fmtDuration(value: number, unit: RuleLite["thresholdUnit"], preferDays: boolean): string {
  if (unit === "business_days") return plural(Math.round(value), "jour") + (Math.round(value) > 1 ? " ouvrés" : " ouvré");
  if (preferDays && value >= 48) return plural(Math.round(value / 24), "jour");
  return `${Math.round(value)} h`;
}

function findRule(rules: RuleLite[], carrier: string, type: ClaimType): RuleLite | undefined {
  return rules.find((r) => r.active && r.carrier === carrier && r.incidentType === type);
}

function compute(rule: RuleLite, s: ShipmentLite, type: ClaimType): Evaluation {
  let amount: number | null = null;
  switch (rule.compensationType) {
    case "shipping_cost": {
      const v = num(s.shippingCost);
      if (v === null) return { kind: "missing_data", type, field: "shippingCost" };
      amount = v;
      break;
    }
    case "per_kg": {
      const w = num(s.weightKg);
      if (w === null) return { kind: "missing_data", type, field: "weightKg" };
      amount = w * Number(rule.compensationValue);
      break;
    }
    case "fixed":
      amount = Number(rule.compensationValue);
      break;
    case "goods_value": {
      const v = num(s.goodsValue);
      if (v === null) return { kind: "missing_data", type, field: "goodsValue" };
      amount = v;
      break;
    }
  }
  amount = round2(amount);
  if (amount <= 0) return { kind: "none" };
  return { kind: "incident", incident: { type, amount, reason: "", basis: rule.basisLabel } };
}

/**
 * Évalue un colis qui n'a pas encore de réclamation.
 * Priorité : avarie, puis perte, puis retard. Une seule réclamation par colis.
 */
export function evaluateShipment(s: ShipmentLite, rules: RuleLite[], now: Date): Evaluation {
  // 1. Avarie signalée dans le délai autorisé après la livraison
  if (s.damageReportedAt) {
    const rule = findRule(rules, s.carrier, "damage");
    if (rule) {
      const ref = s.deliveredAt ?? s.damageReportedAt;
      const since = elapsed(rule, ref, s.damageReportedAt);
      if (since <= rule.thresholdValue) {
        const res = compute(rule, s, "damage");
        if (res.kind === "incident") {
          const when = rule.thresholdUnit === "business_days" ? fmtDuration(since, rule.thresholdUnit, false) : since < 24 ? `${Math.max(1, Math.round(since))} h` : plural(Math.round(since / 24), "jour");
          res.incident.reason = s.deliveredAt ? `Avarie signalée ${when} après la livraison` : "Avarie signalée par le destinataire";
        }
        if (res.kind !== "none") return res;
      }
    }
  }

  // 2. Perte : colis non livré, sans scan depuis trop longtemps
  if (!s.deliveredAt) {
    const rule = findRule(rules, s.carrier, "loss");
    if (rule) {
      const ref = s.lastScanAt ?? s.shippedAt;
      const since = elapsed(rule, ref, now);
      if (since >= rule.thresholdValue) {
        const res = compute(rule, s, "loss");
        if (res.kind === "incident") {
          const dur = fmtDuration(since, rule.thresholdUnit, true);
          res.incident.reason = s.lastScanAt ? `Aucun scan depuis ${dur}` : `Aucune activité depuis ${dur}`;
        }
        if (res.kind !== "none") return res;
      }
    }
    return { kind: "none" };
  }

  // 3. Retard : livré après le délai garanti
  const rule = findRule(rules, s.carrier, "delay");
  if (rule) {
    const transit = elapsed(rule, s.shippedAt, s.deliveredAt);
    if (transit > rule.thresholdValue) {
      const res = compute(rule, s, "delay");
      if (res.kind === "incident") {
        res.incident.reason = `Livré en ${fmtDuration(transit, rule.thresholdUnit, false)}, seuil de ${fmtDuration(rule.thresholdValue, rule.thresholdUnit, false)} dépassé`;
      }
      return res;
    }
  }
  return { kind: "none" };
}
