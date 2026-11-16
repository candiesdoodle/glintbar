import { CircleDot } from "lucide-react";
import { siLinear } from "simple-icons";
import { call } from "../../../core/backend";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, ListRow, Stat } from "../../../ui";
import { disconnectAccount, makeConnect } from "../../finance/shared/account";
import { AccountFooter, CardChart, CardHero, CardStatus, MetricTile, StatGrid, dayLabel, statusOf } from "../../finance/shared/kit";
import { useAccountData } from "../../finance/shared/useAccount";
import { linearAccount, loadLinear, sampleLinear } from "./api";

const REFRESH = 10 * 60_000;
const use = (isSample: boolean) => useAccountData(linearAccount, isSample, loadLinear, sampleLinear, { refreshMs: REFRESH });
const PRIORITY = ["", "Urgent", "High", "Medium", "Low"];

function LinearTile({ size, isSample }: TileProps) {
  const { data, poll } = use(isSample);
  return (
    <MetricTile
      glyph={siLinear}
      label="Assigned"
      value={data ? data.open : "–"}
      sub={data ? `${data.inProgress} active` : undefined}
      size={size}
      isSample={isSample}
      status={statusOf(poll, isSample)}
      title={data ? `You have ${data.open} open issues, ${data.inProgress} of them started. Completed over the past 7 days: ${data.done7}` : undefined}
    />
  );
}

function LinearCard({ isSample, close }: CardProps) {
  const { data, poll } = use(isSample);
  return (
    <CardFrame
      title="Linear"
      subtitle="Issues assigned to you"
      icon={CircleDot}
      footer={
        <AccountFooter
          url="https://linear.app/"
          urlLabel="Open Linear"
          onDisconnect={
            isSample
              ? undefined
              : () => {
                  void disconnectAccount(linearAccount);
                  close();
                }
          }
        />
      }
    >
      <CardHero label="Open and assigned" value={data?.open ?? "–"} sub={data ? `${data.inProgress} in progress` : undefined} />
      <StatGrid>
        <Stat label="To do" value={data?.todo ?? "–"} />
        <Stat label="Backlog" value={data?.backlog ?? "–"} />
        <Stat label="Urgent" value={data?.urgent ?? "–"} />
        <Stat label="Overdue" value={<span className={data?.overdue ? "text-bad" : undefined}>{data?.overdue ?? "–"}</span>} />
        <Stat label="Due this week" value={data?.dueThisWeek ?? "–"} />
        <Stat label="Done · 7d" value={data?.done7 ?? "–"} />
      </StatGrid>
      <div className="mt-3 text-[11px] text-dim">Finished per day</div>
      <CardChart data={data?.doneDaily ?? []} labels={data ? [dayLabel(data.days[0]), "Today"] : undefined} height={56} />
      {data && data.active.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 px-1 text-[11px] font-medium tracking-wide text-faint uppercase">Up next</div>
          {data.active.map((i) => (
            <ListRow
              key={i.identifier}
              title={i.title}
              subtitle={`${i.identifier} · ${i.state}${i.priority ? ` · ${PRIORITY[i.priority]}` : ""}`}
              right={i.dueDate ? dayLabel(i.dueDate) : undefined}
              onClick={isSample ? undefined : () => call("shell", "open", { target: i.url }).catch(() => {})}
            />
          ))}
        </div>
      )}
      <CardStatus poll={poll} isSample={isSample} sampleText="These are sample issues. Add a Linear personal API key to load yours." />
    </CardFrame>
  );
}

export default defineWidget({
  id: "developer.linear",
  name: "Linear",
  category: "Developer",
  description: "Your assigned Linear issues: in progress and due this week.",
  keywords: ["issues", "tasks", "tickets", "project", "sprint"],
  icon: CircleDot,
  size: "l",
  Tile: LinearTile,
  Card: LinearCard,
  Connect: makeConnect(linearAccount),
  disconnect: () => disconnectAccount(linearAccount),
  cardSize: { width: 340 },
});
