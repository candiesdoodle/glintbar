import { ChevronUp, Settings2, SquareStack } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { call, useService } from "../../../core/backend";
import { describeError } from "../../../core/http";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { Button, CardFrame, EmptyState, ErrorState, Section, Skeleton, TileFrame } from "../../../ui";
import type { TrayIcon, TrayList } from "../shared/types";

function TrayTile({ size, isSample }: TileProps) {
  // Asked once: whether this Windows lets GlintBar list the icons does not change while it runs.
  const list = useService<TrayList>("system", "tray_list", undefined, { enabled: !isSample });
  // Where the icons can't be listed the card would be empty, so a click opens Windows' own
  // "hidden icons" flyout straight away.
  const direct = list.data !== undefined && list.data !== null && !list.data.supported;
  return (
    <div
      className="h-full w-full"
      onClick={(e) => {
        if (!direct) return;
        e.stopPropagation();
        call("system", "tray_overflow").catch((err) => console.warn("tray: could not open the flyout", err));
      }}
    >
      <TileFrame padded={false} className="justify-center" title={direct ? "Hidden icons" : "Tray icons"}>
        <ChevronUp size={Math.round(size * 0.44)} className="text-dim" strokeWidth={2.4} />
      </TileFrame>
    </div>
  );
}

function IconButton({ icon, onError }: { icon: TrayIcon; onError: (m: string) => void }) {
  const send = (button: "left" | "right" | "double") =>
    call("system", "tray_click", { hwnd: icon.hwnd, uid: icon.uid, callback: icon.callback, button }).catch((e) => onError(describeError(e)));
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    // Wait a moment so a double-click isn't also sent as a single click.
    if (e.detail > 1) return;
    clickTimer.current = setTimeout(() => void send("left"), 220);
  };
  const onDoubleClick = (e: MouseEvent) => {
    e.stopPropagation();
    clearTimeout(clickTimer.current);
    void send("double");
  };
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void send("right");
  };
  return (
    <button
      type="button"
      title={icon.tooltip || "Tray icon"}
      aria-label={icon.tooltip || "Tray icon"}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className="g-press grid h-10 w-10 place-items-center rounded-xl hover:bg-hover"
    >
      {icon.icon ? (
        <img src={icon.icon} alt="" className="h-5 w-5 object-contain" draggable={false} />
      ) : (
        <span className="grid h-5 w-5 place-items-center rounded-md bg-track text-[10px] font-semibold text-dim">{(icon.tooltip || "?").slice(0, 1)}</span>
      )}
    </button>
  );
}

function TrayCard(_: CardProps) {
  const list = useService<TrayList>("system", "tray_list", undefined, { refreshMs: 3000 });
  const [error, setError] = useState<string | null>(null);
  const data = list.data;
  const openOverflow = () => call("system", "tray_overflow").catch((e) => setError(describeError(e)));
  const openSettings = () => call("shell", "open", { target: "ms-settings:taskbar" }).catch(() => {});
  const main = data?.icons.filter((i) => !i.overflow) ?? [];
  const hidden = data?.icons.filter((i) => i.overflow) ?? [];

  return (
    <CardFrame
      title="Tray"
      subtitle={data?.supported ? `${data.icons.length} icons · right-click opens each app's menu` : "Notification area"}
      icon={SquareStack}
      footer={
        <>
          <Button size="sm" icon={ChevronUp} onClick={openOverflow}>
            Hidden icons
          </Button>
          <Button size="sm" variant="ghost" icon={Settings2} onClick={openSettings}>
            Settings
          </Button>
        </>
      }
    >
      {!data && list.loading && (
        <div className="grid grid-cols-6 gap-1 py-1">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-10 rounded-xl" />
          ))}
        </div>
      )}
      {data && !data.supported && (
        <EmptyState
          icon={SquareStack}
          title="Use the Windows flyout for tray icons"
          message={`${data.reason ?? "GlintBar can't read the tray on this Windows version."} The "Hidden icons" button below shows the Windows flyout instead.`}
        />
      )}
      {data?.supported && data.icons.length === 0 && <EmptyState icon={SquareStack} title="No tray icons" message="Icons from apps in the notification area will appear here." />}
      {main.length > 0 && (
        <Section title="Shown" className="mb-2">
          <div className="-mx-2 grid grid-cols-6 gap-0.5 py-1.5">
            {main.map((i) => (
              <IconButton key={i.key} icon={i} onError={setError} />
            ))}
          </div>
        </Section>
      )}
      {hidden.length > 0 && (
        <Section title="Hidden" className="mb-0">
          <div className="-mx-2 grid grid-cols-6 gap-0.5 py-1.5">
            {hidden.map((i) => (
              <IconButton key={i.key} icon={i} onError={setError} />
            ))}
          </div>
        </Section>
      )}
      {(error || list.error) && <ErrorState className="mt-2" message={error ?? describeError(list.error)} onRetry={list.refresh} />}
    </CardFrame>
  );
}

export default defineWidget({
  id: "system.tray",
  name: "Tray",
  category: "System",
  description: "Your notification-area icons in a grid. On Windows 11 22H2 and later it opens Windows' own hidden-icons flyout instead.",
  keywords: ["notification area", "system tray", "icons", "hidden icons", "overflow"],
  icon: ChevronUp,
  size: "s",
  Tile: TrayTile,
  Card: TrayCard,
  cardSize: { width: 320 },
});
