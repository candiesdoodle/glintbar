import { Bell } from "lucide-react";
import { siGithub } from "simple-icons";
import { call } from "../../../core/backend";
import { relativeTime } from "../../../core/format";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, EmptyState, ListRow } from "../../../ui";
import { disconnectAccount, makeConnect } from "../../finance/shared/account";
import { AccountFooter, CardHero, CardStatus, MetricTile, statusOf } from "../../finance/shared/kit";
import { useAccountData } from "../../finance/shared/useAccount";
import { githubAccount, loadNotifications, sampleNotifications } from "../shared/github";

const REFRESH = 5 * 60_000;
const use = (isSample: boolean) => useAccountData(githubAccount, isSample, loadNotifications, sampleNotifications, { refreshMs: REFRESH, key: "notifications" });

function GithubTile({ size, isSample }: TileProps) {
  const { data, poll } = use(isSample);
  return (
    <MetricTile
      glyph={siGithub}
      label="Unread"
      value={data ? `${data.count}${data.more ? "+" : ""}` : "–"}
      size={size}
      isSample={isSample}
      status={statusOf(poll, isSample)}
      title={data ? `${data.count}${data.more ? "+" : ""} unread GitHub notifications` : undefined}
    />
  );
}

const TYPE: Record<string, string> = { PullRequest: "Pull request", Issue: "Issue", Release: "Release", Discussion: "Discussion", CheckSuite: "Checks", Commit: "Commit" };

function GithubCard({ isSample, close }: CardProps) {
  const { data, poll } = use(isSample);
  return (
    <CardFrame
      title="GitHub"
      subtitle="Unread notifications"
      icon={Bell}
      footer={
        <AccountFooter
          url="https://github.com/notifications"
          urlLabel="Open notifications"
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
      <CardHero label="Unread" value={data ? `${data.count}${data.more ? "+" : ""}` : "–"} />
      <div className="mt-2">
        {data && data.items.length === 0 && <EmptyState icon={Bell} title="All caught up" message="Nothing unread right now." />}
        {data?.items.map((n) => (
          <ListRow
            key={n.id}
            title={n.title}
            subtitle={`${n.repo} · ${TYPE[n.type] ?? n.type}`}
            right={relativeTime(Date.parse(n.updatedAt))}
            onClick={() => call("shell", "open", { target: n.url }).catch(() => {})}
          />
        ))}
      </div>
      <CardStatus poll={poll} isSample={isSample} sampleText="These are sample notifications. Add a GitHub token with the notifications scope to load yours." />
    </CardFrame>
  );
}

export default defineWidget({
  id: "online.github",
  name: "GitHub",
  category: "Online & Mail",
  description: "Your unread GitHub notifications, with links to each one.",
  keywords: ["github", "notifications", "inbox", "pull requests", "issues"],
  icon: Bell,
  size: "m",
  Tile: GithubTile,
  Card: GithubCard,
  Connect: makeConnect(githubAccount),
  disconnect: () => disconnectAccount(githubAccount),
  cardSize: { width: 340 },
});
