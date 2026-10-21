// Tous les calculs d'argent passent par des centimes entiers pour éviter les erreurs d'arrondi.
export const COMMISSION_RATE = 0.25;

export const toCents = (v: number | string): number => Math.round(Number(v) * 100);
export const fromCents = (c: number): number => c / 100;
export const round2 = (v: number | string): number => fromCents(toCents(v));

/** Commission ParcelGuard : 25 % du montant remboursé, arrondie au centime. */
export const commissionFor = (amount: number | string): number =>
  fromCents(Math.round(toCents(amount) * COMMISSION_RATE));

/** Convertit une colonne numeric (renvoyée en chaîne par Postgres) en nombre. */
export const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);
