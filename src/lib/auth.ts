import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { HttpError } from "./http";

export const SESSION_COOKIE = "pg_session";
const SESSION_DAYS = 30;

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET est absente ou trop courte (16 caractères minimum, 32 recommandés).");
  return new TextEncoder().encode(s);
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function readToken(req: Request): string | null {
  const bearer = req.headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  const cookies = req.headers.get("cookie");
  if (!cookies) return null;
  for (const part of cookies.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v.join("=");
  }
  return null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/** Retourne l'utilisateur connecté ou répond 401. Toutes les routes privées passent par ici. */
export async function requireUser(req: Request): Promise<AuthUser> {
  const token = readToken(req);
  if (!token) throw new HttpError(401, "unauthenticated", "Connexion requise.");
  let userId: string | undefined;
  try {
    userId = (await jwtVerify(token, secretKey())).payload.sub;
  } catch {
    throw new HttpError(401, "unauthenticated", "Session invalide ou expirée.");
  }
  if (!userId) throw new HttpError(401, "unauthenticated", "Session invalide.");
  const db = await getDb();
  const [u] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new HttpError(401, "unauthenticated", "Compte introuvable.");
  return u;
}

const digest = (s: string) => createHash("sha256").update(s).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** Routes appelées par Make : clé statique dans l'en-tête X-Internal-Key. */
export function requireInternalKey(req: Request) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) throw new HttpError(503, "not_configured", "INTERNAL_API_KEY n'est pas configurée.");
  const given = req.headers.get("x-internal-key") ?? "";
  if (!safeEqual(given, expected)) throw new HttpError(401, "unauthorized", "Clé interne invalide.");
}

/** Tâche planifiée : Vercel envoie automatiquement Authorization: Bearer <CRON_SECRET>. */
export function requireCronSecret(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) throw new HttpError(503, "not_configured", "CRON_SECRET n'est pas configurée.");
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(given, expected)) throw new HttpError(401, "unauthorized", "Secret invalide.");
}
