import { z } from "zod";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { createSessionToken, hashPassword, sessionCookie } from "../../../../lib/auth";
import { HttpError, handle, json, readBody } from "../../../../lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8, "8 caractères minimum").max(200),
  name: z.string().trim().min(1).max(100),
});

export const POST = handle(async (req) => {
  const body = await readBody(req, schema);
  const db = await getDb();
  const [user] = await db
    .insert(users)
    .values({ email: body.email, name: body.name, passwordHash: await hashPassword(body.password) })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id, email: users.email, name: users.name });
  if (!user) throw new HttpError(409, "email_taken", "Un compte existe déjà avec cette adresse e-mail.");
  return json({ user }, 201, { "Set-Cookie": sessionCookie(await createSessionToken(user.id)) });
});
