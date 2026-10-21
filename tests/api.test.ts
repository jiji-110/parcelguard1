import { beforeAll, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory://api-test";
delete process.env.DATABASE_URL;
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
process.env.INTERNAL_API_KEY = "internal-key-for-tests";
process.env.CRON_SECRET = "cron-secret-for-tests";

type Ctx = { params: Promise<{ id: string }> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let R: Record<string, any>;

const HOUR = 3_600_000;
const iso = (offsetHours: number) => new Date(Date.now() + offsetHours * HOUR).toISOString();

async function call(handler: (req: Request, ctx: Ctx) => Promise<Response>, path: string, opts: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; id?: string } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await handler(
    new Request("http://localhost" + path, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
    { params: Promise.resolve({ id: opts.id ?? "" }) },
  );
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, body: await res.json(), cookie: setCookie ? setCookie.split(";")[0] : undefined };
}

const internal = { "x-internal-key": "internal-key-for-tests" };
const cron = { authorization: "Bearer cron-secret-for-tests" };

let cookieA = "";
let cookieB = "";
let storeId = "";
const claimIds: Record<string, string> = {};

beforeAll(async () => {
  R = {
    health: await import("../src/app/api/health/route"),
    signup: await import("../src/app/api/auth/signup/route"),
    login: await import("../src/app/api/auth/login/route"),
    me: await import("../src/app/api/auth/me/route"),
    stores: await import("../src/app/api/stores/route"),
    store: await import("../src/app/api/stores/[id]/route"),
    ingest: await import("../src/app/api/internal/shipments/route"),
    resolve: await import("../src/app/api/internal/claims/[id]/resolve/route"),
    detect: await import("../src/app/api/cron/detect/route"),
    claims: await import("../src/app/api/claims/route"),
    claim: await import("../src/app/api/claims/[id]/route"),
    send: await import("../src/app/api/claims/[id]/send/route"),
    sendAll: await import("../src/app/api/claims/send-all/route"),
    contest: await import("../src/app/api/claims/[id]/contest/route"),
    shipments: await import("../src/app/api/shipments/route"),
    dashboard: await import("../src/app/api/dashboard/route"),
    demo: await import("../src/app/api/demo/route"),
  };
});

describe("authentification", () => {
  it("la base répond", async () => {
    const r = await call(R.health.GET, "/api/health");
    expect(r.status).toBe(200);
  });
  it("refuse l'accès sans session", async () => {
    expect((await call(R.claims.GET, "/api/claims")).status).toBe(401);
  });
  it("crée un compte, refuse les doublons et les mots de passe courts", async () => {
    const a = await call(R.signup.POST, "/api/auth/signup", { method: "POST", body: { email: "Alice@Example.com", password: "motdepasse1", name: "Alice" } });
    expect(a.status).toBe(201);
    expect(a.body.user.email).toBe("alice@example.com");
    cookieA = a.cookie!;
    expect((await call(R.signup.POST, "/api/auth/signup", { method: "POST", body: { email: "alice@example.com", password: "motdepasse1", name: "Alice" } })).status).toBe(409);
    expect((await call(R.signup.POST, "/api/auth/signup", { method: "POST", body: { email: "x@example.com", password: "court", name: "X" } })).status).toBe(400);
    const b = await call(R.signup.POST, "/api/auth/signup", { method: "POST", body: { email: "bob@example.com", password: "motdepasse2", name: "Bob" } });
    cookieB = b.cookie!;
  });
  it("connecte et identifie l'utilisateur", async () => {
    expect((await call(R.login.POST, "/api/auth/login", { method: "POST", body: { email: "alice@example.com", password: "faux" } })).status).toBe(401);
    expect((await call(R.login.POST, "/api/auth/login", { method: "POST", body: { email: "alice@example.com", password: "motdepasse1" } })).status).toBe(200);
    const me = await call(R.me.GET, "/api/auth/me", { cookie: cookieA });
    expect(me.body.user.name).toBe("Alice");
  });
});

describe("boutiques", () => {
  it("connecte une boutique sans jamais renvoyer le jeton, et le chiffre en base", async () => {
    const r = await call(R.stores.POST, "/api/stores", { method: "POST", cookie: cookieA, body: { platform: "shopify", url: "https://Atelier-Lumen.myshopify.com/", accessToken: "shpat_secret" } });
    expect(r.status).toBe(201);
    expect(r.body.store.url).toBe("atelier-lumen.myshopify.com");
    expect(r.body.store.name).toBe("Atelier lumen");
    expect(JSON.stringify(r.body)).not.toContain("shpat_secret");
    expect(JSON.stringify(r.body)).not.toContain("accessToken");
    storeId = r.body.store.id;

    const { getDb } = await import("../src/db");
    const { stores } = await import("../src/db/schema");
    const [row] = await (await getDb()).select().from(stores);
    expect(row.accessToken).toMatch(/^v1:/);
    expect(row.accessToken).not.toContain("shpat_secret");
    const { decryptToken } = await import("../src/lib/crypto");
    expect(decryptToken(row.accessToken!)).toBe("shpat_secret");
  });
  it("refuse un doublon et une adresse invalide", async () => {
    expect((await call(R.stores.POST, "/api/stores", { method: "POST", cookie: cookieA, body: { platform: "shopify", url: "atelier-lumen.myshopify.com" } })).status).toBe(409);
    expect((await call(R.stores.POST, "/api/stores", { method: "POST", cookie: cookieA, body: { platform: "shopify", url: "pas une adresse" } })).status).toBe(400);
  });
});

describe("import des colis et détection", () => {
  const base = { orderNumber: "#4001", customerName: "Camille R.", city: "Lyon" };
  it("l'API interne exige la clé", async () => {
    expect((await call(R.ingest.POST, "/api/internal/shipments", { method: "POST", body: {} })).status).toBe(401);
  });
  it("enregistre cinq colis (création puis mise à jour sans doublon)", async () => {
    const shipments = [
      { ...base, storeId, trackingNumber: "6A0000000001", carrier: "colissimo", shippingCost: 6.95, weightKg: 1.2, shippedAt: iso(-120), deliveredAt: iso(-60) }, // 60 h : retard
      { ...base, storeId, trackingNumber: "MR00000002", carrier: "mondial_relay", shippingCost: 5, weightKg: 1, shippedAt: iso(-24 * 12) }, // perdu
      { ...base, storeId, trackingNumber: "XW00000003FR", carrier: "chronopost", shippingCost: 12, shippedAt: iso(-48), deliveredAt: iso(-38) }, // 10 h : rien
      { ...base, storeId, trackingNumber: "12345678901234", carrier: "dpd", goodsValue: 89, shippedAt: iso(-100), deliveredAt: iso(-50), damageReportedAt: iso(-30) }, // avarie
      { ...base, storeId, trackingNumber: "XW00000005FR", carrier: "chronopost", shippedAt: iso(-100), deliveredAt: iso(-50) }, // frais de port inconnus
    ];
    const r = await call(R.ingest.POST, "/api/internal/shipments", { method: "POST", headers: internal, body: { shipments } });
    expect(r.body).toEqual({ upserted: 5, conflicts: [] });
    const again = await call(R.ingest.POST, "/api/internal/shipments", { method: "POST", headers: internal, body: shipments[0] });
    expect(again.body.upserted).toBe(1);
    const list = await call(R.shipments.GET, "/api/shipments", { cookie: cookieA });
    expect(list.body.total).toBe(5);
  });
  it("refuse un colis rattaché à une boutique inconnue", async () => {
    const r = await call(R.ingest.POST, "/api/internal/shipments", { method: "POST", headers: internal, body: { ...base, storeId: "00000000-0000-4000-8000-000000000000", trackingNumber: "ZZZ999", carrier: "dpd", shippedAt: iso(-5) } });
    expect(r.status).toBe(404);
  });
  it("la détection crée trois réclamations, une seule fois", async () => {
    expect((await call(R.detect.GET, "/api/cron/detect")).status).toBe(401);
    const run = await call(R.detect.GET, "/api/cron/detect", { headers: cron });
    expect(run.body).toMatchObject({ ok: true, scanned: 5, created: 3, missingData: 1, autoSent: 0 });
    const second = await call(R.detect.GET, "/api/cron/detect", { headers: cron });
    expect(second.body).toMatchObject({ created: 0 });
  });
  it("liste les réclamations avec leurs montants et leurs compteurs", async () => {
    const r = await call(R.claims.GET, "/api/claims?status=pending", { cookie: cookieA });
    expect(r.body.total).toBe(3);
    expect(r.body.counts).toMatchObject({ all: 3, pending: 3 });
    const byType = Object.fromEntries(r.body.items.map((c: { type: string; amount: number; id: string }) => [c.type, c]));
    expect(byType.delay.amount).toBe(6.95);
    expect(byType.loss.amount).toBe(25);
    expect(byType.damage.amount).toBe(89);
    expect(byType.delay.ref).toMatch(/^R-\d{4}$/);
    for (const [t, c] of Object.entries(byType)) claimIds[t] = (c as { id: string }).id;
    const issues = await call(R.shipments.GET, "/api/shipments?status=issues", { cookie: cookieA });
    expect(issues.body.total).toBe(3);
  });
  it("recherche par numéro de suivi", async () => {
    const r = await call(R.claims.GET, "/api/claims?q=MR0000", { cookie: cookieA });
    expect(r.body.total).toBe(1);
    expect(r.body.items[0].type).toBe("loss");
  });
});

describe("réclamations", () => {
  it("un autre utilisateur ne voit rien et ne peut rien modifier", async () => {
    expect((await call(R.claims.GET, "/api/claims", { cookie: cookieB })).body.total).toBe(0);
    expect((await call(R.claim.GET, "/x", { cookie: cookieB, id: claimIds.delay })).status).toBe(404);
    expect((await call(R.send.POST, "/x", { method: "POST", cookie: cookieB, id: claimIds.delay })).status).toBe(404);
    expect((await call(R.claim.GET, "/x", { cookie: cookieA, id: "pas-un-uuid" })).status).toBe(404);
  });
  it("envoie une réclamation, puis refuse de l'envoyer deux fois", async () => {
    expect((await call(R.send.POST, "/x", { method: "POST", cookie: cookieA, id: claimIds.delay })).status).toBe(200);
    expect((await call(R.send.POST, "/x", { method: "POST", cookie: cookieA, id: claimIds.delay })).status).toBe(409);
  });
  it("envoie toutes les réclamations en attente", async () => {
    const r = await call(R.sendAll.POST, "/api/claims/send-all", { method: "POST", cookie: cookieA });
    expect(r.body).toMatchObject({ sent: 2, amount: 114 });
  });
  it("enregistre les réponses du transporteur et calcule la commission", async () => {
    const ok = await call(R.resolve.POST, "/x", { method: "POST", headers: internal, id: claimIds.delay, body: { status: "approved" } });
    expect(ok.status).toBe(200);
    expect((await call(R.resolve.POST, "/x", { method: "POST", headers: internal, id: claimIds.delay, body: { status: "approved" } })).status).toBe(409);
    expect((await call(R.resolve.POST, "/x", { method: "POST", id: claimIds.loss, body: { status: "approved" } })).status).toBe(401);
    await call(R.resolve.POST, "/x", { method: "POST", headers: internal, id: claimIds.loss, body: { status: "rejected", note: "Colis retrouvé" } });

    const detail = await call(R.claim.GET, "/x", { cookie: cookieA, id: claimIds.delay });
    expect(detail.body.claim).toMatchObject({ status: "approved", amount: 6.95, commission: 1.74, netToMerchant: 5.21 });
    const titles = detail.body.timeline.map((e: { title: string }) => e.title);
    expect(titles).toEqual(expect.arrayContaining(["Anomalie détectée par ParcelGuard", "Réclamation envoyée à Colissimo", "Remboursement accordé", "Colis livré"]));

    const rejected = await call(R.claim.GET, "/x", { cookie: cookieA, id: claimIds.loss });
    expect(rejected.body.claim).toMatchObject({ status: "rejected", commission: 0, netToMerchant: 0 });
  });
  it("le tableau de bord additionne les bons montants", async () => {
    const r = await call(R.dashboard.GET, "/api/dashboard?days=30", { cookie: cookieA });
    expect(r.body.totals).toMatchObject({
      incidentCount: 3,
      approvedCount: 1,
      rejectedCount: 1,
      approvedAmount: 6.95,
      commission: 1.74,
      netPaid: 5.21,
      pendingCount: 1,
      pendingAmount: 89,
      acceptanceRate: 0.5,
    });
    expect(r.body.dailyCumulative).toHaveLength(30);
    expect(r.body.dailyCumulative.at(-1).cumulative).toBe(6.95);
    expect(r.body.byCarrier.find((c: { carrier: string }) => c.carrier === "colissimo")).toMatchObject({ incidents: 1, approvedAmount: 6.95, acceptanceRate: 1 });
    expect((await call(R.dashboard.GET, "/api/dashboard?days=7", { cookie: cookieA })).status).toBe(400);
  });
  it("une réclamation refusée apparaît dans « à traiter » et peut être contestée", async () => {
    const todo = await call(R.claims.GET, "/api/claims?status=todo", { cookie: cookieA });
    expect(todo.body.items.map((c: { type: string }) => c.type)).toEqual(["loss"]);
    expect((await call(R.contest.POST, "/x", { method: "POST", cookie: cookieA, id: claimIds.loss })).status).toBe(200);
    expect((await call(R.contest.POST, "/x", { method: "POST", cookie: cookieA, id: claimIds.loss })).status).toBe(409);
    const d = await call(R.dashboard.GET, "/api/dashboard?days=30", { cookie: cookieA });
    expect(d.body.totals).toMatchObject({ rejectedCount: 0, pendingCount: 2, acceptanceRate: 1 });
  });
});

describe("données d'exemple", () => {
  it("se chargent dans un compte vide, une seule fois, et se retirent sans toucher aux vraies données", async () => {
    expect((await call(R.demo.POST, "/api/demo", { method: "POST" })).status).toBe(401);
    const r = await call(R.demo.POST, "/api/demo", { method: "POST", cookie: cookieB });
    expect(r.status).toBe(201);
    expect(r.body.claims).toBeGreaterThan(20);
    const dash = await call(R.dashboard.GET, "/api/dashboard?days=180", { cookie: cookieB });
    expect(dash.body.totals.incidentCount).toBeGreaterThan(20);
    expect((await call(R.demo.POST, "/api/demo", { method: "POST", cookie: cookieB })).status).toBe(409);
    // Alice a déjà des boutiques : elle ne peut pas charger l'exemple, et ses données restent intactes.
    expect((await call(R.demo.POST, "/api/demo", { method: "POST", cookie: cookieA })).status).toBe(409);
    expect((await call(R.demo.DELETE, "/api/demo", { method: "DELETE", cookie: cookieA })).body.removedStores).toBe(0);
    expect((await call(R.claims.GET, "/api/claims", { cookie: cookieA })).body.total).toBe(3);

    expect((await call(R.demo.DELETE, "/api/demo", { method: "DELETE", cookie: cookieB })).body.removedStores).toBe(2);
    expect((await call(R.claims.GET, "/api/claims", { cookie: cookieB })).body.total).toBe(0);
    expect((await call(R.stores.GET, "/api/stores", { cookie: cookieB })).body.items).toHaveLength(0);
  });
});

describe("suppression d'une boutique", () => {
  it("est refusée tant qu'elle a des réclamations, autorisée sinon", async () => {
    expect((await call(R.store.DELETE, "/x", { method: "DELETE", cookie: cookieA, id: storeId })).status).toBe(409);
    const s2 = await call(R.stores.POST, "/api/stores", { method: "POST", cookie: cookieA, body: { platform: "woocommerce", url: "lumen-maison.fr" } });
    expect((await call(R.store.DELETE, "/x", { method: "DELETE", cookie: cookieA, id: s2.body.store.id })).status).toBe(200);
  });
});
