import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { seedDemoData } from "../lib/demo";
import { loadEnv, openDb } from "./index";
import { users } from "./schema";

// Crée (ou recrée) le compte de démonstration avec deux boutiques et quatre mois d'historique.
//   npm run db:seed        puis connexion : demo@parcelguard.fr / demo-parcelguard
// Pour choisir un autre mot de passe : DEMO_PASSWORD=... npm run db:seed
async function main() {
  loadEnv();
  const { db, close } = await openDb({ migrate: true });
  const email = "demo@parcelguard.fr";
  const password = process.env.DEMO_PASSWORD ?? "demo-parcelguard";
  await db.delete(users).where(eq(users.email, email));
  const [user] = await db.insert(users).values({ email, name: "Atelier Lumen", passwordHash: await hashPassword(password) }).returning();
  const r = await seedDemoData(db, user.id, { seed: 20261019 });
  console.log(`Données de démonstration créées : ${r.shipments} colis, ${r.claims} réclamations`);
  console.log(`  à envoyer ${r.pending}, envoyées ${r.submitted}, remboursées ${r.approved}, refusées ${r.rejected}`);
  console.log(`Connexion : ${email} / ${password}`);
  await close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
