import { getDb } from "../../../../db";
import { requireUser } from "../../../../lib/auth";
import { sendAllClaims } from "../../../../lib/claims";
import { handle, json } from "../../../../lib/http";

export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const r = await sendAllClaims(await getDb(), user.id);
  return json({ ok: true, sent: r.count, amount: r.amount });
});
