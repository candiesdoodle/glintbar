import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, Leaf, Plug, Zap, type LucideIcon } from "lucide-react";
import { call } from "../../../core/backend";
import { duration } from "../../../core/format";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, EmptyState, ProgressBar, SampleBadge, Section, SettingRow, Skeleton, Stat, TileFrame, TileNotice } from "../../../ui";
import { batteryColor } from "./format";
import { useBattery } from "./hooks";
import type { BatteryState } from "./types";

export const SAMPLE_BATTERY: BatteryState = {
  present: true,
  percent: 76,
  charging: false,
  pluggedIn: false,
  secondsLeft: 4 * 3600 + 12 * 60,
  saver: false,
  at: 0,
};

/**
 * The battery for a tile. In the widget picker on a PC without a battery, a sample battery
 * (with the sample badge) shows what the tile looks like.
 */
export function useBatteryView(isSample: boolean): { b: BatteryState | undefined; sample: boolean } {
  const b = useBattery();
  if (isSample && (!b || !b.present)) return { b: SAMPLE_BATTERY, sample: true };
  return { b, sample: false };
}

export function stateText(b: BatteryState): string {
  if (!b.present) return "No battery";
  if (b.charging) return "Charging";
  if (b.pluggedIn) return (b.percent ?? 0) >= 99 ? "Fully charged" : "Plugged in";
  if (b.secondsLeft) return `${duration(b.secondsLeft)} left`;
  return b.saver ? "Energy saver" : "On battery";
}

/** For tiles: "Charging", "Plugged in", "3h 12m", "On battery". */
export function shortState(b: BatteryState): string {
  if (!b.present) return "No battery";
  if (b.charging) return "Charging";
  if (b.pluggedIn) return (b.percent ?? 0) >= 99 ? "Full" : "Plugged in";
  if (b.secondsLeft) return duration(b.secondsLeft);
  return b.saver ? "Saver" : "On battery";
}

export function batteryTitle(b: BatteryState | undefined): string {
  if (!b) return "Battery";
  if (!b.present) return "No battery: this PC is powered from the wall";
  return `Battery ${b.percent ?? "?"}% · ${stateText(b)}`;
}

/** What a battery tile shows on a desktop: a calm "No battery" instead of a fake 0 %. */
export function NoBatteryTile({ size, compact }: { size: number; compact?: boolean }) {
  return <TileNotice icon={Plug} title="No battery" detail="On AC power" size={size} compact={compact} narrow hint="Powered from the wall; this PC has no battery" />;
}

export function LoadingTile({ size }: { size: number }) {
  return (
    <TileFrame className="justify-center" title="Checking the battery…">
      <div className="animate-pulse rounded-full bg-track" style={{ width: size * 0.5, height: size * 0.5 }} />
    </TileFrame>
  );
}

/** Small charge/plug marker next to numbers. */
export function PowerMark({ b, size }: { b: BatteryState; size: number }) {
  if (b.charging) return <Zap size={size} className="shrink-0 text-good" fill="currentColor" strokeWidth={1.5} />;
  if (b.pluggedIn) return <Plug size={size} className="shrink-0 text-dim" strokeWidth={2.2} />;
  if (b.saver) return <Leaf size={size} className="shrink-0 text-good" strokeWidth={2.2} />;
  return null;
}

export function Corner({ sample }: { sample: boolean }) {
  return sample ? <SampleBadge className="absolute top-[3px] right-[3px]" /> : null;
}

function batteryIcon(b: BatteryState): LucideIcon {
  if (b.charging) return BatteryCharging;
  const p = b.percent ?? 0;
  if (p >= 80) return BatteryFull;
  if (p >= 35) return BatteryMedium;
  return BatteryLow;
}

/** The card every battery tile opens. */
export function BatteryCard(_: CardProps) {
  const live = useBattery();
  const b = live;
  if (b && !b.present) {
    return (
      <CardFrame title="Battery" subtitle="Mains power" icon={Plug}>
        <EmptyState icon={Plug} title="This PC has no battery" message="It draws power from the outlet, so there is no level to measure. Laptops show their charge here automatically." />
      </CardFrame>
    );
  }
  const Icon = b ? batteryIcon(b) : BatteryMedium;
  const color = batteryColor(b?.percent, b?.charging ?? false);
  return (
    <CardFrame
      title="Battery"
      subtitle={b ? stateText(b) : "…"}
      icon={Icon}
      footer={
        <Button size="sm" icon={Zap} onClick={() => call("shell", "open", { target: "ms-settings:batterysaver" }).catch(() => {})}>
          Power & battery settings
        </Button>
      }
    >
      <div className="flex items-end justify-between">
        <div className="text-[38px] leading-none font-semibold tabular-nums" style={{ color }}>
          {b?.percent === null || b?.percent === undefined ? <Skeleton className="h-9 w-20" /> : `${b.percent}%`}
        </div>
        {b && <PowerMark b={b} size={22} />}
      </div>
      <ProgressBar className="mt-3" value={b?.percent ?? 0} color={color} height={8} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat label="Power" value={b ? (b.pluggedIn ? "Plugged in" : "On battery") : "–"} />
        <Stat label={b?.pluggedIn ? "Charging" : "Time left"} value={b ? (b.pluggedIn ? (b.charging ? "Yes" : "Full / paused") : b.secondsLeft ? duration(b.secondsLeft) : "Estimating…") : "–"} />
      </div>
      <Section title="Energy" className="mt-4 mb-0">
        <SettingRow label="Energy saver" description="While on, Windows lowers screen brightness and holds back background apps so the battery lasts longer.">
          <span className={b?.saver ? "text-[12px] font-medium text-good" : "text-[12px] text-dim"}>{b?.saver ? "On" : "Off"}</span>
        </SettingRow>
      </Section>
    </CardFrame>
  );
}
