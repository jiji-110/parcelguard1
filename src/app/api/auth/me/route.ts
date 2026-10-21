import { requireUser } from "../../../../lib/auth";
import { handle, json } from "../../../../lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => json({ user: await requireUser(req) }));
