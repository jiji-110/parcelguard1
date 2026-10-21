import { and, count, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../db";
import { claims, shipments, stores } from "../../../db/schema";
import { requireUser } from "../../../lib/auth";
import { handle, json, likePattern, parseQuery } from "../../../lib/http";
import { serializeClaim } from "../../../lib/serialize";

export const dynamic = "force-dynamic";

const query = z.object({
  status: z.enum(["all", "pending", "submitted", "approved", "rejected", "todo"]).default("all"),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(30),
});

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { status, q, page, perPage } = parseQuery(req, query);
  const db = await getDb();

  const filters = [eq(claims.userId, user.id)];
  if (status === "todo") {
    // À traiter : à envoyer, ou refusées depuis moins de 21 jours (donc encore contestables).
    const since = new Date(Date.now() - 21 * 86_400_000);
    filters.push(or(eq(claims.status, "pending"), and(eq(claims.status, "rejected"), gte(claims.resolvedAt, since)))!);
  } else if (status !== "all") {
    filters.push(eq(claims.status, status));
  }
  if (q) {
    const p = likePattern(q);
    filters.push(
      or(
        ilike(shipments.trackingNumber, p),
        ilike(shipments.customerName, p),
        ilike(shipments.city, p),
        ilike(shipments.orderNumber, p),
        sql`('R-' || ${claims.number}::text) ilike ${p}`,
      )!,
    );
  }
  const where = and(...filters);

  const [rows, [{ total }], grouped] = await Promise.all([
    db
      .select({ c: claims, s: shipments, storeName: stores.name })
      .from(claims)
      .innerJoin(shipments, eq(shipments.id, claims.shipmentId))
      .innerJoin(stores, eq(stores.id, claims.storeId))
      .where(where)
      .orderBy(desc(claims.detectedAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ total: count() }).from(claims).innerJoin(shipments, eq(shipments.id, claims.shipmentId)).where(where),
    db.select({ status: claims.status, n: count() }).from(claims).where(eq(claims.userId, user.id)).groupBy(claims.status),
  ]);

  const counts = { all: 0, pending: 0, submitted: 0, approved: 0, rejected: 0 };
  for (const g of grouped) {
    counts[g.status] = g.n;
    counts.all += g.n;
  }

  return json({
    items: rows.map((r) => serializeClaim(r.c, r.s, r.storeName)),
    page,
    perPage,
    total,
    counts,
  });
});
