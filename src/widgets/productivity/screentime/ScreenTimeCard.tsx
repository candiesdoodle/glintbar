import { useState } from "react";
import { Globe, Hourglass, Pin, PinOff } from "lucide-react";
import { call, useService } from "../../../core/backend";
import { delta, duration } from "../../../core/format";
import { describeError } from "../../../core/http";
import { useStored } from "../../../core/store";
import { useSettings } from "../../../core/store";
import type { CardProps } from "../../../core/widget";
import { CardFrame, cx, EmptyState, ErrorState, IconButton, SampleBadge, Section, Segmented, SettingRow, Skeleton, Stat, Toggle } from "../../../ui";
import { setRule, updateAutomations, useAutomations } from "../../../automations/settings";
import { appColor, initials } from "../shared/apps";
import { HourBars } from "./ScreenTimeTile";
import { DEFAULT_OPTIONS, localDate, OPTIONS_KEY, type AppTime, type DaySummary, type DayTotal, type ScreenTimeConfig, type ScreenTimeOptions } from "./types";

function clockOf(sec: number, hour24: boolean): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setSeconds(sec);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: !hour24 });
}

function AppRow({ app, max, pinned, onPin }: { app: AppTime; max: number; pinned: boolean; onPin?: () => void }) {
  return (
    <div className="group flex items-center gap-2.5 py-1.5">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: appColor(app.key) }}>
        {initials(app.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[12.5px] text-fg">{app.name}</span>
          <span className="shrink-0 text-[12px] text-dim tabular-nums">{duration(app.secs)}</span>
        </div>
        <div className="mt-1 h-[4px] overflow-hidden rounded-full bg-track">
          <div className="h-full rounded-full" style={{ width: `${Math.max(2, (app.secs / max) * 100)}%`, background: appColor(app.key) }} />
        </div>
      </div>
      {onPin && <IconButton icon={pinned ? PinOff : Pin} label={pinned ? "Unpin from the tile" : "Show on the tile"} size={13} className={pinned ? "text-accent" : "opacity-0 group-hover:opacity-100"} onClick={onPin} />}
    </div>
  );
}

export function ScreenTimeCard({ config, setConfig, isSample }: CardProps<ScreenTimeConfig>) {
  const [tab, setTab] = useState<"day" | "week">("day");
  const hour24 = useSettings((s) => s.clock24h);
  const today = useService<DaySummary>("productivity", "screentime_day", {}, { refreshMs: 60_000 });
  const yesterdayDate = localDate(Date.now() - 86_400_000);
  const yesterday = useService<DaySummary>("productivity", "screentime_day", { date: yesterdayDate });
  const week = useService<DayTotal[]>("productivity", "screentime_days", { days: 7 }, { enabled: tab === "week", refreshMs: 10 * 60_000 });
  const [opts, setOpts] = useStored<ScreenTimeOptions>(OPTIONS_KEY, DEFAULT_OPTIONS);
  const summaryOn = useAutomations((s) => s.rules.screenSummary);
  const summaryTime = useAutomations((s) => s.summaryTime);
  const [showAll, setShowAll] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const d = today.data;

  const setSites = (on: boolean) => {
    if (isSample) return;
    setOpts({ ...opts, sites: on });
    if (!on) call("productivity", "screentime_forget_sites").then(today.refresh, (e) => setProblem(describeError(e)));
    else setTimeout(today.refresh, 300);
  };

  const change = d && yesterday.data && yesterday.data.totalSecs > 600 ? ((d.totalSecs - yesterday.data.totalSecs) / yesterday.data.totalSecs) * 100 : null;
  const pin = (key: string) => !isSample && setConfig({ pinned: config.pinned === key ? null : key });

  let body;
  if (today.error && !d) body = <ErrorState message={today.error.code === "unsupported" ? "Screen Time works only on Windows." : describeError(today.error)} onRetry={today.refresh} />;
  else if (!d) body = <Skeleton className="h-[200px] w-full" />;
  else if (tab === "day") {
    const apps = showAll ? d.apps : d.apps.slice(0, 6);
    body = (
      <>
        <div className="mb-2 flex items-end justify-between">
          <div>
            <div className="text-[28px] leading-none font-semibold tabular-nums">{duration(d.totalSecs)}</div>
            <div className="mt-1 text-[12px] text-dim">
              {change === null ? "today" : <span className={change > 0 ? "text-warn" : "text-good"}>{delta(change)} vs yesterday</span>}
            </div>
          </div>
          {d.firstActive !== null && <div className="text-right text-[11.5px] text-dim">Day began {clockOf(d.firstActive, hour24)}</div>}
        </div>
        <div className="rounded-xl bg-input px-3 pt-3 pb-2">
          <HourBars hours={d.hours} height={64} highlight={new Date().getHours()} />
          <div className="mt-1 flex justify-between text-[10px] text-faint tabular-nums">
            {[0, 6, 12, 18, 24].map((h) => (
              <span key={h}>{hour24 ? String(h).padStart(2, "0") : h === 0 || h === 24 ? "12a" : h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`}</span>
            ))}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-input p-3">
          <Stat label="Longest focus" value={duration(d.longestFocusSecs)} sub={d.longestFocusApp ?? "–"} />
          <Stat label="App switches" value={d.switches} />
          <Stat label="Apps used" value={d.apps.length} />
        </div>
        <Section title="Apps" className="mt-3">
          {apps.length === 0 ? <div className="py-3 text-[12px] text-dim">No app time recorded so far today.</div> : apps.map((a) => <AppRow key={a.key} app={a} max={d.apps[0].secs} pinned={config.pinned === a.key} onPin={() => pin(a.key)} />)}
          {d.apps.length > 6 && (
            <button type="button" className="w-full py-1.5 text-[12px] text-accent" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${d.apps.length}`}
            </button>
          )}
        </Section>
        {d.sitesOn && d.sites.length > 0 && (
          <Section title="Websites">
            {d.sites.slice(0, 8).map((s) => (
              <AppRow key={s.name} app={{ key: s.name, name: s.name, secs: s.secs }} max={d.sites[0].secs} pinned={false} />
            ))}
          </Section>
        )}
      </>
    );
  } else {
    const days = week.data ?? [];
    const max = Math.max(3600, ...days.map((x) => x.totalSecs));
    const total = days.reduce((a, x) => a + x.totalSecs, 0);
    const active = days.filter((x) => x.totalSecs > 0).length || 1;
    const agg = new Map<string, AppTime>();
    for (const day of days) for (const a of day.apps) agg.set(a.key, { ...a, secs: (agg.get(a.key)?.secs ?? 0) + a.secs });
    const top = [...agg.values()].sort((a, b) => b.secs - a.secs).slice(0, 8);
    body = week.error && !week.data ? (
      <ErrorState message={describeError(week.error)} onRetry={week.refresh} />
    ) : !week.data ? (
      <Skeleton className="h-[200px] w-full" />
    ) : (
      <>
        <div className="mb-2 flex items-end justify-between">
          <div>
            <div className="text-[28px] leading-none font-semibold tabular-nums">{duration(total)}</div>
            <div className="mt-1 text-[12px] text-dim">last 7 days · {duration(total / active)} a day on average</div>
          </div>
        </div>
        <div className="flex h-[110px] items-end gap-2 rounded-xl bg-input px-3 pt-3 pb-2">
          {days.map((x) => {
            const isToday = x.date === localDate();
            const [y, m, dd] = x.date.split("-").map(Number);
            return (
              <div key={x.date} className="flex flex-1 flex-col items-center gap-1" title={`${x.date}: ${duration(x.totalSecs)}`}>
                <span className="text-[9.5px] text-faint tabular-nums">{x.totalSecs ? duration(x.totalSecs).split(" ")[0] : ""}</span>
                <div className="w-full rounded-[4px] bg-accent" style={{ height: Math.max(2, (x.totalSecs / max) * 64), opacity: isToday ? 1 : 0.55 }} />
                <span className={cx("text-[10px]", isToday ? "text-fg" : "text-faint")}>{new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: "narrow" })}</span>
              </div>
            );
          })}
        </div>
        <Section title="Apps this week" className="mt-3">
          {top.length === 0 ? <div className="py-3 text-[12px] text-dim">No app time recorded this week.</div> : top.map((a) => <AppRow key={a.key} app={a} max={top[0].secs} pinned={config.pinned === a.key} onPin={() => pin(a.key)} />)}
        </Section>
      </>
    );
  }

  return (
    <CardFrame
      title="Screen Time"
      icon={Hourglass}
      subtitle="Stays on this PC · 90 days of history"
      actions={
        <>
          {isSample && <SampleBadge />}
          <Segmented
            value={tab}
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
            ]}
            onChange={setTab}
          />
        </>
      }
    >
      {body}
      {problem && <ErrorState className="mt-2" message={problem} />}
      <Section title="Settings" className="mt-3 mb-0">
        <SettingRow label={<span className="flex items-center gap-1.5"><Globe size={13} className="text-dim" /> Count websites</span>} description="Records just the site name, like YouTube or GitHub - no page titles, no private windows. Switching it off deletes all site data.">
          <Toggle checked={opts.sites} onChange={setSites} label="Count websites" />
        </SettingRow>
        <SettingRow label="End-of-day summary" description={`Shows above the dock at ${summaryTime}; on Mondays it also covers the past week.`}>
          <div className="flex items-center gap-2">
            {summaryOn && (
              <input
                type="time"
                aria-label="Summary time"
                value={summaryTime}
                onChange={(e) => e.target.value && updateAutomations({ summaryTime: e.target.value })}
                className="h-7 w-[84px] rounded-md border border-card-line bg-input px-1.5 text-[12px] text-fg outline-none focus:border-accent"
              />
            )}
            <Toggle checked={summaryOn} onChange={(v) => setRule("screenSummary", v)} label="End-of-day summary" />
          </div>
        </SettingRow>
        <SettingRow label="Count all the time" description="When off, counting runs only while a Screen Time or Day Timeline tile is on the dock, starting from when you added it.">
          <Toggle checked={!!opts.always} onChange={(v) => !isSample && setOpts({ ...opts, always: v })} label="Count all the time" />
        </SettingRow>
        <SettingRow label="Pause counting">
          <Toggle checked={opts.paused} onChange={(v) => !isSample && setOpts({ ...opts, paused: v })} label="Pause counting" />
        </SettingRow>
      </Section>
      {d && !d.tracking && (
        <EmptyState
          className="py-3"
          title={opts.paused ? "Counting is paused" : "Not counting"}
          message={opts.paused ? "Switch off Pause counting to resume." : "Counting happens on Windows while this tile or the Day Timeline sits on the dock."}
        />
      )}
    </CardFrame>
  );
}
