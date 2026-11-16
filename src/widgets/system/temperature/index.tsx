import { Check, Thermometer } from "lucide-react";
import { useTopic } from "../../../core/backend";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { AreaChart, CardFrame, EmptyState, Gauge, ListRow, ProgressBar, SampleBadge, Section, Segmented, Skeleton, Stat, TileFrame } from "../../../ui";
import type { CpuSample } from "../cpu/types";
import { loadColor } from "../cpu/types";
import { fs, temp, tempColor, toUnit, type TempUnit } from "../shared/format";
import { useMemory } from "../shared/hooks";
import type { Sensor, ThermalSample } from "../shared/types";
import { updateGeneral, useGeneralPrefs } from "../../../settings/keys";

type TempConfig = { sensor: string };

/** Settings > General > Temperature (app-wide, shared with the weather widgets). */
const useUnit = (): TempUnit => useGeneralPrefs((p) => p.temperature);

const SAMPLE_SENSOR: Sensor = { id: "sample", label: "CPU", isCpu: true, celsius: 52, history: [48, 49, 51, 50, 52, 55, 53, 52] };

/** The chosen sensor, or the processor's, or the hottest. */
function pick(sample: ThermalSample | undefined, id: string): Sensor | undefined {
  const list = sample?.sensors ?? [];
  if (!list.length) return undefined;
  return list.find((s) => s.id === id) ?? list.find((s) => s.isCpu) ?? [...list].sort((a, b) => b.celsius - a.celsius)[0];
}

function LoadRow({ label, value, size }: { label: string; value: number | undefined; size: number }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <div className="flex items-baseline justify-between gap-2 leading-none" style={{ fontSize: fs(size, 0.18, 8) }}>
        <span className="text-dim">{label}</span>
        <span className="font-semibold tabular-nums">{value === undefined ? "–" : `${Math.round(value)}%`}</span>
      </div>
      <ProgressBar value={value ?? 0} color={loadColor(value)} height={Math.max(2, Math.round(size * 0.06))} />
    </div>
  );
}

function TempTile({ config, size, isSample }: TileProps<TempConfig>) {
  const thermal = useTopic<ThermalSample>("system", "thermal");
  const cpu = useTopic<CpuSample>("system", "cpu");
  const memory = useMemory();
  const unit = useUnit();
  let sensor = pick(thermal, config.sensor);
  const showSample = !sensor && isSample;
  if (showSample) sensor = SAMPLE_SENSOR;
  const c = sensor?.celsius;
  const gw = Math.round(size * 1.24);
  const title = sensor
    ? `${sensor.label}: ${temp(c, unit)}`
    : thermal && !thermal.available
      ? (thermal.reason ?? "No temperature sensor")
      : "Temperature";
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.16)]" title={title}>
      {c === undefined && thermal && !thermal.available ? (
        <div className="flex shrink-0 flex-col items-center justify-center gap-[2px] text-dim leading-none" style={{ width: gw }}>
          <Thermometer size={Math.round(size * 0.34)} strokeWidth={1.8} />
          <span className="truncate" style={{ fontSize: fs(size, 0.17, 8) }}>
            No sensor
          </span>
        </div>
      ) : (
      <div className="shrink-0" style={{ marginTop: size * 0.08 }}>
        <Gauge value={c ?? 0} max={100} size={gw} color={tempColor(c)} stroke={Math.max(3, Math.round(gw * 0.09))}>
          {c === undefined ? (
            <Thermometer size={Math.round(size * 0.26)} className="mb-[1px] text-faint" />
          ) : (
            <span className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.3) }}>
              {temp(c, unit, false)}
            </span>
          )}
        </Gauge>
      </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[calc(var(--tile-h)*0.1)]">
        <LoadRow label="CPU" value={cpu?.usage} size={size} />
        <LoadRow label="RAM" value={memory?.usage} size={size} />
      </div>
      {showSample && <SampleBadge className="absolute top-[3px] right-[3px]" />}
    </TileFrame>
  );
}

function TempCard({ config, setConfig }: CardProps<TempConfig>) {
  const thermal = useTopic<ThermalSample>("system", "thermal");
  const cpu = useTopic<CpuSample>("system", "cpu");
  const memory = useMemory();
  const sensor = pick(thermal, config.sensor);
  const unit = useUnit();
  const hist = (sensor?.history ?? []).map((v) => toUnit(v, unit));
  const lo = hist.length ? Math.min(...hist) : undefined;
  const hi = hist.length ? Math.max(...hist) : undefined;
  const avg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : undefined;
  const fmt = (v: number | undefined) => (v === undefined ? "–" : `${Math.round(v)}°`);
  const minutes = thermal ? Math.round((hist.length * thermal.intervalSecs) / 60) : 0;

  return (
    <CardFrame
      title="Temperature"
      subtitle={sensor ? `${sensor.label} sensor` : thermal && !thermal.available ? "No sensor available" : "…"}
      icon={Thermometer}
      actions={
        <Segmented
          value={unit}
          options={[
            { value: "c", label: "°C" },
            { value: "f", label: "°F" },
          ]}
          onChange={(v) => updateGeneral({ temperature: v })}
        />
      }
    >
      {thermal && !thermal.available ? (
        <EmptyState
          icon={Thermometer}
          title="No temperature reading"
          message={`${thermal.reason ?? "No temperature sensor is available on this PC."} GlintBar runs without administrator rights, and some PCs only reveal the processor sensor to admins.`}
        />
      ) : (
        <>
          <div className="flex items-end justify-between">
            <div className="text-[38px] leading-none font-semibold tabular-nums" style={{ color: tempColor(sensor?.celsius) }}>
              {sensor ? temp(sensor.celsius, unit) : <Skeleton className="h-9 w-24" />}
            </div>
            <div className="text-[11px] text-faint">{minutes >= 1 ? `Last ${Math.min(10, minutes)} min` : "Just started"}</div>
          </div>
          <div className="mt-3 rounded-xl bg-input px-2 py-2">
            <AreaChart data={hist} min={lo !== undefined ? Math.floor(lo - 3) : undefined} max={hi !== undefined ? Math.ceil(hi + 3) : undefined} slots={200} height={84} color={tempColor(sensor?.celsius)} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat label="Lowest" value={fmt(lo)} />
            <Stat label="Average" value={fmt(avg)} />
            <Stat label="Highest" value={fmt(hi)} />
          </div>
        </>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat label="CPU load" value={cpu ? `${Math.round(cpu.usage)}%` : "–"} />
        <Stat label="Memory in use" value={memory ? `${Math.round(memory.usage)}%` : "–"} />
      </div>
      {(thermal?.sensors.length ?? 0) > 0 && (
        <Section title="Sensor" className="mt-4 mb-0">
          <div className="-mx-2 py-1">
            <ListRow
              title="Automatic"
              subtitle="Uses the CPU sensor if Windows labels one, else the hottest zone"
              right={config.sensor === "auto" ? <Check size={15} className="text-accent" /> : ""}
              onClick={() => setConfig({ sensor: "auto" })}
            />
            {thermal!.sensors.map((s) => (
              <ListRow
                key={s.id}
                title={s.label}
                subtitle={s.id}
                right={
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{temp(s.celsius, unit)}</span>
                    {config.sensor === s.id ? <Check size={15} className="text-accent" /> : <span className="w-[15px]" />}
                  </span>
                }
                onClick={() => setConfig({ sensor: s.id })}
              />
            ))}
          </div>
        </Section>
      )}
      {thermal?.available && (
        <p className="mt-2 px-1 text-[11px] leading-snug text-faint">
          Values come from the thermal zones Windows exposes. On many desktops they measure the motherboard rather than the CPU.
        </p>
      )}
    </CardFrame>
  );
}

export default defineWidget<TempConfig>({
  id: "system.temperature",
  name: "Temperature",
  category: "System",
  description: "A gauge for CPU temperature, next to bars for current CPU and RAM usage.",
  keywords: ["heat", "thermal", "sensor", "cpu", "celsius", "fahrenheit", "hot"],
  icon: Thermometer,
  size: "l",
  Tile: TempTile,
  Card: TempCard,
  cardSize: { width: 340 },
  defaultConfig: { sensor: "auto" },
});
