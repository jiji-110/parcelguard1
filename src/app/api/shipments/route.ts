import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../db";
import { CARRIERS, claims, shipments, stores } from "../../../db/schema";
import { requireUser } from "../../../lib/auth";
import { handle, json, likePattern, parseQuery } from "../../../lib/http";
import { serializeShipment } from "../../../lib/serialize";

export const dynamic = "force-dynamic";

const ISSUES = ["late", "lost", "damaged"] as const;

const query = z.object({
  status: z.enum(["all", "in_transit", "delivered", "issues"]).default("all"),
  carrier: z.enum(CARRIERS).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { status, carrier, q, page, perPage } = parseQuery(req, query);
  const db = await getDb();

  const filters = [eq(shipments.userId, user.id)];
  if (status === "in_transit" || status === "delivered") filters.push(eq(shipments.status, status));
  if (status === "issues") filters.push(inArray(shipments.status, [...ISSUES]));
  if (carrier) filters.push(eq(shipments.carrier, carrier));
  if (q) {
    const p = likePattern(q);
    filters.push(or(ilike(shipments.trackingNumber, p), ilike(shipments.customerName, p), ilike(shipments.city, p), ilike(shipments.orderNumber, p))!);
  }
  const where = and(...filters);

  const [rows, [{ total }], grouped] = await Promise.all([
    db
      .select({ s: shipments, storeName: stores.name, claimId: claims.id, claimNumber: claims.number, claimStatus: claims.status })
      .from(shipments)
      .innerJoin(stores, eq(stores.id, shipments.storeId))
      .leftJoin(claims, eq(claims.shipmentId, shipments.id))
      .where(where)
      .orderBy(desc(shipments.shippedAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ total: count() }).from(shipments).where(where),
    db.select({ status: shipments.status, n: count() }).from(shipments).where(eq(shipments.userId, user.id)).groupBy(shipments.status),
  ]);

  const counts = { all: 0, in_transit: 0, delivered: 0, issues: 0 };
  for (const g of grouped) {
    counts.all += g.n;
    if (g.status === "in_transit" || g.status === "delivered") counts[g.status] = g.n;
    else counts.issues += g.n;
  }

  return json({
    items: rows.map((r) => serializeShipment(r.s, r.storeName, r.claimId ? { id: r.claimId, number: r.claimNumber!, status: r.claimStatus! } : null)),
    page,
    perPage,
    total,
    counts,
  });
});
