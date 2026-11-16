import { Monitor, MonitorOff, Sun, SunDim } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { call, useService } from "../../../core/backend";
import { describeError } from "../../../core/http";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, EmptyState, ErrorState, Section, Skeleton, Slider, TileFrame, TileNotice } from "../../../ui";
import { fs } from "../shared/format";
import { insideTile } from "../shared/hooks";
import type { DisplayBrightness } from "../shared/types";

type BrightnessConfig = { display: string };

/**
 * Local slider value that follows the screen, sends changes at most every 150 ms while
 * dragging and once more when released.
 */
function useBrightness(display: DisplayBrightness | undefined, onDone?: () => void) {
  const [value, setValue] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setValue(display?.percent ?? null);
  }, [display?.percent]);
  useEffect(() => () => clearTimeout(pending.current), []);
  const send = useCallback(
    (v: number) => {
      if (!display) return;
      last.current = Date.now();
      call("system", "brightness_set", { id: display.id, percent: v })
        .then(() => setError(null))
        .catch((e) => setError(describeError(e)));
    },
    [display],
  );
  const change = useCallback(
    (v: number) => {
      dragging.current = true;
      setValue(v);
      clearTimeout(pending.current);
      const wait = Math.max(0, 150 - (Date.now() - last.current));
      pending.current = setTimeout(() => {
        send(v);
        dragging.current = false;
        onDone?.();
      }, wait);
    },
    [send, onDone],
  );
  return { value, change, error };
}

function pickDisplay(list: DisplayBrightness[] | undefined, id: string): DisplayBrightness | undefined {
  if (!list) return undefined;
  const usable = list.filter((d) => d.percent !== null);
  return usable.find((d) => d.id === id) ?? usable.find((d) => d.primary) ?? usable[0];
}

function BrightnessTile({ config, size }: TileProps<BrightnessConfig>) {
  const list = useService<DisplayBrightness[]>("system", "brightness_list", undefined, { refreshMs: 30_000 });
  const display = pickDisplay(list.data, config.display);
  const { value, change } = useBrightness(display);
  const icon = Math.round(size * 0.36);
  if (list.data && !display) {
    return <TileNotice icon={MonitorOff} title="Brightness" detail="Not adjustable" size={size} hint="Windows can't set the brightness of any connected screen. Adjust it on the monitor itself." />;
  }
  const v = value ?? 0;
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.16)]" title={display ? `${display.name}: ${v}%` : "Brightness"}>
      {v < 40 ? <SunDim size={icon} className="shrink-0 text-dim" /> : <Sun size={icon} className="shrink-0 text-accent" />}
      <div className="min-w-0 flex-1" {...insideTile}>
        {value === null ? <Skeleton className="h-1.5 w-full" /> : <Slider value={v} min={0} max={100} onChange={change} label="Brightness" />}
      </div>
      <span className="w-[2.4em] shrink-0 text-right font-semibold tabular-nums" style={{ fontSize: fs(size, 0.24, 9) }}>
        {value === null ? "" : v}
      </span>
    </TileFrame>
  );
}

function DisplayRow({ display, onChanged }: { display: DisplayBrightness; onChanged: () => void }) {
  const { value, change, error } = useBrightness(display, onChanged);
  const usable = display.percent !== null;
  return (
    <div className="py-2.5">
      <div className="mb-2 flex items-center gap-2 text-[13px]">
        <Monitor size={15} className="shrink-0 text-dim" />
        <span className="min-w-0 flex-1 truncate">{display.name}</span>
        <span className="text-[11px] text-faint">{display.kind === "internal" ? "Built-in" : "External"}</span>
        {usable && <span className="w-9 text-right font-semibold tabular-nums">{value ?? display.percent}%</span>}
      </div>
      {usable ? (
        <div className="flex items-center gap-2.5">
          <SunDim size={14} className="shrink-0 text-faint" />
          <Slider value={value ?? display.percent ?? 0} onChange={change} label={`${display.name} brightness`} />
          <Sun size={16} className="shrink-0 text-faint" />
        </div>
      ) : (
        <div className="text-[11.5px] leading-snug text-dim">
          Windows can't adjust this screen. Enable DDC/CI in the monitor's on-screen menu, or change it with the monitor's buttons.
        </div>
      )}
      {error && <ErrorState className="mt-2" message={error} />}
    </div>
  );
}

function BrightnessCard({ config, setConfig }: CardProps<BrightnessConfig>) {
  const list = useService<DisplayBrightness[]>("system", "brightness_list");
  const current = pickDisplay(list.data, config.display);
  const usable = (list.data ?? []).filter((d) => d.percent !== null);
  return (
    <CardFrame title="Brightness" subtitle={list.data ? `${list.data.length} display${list.data.length === 1 ? "" : "s"}` : "Finding screens…"} icon={Sun}>
      {list.loading && !list.data && (
        <div className="flex flex-col gap-3 py-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-2 w-full" />
        </div>
      )}
      {list.data?.length === 0 && <EmptyState icon={MonitorOff} title="No displays found" message="Windows found no screen with adjustable brightness." />}
      {list.data && list.data.length > 0 && (
        <Section className="mb-2">
          <div className="divide-y divide-card-line">
            {list.data.map((d) => (
              <DisplayRow key={d.id} display={d} onChanged={() => {}} />
            ))}
          </div>
        </Section>
      )}
      {usable.length > 1 && (
        <Section title="Tile adjusts" className="mb-0">
          <div className="-mx-1 flex flex-wrap gap-1.5 py-2">
            {usable.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setConfig({ display: d.id })}
                className={
                  "rounded-lg px-2.5 py-1 text-[12px] " + (current?.id === d.id ? "bg-accent text-on-accent" : "bg-hover text-dim hover:text-fg")
                }
              >
                {d.name}
              </button>
            ))}
          </div>
        </Section>
      )}
      {list.error && <ErrorState className="mt-2" message={describeError(list.error)} onRetry={list.refresh} />}
    </CardFrame>
  );
}

export default defineWidget<BrightnessConfig>({
  id: "system.brightness",
  name: "Brightness",
  category: "System",
  description: "A brightness slider for laptop screens and DDC/CI monitors.",
  keywords: ["screen", "display", "dim", "monitor", "backlight", "ddc"],
  icon: Sun,
  size: "l",
  Tile: BrightnessTile,
  Card: BrightnessCard,
  cardSize: { width: 330 },
  defaultConfig: { display: "" },
});
