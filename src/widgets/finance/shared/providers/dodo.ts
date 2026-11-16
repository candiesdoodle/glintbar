import { HttpError, httpJson } from "../../../../core/http";
import { monogram } from "../kit";
import { guard, setSetting, testCtx, type Ctx } from "../account";
import { minorFactor, type ProviderResult, type RevenueEntry, type RevenueProvider } from "../revenue";

export interface DodoLedgerEntry {
  id: string;
  event_type: string;
  amount: number;
  currency: string;
  is_credit: boolean;
  created_at: string;
}
export interface DodoPayment {
  payment_id: string;
  total_amount: number;
  currency: string;
  status: string | null;
  created_at: string;
}

/** Ledger lines that move money in or out of the balance for reasons other than revenue. */
const NOT_REVENUE = /payout|reserve|conversion|transfer|withdraw|top_?up/i;

/** Net revenue from the balance ledger: payments in, refunds, disputes, fees and tax out. */
export function dodoLedgerEntries(items: DodoLedgerEntry[]): { entries: RevenueEntry[]; count: number } {
  const entries: RevenueEntry[] = [];
  let count = 0;
  for (const it of items) {
    if (NOT_REVENUE.test(it.event_type)) continue;
    if (it.event_type === "payment") count++;
    const v = Math.abs(it.amount) / minorFactor(it.currency);
    entries.push({ at: it.created_at, amount: it.is_credit ? v : -v, currency: it.currency.toUpperCase() });
  }
  return { entries, count };
}

/** Fallback: the gross amount of succeeded payments. */
export function dodoPaymentEntries(items: DodoPayment[]): { entries: RevenueEntry[]; count: number } {
  const ok = items.filter((p) => p.status === "succeeded");
  return {
    entries: ok.map((p) => ({ at: p.created_at, amount: p.total_amount / minorFactor(p.currency), currency: p.currency.toUpperCase() })),
    count: ok.length,
  };
}

const NAME = "Dodo Payments";
const ACC = { ns: "finance.dodo" };
const BASES = { live: "https://live.dodopayments.com", test: "https://test.dodopayments.com" } as const;
const auth = (ctx: Ctx) => ({ Authorization: `Bearer ${ctx.secret("apiKey")}` });
const PAGE = 100;
const MAX_PAGES = 20;

async function pages<T>(ctx: Ctx, url: string, query: Record<string, string | number>): Promise<{ items: T[]; capped: boolean }> {
  const items: T[] = [];
  for (let n = 0; n < MAX_PAGES; n++) {
    const res = await httpJson<{ items: T[] }>(url, { headers: auth(ctx), query: { ...query, page_size: PAGE, page_number: n } });
    items.push(...(res.items ?? []));
    if ((res.items ?? []).length < PAGE) return { items, capped: false };
  }
  return { items, capped: true };
}

/** Live keys and test keys live on different servers: try the remembered one first. */
async function withEnv<T>(ctx: Ctx, fn: (base: string) => Promise<T>): Promise<{ value: T; test: boolean }> {
  const remembered = ctx.settings.env === "test" ? "test" : "live";
  const order: Array<"live" | "test"> = remembered === "test" ? ["test", "live"] : ["live", "test"];
  let first: unknown;
  for (const env of order) {
    try {
      const value = await fn(BASES[env]);
      if (!ctx.testing && env !== remembered) setSetting(ACC, "env", env);
      return { value, test: env === "test" };
    } catch (e) {
      if (!(e instanceof HttpError && e.kind === "unauthorized")) throw e;
      first ??= e;
    }
  }
  throw first;
}

async function fetchDodo(ctx: Ctx, range: { start: Date }): Promise<ProviderResult> {
  const since = range.start.toISOString();
  const { value, test } = await guard(NAME, () =>
    withEnv(ctx, async (base) => {
      try {
        const ledger = await pages<DodoLedgerEntry>(ctx, `${base}/balances/ledger`, { created_at_gte: since });
        return { ...dodoLedgerEntries(ledger.items), capped: ledger.capped, gross: false };
      } catch (e) {
        // Ledger not readable (or an older API): use gross payment totals instead.
        if (e instanceof HttpError && (e.kind === "forbidden" || e.kind === "not_found")) {
          const pay = await pages<DodoPayment>(ctx, `${base}/payments`, { created_at_gte: since });
          return { ...dodoPaymentEntries(pay.items), capped: pay.capped, gross: true };
        }
        throw e;
      }
    }),
  );
  return { ...value, testMode: test };
}

export const dodo: RevenueProvider = {
  id: "dodo",
  name: NAME,
  short: "Dodo",
  glyph: monogram("D"),
  dashboardUrl: "https://app.dodopayments.com/",
  countLabel: "payments",
  sample: { base: 186, currency: "USD", perOrder: 29 },
  account: {
    ns: ACC.ns,
    name: NAME,
    ids: ["finance.dodo", "finance.dodo-chart"],
    spec: {
      fields: [{ key: "apiKey", label: "API key", secret: true, help: "Either a live or a test key is fine." }],
      guide: {
        steps: [
          "Go to Developer → API Keys in your Dodo Payments dashboard and choose Create New Key.",
          "Give Payments read access. Nothing more is required, since balances are read-only anyway.",
          "Copy the new key once it has been created.",
        ],
        url: "https://app.dodopayments.com/",
        linkLabel: "Open Dodo Payments",
      },
      test: async (values) => {
        const ctx = testCtx(values);
        await guard(NAME, () => withEnv(ctx, (base) => httpJson(`${base}/payments`, { headers: auth(ctx), query: { page_size: 1 } })));
      },
    },
  },
  fetch: fetchDodo,
};
