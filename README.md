# ParcelGuard

Application complète (interface dans `public/app.html`, servie à la racine, et API) : il surveille les colis des marchands, détecte les retards, pertes et avaries donnant droit à une indemnisation, et suit les réclamations jusqu'au remboursement. Next.js (routes d'API) + TypeScript + PostgreSQL.

## Lancer en local (5 minutes, sans Docker)

Il faut **Node.js 22 ou plus** ([nodejs.org](https://nodejs.org)).

```bash
npm install
cp .env.example .env.local     # puis ouvre .env.local et remplace les trois secrets
npm run db:seed                # crée la base locale et des données de démonstration
npm run dev
```

Ouvre <http://localhost:3000> : l'application s'affiche. Crée un compte, puis clique sur **Essayer avec des données d'exemple** pour tout voir en 30 secondes. Pour vérifier le serveur seul : <http://localhost:3000/api/health>.

Sans `DATABASE_URL`, l'app utilise une base PostgreSQL intégrée (PGlite) stockée dans `.data/`. C'est réservé au développement. Pour repartir de zéro, supprime le dossier `.data`.

Le compte `demo@parcelguard.fr` / `demo-parcelguard` est créé par `npm run db:seed` (il est déjà rempli de données).

```bash
npm test          # 30 tests : règles de détection, droits d'accès, commission, tableau de bord
npm run typecheck
```

## Mettre en ligne sur Vercel

1. **Base de données** : crée un projet gratuit sur [neon.tech](https://neon.tech) et copie l'adresse de connexion (`postgresql://...`).
2. **Code** : envoie ce dossier sur un dépôt GitHub (privé de préférence).
3. **Vercel** : *Add New > Project*, choisis le dépôt, puis ajoute ces variables dans *Environment Variables* :

   | Variable | Valeur |
   |---|---|
   | `DATABASE_URL` | l'adresse Neon |
   | `AUTH_SECRET` | une chaîne aléatoire (`openssl rand -base64 32`) |
   | `INTERNAL_API_KEY` | une autre chaîne aléatoire, que tu donneras à Make |
   | `CRON_SECRET` | une troisième chaîne aléatoire |
   | `AUTO_SEND_DELAY_HOURS` | `6` (facultatif) |

4. **Deploy**. Les migrations de la base s'appliquent toutes seules avant chaque déploiement (`npm run build`).
5. Vérifie `https://ton-projet.vercel.app/api/health`.

### Tâche planifiée

`vercel.json` lance la détection **une fois par jour** (6 h UTC). À ma connaissance, le plan gratuit de Vercel limite les tâches planifiées à une exécution par jour et refuse le déploiement si la fréquence est plus élevée (vérifie dans la documentation Vercel, ces limites changent). Deux options pour détecter plus souvent :

- passer à un plan Vercel payant et mettre `"0 * * * *"` (toutes les heures) dans `vercel.json` ;
- garder le plan gratuit et créer dans Make un scénario qui appelle `GET /api/cron/detect` toutes les heures avec l'en-tête `Authorization: Bearer <CRON_SECRET>`.

## Comment ça marche

```
Boutique (Shopify, WooCommerce)
        │  Make envoie les colis et leurs scans
        ▼
POST /api/internal/shipments ──► table shipments
                                      │  toutes les heures (ou chaque jour)
                                      ▼
                         GET /api/cron/detect  : moteur de détection
                                      │  crée une réclamation « à envoyer »
                                      ▼
         6 h plus tard : envoi automatique (ou bouton « Envoyer » dans l'interface)
                                      │  Make transmet au transporteur
                                      ▼
POST /api/internal/claims/{id}/resolve  : remboursé ou refusé
                                      │  commission de 25 % calculée sur le remboursé
                                      ▼
                 GET /api/dashboard  : chiffres affichés à l'utilisateur
```

### Règles de détection

Elles sont dans la table `carrier_rules` (valeurs de départ dans `src/lib/rules.ts`). **Vérifie-les dans les conditions générales de chaque transporteur avant la mise en production** : ce sont des valeurs de départ, pas une source officielle.

| Transporteur | Incident | Seuil | Indemnisation |
|---|---|---|---|
| Colissimo | Retard | livré en plus de 48 h | frais de port |
| Colissimo | Perte | 6 jours ouvrés sans scan | 23 € par kg |
| Mondial Relay | Perte | 10 jours sans activité | 25 € forfait |
| Chronopost | Retard | livré en plus de 24 h | frais de port |
| Tous | Avarie | signalée dans les 72 h après livraison | valeur de la marchandise |

Pour changer une règle, modifie la ligne dans la table (par exemple depuis l'éditeur de Neon). Une même réclamation par colis : avarie, puis perte, puis retard par ordre de priorité.

Le calcul d'un montant a besoin de données sur le colis : `shippingCost` (frais de port payés), `weightKg` (poids) ou `goodsValue` (valeur de la commande). S'il en manque une, le colis n'est pas ignoré en silence : la réponse de `/api/cron/detect` indique `missingData`.

## API

Les réponses sont en JSON, les erreurs ont la forme `{"error":{"code","message"}}`. Les routes privées utilisent le cookie de session (ou `Authorization: Bearer <jeton>`).

| Route | Rôle |
|---|---|
| `POST /api/auth/signup` `login` `logout`, `GET /api/auth/me` | Compte et session |
| `GET /api/dashboard?days=30\|90\|180` | Totaux, taux d'acceptation, délai moyen, courbe cumulée, détail par transporteur |
| `GET /api/claims?status=&q=&page=&perPage=` | Liste. `status` : `all`, `pending`, `submitted`, `approved`, `rejected`, `todo` (à traiter). Renvoie aussi les compteurs par statut |
| `GET /api/claims/{id}` | Détail, historique complet, heure d'envoi automatique |
| `POST /api/claims/{id}/send`, `/contest`, `POST /api/claims/send-all` | Envoyer, contester, tout envoyer |
| `GET /api/shipments?status=&carrier=&q=` | Colis (`status` : `all`, `in_transit`, `delivered`, `issues`) |
| `GET /api/stores`, `POST /api/stores`, `DELETE /api/stores/{id}` | Boutiques (le jeton d'accès n'est jamais renvoyé) |
| `POST /api/internal/shipments` | Make : crée ou met à jour des colis (un objet ou `{"shipments":[...]}`, 200 maximum). En-tête `X-Internal-Key` |
| `POST /api/internal/claims/{id}/resolve` | Make : `{"status":"approved"\|"rejected","note":"..."}`. En-tête `X-Internal-Key` |
| `GET/POST /api/cron/detect` | Détection + envoi automatique. En-tête `Authorization: Bearer <CRON_SECRET>` |
| `POST /api/demo`, `DELETE /api/demo` | Charge des données d'exemple dans un compte vide, ou les retire (sans toucher aux vraies boutiques). Désactivable avec `DEMO_ENABLED=false` |
| `GET /api/health` | État du service et de la base |

Exemple d'envoi d'un colis depuis Make (module HTTP, méthode POST, corps JSON) :

```json
{
  "storeId": "<identifiant de la boutique dans ParcelGuard>",
  "orderNumber": "#4001",
  "trackingNumber": "6A12345678901",
  "carrier": "colissimo",
  "customerName": "Camille R.",
  "city": "Lyon",
  "weightKg": 1.2,
  "shippingCost": 6.95,
  "goodsValue": 89,
  "shippedAt": "2026-10-05T08:00:00Z",
  "deliveredAt": null,
  "lastScanAt": "2026-10-06T14:30:00Z"
}
```

## Ce qui reste à construire

- **Connexion réelle aux boutiques** : récupérer les commandes Shopify et WooCommerce (OAuth ou clés d'API) et les envoyer à `/api/internal/shipments`. Les jetons sont déjà chiffrés en base.
- **Suivi réel des colis** : interroger les API de suivi des transporteurs (ou un agrégateur comme Sendcloud ou AfterShip) pour alimenter `lastScanAt` et `deliveredAt`.
- **Transmission des réclamations** : une réclamation « envoyée » change de statut, mais c'est un automate (Make) qui doit la transmettre au transporteur (formulaire ou e-mail selon le cas) puis appeler `resolve`.
- **Facturation** : prélever la commission (Stripe Connect). Les montants sont déjà calculés dans `claims.commission`.
- **Sécurité avant ouverture au public** : limitation du nombre de tentatives de connexion, confirmation d'e-mail, réinitialisation du mot de passe.
