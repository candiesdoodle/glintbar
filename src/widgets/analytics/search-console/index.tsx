import { useState } from "react";
import { Search } from "lucide-react";
import { siGooglesearchconsole } from "simple-icons";
import { relativeTime, shortNumber } from "../../../core/format";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { AreaChart, Button, CardFrame, ErrorState, ListRow, Segmented, Spinner, Stat, TextInput, TileFrame } from "../../../ui";
import { CardStatus, DeltaChip, GlyphIcon, StatGrid, TileMarker, AccountFooter, dayLabel, pctChange, statusOf, type TileStatus } from "../../finance/shared/kit";
import { errorMessage, resetPolled, usePolled } from "../../finance/shared/poll";
import { makeOAuthConnect, signOut } from "../../online/shared/oauth";
import { SAMPLE_TOP, inspectUrl, loadSummary, loadTop, sampleSummary, scAccount, setSite, siteLabel, type Inspection, type ScSummary, type TopDim } from "./api";

const REFRESH = 30 * 60_000;

function useSummary(range: number, isSample: boolean) {
  const poll = usePolled<ScSummary>(isSample ? null : `${scAccount.ns}:summary:${range}`, () => loadSummary(range), { refreshMs: REFRESH });
  return { data: isSample ? sampleSummary(range) : poll.data, poll };
}

/** Clicks (accent) over impressions (dim), each on its own scale, like Search Console's chart. */
function TwoLines({ clicks, impressions, height }: { clicks: number[]; impressions: number[]; height: number }) {
  return (
    <div className="relative w-full" style={{ height }}>
      <div className="absolute inset-0">
        <AreaChart data={impressions} min={0} height={height} color="var(--g-dim)" strokeWidth={1.2} fill={false} />
      </div>
      <div className="absolute inset-0">
        <AreaChart data={clicks} min={0} height={height} strokeWidth={1.6} />
      </div>
    </div>
  );
}

function ScTile({ size, isSample }: TileProps) {
  const { data, poll } = useSummary(28, isSample);
  const status: TileStatus = statusOf(poll, isSample);
  const small = Math.max(9, Math.round(size * 0.21));
  const change = data ? pctChange(data.totals.clicks, data.prev.clicks) : undefined;
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.2)]" title={data ? `${siteLabel(data.site)}: ${data.totals.clicks.toLocaleString()} clicks, ${data.totals.impressions.toLocaleString()} impressions (28 days)` : status.error}>
      <div className="flex min-w-0 shrink-0 flex-col justify-center leading-none" style={{ width: size < 40 ? "52%" : "46%" }}>
        <div className="flex min-w-0 items-center gap-[0.3em] text-dim" style={{ fontSize: small }}>
          <GlyphIcon glyph={siGooglesearchconsole} size={Math.round(small * 1.1)} />
          <span className="truncate">Clicks</span>
        </div>
        {status.loading ? (
          <span className="mt-[3px] text-dim" style={{ fontSize: small }}>
            Loading…
          </span>
        ) : status.error ? (
          <span className="mt-[3px] truncate text-warn" style={{ fontSize: small }}>
            {status.error.includes("sign in") ? "Sign in again" : "Can't load"}
          </span>
        ) : (
          <>
            <div className="mt-[3px] flex items-baseline gap-[0.35em] whitespace-nowrap">
              <span className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.34) }}>
                {data ? shortNumber(data.totals.clicks) : "–"}
              </span>
            </div>
            {size >= 40 && <DeltaChip value={change} fontSize={small} />}
          </>
        )}
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col justify-end self-stretch" style={{ paddingTop: isSample || status.staleMessage ? 15 : Math.round(size * 0.16), paddingBottom: Math.round(size * 0.16) }}>
        {data && !status.error && <TwoLines clicks={data.clicks} impressions={data.impressions} height={Math.round(size * (isSample ? 0.5 : 0.62))} />}
        <span className="absolute top-[3px] right-0 flex">
          <TileMarker isSample={isSample} status={status} size={size} />
        </span>
      </div>
    </TileFrame>
  );
}

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "28", label: "28 days" },
  { value: "90", label: "3 months" },
] as const;

const DIMS: Array<{ value: TopDim; label: string }> = [
  { value: "query", label: "Queries" },
  { value: "page", label: "Pages" },
  { value: "country", label: "Countries" },
  { value: "device", label: "Devices" },
];

const countryName = (code: string) => {
  try {
    const two = { usa: "US", gbr: "GB", deu: "DE", ind: "IN", fra: "FR", can: "CA", aus: "AU", bra: "BR", esp: "ES", ita: "IT", nld: "NL", jpn: "JP" }[code.toLowerCase()];
    return two ? (new Intl.DisplayNames(undefined, { type: "region" }).of(two) ?? code.toUpperCase()) : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
};

function rowTitle(dim: TopDim, key: string): string {
  if (dim === "page") return key.replace(/^https?:\/\/[^/]+/, "") || "/";
  if (dim === "country") return countryName(key);
  if (dim === "device") return key.charAt(0) + key.slice(1).toLowerCase();
  return key;
}

function ScCard({ isSample, close }: CardProps) {
  const [range, setRange] = useState<"7" | "28" | "90">("28");
  const [dim, setDim] = useState<TopDim>("query");
  const r = Number(range);
  const { data, poll } = useSummary(r, isSample);
  const top = usePolled(isSample ? null : `${scAccount.ns}:top:${dim}:${r}`, () => loadTop(dim, r), { refreshMs: REFRESH });
  const rows = isSample ? SAMPLE_TOP[dim] : top.data;
  const [url, setUrl] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const inspect = async (target = url) => {
    if (!target.trim() || isSample) return;
    setInspecting(true);
    setInspectError(null);
    setInspection(null);
    try {
      setInspection(await inspectUrl(target.trim()));
    } catch (e) {
      setInspectError(errorMessage(e));
    } finally {
      setInspecting(false);
    }
  };

  const t = data?.totals;
  const p = data?.prev;
  return (
    <CardFrame
      title="Search Console"
      subtitle={data ? siteLabel(data.site) : "Google Search"}
      icon={Search}
      actions={
        data && data.sites.length > 1 ? (
          <select
            className="h-7 max-w-[130px] rounded-lg border border-card-line bg-input px-1.5 text-[12px] text-fg outline-none"
            value={data.site}
            onChange={(e) => {
              setSite(e.target.value);
              resetPolled(scAccount.ns);
            }}
          >
            {data.sites.map((s) => (
              <option key={s} value={s}>
                {siteLabel(s)}
              </option>
            ))}
          </select>
        ) : undefined
      }
      footer={
        <AccountFooter
          url={`https://search.google.com/search-console${data ? `?resource_id=${encodeURIComponent(data.site)}` : ""}`}
          urlLabel="Open Search Console"
          onDisconnect={
            isSample
              ? undefined
              : () => {
                  void signOut(scAccount);
                  close();
                }
          }
        />
      }
    >
      <Segmented value={range} options={RANGES.map((x) => ({ value: x.value, label: x.label }))} onChange={(v) => setRange(v as "7" | "28" | "90")} className="mb-3" />
      <StatGrid cols={4}>
        <Stat label="Clicks" value={t ? shortNumber(t.clicks) : "–"} sub={t && p ? <DeltaChip value={pctChange(t.clicks, p.clicks)} fontSize={11} /> : undefined} />
        <Stat label="Impressions" value={t ? shortNumber(t.impressions) : "–"} sub={t && p ? <DeltaChip value={pctChange(t.impressions, p.impressions)} fontSize={11} /> : undefined} />
        <Stat label="CTR" value={t ? `${(t.ctr * 100).toFixed(1)}%` : "–"} />
        <Stat label="Position" value={t ? t.position.toFixed(1) : "–"} sub={t && p ? <DeltaChip value={pctChange(t.position, p.position)} invert fontSize={11} /> : undefined} />
      </StatGrid>
      <div className="mt-3 rounded-xl bg-input px-2 pt-2 pb-1.5">
        {data && <TwoLines clicks={data.clicks} impressions={data.impressions} height={84} />}
        <div className="mt-1 flex justify-between text-[10px] text-faint">
          <span>{data ? dayLabel(data.days[0]) : ""}</span>
          <span>
            <span className="text-accent">Clicks</span> · Impressions
          </span>
          <span>{data ? dayLabel(data.days[data.days.length - 1]) : ""}</span>
        </div>
      </div>
      <Segmented value={dim} options={DIMS} onChange={setDim} className="mt-3" />
      <div className="mt-1.5 min-h-[120px]">
        {!rows && top.loading && (
          <div className="grid place-items-center py-6">
            <Spinner />
          </div>
        )}
        {Boolean(top.error) && !rows && <ErrorState message={top.message} onRetry={top.refresh} />}
        {rows?.length === 0 && <p className="py-4 text-center text-[12px] text-dim">Nothing recorded for this period yet.</p>}
        {rows?.map((row) => {
          const key = row.keys?.[0] ?? "";
          return (
            <ListRow
              key={key}
              title={rowTitle(dim, key)}
              subtitle={`${shortNumber(row.impressions)} impressions · position ${row.position.toFixed(1)}`}
              right={`${shortNumber(row.clicks)} clicks`}
              onClick={
                dim === "page"
                  ? () => {
                      setUrl(key);
                      void inspect(key);
                    }
                  : undefined
              }
            />
          );
        })}
      </div>
      <div className="mt-3 rounded-xl bg-input p-3">
        <div className="mb-1.5 text-[12px] font-medium text-fg">Inspect URL</div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void inspect();
          }}
        >
          <TextInput placeholder="https://example.com/page" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
          <Button size="md" type="submit" disabled={inspecting || isSample || !url.trim()}>
            {inspecting ? <Spinner size={12} /> : "Check"}
          </Button>
        </form>
        {inspectError && <ErrorState className="mt-2" message={inspectError} />}
        {inspection && (
          <div className="mt-2 text-[12px] leading-snug">
            <div className={inspection.verdict === "PASS" ? "font-medium text-good" : "font-medium text-warn"}>
              {inspection.verdict === "PASS" ? "Indexed by Google" : "Not indexed"}
            </div>
            {inspection.coverageState && <div className="text-dim">{inspection.coverageState}</div>}
            <div className="text-faint">{inspection.lastCrawlTime ? `Last crawled ${relativeTime(Date.parse(inspection.lastCrawlTime))}` : "No crawl by Google so far."}</div>
          </div>
        )}
        {isSample && <p className="mt-1.5 text-[11px] text-faint">After you sign in, you can look up a page's index status here.</p>}
      </div>
      <CardStatus poll={poll} isSample={isSample} sampleText="These are sample figures. Sign in with your own Google client to load your site." />
    </CardFrame>
  );
}

export default defineWidget({
  id: "analytics.search-console",
  name: "Search Console",
  category: "Analytics",
  description: "Google Search clicks to your site over 28 days, and the change.",
  keywords: ["google", "seo", "search", "clicks", "impressions", "webmaster"],
  icon: Search,
  size: "l",
  Tile: ScTile,
  Card: ScCard,
  Connect: makeOAuthConnect(scAccount),
  disconnect: () => signOut(scAccount),
  disconnectLabel: "Sign out",
  cardSize: { width: 400, height: 640 },
});
