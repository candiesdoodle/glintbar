import { Bell, GitPullRequest, LayoutGrid, Star } from "lucide-react";
import { siGithub } from "simple-icons";
import { call } from "../../../core/backend";
import { shortNumber } from "../../../core/format";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, ListRow, Stat, TileFrame } from "../../../ui";
import { disconnectAccount, makeConnect } from "../../finance/shared/account";
import { AccountFooter, CardStatus, GlyphIcon, StatGrid, TileMarker, shortError, statusOf } from "../../finance/shared/kit";
import { useAccountData } from "../../finance/shared/useAccount";
import { githubAccount, loadOverview, sampleOverview } from "../shared/github";

const REFRESH = 10 * 60_000;
const use = (isSample: boolean) => useAccountData(githubAccount, isSample, loadOverview, sampleOverview, { refreshMs: REFRESH, key: "overview" });

function OverviewTile({ size, isSample }: TileProps) {
  const { data, poll } = use(isSample);
  const status = statusOf(poll, isSample);
  const small = Math.max(9, Math.round(size * 0.21));
  const big = Math.round(size * (size < 40 ? 0.3 : 0.32));
  const icon = Math.round(big * 0.8);
  const items = data
    ? [
        { Icon: Bell, v: data.notifications === undefined ? "–" : `${data.notifications}${data.notificationsMore ? "+" : ""}`, t: "Unread notifications" },
        { Icon: GitPullRequest, v: String(data.openPrs), t: "Open pull requests" },
        { Icon: Star, v: shortNumber(data.stars), t: "Stars on your repositories" },
      ]
    : [];
  return (
    <TileFrame title={status.error ?? items.map((i) => `${i.t}: ${i.v}`).join("\n")}>
      <div className="min-w-0 flex-1 leading-none">
        <div className="flex min-w-0 items-center gap-[0.3em] text-dim" style={{ fontSize: small }}>
          <GlyphIcon glyph={siGithub} size={Math.round(small * 1.1)} />
          <span className="min-w-0 flex-1 truncate">{data ? data.login : "GitHub"}</span>
          <TileMarker isSample={isSample} status={status} size={size} />
        </div>
        {status.error ? (
          <div className="mt-[3px] truncate text-warn" style={{ fontSize: small }}>
            {shortError(status.error)}
          </div>
        ) : (
          <div className="mt-[4px] flex items-center justify-between gap-[0.4em]">
            {items.map(({ Icon, v, t }) => (
              <span key={t} className="flex min-w-0 items-center gap-[0.25em]">
                <Icon size={icon} className="shrink-0 text-dim" />
                <span className="truncate font-semibold tabular-nums" style={{ fontSize: big }}>
                  {v}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </TileFrame>
  );
}

function OverviewCard({ isSample, close }: CardProps) {
  const { data, poll } = use(isSample);
  const open = (url: string) => call("shell", "open", { target: url }).catch(() => {});
  return (
    <CardFrame
      title="GitHub Overview"
      subtitle={data ? `@${data.login}` : "GitHub"}
      icon={LayoutGrid}
      footer={
        <AccountFooter
          url="https://github.com/pulls"
          urlLabel="Open pull requests"
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
      <StatGrid>
        <Stat label="Notifications" value={data?.notifications ?? "–"} sub={data?.notificationsError ? "Needs the notifications scope" : "unread"} />
        <Stat label="Open PRs" value={data?.openPrs ?? "–"} sub="by you" />
        <Stat label="Stars" value={data ? data.stars.toLocaleString() : "–"} sub="on your repos" />
      </StatGrid>
      {data && data.prs.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 px-1 text-[11px] font-medium tracking-wide text-faint uppercase">Open pull requests</div>
          {data.prs.map((p) => (
            <ListRow key={p.url + p.title} icon={GitPullRequest} title={p.title} subtitle={p.repo} onClick={() => open(p.url)} />
          ))}
        </div>
      )}
      {data && data.repos.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 px-1 text-[11px] font-medium tracking-wide text-faint uppercase">Most starred</div>
          {data.repos.map((r) => (
            <ListRow key={r.name} icon={Star} title={r.name} right={r.stars.toLocaleString()} onClick={() => open(r.url)} />
          ))}
        </div>
      )}
      <CardStatus poll={poll} isSample={isSample} sampleText="These are sample figures. Add a GitHub token to load yours." />
    </CardFrame>
  );
}

export default defineWidget({
  id: "online.github-overview",
  name: "GitHub Overview",
  category: "Online & Mail",
  description: "Unread GitHub notifications, your open PRs and total stars.",
  keywords: ["github", "pull requests", "stars", "notifications", "repos"],
  icon: LayoutGrid,
  size: "l",
  Tile: OverviewTile,
  Card: OverviewCard,
  Connect: makeConnect(githubAccount),
  disconnect: () => disconnectAccount(githubAccount),
  cardSize: { width: 340 },
});
