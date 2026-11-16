import { MessageCircleOff } from "lucide-react";
import { useService } from "../../../core/backend";
import { relativeTime } from "../../../core/format";
import { useNow } from "../../../core/useVisible";
import type { TileProps } from "../../../core/widget";
import { TileFrame, TileNotice } from "../../../ui";
import { TileSampleBadge } from "../shared/TileBadge";
import { WhatsAppGlyph } from "./Glyph";
import { SAMPLE_STATUS, type WhatsAppStatus } from "./types";

function WhatsAppUnavailable({ size }: { size: number }) {
  return <TileNotice icon={MessageCircleOff} title="WhatsApp" detail="Not available" size={size} narrow hint="Windows on this PC won't share notifications with GlintBar" />;
}

export function WhatsAppTile({ size, isSample }: TileProps) {
  const res = useService<WhatsAppStatus>("productivity", "whatsapp_status", undefined, { refreshMs: 30_000, enabled: !isSample });
  const now = useNow("minute").getTime();
  const real = res.data;
  const allowed = real?.access === "allowed";
  const s = isSample || (real && !allowed) ? SAMPLE_STATUS : real;
  const sample = isSample || (Boolean(real) && !allowed);
  const glyph = Math.round(size * 0.56);
  const big = Math.max(11, Math.round(size * 0.29));
  const small = Math.max(9, Math.round(size * 0.22));
  const unread = s?.unread ?? 0;
  // Windows can't share notifications here: no sample numbers that could never become real.
  if (!isSample && real?.access === "unavailable") return <WhatsAppUnavailable size={size} />;
  const askAccess = Boolean(real) && !allowed;
  if (!isSample && askAccess) {
    return (
      <TileFrame padded={false} className="gap-[calc(var(--tile-h)*0.16)] px-[calc(var(--tile-h)*0.16)]" title="WhatsApp: click to give GlintBar notification access">
        <WhatsAppGlyph size={glyph} muted />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-medium" style={{ fontSize: big }}>
            Set up
          </div>
        </div>
      </TileFrame>
    );
  }
  return (
    <TileFrame padded={false} className="gap-[calc(var(--tile-h)*0.16)] px-[calc(var(--tile-h)*0.16)]" title={s ? `WhatsApp: ${unread} unread${s.lastSender ? `, last from ${s.lastSender}` : ""}` : "WhatsApp"}>
      {sample && <TileSampleBadge />}
      <div className="relative shrink-0">
        <WhatsAppGlyph size={glyph} muted={Boolean(s) && unread === 0} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1.5 grid min-w-[16px] place-items-center rounded-full bg-bad px-1 font-semibold text-white tabular-nums" style={{ fontSize: Math.max(9, Math.round(size * 0.2)), height: Math.max(14, Math.round(size * 0.32)) }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate font-medium" style={{ fontSize: big }}>
          {!s ? (res.error ? "Unavailable" : "WhatsApp") : unread && s.lastSender ? s.lastSender : unread ? `${unread} new` : "All read"}
        </div>
        <div className="truncate text-dim" style={{ fontSize: small }}>
          {askAccess ? "Allow access" : s?.lastAt && unread ? relativeTime(s.lastAt, now) : "WhatsApp"}
        </div>
      </div>
    </TileFrame>
  );
}
