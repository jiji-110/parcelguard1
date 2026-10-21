import { getDb } from "../../../../db";
import { requireCronSecret } from "../../../../lib/auth";
import { runDetection } from "../../../../lib/detector";
import { handle, json } from "../../../../lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Appelée par Vercel Cron (GET) ou par un automate comme Make (GET ou POST), avec le secret en Bearer.
const run = handle(async (req) => {
  requireCronSecret(req);
  const summary = await runDetection(await getDb(), { autoSendDelayHours: Number(process.env.AUTO_SEND_DELAY_HOURS) || 6 });
  return json({ ok: true, ...summary });
});

export const GET = run;
export const POST = run;
