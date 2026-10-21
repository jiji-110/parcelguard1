import type { NextConfig } from "next";

const config: NextConfig = {
  // La base intégrée (PGlite) sert uniquement au développement local sans PostgreSQL.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // L'interface est le fichier public/app.html, servi à la racine du site.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/app.html" }], afterFiles: [], fallback: [] };
  },
};

export default config;
