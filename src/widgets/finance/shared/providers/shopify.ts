import { siShopify } from "simple-icons";
import { httpJson, HttpError } from "../../../../core/http";
import { secretRef, secrets } from "../../../../core/secrets";
import { getStored, setStored } from "../../../../core/store";
import { guard, testCtx, type Ctx } from "../account";
import { PlainError } from "../poll";
import type { ProviderResult, RevenueEntry, RevenueProvider } from "../revenue";

export interface ShopifyOrderNode {
  id: string;
  createdAt: string;
  test: boolean;
  cancelledAt: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
}
export interface ShopifyOrdersResponse {
  data?: { orders: { nodes: ShopifyOrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
  errors?: Array<{ message: string }>;
}

/** Each order's current total (after refunds, taxes included); test and cancelled orders left out. */
export function shopifyEntries(nodes: ShopifyOrderNode[]): { entries: RevenueEntry[]; count: number } {
  const ok = nodes.filter((o) => !o.test && !o.cancelledAt);
  return {
    entries: ok.map((o) => ({ at: o.createdAt, amount: Number(o.currentTotalPriceSet.shopMoney.amount), currency: o.currentTotalPriceSet.shopMoney.currencyCode })),
    count: ok.length,
  };
}

const NAME = "Shopify";
const NS = "finance.shopify";
const API_VERSION = "2026-10";
const TOKEN_EXPIRES_KEY = "finance.shopify.tokenExpires";
const MAX_PAGES = 20;

export function normalizeStore(input: string): string {
  const s = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) throw new PlainError("That is not a .myshopify.com address. Shopify admin shows the right one under Settings → Domains.");
  return s;
}

/** The value for X-Shopify-Access-Token: a legacy shpat_ token, or a 24-hour client-credentials token. */
async function accessToken(ctx: Ctx, store: string): Promise<string> {
  if (ctx.testing) {
    const id = ctx.secret("clientId");
    if (id.startsWith("shpat_") && !ctx.secret("secret")) return id;
    const t = await exchange(store, id, ctx.secret("secret"));
    return t.token;
  }
  const id = (await secrets.get(`${NS}.clientId`)) ?? "";
  const hasSecret = await secrets.has(`${NS}.secret`);
  if (id.startsWith("shpat_") && !hasSecret) return secretRef(`${NS}.clientId`);
  const exp = getStored<number>(TOKEN_EXPIRES_KEY, 0);
  if (Date.now() < exp - 10 * 60_000 && (await secrets.has(`${NS}.token`))) return secretRef(`${NS}.token`);
  const t = await exchange(store, secretRef(`${NS}.clientId`), secretRef(`${NS}.secret`));
  await secrets.set(`${NS}.token`, t.token);
  setStored(TOKEN_EXPIRES_KEY, Date.now() + t.expiresIn * 1000);
  return secretRef(`${NS}.token`);
}

async function exchange(store: string, clientId: string, clientSecret: string): Promise<{ token: string; expiresIn: number }> {
  try {
    const res = await httpJson<{ access_token: string; expires_in?: number }>(`https://${store}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
    });
    return { token: res.access_token, expiresIn: res.expires_in ?? 86399 };
  } catch (e) {
    if (e instanceof HttpError && (e.kind === "unauthorized" || e.kind === "forbidden" || e.kind === "bad_response")) {
      throw new PlainError("Shopify turned down this client ID and secret. Make sure both are correct and that this store has the app installed.");
    }
    throw e;
  }
}

const QUERY = `query Orders($q: String!, $after: String) {
  orders(first: 250, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    nodes { id createdAt test cancelledAt currentTotalPriceSet { shopMoney { amount currencyCode } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function ordersPage(store: string, token: string, q: string, after: string | null): Promise<ShopifyOrdersResponse> {
  const res = await guard(NAME, () =>
    httpJson<ShopifyOrdersResponse>(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token },
      body: { query: QUERY, variables: { q, after } },
    }),
  );
  if (res.errors?.length) throw new PlainError(`Shopify: ${res.errors[0].message}`);
  return res;
}

async function fetchShopify(ctx: Ctx, range: { start: Date }): Promise<ProviderResult> {
  const store = normalizeStore(ctx.settings.store ?? "");
  const token = await accessToken(ctx, store);
  const q = `created_at:>='${range.start.toISOString()}'`;
  const nodes: ShopifyOrderNode[] = [];
  let after: string | null = null;
  let pages = 0;
  let more = true;
  while (more && pages < MAX_PAGES) {
    const res = await ordersPage(store, token, q, after);
    const o = res.data?.orders;
    if (!o) break;
    nodes.push(...o.nodes);
    more = o.pageInfo.hasNextPage;
    after = o.pageInfo.endCursor;
    pages++;
  }
  return { ...shopifyEntries(nodes), capped: more };
}

export const shopify: RevenueProvider = {
  id: "shopify",
  name: NAME,
  glyph: siShopify,
  dashboardUrl: "https://admin.shopify.com/",
  countLabel: "orders",
  sample: { base: 734, currency: "USD", perOrder: 58 },
  account: {
    ns: NS,
    name: NAME,
    ids: ["finance.shopify", "finance.shopify-chart"],
    extraSecrets: ["token"],
    spec: {
      fields: [
        { key: "store", label: "Store", placeholder: "your-store.myshopify.com", help: "Your store's .myshopify.com name, not a custom domain." },
        { key: "clientId", label: "Client ID", secret: true, help: "An older Admin API token (shpat_…) also works here if you leave Secret blank." },
        { key: "secret", label: "Secret", secret: true, optional: true },
      ],
      guide: {
        steps: [
          "Sign in to the Shopify Dev Dashboard as the store's owner and choose Create app.",
          "Add read_orders to the Admin API scopes of the app's version and release that version.",
          "Install it on the store. The app's Settings page lists the Client secret and Client ID; copy both.",
        ],
        url: "https://shopify.dev/docs/apps/build/dev-dashboard",
        linkLabel: "Open the Dev Dashboard guide",
      },
      test: async (values) => {
        const ctx = testCtx(values);
        const store = normalizeStore(values.store ?? "");
        const token = await accessToken(ctx, store);
        await ordersPage(store, token, `created_at:>='${new Date(Date.now() - 86400_000).toISOString()}'`, null);
      },
    },
  },
  fetch: fetchShopify,
};
