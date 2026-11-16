import { Code2, Flame } from "lucide-react";
import { siLeetcode } from "simple-icons";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, ProgressBar, Stat } from "../../../ui";
import { disconnectAccount, makeConnect } from "../../finance/shared/account";
import { AccountFooter, CardHero, CardStatus, MetricTile, StatGrid, dayLabel, statusOf } from "../../finance/shared/kit";
import { useAccountData } from "../../finance/shared/useAccount";
import { ContributionGrid } from "../shared/ContributionGrid";
import type { Level } from "../shared/github";
import { leetAccount, loadLeet, sampleLeet, type LeetData } from "./api";

const REFRESH = 60 * 60_000;
const use = (isSample: boolean) => useAccountData(leetAccount, isSample, loadLeet, sampleLeet, { refreshMs: REFRESH });

function LeetTile({ size, isSample }: TileProps) {
  const { data, poll } = use(isSample);
  const fs = Math.max(9, Math.round(size * 0.22));
  return (
    <MetricTile
      glyph={siLeetcode}
      label={
        data ? (
          <span className="inline-flex items-center gap-[0.15em]">
            <Flame size={fs} className={data.streak > 0 ? "text-warn" : "text-faint"} />
            {data.streak}d streak
          </span>
        ) : (
          "Solved"
        )
      }
      value={data ? data.solved.toLocaleString() : "–"}
      size={size}
      isSample={isSample}
      status={statusOf(poll, isSample)}
      title={data ? `${data.solved} solved (${data.easy} easy, ${data.medium} medium, ${data.hard} hard) · streak ${data.streak} days` : undefined}
    />
  );
}

const DIFF: Array<{ key: "easy" | "medium" | "hard"; label: string; color: string }> = [
  { key: "easy", label: "Easy", color: "var(--g-good)" },
  { key: "medium", label: "Medium", color: "var(--g-warn)" },
  { key: "hard", label: "Hard", color: "var(--g-bad)" },
];

const level = (n: number): Level => (n === 0 ? 0 : n < 2 ? 1 : n < 4 ? 2 : n < 7 ? 3 : 4);

function LeetCard({ isSample, close }: CardProps) {
  const { data, poll } = use(isSample);
  return (
    <CardFrame
      title="LeetCode Stats"
      subtitle={data ? data.username : "Public profile"}
      icon={Code2}
      footer={
        <AccountFooter
          url={data ? `https://leetcode.com/u/${data.username}/` : "https://leetcode.com/"}
          urlLabel="Open profile"
          onDisconnect={
            isSample
              ? undefined
              : () => {
                  void disconnectAccount(leetAccount);
                  close();
                }
          }
        />
      }
    >
      <CardHero label="Problems solved" value={data ? data.solved.toLocaleString() : "–"} sub={data?.totals.all ? `of ${data.totals.all.toLocaleString()}` : undefined} />
      <div className="mt-3 space-y-2">
        {DIFF.map((d) => (
          <div key={d.key}>
            <div className="mb-1 flex justify-between text-[12px]">
              <span className="text-dim">{d.label}</span>
              <span className="tabular-nums">
                {data ? data[d.key] : "–"}
                <span className="text-faint"> / {data?.totals[d.key] || "–"}</span>
              </span>
            </div>
            <ProgressBar value={data ? data[d.key] : 0} max={(data as LeetData | undefined)?.totals[d.key] || 1} color={d.color} height={5} />
          </div>
        ))}
      </div>
      <StatGrid>
        <Stat label="Streak" value={data ? `${data.streak}d` : "–"} />
        <Stat label="Best this year" value={data ? `${data.maxStreak}d` : "–"} />
        <Stat label="Active days" value={data?.activeDays ?? "–"} />
      </StatGrid>
      {data && (
        <div className="mt-3 overflow-hidden rounded-xl bg-input p-2.5">
          <ContributionGrid days={data.calendar.map((c) => ({ date: c.date, count: c.count, level: level(c.count) }))} weeks={26} cell={8} gap={2} title={(d) => `${d.count} submissions on ${dayLabel(d.date)}`} />
        </div>
      )}
      <CardStatus poll={poll} isSample={isSample} sampleText="These are sample stats. Enter your LeetCode username to load yours." />
    </CardFrame>
  );
}

export default defineWidget({
  id: "online.leetcode",
  name: "LeetCode Stats",
  category: "Online & Mail",
  description: "LeetCode problems solved, daily streak and submission calendar.",
  keywords: ["leetcode", "coding", "interview", "algorithms", "streak"],
  icon: Code2,
  size: "m",
  Tile: LeetTile,
  Card: LeetCard,
  Connect: makeConnect(leetAccount),
  disconnect: () => disconnectAccount(leetAccount),
  cardSize: { width: 340 },
});
