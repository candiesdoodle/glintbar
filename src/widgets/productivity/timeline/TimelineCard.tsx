import { useState } from "react";
import { GanttChart, MapPin, Sunrise, Sunset } from "lucide-react";
import { duration, timeOfDay } from "../../../core/format";
import { useSettings } from "../../../core/store";
import { useNow } from "../../../core/useVisible";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, SampleBadge, Section, SettingRow, Stat, TextInput } from "../../../ui";
import { KIND_META } from "../shared/apps";
import { startOfDay } from "../shared/time";
import { useDayLine, type TimelineConfig } from "./data";
import { guessLocation } from "./sun";
import { Track } from "./Track";

export function TimelineCard({ config, setConfig, isSample }: CardProps<TimelineConfig>) {
  const now = useNow("minute").getTime();
  const hour24 = useSettings((s) => s.clock24h);
  const line = useDayLine(config, isSample, now);
  const day = startOfDay(now);
  const [lat, setLat] = useState(config.lat !== null ? String(config.lat) : "");
  const [lon, setLon] = useState(config.lon !== null ? String(config.lon) : "");
  const [place, setPlace] = useState(config.place);
  const guess = guessLocation();
  const dayLen = line.sunrise && line.sunset ? (line.sunset - line.sunrise) / 1000 : null;
  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  return (
    <CardFrame title="Day Timeline" icon={GanttChart} subtitle={new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} actions={isSample ? <SampleBadge /> : undefined}>
      <div className="rounded-xl bg-input px-3 pt-3 pb-2">
        <div className="mb-1 flex justify-between text-[10px] text-faint">
          <span>Focus</span>
          <span>Apps by kind</span>
          <span>Meetings below</span>
        </div>
        <Track line={line} dayStart={day} now={now} height={56} showLanes />
        <div className="relative mt-1 h-3 text-[10px] text-faint tabular-nums">
          {hours.map((h) => (
            <span key={h} className="absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>
              {h === 24 ? "" : hour24 ? String(h).padStart(2, "0") : h === 0 ? "12a" : h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-input p-3">
        <Stat label="At the PC" value={duration(line.totalSecs)} />
        <Stat label="Focus" value={duration(line.focusSecs)} sub={`${line.focus.length} round${line.focus.length === 1 ? "" : "s"}`} />
        <Stat label="Meetings" value={duration(line.meetingSecs)} sub={`${line.meetings.length} today`} />
      </div>

      <Section title="By kind of app" className="mt-3">
        {line.byKind.length === 0 && <div className="py-2.5 text-[12px] text-dim">No app time recorded so far today.</div>}
        {line.byKind.map((k) => (
          <div key={k.kind} className="flex items-center gap-2 border-b border-card-line py-2 text-[12.5px] last:border-0">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND_META[k.kind].color }} />
            <span className="flex-1">{KIND_META[k.kind].label}</span>
            <span className="text-dim tabular-nums">{duration(k.secs)}</span>
          </div>
        ))}
      </Section>

      <Section title="Sun">
        <div className="flex items-center gap-4 py-2.5 text-[12.5px]">
          <span className="flex items-center gap-1.5">
            <Sunrise size={14} className="text-warn" /> {line.sunrise ? timeOfDay(new Date(line.sunrise), { hour24 }) : "–"}
          </span>
          <span className="flex items-center gap-1.5">
            <Sunset size={14} className="text-warn" /> {line.sunset ? timeOfDay(new Date(line.sunset), { hour24 }) : "–"}
          </span>
          <span className="ml-auto text-dim">{dayLen ? `${duration(dayLen)} of daylight` : "No sunrise today"}</span>
        </div>
        <SettingRow label={<span className="flex items-center gap-1.5"><MapPin size={13} className="text-dim" /> {line.place}</span>} description={config.lat === null ? "Estimated from your time zone." : "A location you set."}>
          {config.lat !== null && (
            <Button size="sm" variant="ghost" onClick={() => setConfig({ lat: null, lon: null, place: guess.place })}>
              Use time zone
            </Button>
          )}
        </SettingRow>
        <div className="flex items-center gap-1.5 pb-2.5">
          <TextInput placeholder="Place" value={place} onChange={(e) => setPlace(e.target.value)} />
          <TextInput className="w-[78px]" placeholder={String(guess.lat)} value={lat} onChange={(e) => setLat(e.target.value)} aria-label="Latitude" />
          <TextInput className="w-[78px]" placeholder={String(guess.lon)} value={lon} onChange={(e) => setLon(e.target.value)} aria-label="Longitude" />
          <Button
            size="sm"
            onClick={() => {
              const la = Number(lat);
              const lo = Number(lon);
              if (lat.trim() && lon.trim() && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) setConfig({ lat: la, lon: lo, place: place.trim() || "My place" });
            }}
          >
            Set
          </Button>
        </div>
      </Section>
    </CardFrame>
  );
}
