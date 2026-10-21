import { z } from "zod";
import { getDb } from "../../../db";
import { requireUser } from "../../../lib/auth";
import { buildDashboard, PERIOD_DAYS } from "../../../lib/dashboard";
import { handle, json, parseQuery } from "../../../lib/http";

export const dynamic = "force-dynamic";

const query = z.object({
  days: z.coerce.number().refine((n) => (PERIOD_DAYS as readonly number[]).includes(n), "Valeurs possibles : 30, 90 ou 180").default(30),
});

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { days } = parseQuery(req, query);
  return json(await buildDashboard(await getDb(), user.id, days));
});
