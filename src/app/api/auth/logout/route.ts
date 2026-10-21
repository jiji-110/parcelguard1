import { clearedSessionCookie } from "../../../../lib/auth";
import { handle, json } from "../../../../lib/http";

export const dynamic = "force-dynamic";

export const POST = handle(async () => json({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie() }));
