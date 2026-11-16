import { siStripe } from "simple-icons";
import { httpJson } from "../../../../core/http";
import { guard, type Ctx } from "../account";
import { minorFactor, type ProviderResult, type RevenueEntry, type RevenueProvider, type UpcomingItem } from "../revenue";
import { dayKey } from "../sample";

export interface StripeBalanceTxn {
  id: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  created: number;
  type: string;
}
interface StripeList<T> {
  object: "list";
  data: T[];
  has_more: boolean;
}

/** Charges and the refunds that reverse them; payouts, transfers and lone fees are not revenue. */
export const STRIPE_REVENUE_TYPES = new Set(["charge", "payment", "refund", "payment_refund", "refund_failure", "payment_failure_refund"]);

export function stripeEntries(txns: StripeBalanceTxn[]): { entries: RevenueEntry[]; count: number } {
  const entries: RevenueEntry[] = [];
  let count = 0;
  for (const t of txns) {
    if (!STRIPE_REVENUE_TYPES.has(t.type)) continue;
    if (t.type === "charge" || t.type === "payment") count++;
    entries.push({ at: t.created * 1000, amount: t.net / minorFactor(t.currency), currency: t.currency.toUpperCase() });
  }
  return { entries, count };
}

const NAME = "Stripe";
const auth = (ctx: Ctx) => ({ Authorization: `Bearer ${ctx.secret("apiKey")}` });
const MAX_PAGES = 30;

async function fetchStripe(ctx: Ctx, range: { start: Date }): Promise<ProviderResult> {
  const balance = await guard(NAME, () => httpJson<{ livemode: boolean }>("https://api.stripe.com/v1/balance", { headers: auth(ctx) }));
  const all: StripeBalanceTxn[] = [];
  let after: string | undefined;
  let pages = 0;
  let more = true;
  while (more && pages < MAX_PAGES) {
    const page = await guard(NAME, () =>
      httpJson<StripeList<StripeBalanceTxn>>("https://api.stripe.com/v1/balance_transactions", {
        headers: auth(ctx),
        query: { "created[gte]": Math.floor(range.start.getTime() / 1000), limit: 100, starting_after: after },
      }),
    );
    all.push(...page.data);
    pages++;
    more = page.has_more && page.data.length > 0;
    after = page.data[page.data.length - 1]?.id;
  }
  const { entries, count } = stripeEntries(all);
  return { entries, count, testMode: !balance.livemode, capped: more };
}

interface StripePayout {
  id: string;
  amount: number;
  currency: string;
  arrival_date: number;
  status: string;
}

/** Upcoming payouts, when the key may read them (optional: the connect guide doesn't ask for it). */
async function upcomingPayouts(ctx: Ctx): Promise<UpcomingItem[]> {
  const res = await httpJson<StripeList<StripePayout>>("https://api.stripe.com/v1/payouts", { headers: auth(ctx), query: { limit: 10 } });
  const today = dayKey(new Date());
  return res.data
    .filter((p) => p.status === "pending" || p.status === "in_transit")
    .map((p) => ({ date: dayKey(new Date(p.arrival_date * 1000)), title: "Stripe payout", kind: "payout" as const, amount: p.amount / minorFactor(p.currency), currency: p.currency.toUpperCase() }))
    .filter((i) => i.date >= today);
}

export const stripe: RevenueProvider = {
  id: "stripe",
  name: NAME,
  glyph: siStripe,
  dashboardUrl: "https://dashboard.stripe.com/",
  countLabel: "payments",
  sample: { base: 412, currency: "USD", perOrder: 39 },
  account: {
    ns: "finance.stripe",
    name: NAME,
    ids: ["finance.stripe", "finance.stripe-chart"],
    spec: {
      fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "rk_live_…", help: "Restricted key; give it Read on Balance transaction sources and on Balance." }],
      guide: {
        steps: [
          "In your Stripe Dashboard, go to Developers → API keys and choose Create restricted key.",
          "Set Balance transaction sources and Balance to Read. All other permissions stay at None.",
          "Copy the key (rk_test_… or rk_live_…) right after creating it; Stripe will not show it again.",
        ],
        url: "https://dashboard.stripe.com/apikeys",
        linkLabel: "Open Stripe API keys",
      },
      test: async (values) => {
        const ctx: Ctx = { secret: (f) => values[f] ?? "", settings: values, testing: true };
        await guard(NAME, () => httpJson("https://api.stripe.com/v1/balance_transactions", { headers: auth(ctx), query: { limit: 1 } }));
      },
    },
  },
  fetch: fetchStripe,
  fetchUpcoming: async (ctx) => {
    try {
      return await upcomingPayouts(ctx);
    } catch {
      return [];
    }
  },
};
