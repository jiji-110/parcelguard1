import { sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { handle, json } from "../../../lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const db = await getDb();
  await db.execute(sql`select 1`);
  return json({ ok: true, database: "up" });
});
