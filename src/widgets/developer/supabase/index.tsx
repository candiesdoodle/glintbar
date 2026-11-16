import { Database } from "lucide-react";
import { siSupabase } from "simple-icons";
import { bytes, shortNumber } from "../../../core/format";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, ListRow, Stat, cx } from "../../../ui";
import { disconnectAccount, makeConnect } from "../../finance/shared/account";
import { AccountFooter, CardChart, CardHero, CardStatus, DeltaChip, MetricTile, StatGrid, pctChange, statusOf } from "../../finance/shared/kit";
import { useAccountData } from "../../finance/shared/useAccount";
import { loadSupabase, sampleSupabase, supabaseAccount, type SupabaseData } from "./api";

const REFRESH = 10 * 60_000;
const use = (isSample: boolean) => useAccountData(supabaseAccount, isSample, loadSupabase, sampleSupabase, { refreshMs: REFRESH });

function healthy(d: SupabaseData): boolean {
  return d.project.status === "ACTIVE_HEALTHY" && d.health.every((h) => h.ok);
}

function SbTile({ size, isSample }: TileProps) {
  const { data, poll } = use(isSample);
  const change = data ? pctChange(data.requests, data.prevRequests) : undefined;
  const dot = data ? (healthy(data) ? "bg-good" : data.project.status.startsWith("ACTIVE") ? "bg-warn" : "bg-bad") : "bg-track";
  return (
    <MetricTile
      glyph={siSupabase}
      label={
        <span className="inline-flex items-center gap-[0.35em]">
          <span className={cx("inline-block h-[0.55em] w-[0.55em] rounded-full", dot)} />
          {data?.project.name ?? "Supabase"}
        </span>
      }
      value={data ? shortNumber(data.requests) : "–"}
      sub={change !== undefined ? <DeltaChip value={change} fontSize={Math.max(9, Math.round(size * 0.22))} /> : undefined}
      size={size}
      isSample={isSample}
      status={statusOf(poll, isSample)}
      title={data ? `${data.requests.toLocaleString()} API requests in the last 24 h, ${data.prevRequests.toLocaleString()} in the 24 h before. Project status: ${data.project.status.replace(/_/g, " ").toLowerCase()}.` : undefined}
    />
  );
}

function SbCard({ isSample, close }: CardProps) {
  const { data, poll } = use(isSample);
  return (
    <CardFrame
      title="Supabase"
      subtitle={data ? `${data.project.name} · ${data.project.region}` : "Project"}
      icon={Database}
      footer={
        <AccountFooter
          url={data ? `https://supabase.com/dashboard/project/${data.project.ref}` : "https://supabase.com/dashboard"}
          urlLabel="Open dashboard"
          onDisconnect={
            isSample
              ? undefined
              : () => {
                  void disconnectAccount(supabaseAccount);
                  close();
                }
          }
        />
      }
    >
      <CardHero label="API requests · last 24 hours" value={data ? data.requests.toLocaleString() : "–"} change={data ? pctChange(data.requests, data.prevRequests) : undefined} sub="vs the day before" />
      {data && data.series.length > 1 && <CardChart data={data.series} labels={["24 h ago", "Now"]} height={60} format={shortNumber} />}
      <StatGrid cols={4}>
        <Stat label="REST" value={data ? shortNumber(data.byService.rest) : "–"} />
        <Stat label="Auth" value={data ? shortNumber(data.byService.auth) : "–"} />
        <Stat label="Storage" value={data ? shortNumber(data.byService.storage) : "–"} />
        <Stat label="Realtime" value={data ? shortNumber(data.byService.realtime) : "–"} />
      </StatGrid>
      <StatGrid>
        <Stat label="Users" value={data?.db ? shortNumber(data.db.users) : "–"} sub={data?.db ? `+${data.db.newUsers} this week` : undefined} />
        <Stat label="Database" value={data?.db ? bytes(data.db.bytes) : "–"} />
        <Stat label="Status" value={<span className={data && healthy(data) ? "text-good" : "text-warn"}>{data ? (healthy(data) ? "Healthy" : data.project.status.replace(/_/g, " ").toLowerCase()) : "–"}</span>} />
      </StatGrid>
      {data && data.health.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-x-2">
          {data.health.map((h) => (
            <ListRow key={h.name} leading={<span className={cx("h-2 w-2 shrink-0 rounded-full", h.ok ? "bg-good" : "bg-bad")} />} title={h.name === "db" ? "Database" : h.name.charAt(0).toUpperCase() + h.name.slice(1)} right={h.ok ? "OK" : h.status.replace(/_/g, " ").toLowerCase()} />
          ))}
        </div>
      )}
      {data?.problems.map((p) => (
        <p key={p} className="mt-1.5 text-[11.5px] text-warn">
          {p}
        </p>
      ))}
      <CardStatus poll={poll} isSample={isSample} sampleText="This is a sample project. Add a Supabase access token to load yours." />
    </CardFrame>
  );
}

export default defineWidget({
  id: "developer.supabase",
  name: "Supabase",
  category: "Developer",
  description: "Health of a Supabase project and its API requests from the past day.",
  keywords: ["database", "postgres", "backend", "api", "health"],
  icon: Database,
  size: "l",
  Tile: SbTile,
  Card: SbCard,
  Connect: makeConnect(supabaseAccount),
  disconnect: () => disconnectAccount(supabaseAccount),
  cardSize: { width: 340 },
});
