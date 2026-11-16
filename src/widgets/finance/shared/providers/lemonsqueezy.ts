import { siLemonsqueezy } from "simple-icons";
import { httpJson } from "../../../../core/http";
import { guard, testCtx, type Ctx } from "../account";
import type { ProviderResult, RevenueEntry, RevenueProvider } from "../revenue";

export interface LemonOrder {
  id: string;
  attributes: {
    status: string;
    total_usd: number;
    tax_usd: number;
    refunded_amount_usd?: number;
    created_at: string;
    test_mode: boolean;
  };
}
export interface LemonOrdersResponse {
  data: LemonOrder[];
  links?: { next?: string };
  meta?: { page?: { lastPage?: number; currentPage?: number } };
}

const COUNTED = new Set(["paid", "refunded", "partial_refund"]);

/** Each paid order's total less tax and anything refunded, in USD. */
export function lemonEntries(orders: LemonOrder[]): { entries: RevenueEntry[]; count: number; testMode: boolean } {
  const entries: RevenueEntry[] = [];
  let count = 0;
  let testMode = false;
  for (const o of orders) {
    const a = o.attributes;
    if (a.test_mode) testMode = true;
    if (!COUNTED.has(a.status)) continue;
    if (a.status === "paid") count++;
    const cents = a.total_usd - a.tax_usd - (a.refunded_amount_usd ?? 0);
    entries.push({ at: a.created_at, amount: Math.max(0, cents) / 100, currency: "USD" });
  }
  return { entries, count, testMode };
}

const NAME = "Lemon Squeezy";
const API = "https://api.lemonsqueezy.com/v1/orders";
const MAX_PAGES = 25;
const headers = (ctx: Ctx) => ({ Accept: "application/vnd.api+json", Authorization: `Bearer ${ctx.secret("apiKey")}` });

async function fetchLemon(ctx: Ctx, range: { start: Date }): Promise<ProviderResult> {
  const startMs = range.start.getTime();
  const orders: LemonOrder[] = [];
  let capped = true;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await guard(NAME, () => httpJson<LemonOrdersResponse>(API, { headers: headers(ctx), query: { "page[size]": 100, "page[number]": page } }));
    const data = res.data ?? [];
    orders.push(...data);
    const oldest = data[data.length - 1];
    // Orders come newest first: stop once we are past the range or out of pages.
    if (!res.links?.next || !oldest || Date.parse(oldest.attributes.created_at) < startMs) {
      capped = false;
      break;
    }
  }
  return { ...lemonEntries(orders.filter((o) => Date.parse(o.attributes.created_at) >= startMs)), capped };
}

export const lemonsqueezy: RevenueProvider = {
  id: "lemonsqueezy",
  name: NAME,
  short: "Lemon",
  glyph: siLemonsqueezy,
  dashboardUrl: "https://app.lemonsqueezy.com/",
  countLabel: "orders",
  sample: { base: 221, currency: "USD", perOrder: 19 },
  account: {
    ns: "finance.lemonsqueezy",
    name: NAME,
    ids: ["finance.lemonsqueezy", "finance.lemonsqueezy-chart"],
    spec: {
      fields: [{ key: "apiKey", label: "API key", secret: true }],
      guide: {
        steps: ["Go to Settings → API in Lemon Squeezy and press + to add a new key.", "Give it a name, then copy the key right away: Lemon Squeezy shows it once."],
        url: "https://app.lemonsqueezy.com/settings/api",
        linkLabel: "Open Lemon Squeezy API settings",
      },
      test: async (values) => {
        const ctx = testCtx(values);
        await guard(NAME, () => httpJson(API, { headers: headers(ctx), query: { "page[size]": 1 } }));
      },
    },
  },
  fetch: fetchLemon,
};
