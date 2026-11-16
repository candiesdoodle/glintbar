import { useState } from "react";
import { BellRing, ExternalLink, MessageCircle, Settings, ShieldCheck } from "lucide-react";
import { call, useService } from "../../../core/backend";
import { relativeTime } from "../../../core/format";
import { describeError } from "../../../core/http";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, EmptyState, ErrorState, SampleBadge, Skeleton, Spinner } from "../../../ui";
import { WhatsAppGlyph } from "./Glyph";
import { SAMPLE_STATUS, type WhatsAppStatus } from "./types";

export function WhatsAppCard({ isSample }: CardProps) {
  const res = useService<WhatsAppStatus>("productivity", "whatsapp_status", undefined, { refreshMs: 15_000, enabled: !isSample });
  const [asking, setAsking] = useState(false);
  const [askResult, setAskResult] = useState<WhatsAppStatus | null>(null);
  const real = askResult ?? res.data;
  const s = isSample ? SAMPLE_STATUS : real;
  const open = () => call("shell", "open", { target: "whatsapp:" }).catch(() => {});

  const ask = async () => {
    setAsking(true);
    try {
      const r = await call<WhatsAppStatus>("productivity", "whatsapp_request_access");
      setAskResult(r);
      res.refresh();
    } catch {
      setAskResult(null);
    } finally {
      setAsking(false);
    }
  };

  let body;
  if (!s) body = res.error ? <ErrorState message={describeError(res.error)} onRetry={res.refresh} /> : <Skeleton className="h-24 w-full" />;
  else if (s.access !== "allowed") {
    body = (
      <div className="flex flex-col items-center gap-2 px-2 py-4 text-center">
        <ShieldCheck size={26} className="text-faint" />
        <div className="text-[13px] font-medium">
          {s.access === "denied" ? "GlintBar cannot see notifications" : s.access === "unavailable" ? "This PC cannot share notifications" : "GlintBar needs notification access"}
        </div>
        <div className="max-w-[280px] text-[12px] leading-snug text-dim">
          {s.message ?? "Only WhatsApp's notifications are counted. GlintBar ignores other apps and sends nothing off this PC."}
        </div>
        {s.access === "unspecified" && (
          <Button variant="primary" icon={BellRing} disabled={asking} onClick={() => void ask()}>
            {asking ? <Spinner /> : "Allow access"}
          </Button>
        )}
        {s.access !== "unavailable" && (
          <Button icon={Settings} onClick={() => call("shell", "open", { target: "ms-settings:privacy-notifications" }).catch(() => {})}>
            Open notification settings
          </Button>
        )}
        {s.access === "unavailable" && <div className="text-[11.5px] text-faint">The WhatsApp taskbar icon keeps its own unread badge.</div>}
      </div>
    );
  } else if (s.chats.length === 0) {
    body = <EmptyState icon={MessageCircle} title="No new messages" message="When a WhatsApp notification comes in, the chat is listed here." />;
  } else {
    body = (
      <div className="-mx-1">
        {s.chats.map((c) => (
          <div key={c.name} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-good/15 text-[12px] font-semibold text-good">{c.name.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-fg">{c.name}</div>
              <div className="text-[11.5px] text-dim">{relativeTime(c.lastAt)}</div>
            </div>
            <span className="grid min-w-[20px] place-items-center rounded-full bg-good px-1.5 text-[11px] font-semibold text-white tabular-nums">{c.count}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <CardFrame
      title="WhatsApp"
      subtitle={s?.access === "allowed" ? `${s.unread} unread · from Windows notifications` : "Read from Windows notifications"}
      actions={
        <>
          {isSample && <SampleBadge />}
          <WhatsAppGlyph size={20} />
        </>
      }
      footer={
        <Button className="ml-auto" size="sm" icon={ExternalLink} onClick={open}>
          Open WhatsApp
        </Button>
      }
    >
      {body}
    </CardFrame>
  );
}
