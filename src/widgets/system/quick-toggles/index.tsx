import { BatteryMedium, Bluetooth, Gamepad2, Headphones, Laptop, Mouse, Settings2, Smartphone, ToggleRight } from "lucide-react";
import type { MouseEvent, PointerEvent } from "react";
import { call, useService } from "../../../core/backend";
import { describeError } from "../../../core/http";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { useDockUi } from "../../../dock/ui";
import { Button, CardFrame, ErrorState, ListRow, Section, Segmented, SettingRow, Skeleton, TileFrame, Toggle, cx } from "../../../ui";
import type { BtDevice, DisplayMode } from "../shared/types";
import { ALL_TOGGLES, DEFAULT_TOGGLES, tileToggles, viewOf, type ToggleId, type ToggleView } from "./toggles";
import { useToggles } from "./useToggles";

type QTConfig = { toggles: ToggleId[] };

function TileButton({ v, d, onPress, live }: { v: ToggleView; d: number; onPress: () => void; live: boolean }) {
  const Icon = v.icon;
  const stop = (e: PointerEvent | MouseEvent) => {
    if (live) e.stopPropagation();
  };
  return (
    <button
      type="button"
      title={`${v.label}: ${v.sub}`}
      aria-label={v.label}
      aria-pressed={v.action ? undefined : v.on}
      onPointerDown={stop}
      onClick={(e) => {
        stop(e);
        if (live) onPress();
      }}
      className={cx(
        "g-press relative grid shrink-0 place-items-center rounded-full transition-colors duration-200",
        v.on ? "bg-accent text-on-accent" : "bg-hover text-fg hover:bg-tile-hover",
      )}
      style={{ width: d, height: d }}
    >
      <Icon size={Math.round(d * 0.46)} strokeWidth={2.2} />
      {v.warn && <span className="absolute top-[8%] right-[8%] h-[22%] w-[22%] rounded-full border-2 border-tile bg-warn" />}
    </button>
  );
}

function QuickTogglesTile({ config, size, isSample }: TileProps<QTConfig>) {
  const { state, override, flip } = useToggles();
  const editing = useDockUi((s) => s.panel === "widgets");
  const chosen = tileToggles(config.toggles, state).map((id) => viewOf(id, state, override));
  const shown = state ? chosen.filter((v) => v.available) : chosen;
  const d = Math.round(size * 0.7);
  const gap = Math.max(3, Math.round(size * 0.1));
  const width = 4 * size + 3 * 6;
  const fit = Math.max(1, Math.floor((width - size * 0.24 + gap) / (d + gap)));
  const live = !isSample && !editing;
  return (
    <TileFrame padded={false} className="justify-center" title="Quick toggles">
      <div className="flex items-center" style={{ gap }}>
        {shown.slice(0, fit).map((v) =>
          state || isSample ? (
            <TileButton key={v.id} v={v} d={d} live={live} onPress={() => void flip(v.id)} />
          ) : (
            <span key={v.id} className="animate-pulse rounded-full bg-track" style={{ width: d, height: d }} />
          ),
        )}
        {state && shown.length === 0 && <span className="px-2 text-[11px] text-dim">Choose toggles in the card</span>}
      </div>
    </TileFrame>
  );
}

function Pill({ v, onPress, busy }: { v: ToggleView; onPress: () => void; busy: boolean }) {
  const Icon = v.icon;
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={v.action ? undefined : v.on}
      className={cx("g-press flex min-w-0 items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left transition-colors", v.on ? "bg-accent/15" : "bg-input hover:bg-hover")}
    >
      <span className={cx("relative grid h-8 w-8 shrink-0 place-items-center rounded-full", v.on ? "bg-accent text-on-accent" : "bg-hover text-fg", busy && "animate-pulse")}>
        <Icon size={16} strokeWidth={2.2} />
        {v.warn && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-warn" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium text-fg">{v.label}</span>
        <span className={cx("block truncate text-[11px]", v.warn ? "text-warn" : "text-dim")}>{v.sub}</span>
      </span>
    </button>
  );
}

function deviceIcon(kind: BtDevice["kind"]) {
  if (kind === "audio") return Headphones;
  if (kind === "input") return Mouse;
  if (kind === "phone") return Smartphone;
  if (kind === "computer") return Laptop;
  return Gamepad2;
}

function BluetoothSection({ on }: { on: boolean }) {
  const devices = useService<BtDevice[]>("system", "bluetooth_devices", undefined, { refreshMs: 20_000, enabled: on });
  if (!on) return null;
  const list = devices.data ?? [];
  return (
    <Section title="Bluetooth devices" className="mt-3 mb-0">
      <div className="-mx-2 py-1">
        {devices.loading && !devices.data && (
          <div className="flex flex-col gap-2 px-2 py-1.5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-32" />
          </div>
        )}
        {list.map((dev) => (
          <ListRow
            key={dev.id}
            icon={deviceIcon(dev.kind)}
            title={dev.name}
            subtitle={dev.connected ? "Connected" : "Paired"}
            right={
              dev.battery !== null ? (
                <span className={cx("flex items-center gap-1", dev.battery <= 20 ? "text-bad" : "text-fg")}>
                  <BatteryMedium size={14} /> {dev.battery}%
                </span>
              ) : (
                ""
              )
            }
          />
        ))}
        {devices.data && list.length === 0 && <div className="px-2 py-1.5 text-[12px] text-dim">No devices paired so far.</div>}
        {devices.error && <div className="px-2 py-1.5 text-[12px] text-dim">Bluetooth device list failed: {describeError(devices.error)}</div>}
      </div>
    </Section>
  );
}

const MODES: DisplayMode[] = ["internal", "clone", "extend", "external"];
const SHORT_MODE: Record<DisplayMode, string> = { internal: "PC only", clone: "Duplicate", extend: "Extend", external: "Second only" };

function QuickTogglesCard({ config, setConfig }: CardProps<QTConfig>) {
  const { state, override, flip, note, busy, error, refresh } = useToggles();
  const views = ALL_TOGGLES.map((id) => viewOf(id, state, override));
  const available = views.filter((v) => v.available && v.id !== "displayMode");
  const chosen = tileToggles(config.toggles, state);
  const setChosen = (id: ToggleId, on: boolean) => {
    const next = on ? ALL_TOGGLES.filter((t) => t === id || chosen.includes(t)) : chosen.filter((t) => t !== id);
    setConfig({ toggles: next });
  };
  const mode = state?.displayMode ?? null;
  return (
    <CardFrame
      title="Quick toggles"
      subtitle={state ? (state.online ? "Online" : "Offline") : "…"}
      icon={ToggleRight}
      footer={
        <>
          <Button size="sm" icon={Settings2} onClick={() => call("system", "quick_settings_open").catch(() => {})}>
            Windows Quick Settings
          </Button>
          <Button size="sm" variant="ghost" icon={Bluetooth} onClick={() => call("shell", "open", { target: "ms-settings:bluetooth" }).catch(() => {})}>
            Devices
          </Button>
        </>
      }
    >
      {!state && !error && (
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[52px] w-full rounded-2xl" />
          ))}
        </div>
      )}
      {error && !state && <ErrorState message={`Toggle states are unavailable: ${describeError(error)}`} onRetry={refresh} />}
      {state && (
        <div className="grid grid-cols-2 gap-2">
          {available.map((v) => (
            <Pill key={v.id} v={v} busy={busy === v.id} onPress={() => void flip(v.id)} />
          ))}
        </div>
      )}
      {note && <div className="mt-2 rounded-lg bg-input px-3 py-2 text-[12px] text-dim">{note}</div>}
      {mode && (
        <Section title="Display mode" className="mt-3 mb-0">
          <div className="py-2.5">
            <Segmented<DisplayMode>
              value={mode}
              className="flex w-full [&>button]:flex-1 [&>button]:px-1 [&>button]:whitespace-nowrap [&>button]:text-[11.5px]"
              options={MODES.map((m) => ({ value: m, label: SHORT_MODE[m] }))}
              onChange={(m) => void flip("displayMode", m)}
            />
          </div>
        </Section>
      )}
      <BluetoothSection on={!!state?.bluetooth} />
      <Section title="On the tile" className="mt-3 mb-0">
        {views
          .filter((v) => v.available || !state)
          .map((v) => (
            <SettingRow key={v.id} label={v.label}>
              <Toggle checked={chosen.includes(v.id)} onChange={(on) => setChosen(v.id, on)} label={`Put ${v.label} on the tile`} />
            </SettingRow>
          ))}
      </Section>
    </CardFrame>
  );
}

export default defineWidget<QTConfig>({
  id: "system.quick-toggles",
  name: "Quick Toggles",
  category: "System",
  description: "One-click switches for Wi-Fi, Bluetooth, hotspot, flight mode and more.",
  keywords: ["wifi", "bluetooth", "hotspot", "airplane", "ethernet", "energy saver", "do not disturb", "microphone", "camera", "keep awake", "display"],
  icon: ToggleRight,
  size: "xl",
  Tile: QuickTogglesTile,
  Card: QuickTogglesCard,
  cardSize: { width: 360, height: 600 },
  defaultConfig: { toggles: DEFAULT_TOGGLES },
});
