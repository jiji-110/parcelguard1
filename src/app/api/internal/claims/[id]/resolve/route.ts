import { z } from "zod";
import { getDb } from "../../../../../../db";
import { requireInternalKey } from "../../../../../../lib/auth";
import { resolveClaim } from "../../../../../../lib/claims";
import { handle, idParam, json, readBody } from "../../../../../../lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({ status: z.enum(["approved", "rejected"]), note: z.string().max(500).nullish() });

/** Réponse du transporteur : remboursement accordé ou refusé. Appelé par Make. */
export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  requireInternalKey(req);
  const id = await idParam(ctx);
  const body = await readBody(req, schema);
  await resolveClaim(await getDb(), id, body.status, body.note);
  return json({ ok: true, status: body.status });
});
