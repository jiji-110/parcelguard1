import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Chiffre les jetons d'accès des boutiques (Shopify, WooCommerce) avant de les écrire en base.
// Clé : ENCRYPTION_KEY si définie, sinon dérivée de AUTH_SECRET.
function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY ?? process.env.AUTH_SECRET;
  if (!secret) throw new Error("ENCRYPTION_KEY ou AUTH_SECRET est requise pour chiffrer les jetons.");
  return createHash("sha256").update(secret).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptToken(stored: string): string {
  const [v, iv, tag, enc] = stored.split(":");
  if (v !== "v1") throw new Error("Format de jeton inconnu.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}
