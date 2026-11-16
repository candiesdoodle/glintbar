import { LogOut, Wallet } from "lucide-react";
import { disconnect } from "../../../core/connections";
import { useStored } from "../../../core/store";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { Button, Section, Stat } from "../../../ui";
import { AiCardFrame, LimitsSkeleton, PlanRow, StatusNote } from "../shared/card";
import { deepSeekSource, useDeepSeek } from "../shared/data";
import { clearSamples, pace, spentSince, testDeepSeekKey, type BalanceSample } from "../shared/deepseek";
import { cash, startOfDay } from "../shared/format";
import { sampleDeepSeek } from "../shared/samples";
import { AiTileFrame, Glyph, TileMessage, tileProblem } from "../shared/ui";

const DAY = 86_400_000;

interface Numbers {
  total: number;
  currency: string;
  granted: number;
  toppedUp: number;
  today: number;
  week: number;
  perDay: number | null;
  daysLeft: number | null;
  observedHours: number;
  days: Array<[number, number]>;
}

function useNumbers(isSample: boolean): { n: Numbers | undefined; view: ReturnType<typeof useDeepSeek> } {
  const view = useDeepSeek(isSample);
  const [samples] = useStored<BalanceSample[]>("ai.deepseek.samples", []);
  const now = useNow("minute").getTime();
  if (isSample) {
    const s = sampleDeepSeek(now);
    return {
      view,
      n: { total: s.balance.total, currency: s.balance.currency, granted: 0, toppedUp: s.balance.total, today: s.today, week: s.week, perDay: s.perDay, daysLeft: s.daysLeft, observedHours: 168, days: s.days },
    };
  }
  const b = view.data;
  if (!b) return { view, n: undefined };
  const today0 = startOfDay(now);
  const p = pace(samples, b.total, now, today0);
  const days: Array<[number, number]> = [];
  for (let i = 6; i >= 0; i--) {
    const from = today0 - i * DAY;
    days.push([from, spentSince(samples, from, from + DAY)]);
  }
  return { view, n: { total: b.total, currency: b.currency, granted: b.granted, toppedUp: b.toppedUp, ...p, days } };
}

function DeepSeekTile({ size, isSample }: TileProps) {
  const { n, view } = useNumbers(isSample);
  const problem = !n ? tileProblem(undefined, view.error) : null;
  const low = n?.daysLeft !== null && n?.daysLeft !== undefined && n.daysLeft < 3;
  let body;
  if (!n && view.loading) body = <TileMessage tool="deepseek" size={size} text="Checking…" />;
  else if (!n) body = <TileMessage tool="deepseek" size={size} text={problem?.short ?? "DeepSeek"} tone={problem?.tone} sub="DeepSeek" />;
  else
    body = (
      <>
        <Glyph tool="deepseek" size={Math.round(size * 0.42)} className="text-dim" />
        <div className="min-w-0 leading-none">
          <div className={low ? "font-semibold text-warn tabular-nums" : "font-semibold tabular-nums"} style={{ fontSize: Math.round(size * (n.total >= 1000 ? 0.26 : 0.3)) }}>
            {cash(n.total, n.currency, n.total >= 1000 ? 0 : 2)}
          </div>
          <div className="mt-[3px] truncate text-dim tabular-nums" style={{ fontSize: Math.max(8.5, Math.round(size * 0.2)) }}>
            {n.today > 0 ? `−${cash(n.today, n.currency)}${size >= 52 ? " today" : ""}` : "balance"}
          </div>
        </div>
      </>
    );
  const title = n ? `DeepSeek balance ${cash(n.total, n.currency)} · today ${cash(n.today, n.currency)} · 7 days ${cash(n.week, n.currency)}` : "DeepSeek balance";
  return (
    <AiTileFrame sample={isSample} stale={Boolean(view.error && n)} title={title}>
      {body}
    </AiTileFrame>
  );
}

function DeepSeekCard({ isSample }: CardProps) {
  const { n, view } = useNumbers(isSample);
  const max = Math.max(0.0001, ...(n?.days.map(([, v]) => v) ?? [0]));
  const fmt = (v: number) => (n ? cash(v, n.currency) : "–");
  return (
    <AiCardFrame tool="deepseek" title="DeepSeek Balance" view={view} sample={isSample}>
      {!isSample && <StatusNote tool="deepseek" view={{ ...view, data: undefined }} onCheck={view.refresh} />}
      {!n && view.loading && <LimitsSkeleton />}
      {n && (
        <>
          <div className="mb-3 flex items-end justify-between">
            <div className="text-[30px] leading-none font-semibold tabular-nums">{cash(n.total, n.currency)}</div>
            <div className="text-[11px] text-faint">{n.daysLeft !== null ? `≈ ${Math.round(n.daysLeft)} days left at this rate` : "balance"}</div>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-3">
            <Stat label="Today" value={fmt(n.today)} />
            <Stat label="Last 7 days" value={fmt(n.week)} />
            <Stat label="Per day" value={n.perDay !== null ? fmt(n.perDay) : "–"} />
          </div>
          <Section title="Spend by day">
            <div className="flex h-[70px] items-end gap-1.5 pt-3 pb-1">
              {n.days.map(([t, v]) => (
                <div key={t} className="flex h-full flex-1 flex-col justify-end" title={`${new Date(t).toLocaleDateString(undefined, { weekday: "long" })}: ${fmt(v)}`}>
                  <div className="w-full rounded-[3px] bg-accent" style={{ height: `${Math.max(2, (v / max) * 100)}%`, opacity: v > 0 ? 1 : 0.25 }} />
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 pb-2 text-center text-[10px] text-faint">
              {n.days.map(([t]) => (
                <span key={t} className="flex-1">
                  {new Date(t).toLocaleDateString(undefined, { weekday: "narrow" })}
                </span>
              ))}
            </div>
          </Section>
          <Section>
            <div className="divide-y divide-card-line">
              <PlanRow label="Topped up">{fmt(n.toppedUp)}</PlanRow>
              <PlanRow label="Granted">{fmt(n.granted)}</PlanRow>
            </div>
          </Section>
          {!isSample && n.observedHours < 24 && (
            <p className="mb-2 text-[11px] leading-snug text-faint">
              {Math.max(0, Math.round(n.observedHours))} h of balance history so far. Spend for today and the last 7 days becomes complete while GlintBar keeps running.
            </p>
          )}
        </>
      )}
      {!isSample && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            icon={LogOut}
            onClick={() => {
              deepSeekSource().forget();
              clearSamples();
              void disconnect(def);
            }}
          >
            Disconnect
          </Button>
        </div>
      )}
    </AiCardFrame>
  );
}

/** DeepSeek balance with a pasted key; today's and this week's spend from balance changes. */
const def = defineWidget({
  id: "ai.deepseek",
  name: "DeepSeek Balance",
  category: "AI",
  description: "DeepSeek credit left, daily and 7-day spend, and days remaining.",
  keywords: ["deepseek", "balance", "credits", "spend", "api key", "top up"],
  icon: Wallet,
  size: "m",
  Tile: DeepSeekTile,
  Card: DeepSeekCard,
  connect: {
    fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "sk-…" }],
    guide: {
      steps: ["On the DeepSeek platform, go to API keys and make a new key.", "Paste the key (it begins with sk-) into the field below. GlintBar makes one balance request to test it."],
      url: "https://platform.deepseek.com/api_keys",
      linkLabel: "Open DeepSeek API keys",
    },
    test: (v) => testDeepSeekKey(v.apiKey ?? ""),
  },
  cardSize: { width: 340 },
});

export default def;
