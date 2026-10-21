import { and, count, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { claims, stores } from "../../../../db/schema";
import { requireUser } from "../../../../lib/auth";
import { HttpError, handle, idParam, json, notFound } from "../../../../lib/http";

export const dynamic = "force-dynamic";

export const DELETE = handle<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const user = await requireUser(req);
  const id = await idParam(ctx);
  const db = await getDb();
  const [s] = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.id, id), eq(stores.userId, user.id))).limit(1);
  if (!s) throw notFound("Boutique");
  // Supprimer une boutique effacerait aussi l'historique de ses réclamations et de ses gains.
  const [{ n }] = await db.select({ n: count() }).from(claims).where(eq(claims.storeId, id));
  if (n > 0) throw new HttpError(409, "store_has_claims", "Cette boutique a des réclamations : elle ne peut pas être supprimée sans perdre l'historique.");
  await db.delete(stores).where(eq(stores.id, id));
  return json({ ok: true });
});
