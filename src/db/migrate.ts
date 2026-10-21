import { loadEnv, openDb } from "./index";

// Applique les migrations SQL du dossier drizzle/ puis insère les règles transporteurs par défaut.
// Lancé automatiquement avant "next build", ou à la main avec : npm run db:migrate
async function main() {
  loadEnv();
  if (process.env.VERCEL && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL est absente. Ajoute-la dans Vercel > Settings > Environment Variables.");
  }
  const { close } = await openDb({ migrate: true });
  await close();
  console.log(process.env.DATABASE_URL ? "Migrations appliquées sur PostgreSQL." : "Migrations appliquées sur la base locale (.data/pglite).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
