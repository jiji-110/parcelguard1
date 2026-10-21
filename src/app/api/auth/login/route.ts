import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { createSessionToken, sessionCookie, verifyPassword } from "../../../../lib/auth";
import { HttpError, handle, json, readBody } from "../../../../lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1).max(200) });

// Hash factice : le temps de réponse ne révèle pas si l'adresse existe.
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.v0Zf3b5bXv6bZ1wZ6u0j7k8sQe3a";

export const POST = handle(async (req) => {
  const body = await readBody(req, schema);
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  const ok = await verifyPassword(body.password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, "invalid_credentials", "E-mail ou mot de passe incorrect.");
  return json({ user: { id: u.id, email: u.email, name: u.name } }, 200, { "Set-Cookie": sessionCookie(await createSessionToken(u.id)) });
});
