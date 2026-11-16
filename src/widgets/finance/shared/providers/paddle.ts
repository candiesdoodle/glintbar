import { siPaddle } from "simple-icons";
import { HttpError, httpJson } from "../../../../core/http";
import { guard, setSetting, testCtx, type Ctx } from "../account";
import { minorFactor, type ProviderResult, type RevenueEntry, type RevenueProvider } from "../revenue";

interface PaddleTotals {
  total: string;
  tax: string;
  fee?: string | null;
  earnings?: string | null;
  currency_code: string;
}
export interface PaddleTransaction {
  id: string;
  status: string;
  created_at: string;
  billed_at?: string | null;
  details: { totals: PaddleTotals; adjusted_totals?: PaddleTotals | null };
}
export interface PaddleList {
  data: PaddleTransaction[];
  meta: { pagination: { next?: string; has_more: boolean } };
}

/** Earnings after tax and Paddle's fee, using the adjusted totals (refunds and credits applied). */
export function paddleEntries(txns: PaddleTransaction[]): { entries: RevenueEntry[]; count: number } {
  const entries: RevenueEntry[] = [];
  for (const t of txns) {
    const tot = t.details.adjusted_totals ?? t.details.totals;
    const earnings = tot.earnings ?? null;
    const minor = earnings !== null && earnings !== undefined ? Number(earnings) : Number(tot.total) - Number(tot.tax) - Number(tot.fee ?? 0);
    entries.push({ at: t.billed_at ?? t.created_at, amount: minor / minorFactor(tot.currency_code), currency: tot.currency_code });
  }
  return { entries, count: txns.length };
}

const NAME = "Paddle";
const ACC = { ns: "finance.paddle" };
const BASES = { live: "https://api.paddle.com", sandbox: "https://sandbox-api.paddle.com" } as const;
const MAX_PAGES = 40;
const auth = (ctx: Ctx) => ({ Authorization: `Bearer ${ctx.secret("apiKey")}` });

async function withEnv<T>(ctx: Ctx, fn: (base: string) => Promise<T>): Promise<{ value: T; sandbox: boolean }> {
  const remembered = ctx.settings.env === "sandbox" ? "sandbox" : "live";
  const order: Array<"live" | "sandbox"> = remembered === "sandbox" ? ["sandbox", "live"] : ["live", "sandbox"];
  let first: unknown;
  for (const env of order) {
    try {
      const value = await fn(BASES[env]);
      if (!ctx.testing && env !== remembered) setSetting(ACC, "env", env);
      return { value, sandbox: env === "sandbox" };
    } catch (e) {
      // A key for the other environment is rejected (401) by this one.
      if (!(e instanceof HttpError && e.kind === "unauthorized")) throw e;
      first ??= e;
    }
  }
  throw first;
}

async function fetchPaddle(ctx: Ctx, range: { start: Date }): Promise<ProviderResult> {
  const { value, sandbox } = await guard(
    NAME,
    () =>
      withEnv(ctx, async (base) => {
        const txns: PaddleTransaction[] = [];
        let url: string | undefined = `${base}/transactions?status=completed&created_at[GTE]=${encodeURIComponent(range.start.toISOString())}&per_page=30`;
        let pages = 0;
        let more = false;
        while (url && pages < MAX_PAGES) {
          const res: PaddleList = await httpJson<PaddleList>(url, { headers: { ...auth(ctx), "Skip-Count": "true" } });
          txns.push(...res.data);
          more = res.meta.pagination.has_more;
          url = more ? res.meta.pagination.next : undefined;
          pages++;
        }
        return { txns, capped: Boolean(url) };
      }),
    { forbidden: "Paddle knows this key, but reading transactions is not allowed. Add the transaction.read permission to it." },
  );
  return { ...paddleEntries(value.txns), capped: value.capped, testMode: sandbox };
}

export const paddle: RevenueProvider = {
  id: "paddle",
  name: NAME,
  glyph: siPaddle,
  dashboardUrl: "https://vendors.paddle.com/",
  countLabel: "transactions",
  sample: { base: 356, currency: "USD", perOrder: 42 },
  account: {
    ns: ACC.ns,
    name: NAME,
    ids: ["finance.paddle", "finance.paddle-chart"],
    spec: {
      fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "pdl_live_apikey_…", help: "The key must have transaction.read. A sandbox key is fine as well." }],
      guide: {
        steps: ["Go to Developer tools → Authentication in Paddle and make a new API key.", "Turn on the transaction.read permission for it.", "Save, then copy the key: pdl_live_apikey_… for live, pdl_sdbx_apikey_… for sandbox."],
        url: "https://vendors.paddle.com/authentication-v2",
        linkLabel: "Open Paddle authentication",
      },
      test: async (values) => {
        const ctx = testCtx(values);
        await guard(NAME, () => withEnv(ctx, (base) => httpJson(`${base}/transactions?per_page=1`, { headers: auth(ctx) })), {
          forbidden: "Paddle knows this key, but reading transactions is not allowed. Add the transaction.read permission to it.",
        });
      },
    },
  },
  fetch: fetchPaddle,
};
