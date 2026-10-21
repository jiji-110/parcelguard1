import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../db";
import { claims, PLATFORMS, shipments, stores } from "../../../db/schema";
import { requireUser } from "../../../lib/auth";
import { encryptToken } from "../../../lib/crypto";
import { HttpError, handle, json, readBody } from "../../../lib/http";
import { serializeStore } from "../../../lib/serialize";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  const [list, shipCounts, claimCounts] = await Promise.all([
    db.select().from(stores).where(eq(stores.userId, user.id)).orderBy(stores.createdAt),
    db.select({ id: shipments.storeId, n: count() }).from(shipments).where(eq(shipments.userId, user.id)).groupBy(shipments.storeId),
    db.select({ id: claims.storeId, n: count() }).from(claims).where(eq(claims.userId, user.id)).groupBy(claims.storeId),
  ]);
  const sc = new Map(shipCounts.map((r) => [r.id, r.n]));
  const cc = new Map(claimCounts.map((r) => [r.id, r.n]));
  return json({ items: list.map((s) => serializeStore(s, { shipments: sc.get(s.id) ?? 0, incidents: cc.get(s.id) ?? 0 })) });
});

const schema = z.object({
  platform: z.enum(PLATFORMS),
  url: z.string().trim().min(3).max(200),
  name: z.string().trim().min(1).max(100).optional(),
  accessToken: z.string().min(1).max(4000).optional(),
});

const normalizeUrl = (u: string) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await readBody(req, schema);
  const url = normalizeUrl(body.url);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+/.test(url)) throw new HttpError(400, "invalid_url", "Adresse de boutique invalide, par exemple ma-boutique.myshopify.com.");
  const base = url.split(/[./]/)[0].replace(/-/g, " ");

  const db = await getDb();
  const [store] = await db
    .insert(stores)
    .values({
      userId: user.id,
      platform: body.platform,
      url,
      name: body.name ?? base.charAt(0).toUpperCase() + base.slice(1),
      accessToken: body.accessToken ? encryptToken(body.accessToken) : null,
      status: "syncing",
    })
    .onConflictDoNothing({ target: [stores.userId, stores.url] })
    .returning();
  if (!store) throw new HttpError(409, "store_exists", "Cette boutique est déjà connectée.");
  return json({ store: serializeStore(store, { shipments: 0, incidents: 0 }) }, 201);
});
