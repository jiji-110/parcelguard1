import { count, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { stores } from "../../../db/schema";
import { requireUser } from "../../../lib/auth";
import { seedDemoData, removeDemoData } from "../../../lib/demo";
import { HttpError, handle, json } from "../../../lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Charge des données d'exemple dans un compte vide, pour essayer l'application sans rien connecter.
export const POST = handle(async (req) => {
  if (process.env.DEMO_ENABLED === "false") throw new HttpError(403, "demo_disabled", "Les données d'exemple sont désactivées.");
  const user = await requireUser(req);
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(stores).where(eq(stores.userId, user.id));
  if (n > 0) throw new HttpError(409, "not_empty", "Les données d'exemple ne se chargent que dans un compte sans boutique.");
  return json({ ok: true, ...(await seedDemoData(db, user.id)) }, 201);
});

// Retire uniquement les boutiques d'exemple (adresse en .demo), jamais les vraies données.
export const DELETE = handle(async (req) => {
  const user = await requireUser(req);
  return json({ ok: true, removedStores: await removeDemoData(await getDb(), user.id) });
});
