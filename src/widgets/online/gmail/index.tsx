import { useEffect, useState } from "react";
import { Inbox, Mail, PenSquare, Search, Star } from "lucide-react";
import { siGmail } from "simple-icons";
import { call } from "../../../core/backend";
import { shortNumber } from "../../../core/format";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { Button, CardFrame, EmptyState, ErrorState, Segmented, Skeleton, TextInput, cx } from "../../../ui";
import { AccountFooter, CardStatus, MetricTile, statusOf } from "../../finance/shared/kit";
import { usePolled } from "../../finance/shared/poll";
import { makeOAuthConnect, signOut } from "../shared/oauth";
import { gmailAccount, loadCounts, loadList, mailTime, sampleCounts, sampleMessages, type Mailbox } from "./api";

const REFRESH = 5 * 60_000;

function useCounts(isSample: boolean) {
  const poll = usePolled(isSample ? null : `${gmailAccount.ns}:counts`, loadCounts, { refreshMs: REFRESH });
  return { data: isSample ? sampleCounts() : poll.data, poll };
}

function GmailTile({ size, isSample }: TileProps) {
  const { data, poll } = useCounts(isSample);
  return (
    <MetricTile
      glyph={siGmail}
      label="Unread"
      value={data ? shortNumber(data.unread) : "–"}
      sub={size >= 52 && data && data.today > 0 ? `+${data.today}` : undefined}
      size={size}
      isSample={isSample}
      status={statusOf(poll, isSample)}
      title={data ? `Inbox: ${data.unread.toLocaleString()} unread · ${data.today}${data.todayMore ? "+" : ""} received today` : undefined}
    />
  );
}

const BOXES: Array<{ value: Mailbox; label: string }> = [
  { value: "unread", label: "Unread" },
  { value: "inbox", label: "Inbox" },
  { value: "starred", label: "Starred" },
];

function GmailCard({ isSample, close }: CardProps) {
  const { data: counts, poll } = useCounts(isSample);
  const [box, setBox] = useState<Mailbox>("unread");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(typed), 450);
    return () => clearTimeout(t);
  }, [typed]);
  const list = usePolled(isSample ? null : `${gmailAccount.ns}:list:${box}:${search}`, () => loadList(box, search), { refreshMs: REFRESH, persist: false });
  const messages = isSample ? sampleMessages(box).filter((m) => !search || `${m.from} ${m.subject} ${m.snippet}`.toLowerCase().includes(search.toLowerCase())) : list.data;
  const open = (target: string) => call("shell", "open", { target }).catch(() => {});

  return (
    <CardFrame
      title="Gmail"
      subtitle={counts ? `${counts.unread.toLocaleString()} unread · ${counts.today}${counts.todayMore ? "+" : ""} today` : "Your inbox"}
      icon={Mail}
      actions={<Button size="sm" icon={PenSquare} onClick={() => open("https://mail.google.com/mail/u/0/#inbox?compose=new")}>New</Button>}
      footer={
        <AccountFooter
          url="https://mail.google.com/mail/u/0/#inbox"
          urlLabel="Open Gmail"
          onDisconnect={
            isSample
              ? undefined
              : () => {
                  void signOut(gmailAccount);
                  close();
                }
          }
        />
      }
    >
      <div className="flex items-center gap-2">
        <Segmented value={box} options={BOXES} onChange={setBox} />
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
          <TextInput className="pl-7" placeholder="Search mail" value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} />
        </div>
      </div>
      <div className="mt-2 min-h-[220px]">
        {!messages && list.loading && (
          <div className="space-y-3 px-2 py-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}
        {!messages && Boolean(list.error) && <ErrorState message={list.message} onRetry={list.refresh} />}
        {messages?.length === 0 && <EmptyState icon={box === "starred" ? Star : Inbox} title={search ? "Nothing found" : box === "unread" ? "No unread mail" : "Nothing here"} />}
        {messages?.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => open(`https://mail.google.com/mail/u/0/#all/${m.threadId}`)}
            className="flex w-full gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
          >
            <span className={cx("mt-[6px] h-2 w-2 shrink-0 rounded-full", m.unread ? "bg-accent" : "bg-transparent")} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className={cx("min-w-0 flex-1 truncate text-[13px]", m.unread ? "font-semibold text-fg" : "text-fg")}>{m.from}</span>
                <span className="shrink-0 text-[11px] text-faint">{mailTime(m.at)}</span>
              </span>
              <span className="block truncate text-[12px] text-fg">{m.subject}</span>
              <span className="block truncate text-[11.5px] text-dim">{m.snippet}</span>
            </span>
          </button>
        ))}
      </div>
      <CardStatus poll={poll} isSample={isSample} sampleText="This is sample mail. Sign in with your own Google client to load yours." />
    </CardFrame>
  );
}

export default defineWidget({
  id: "online.gmail",
  name: "Gmail",
  category: "Online & Mail",
  description: "Gmail unread count, with a card to search unread, starred or all mail.",
  keywords: ["email", "mail", "inbox", "google", "unread"],
  icon: Mail,
  size: "m",
  Tile: GmailTile,
  Card: GmailCard,
  Connect: makeOAuthConnect(gmailAccount),
  disconnect: () => signOut(gmailAccount),
  disconnectLabel: "Sign out",
  cardSize: { width: 380, height: 560 },
});
