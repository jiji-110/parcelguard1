import { describe, expect, it } from "vitest";
import { businessDaysBetween, evaluateShipment, type RuleLite, type ShipmentLite } from "../src/lib/detection";
import { commissionFor } from "../src/lib/money";
import { DEFAULT_RULES } from "../src/lib/rules";

const rules: RuleLite[] = DEFAULT_RULES;
const d = (s: string) => new Date(s);

function ship(over: Partial<ShipmentLite>): ShipmentLite {
  return {
    carrier: "colissimo",
    weightKg: "1.50",
    shippingCost: "6.95",
    goodsValue: "89.00",
    shippedAt: d("2026-10-05T08:00:00Z"),
    deliveredAt: null,
    lastScanAt: null,
    damageReportedAt: null,
    ...over,
  };
}

describe("jours ouvrés", () => {
  it("compte du lendemain au jour d'arrivée, week-ends exclus", () => {
    expect(businessDaysBetween(d("2026-10-16T10:00:00Z"), d("2026-10-19T10:00:00Z"))).toBe(1); // vendredi -> lundi
    expect(businessDaysBetween(d("2026-10-12T10:00:00Z"), d("2026-10-19T10:00:00Z"))).toBe(5); // lundi -> lundi
    expect(businessDaysBetween(d("2026-10-17T10:00:00Z"), d("2026-10-18T10:00:00Z"))).toBe(0); // samedi -> dimanche
  });
});

describe("retard", () => {
  it("crée une réclamation au-delà du seuil de 48 h (Colissimo)", () => {
    const r = evaluateShipment(ship({ deliveredAt: d("2026-10-07T20:00:00Z") }), rules, d("2026-10-20T00:00:00Z"));
    expect(r).toEqual({ kind: "incident", incident: { type: "delay", amount: 6.95, reason: "Livré en 60 h, seuil de 48 h dépassé", basis: "Frais de port remboursés (avoir)" } });
  });
  it("ne fait rien à exactement 48 h", () => {
    expect(evaluateShipment(ship({ deliveredAt: d("2026-10-07T08:00:00Z") }), rules, d("2026-10-20T00:00:00Z")).kind).toBe("none");
  });
  it("signale une donnée manquante au lieu d'ignorer le colis", () => {
    const r = evaluateShipment(ship({ carrier: "chronopost", shippingCost: null, deliveredAt: d("2026-10-07T08:00:00Z") }), rules, d("2026-10-20T00:00:00Z"));
    expect(r).toEqual({ kind: "missing_data", type: "delay", field: "shippingCost" });
  });
});

describe("perte", () => {
  it("Colissimo : 6 jours ouvrés sans scan, 23 € par kg", () => {
    const base = ship({ lastScanAt: d("2026-10-05T10:00:00Z") });
    const hit = evaluateShipment(base, rules, d("2026-10-13T10:00:00Z")); // 6 jours ouvrés
    expect(hit).toMatchObject({ kind: "incident", incident: { type: "loss", amount: 34.5, reason: "Aucun scan depuis 6 jours ouvrés" } });
    expect(evaluateShipment(base, rules, d("2026-10-12T10:00:00Z")).kind).toBe("none"); // 5 jours ouvrés
  });
  it("Mondial Relay : forfait de 25 € après 10 jours sans activité", () => {
    const s = ship({ carrier: "mondial_relay" });
    expect(evaluateShipment(s, rules, d("2026-10-16T08:00:00Z"))).toMatchObject({ kind: "incident", incident: { type: "loss", amount: 25, reason: "Aucune activité depuis 11 jours" } });
    expect(evaluateShipment(s, rules, d("2026-10-14T08:00:00Z")).kind).toBe("none");
  });
  it("un colis livré n'est jamais une perte", () => {
    const s = ship({ carrier: "mondial_relay", deliveredAt: d("2026-10-07T08:00:00Z") });
    expect(evaluateShipment(s, rules, d("2026-11-30T08:00:00Z")).kind).toBe("none");
  });
});

describe("avarie", () => {
  const delivered = d("2026-10-07T08:00:00Z");
  it("signalée dans les 72 h : valeur de la marchandise", () => {
    const r = evaluateShipment(ship({ carrier: "dpd", deliveredAt: delivered, damageReportedAt: d("2026-10-08T14:00:00Z") }), rules, d("2026-10-20T00:00:00Z"));
    expect(r).toMatchObject({ kind: "incident", incident: { type: "damage", amount: 89, reason: "Avarie signalée 1 jour après la livraison" } });
  });
  it("signalée trop tard : aucune réclamation", () => {
    expect(evaluateShipment(ship({ carrier: "dpd", deliveredAt: delivered, damageReportedAt: d("2026-10-12T08:00:00Z") }), rules, d("2026-10-20T00:00:00Z")).kind).toBe("none");
  });
  it("l'avarie passe avant le retard", () => {
    const r = evaluateShipment(ship({ deliveredAt: d("2026-10-09T08:00:00Z"), damageReportedAt: d("2026-10-09T20:00:00Z") }), rules, d("2026-10-20T00:00:00Z"));
    expect(r).toMatchObject({ kind: "incident", incident: { type: "damage" } });
  });
});

describe("commission", () => {
  it("25 % arrondis au centime", () => {
    expect(commissionFor(5.95)).toBe(1.49);
    expect(commissionFor("89.00")).toBe(22.25);
    expect(commissionFor(6.95)).toBe(1.74);
    expect(commissionFor(0)).toBe(0);
  });
});
