import { getDb } from "../../../../../db";
import { requireUser } from "../../../../../lib/auth";
import { sendClaim } from "../../../../../lib/claims";
import { handle, idParam, json } from "../../../../../lib/http";

export const dynamic = "force-dynamic";

export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const user = await requireUser(req);
  await sendClaim(await getDb(), user.id, await idParam(ctx));
  return json({ ok: true, status: "submitted" });
});
