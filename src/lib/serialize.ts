import type { Claim, Shipment, Store } from "../db/schema";
import { commissionFor, num, round2 } from "./money";

export const claimRef = (number: number) => `R-${number}`;

type ShipmentView = Pick<Shipment, "id" | "trackingNumber" | "carrier" | "customerName" | "city" | "orderNumber" | "status" | "shippedAt" | "deliveredAt">;

export function serializeClaim(c: Claim, s: ShipmentView, storeName: string) {
  const amount = Number(c.amount);
  const commission = Number(c.commission);
  // Montant net pour le marchand : réel si remboursé, nul si refusé, estimé sinon.
  const netToMerchant = c.status === "approved" ? round2(amount - commission) : c.status === "rejected" ? 0 : round2(amount - commissionFor(amount));
  return {
    id: c.id,
    ref: claimRef(c.number),
    type: c.type,
    status: c.status,
    amount,
    commission,
    netToMerchant,
    reason: c.reason,
    compensationBasis: c.compensationBasis,
    detectedAt: c.detectedAt,
    submittedAt: c.submittedAt,
    resolvedAt: c.resolvedAt,
    store: storeName,
    shipment: {
      id: s.id,
      trackingNumber: s.trackingNumber,
      carrier: s.carrier,
      customerName: s.customerName,
      city: s.city,
      orderNumber: s.orderNumber,
      status: s.status,
      shippedAt: s.shippedAt,
      deliveredAt: s.deliveredAt,
    },
  };
}

export function serializeShipment(s: Shipment, storeName: string, claim: { id: string; number: number; status: string } | null) {
  return {
    id: s.id,
    trackingNumber: s.trackingNumber,
    orderNumber: s.orderNumber,
    carrier: s.carrier,
    customerName: s.customerName,
    city: s.city,
    weightKg: num(s.weightKg),
    shippingCost: num(s.shippingCost),
    goodsValue: num(s.goodsValue),
    shippedAt: s.shippedAt,
    deliveredAt: s.deliveredAt,
    lastScanAt: s.lastScanAt,
    status: s.status,
    store: storeName,
    claim: claim ? { id: claim.id, ref: claimRef(claim.number), status: claim.status } : null,
  };
}

/** Jamais de jeton d'accès dans les réponses. */
export function serializeStore(s: Store, counts: { shipments: number; incidents: number }) {
  return {
    id: s.id,
    platform: s.platform,
    name: s.name,
    url: s.url,
    status: s.status,
    lastSyncAt: s.lastSyncAt,
    createdAt: s.createdAt,
    shipmentCount: counts.shipments,
    incidentCount: counts.incidents,
  };
}
