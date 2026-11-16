import { Flame, GitCommitHorizontal } from "lucide-react";
import { siGithub } from "simple-icons";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, Stat, TileFrame } from "../../../ui";
import { disconnectAccount, makeConnect } from "../../finance/shared/account";
import { AccountFooter, CardStatus, GlyphIcon, StatGrid, TileMarker, dayLabel, shortError, statusOf } from "../../finance/shared/kit";
import { useAccountData } from "../../finance/shared/useAccount";
import { ContributionGrid } from "../shared/ContributionGrid";
import { githubAccount, loadContributions, sampleContributions } from "../shared/github";

const REFRESH = 30 * 60_000;
const use = (isSample: boolean) => useAccountData(githubAccount, isSample, loadContributions, sampleContributions, { refreshMs: REFRESH, key: "contributions" });

function ActivityTile({ size, isSample }: TileProps) {
  const { data, poll } = use(isSample);
  const status = statusOf(poll, isSample);
  const cell = Math.max(2, Math.floor((size * 0.8 - 6) / 7));
  const width = 3 * size + 12;
  const weeks = Math.max(6, Math.floor((width * 0.6 - size * 0.2) / (cell + 1)));
  const small = Math.max(9, Math.round(size * 0.21));
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.18)]" title={data ? `${data.total.toLocaleString()} contributions over 12 months · ${data.current}-day streak right now` : status.error}>
      {data && !status.error ? <ContributionGrid days={data.days} weeks={weeks} cell={cell} /> : <GlyphIcon glyph={siGithub} size={Math.round(size * 0.44)} className="text-dim" />}
      <div className="min-w-0 flex-1 leading-none">
        <div className="flex items-center gap-[0.3em] text-dim" style={{ fontSize: small }}>
          <span className="min-w-0 flex-1 truncate">{status.error ? "GitHub" : "Streak"}</span>
          <TileMarker isSample={isSample} status={status} size={size} />
        </div>
        {status.error ? (
          <div className="mt-[3px] truncate text-warn" style={{ fontSize: small }}>
            {shortError(status.error)}
          </div>
        ) : (
          <div className="mt-[3px] flex items-baseline gap-[0.25em] whitespace-nowrap">
            <span className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.36) }}>
              {data ? data.current : "–"}
            </span>
            <span className="text-dim" style={{ fontSize: small }}>
              {size < 40 ? "d" : data?.current === 1 ? "day" : "days"}
            </span>
          </div>
        )}
      </div>
    </TileFrame>
  );
}

function ActivityCard({ isSample, close }: CardProps) {
  const { data, poll } = use(isSample);
  const best = data?.days.reduce((a, d) => (d.count > a.count ? d : a), data.days[0]);
  const week = data?.days.slice(-7).reduce((a, d) => a + d.count, 0);
  return (
    <CardFrame
      title="GitHub Activity"
      subtitle={data ? `@${data.login}` : "Contributions"}
      icon={GitCommitHorizontal}
      footer={
        <AccountFooter
          url={data ? `https://github.com/${data.login}` : "https://github.com"}
          urlLabel="Open profile"
          onDisconnect={
            isSample
              ? undefined
              : () => {
                  void disconnectAccount(githubAccount);
                  close();
                }
          }
        />
      }
    >
      {data && (
        <div className="overflow-hidden rounded-xl bg-input p-2.5">
          <ContributionGrid days={data.days} weeks={53} cell={6} title={(d) => `${d.count} on ${dayLabel(d.date)}`} />
        </div>
      )}
      <StatGrid cols={4}>
        <Stat label="Last year" value={data ? data.total.toLocaleString() : "–"} />
        <Stat label="This week" value={week ?? "–"} />
        <Stat label="Streak" value={data ? <span className="inline-flex items-center gap-1">{data.current}{data.current >= 7 && <Flame size={14} className="text-warn" />}</span> : "–"} sub="days" />
        <Stat label="Longest" value={data?.longest ?? "–"} sub="days" />
      </StatGrid>
      {best && best.count > 0 && <p className="mt-2 text-[11.5px] text-dim">Best day: {best.count} contributions on {dayLabel(best.date)}.</p>}
      <CardStatus poll={poll} isSample={isSample} sampleText="This is a sample grid. Add a GitHub token with read:user to load yours." />
    </CardFrame>
  );
}

export default defineWidget({
  id: "online.github-activity",
  name: "GitHub Activity",
  category: "Online & Mail",
  description: "Your GitHub contribution calendar for the year and current streak.",
  keywords: ["github", "contributions", "commits", "streak", "code"],
  icon: GitCommitHorizontal,
  size: "l",
  Tile: ActivityTile,
  Card: ActivityCard,
  Connect: makeConnect(githubAccount),
  disconnect: () => disconnectAccount(githubAccount),
  cardSize: { width: 420 },
});
