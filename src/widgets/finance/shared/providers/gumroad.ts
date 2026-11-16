import { siGumroad } from "simple-icons";
import { httpJson } from "../../../../core/http";
import { guard, testCtx, type Ctx } from "../account";
import type { ProviderResult, RevenueEntry, RevenueProvider } from "../revenue";
import { dayKey } from "../sample";

export interface GumroadSale {
  id: string;
  created_at: string;
  price: number;
  gumroad_fee?: number;
  currency?: string;
  refunded?: boolean;
  chargedback?: boolean;
  disputed?: boolean;
  dispute_won?: boolean;
}
export interface GumroadSalesResponse {
  success: boolean;
  sales: GumroadSale[];
  next_page_key?: string;
}

/** What you kept: each sale's price less Gumroad's fee; refunded, charged-back and disputed sales left out. */
export function gumroadEntries(sales: GumroadSale[]): { entries: RevenueEntry[]; count: number } {
  const ok = sales.filter((s) => !s.refunded && !s.chargedback && !(s.disputed && !s.dispute_won));
  return {
    entries: ok.map((s) => ({ at: s.created_at, amount: (s.price - (s.gumroad_fee ?? 0)) / 100, currency: (s.currency ?? "usd").toUpperCase() })),
    count: ok.length,
  };
}

const NAME = "Gumroad";
const API = "https://api.gumroad.com/v2/sales";
const MAX_PAGES = 50;

async function fetchGumroad(ctx: Ctx, range: { start: Date }): Promise<ProviderResult> {
  const sales: GumroadSale[] = [];
  let key: string | undefined;
  let pages = 0;
  do {
    const res = await guard(NAME, () =>
      httpJson<GumroadSalesResponse>(API, { query: { access_token: ctx.secret("apiKey"), after: dayKey(range.start), page_key: key } }),
    );
    sales.push(...(res.sales ?? []));
    key = res.next_page_key || undefined;
    pages++;
  } while (key && pages < MAX_PAGES);
  return { ...gumroadEntries(sales), capped: Boolean(key) };
}

export const gumroad: RevenueProvider = {
  id: "gumroad",
  name: NAME,
  glyph: siGumroad,
  dashboardUrl: "https://app.gumroad.com/dashboard",
  countLabel: "sales",
  sample: { base: 143, currency: "USD", perOrder: 15 },
  account: {
    ns: "finance.gumroad",
    name: NAME,
    ids: ["finance.gumroad", "finance.gumroad-chart"],
    spec: {
      fields: [{ key: "apiKey", label: "Access token", secret: true }],
      guide: {
        steps: [
          "In Gumroad, go to Settings → Advanced and scroll to Applications.",
          "Add an application. Redirect URI: http://127.0.0.1 (GlintBar never opens it).",
          "Press Generate access token, then copy the token.",
        ],
        url: "https://app.gumroad.com/settings/advanced",
        linkLabel: "Open Gumroad settings",
      },
      test: async (values) => {
        const ctx = testCtx(values);
        await guard(NAME, () => httpJson(API, { query: { access_token: ctx.secret("apiKey"), after: dayKey(new Date()) } }));
      },
    },
  },
  fetch: fetchGumroad,
};
