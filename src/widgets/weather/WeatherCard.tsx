import { CloudSun, Droplets, MapPin, RefreshCw, Umbrella, Wind } from "lucide-react";
import { relativeTime } from "../../core/format";
import { useSettings } from "../../core/store";
import { useNow } from "../../core/useVisible";
import type { CardProps } from "../../core/widget";
import { CardFrame, cx, ErrorState, IconButton, SampleBadge, Section, Segmented, SettingRow, Stat } from "../../ui";
import { CityPicker } from "./CityPicker";
import { condition } from "./conditions";
import { compass, hourLabel, placeLabel, setPlace, setUnits, temp, today, toUnits, weekdayLabel, wind, useWeather, type Units } from "./shared";

/** The card every weather tile opens: now, the next hours, the week, and the city. */
export function WeatherCard({ isSample: preview }: CardProps) {
  const w = useWeather({ sample: preview });
  const hour24 = useSettings((s) => s.clock24h);
  useNow("minute");
  const { data, units } = w;
  const cur = data.current;
  const day = today(data);
  const c = condition(cur.code, cur.isDay);
  const CIcon = c.icon;
  const hours = data.hourly.slice(0, 8);
  const lo = Math.min(...data.daily.map((d) => d.min));
  const hi = Math.max(...data.daily.map((d) => d.max));

  return (
    <CardFrame
      title={w.place ? placeLabel(w.place) : "Weather"}
      subtitle={w.isSample ? "Example data until a city is set" : `${c.label} · updated ${relativeTime(data.fetchedAt)}`}
      icon={CloudSun}
      actions={!w.isSample && <IconButton icon={RefreshCw} label="Refresh" onClick={w.refresh} className={cx(w.loading && "animate-spin")} />}
    >
      {w.isSample && !preview && (
        <div className="mb-3 rounded-xl bg-accent/10 px-3 pt-2.5">
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
            <MapPin size={14} className="text-accent" /> Choose a city to get your local forecast
          </div>
          <CityPicker onPick={setPlace} />
        </div>
      )}

      <div className="flex items-center gap-3">
        <CIcon size={46} style={{ color: c.tone }} strokeWidth={1.6} />
        <div className="text-[40px] leading-none font-semibold tabular-nums">{temp(cur.temp, units)}</div>
        <div className="ml-auto text-right text-[12px] leading-snug text-dim">
          <div>Feels like {temp(cur.feels, units)}</div>
          {day && (
            <div>
              H {temp(day.max, units)} · L {temp(day.min, units)}
            </div>
          )}
          {w.isSample && <SampleBadge className="mt-1 inline-block" />}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-input px-3 py-2.5">
        <Stat label={<span className="inline-flex items-center gap-1"><Wind size={11} /> Wind</span>} value={wind(cur.wind, w.windUnits)} sub={`from ${compass(cur.windDir)}`} />
        <Stat label={<span className="inline-flex items-center gap-1"><Droplets size={11} /> Humidity</span>} value={`${Math.round(cur.humidity)}%`} />
        <Stat label={<span className="inline-flex items-center gap-1"><Umbrella size={11} /> Rain</span>} value={`${Math.round(day?.pop ?? 0)}%`} sub={day && day.precip > 0 ? `${day.precip.toFixed(1)} mm` : "none expected"} />
      </div>

      {w.error && <ErrorState className="mt-3" message={w.isSample ? w.error : `${w.error} The data shown is from ${relativeTime(data.fetchedAt)}.`} onRetry={w.refresh} />}

      <Section title="Next hours" className="mt-3">
        <div className="flex justify-between py-2.5">
          {hours.map((h, i) => {
            const hc = condition(h.code, h.isDay);
            const HIcon = hc.icon;
            return (
              <div key={h.time} className="flex w-[36px] flex-col items-center gap-1">
                <span className="text-[10.5px] text-faint">{i === 0 ? "Now" : hourLabel(h.time, data.tz, hour24)}</span>
                <HIcon size={18} style={{ color: hc.tone }} />
                <span className="text-[12.5px] font-medium tabular-nums">{temp(h.temp, units)}</span>
                <span className={cx("text-[10px] tabular-nums", h.pop >= 30 ? "text-[#4ea3ff]" : "text-transparent")}>{Math.round(h.pop)}%</span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="This week">
        <div className="py-1">
          {data.daily.map((d, i) => {
            const dc = condition(d.code, true);
            const DIcon = dc.icon;
            const span = hi - lo || 1;
            return (
              <div key={d.date} className="flex items-center gap-2 py-1.5 text-[12.5px]">
                <span className="w-[42px] shrink-0">{i === 0 ? "Today" : weekdayLabel(d.date, data.tz)}</span>
                <DIcon size={16} style={{ color: dc.tone }} className="shrink-0" />
                <span className={cx("w-[30px] shrink-0 text-[10.5px] tabular-nums", d.pop >= 30 ? "text-[#4ea3ff]" : "text-transparent")}>{Math.round(d.pop)}%</span>
                <span className="w-[30px] shrink-0 text-right text-dim tabular-nums">{temp(d.min, units)}</span>
                <div className="relative h-[5px] flex-1 rounded-full bg-track">
                  <div
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      left: `${((d.min - lo) / span) * 100}%`,
                      right: `${((hi - d.max) / span) * 100}%`,
                      background: `linear-gradient(90deg, ${tempColor(toUnits(d.min, "c"))}, ${tempColor(toUnits(d.max, "c"))})`,
                    }}
                  />
                </div>
                <span className="w-[30px] shrink-0 text-right font-medium tabular-nums">{temp(d.max, units)}</span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Settings" className="mb-0">
        {!w.isSample && (
          <>
            <SettingRow label="City" description={[w.place?.admin, w.place?.country, w.place?.auto ? "guessed from your time zone" : ""].filter(Boolean).join(", ")}>
              <span className="text-[13px] text-dim">{placeLabel(w.place)}</span>
            </SettingRow>
            <CityPicker onPick={setPlace} placeholder="Pick another city…" />
          </>
        )}
        <SettingRow label="Units">
          <Segmented<Units>
            value={units}
            options={[
              { value: "c", label: "°C" },
              { value: "f", label: "°F" },
            ]}
            onChange={setUnits}
          />
        </SettingRow>
      </Section>
    </CardFrame>
  );
}

/** Blue for cold through amber to red for hot (°C). */
export function tempColor(c: number): string {
  if (c <= 0) return "#7cc4ff";
  if (c <= 10) return "#62d0c8";
  if (c <= 18) return "#9bd86b";
  if (c <= 25) return "#f5c542";
  if (c <= 31) return "#f59a3c";
  return "#f0524f";
}
