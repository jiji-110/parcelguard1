import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { DEFAULT_RULES } from "../lib/rules";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface OpenedDb {
  db: Db;
  close: () => Promise<void>;
}

/** Charge .env.local puis .env pour les scripts lancés hors de Next (migration, seed). */
export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(f);
    } catch {
      /* fichier absent : on continue */
    }
  }
}

export async function ensureDefaultRules(db: Db) {
  await db.insert(schema.carrierRules).values(DEFAULT_RULES).onConflictDoNothing();
}

/**
 * Ouvre la base.
 * - DATABASE_URL définie : PostgreSQL (Neon, Supabase, Railway...).
 * - Sinon : base PGlite intégrée, stockée dans .data/ (développement local uniquement).
 */
export async function openDb(opts: { migrate: boolean }): Promise<OpenedDb> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(url, { max: process.env.VERCEL ? 1 : 10, prepare: false });
    const db = drizzle(client, { schema }) as unknown as Db;
    if (opts.migrate) {
      const { migrate } = await import("drizzle-orm/postgres-js/migrator");
      await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    }
    await ensureDefaultRules(db);
    return { db, close: () => client.end() };
  }

  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL est absente. Ajoute-la dans les variables d'environnement Vercel.");
  }

  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  if (!dir.startsWith("memory://")) fs.mkdirSync(dir, { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(dir);
  const db = drizzle(client, { schema }) as unknown as Db;
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await ensureDefaultRules(db);
  return { db, close: () => client.close() };
}

const g = globalThis as unknown as { __parcelguardDb?: Promise<OpenedDb> };

/** Connexion partagée (une seule par processus, y compris en rechargement à chaud). */
export async function getDb(): Promise<Db> {
  if (!g.__parcelguardDb) g.__parcelguardDb = openDb({ migrate: false });
  return (await g.__parcelguardDb).db;
}
