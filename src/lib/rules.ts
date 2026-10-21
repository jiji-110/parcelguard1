import type { CarrierRule } from "../db/schema";

export type RuleSeed = Omit<CarrierRule, "id">;

/**
 * Règles d'indemnisation par défaut. Elles sont copiées dans la table carrier_rules
 * au premier lancement, puis modifiables en base sans toucher au code.
 *
 * ATTENTION : seuils et montants à vérifier dans les conditions générales de chaque
 * transporteur avant la mise en production. Ce sont des valeurs de départ.
 */
export const DEFAULT_RULES: RuleSeed[] = [
  { carrier: "colissimo", incidentType: "delay", thresholdValue: 48, thresholdUnit: "hours", compensationType: "shipping_cost", compensationValue: "0", basisLabel: "Frais de port remboursés (avoir)", active: true },
  { carrier: "colissimo", incidentType: "loss", thresholdValue: 6, thresholdUnit: "business_days", compensationType: "per_kg", compensationValue: "23", basisLabel: "23 € par kg déclaré", active: true },
  { carrier: "colissimo", incidentType: "damage", thresholdValue: 72, thresholdUnit: "hours", compensationType: "goods_value", compensationValue: "0", basisLabel: "Valeur de la marchandise sur facture", active: true },
  { carrier: "mondial_relay", incidentType: "loss", thresholdValue: 240, thresholdUnit: "hours", compensationType: "fixed", compensationValue: "25", basisLabel: "Forfait de 25,00 € TTC par colis", active: true },
  { carrier: "mondial_relay", incidentType: "damage", thresholdValue: 72, thresholdUnit: "hours", compensationType: "goods_value", compensationValue: "0", basisLabel: "Valeur de la marchandise sur facture", active: true },
  { carrier: "chronopost", incidentType: "delay", thresholdValue: 24, thresholdUnit: "hours", compensationType: "shipping_cost", compensationValue: "0", basisLabel: "Transport remboursé en intégralité", active: true },
  { carrier: "chronopost", incidentType: "damage", thresholdValue: 72, thresholdUnit: "hours", compensationType: "goods_value", compensationValue: "0", basisLabel: "Valeur de la marchandise sur facture", active: true },
  { carrier: "dpd", incidentType: "damage", thresholdValue: 72, thresholdUnit: "hours", compensationType: "goods_value", compensationValue: "0", basisLabel: "Valeur de la marchandise sur facture", active: true },
];

export const CARRIER_LABELS: Record<string, string> = {
  colissimo: "Colissimo",
  mondial_relay: "Mondial Relay",
  chronopost: "Chronopost",
  dpd: "DPD",
};
