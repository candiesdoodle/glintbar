import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react";
import { call } from "../../../core/backend";
import { relativeTime, timeOfDay } from "../../../core/format";
import { useSettings } from "../../../core/store";
import { useNow } from "../../../core/useVisible";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, cx, EmptyState, ErrorState, IconButton, SampleBadge, Section, Segmented, Spinner, TextInput } from "../../../ui";
import { startOfDay, untilText } from "../shared/time";
import { sampleItems } from "./sample";
import { KIND_COLORS, KIND_LABELS, type CalendarItem } from "./sources";
import { addFeed, addLocalEvent, refreshFeed, removeFeed, removeLocalEvent, renameFeed, useCalendar, useCalendarItems } from "./store";

const DAY = 86_400_000;

function dayKeys(i: CalendarItem): number[] {
  const first = startOfDay(i.start);
  const last = startOfDay(Math.max(i.start, (i.end ?? i.start) - 1));
  const out: number[] = [];
  for (let d = first; d <= last && out.length < 62; d = startOfDay(d + DAY + 3600_000)) out.push(d);
  return out;
}

function useByDay(items: CalendarItem[]): Map<number, CalendarItem[]> {
  return useMemo(() => {
    const m = new Map<number, CalendarItem[]>();
    for (const i of items) for (const d of dayKeys(i)) m.set(d, [...(m.get(d) ?? []), i]);
    return m;
  }, [items]);
}

export function CalendarCard({ isSample }: CardProps) {
  const now = useNow("minute").getTime();
  const { items, hasOwnData } = useCalendarItems();
  // Sample events only in the widget picker; a calendar without subscriptions is simply empty.
  const sample = isSample;
  const list = useMemo(() => (sample ? sampleItems(now) : items), [sample, items, now]);
  const [tab, setTab] = useState<"month" | "calendars">("month");
  const feeds = useCalendar((s) => s.feeds);

  return (
    <CardFrame
      title="Calendar"
      icon={CalendarDays}
      subtitle={feeds.length ? `${feeds.length} calendar${feeds.length === 1 ? "" : "s"} · updates every 15 min` : "Your events plus renewal, payout and limit-reset dates"}
      actions={
        <>
          {sample && <SampleBadge />}
          <Segmented
            value={tab}
            options={[
              { value: "month", label: "Month" },
              { value: "calendars", label: "Calendars" },
            ]}
            onChange={setTab}
          />
        </>
      }
    >
      {tab === "month" ? <MonthView items={list} now={now} /> : <CalendarsView readOnly={isSample} />}
      {tab === "month" && !sample && !hasOwnData && (
        <div className="mt-3 rounded-lg bg-input px-3 py-2 text-[12px] leading-snug text-dim">
          Nothing linked yet.{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => setTab("calendars")}>
            Link a Google, Outlook or iCloud calendar
          </button>{" "}
          and its events appear here.
        </div>
      )}
    </CardFrame>
  );
}

function MonthView({ items, now }: { items: CalendarItem[]; now: number }) {
  const today = startOfDay(now);
  const [selected, setSelected] = useState(today);
  const [offset, setOffset] = useState(0);
  const byDay = useByDay(items);
  const ref = new Date(now);
  const first = new Date(ref.getFullYear(), ref.getMonth() + offset, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(first.getFullYear(), first.getMonth(), i + 1).getTime())];
  while (cells.length % 7) cells.push(null);
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));
  const dayItems = byDay.get(selected) ?? [];
  const upcoming = items.filter((i) => i.start >= Math.max(now, selected + DAY)).slice(0, 6);

  return (
    <>
      <div className="rounded-xl bg-input p-2.5">
        <div className="mb-1 flex items-center justify-between">
          <IconButton icon={ChevronLeft} label="Previous month" onClick={() => setOffset((o) => o - 1)} />
          <button
            type="button"
            className="text-[13px] font-medium"
            onClick={() => {
              setOffset(0);
              setSelected(today);
            }}
          >
            {first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </button>
          <IconButton icon={ChevronRight} label="Next month" onClick={() => setOffset((o) => o + 1)} />
        </div>
        <div className="grid grid-cols-7 text-center text-[11.5px] tabular-nums">
          {weekdays.map((d, i) => (
            <div key={i} className="pb-1 text-[10.5px] text-faint">
              {d}
            </div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={i} className="h-9" />;
            const its = byDay.get(d) ?? [];
            const isToday = d === today;
            const isSel = d === selected;
            return (
              <button key={i} type="button" onClick={() => setSelected(d)} className={cx("flex h-9 flex-col items-center justify-start gap-[2px] rounded-lg pt-[3px]", isSel && !isToday && "bg-hover")}>
                <span className={cx("grid h-[20px] w-[20px] place-items-center rounded-full", isToday ? "bg-accent font-semibold text-on-accent" : d < today ? "text-dim" : "text-fg")}>{new Date(d).getDate()}</span>
                <span className="flex h-[5px] items-center gap-[2px]">
                  {its.slice(0, 2).map((it) => (
                    <span key={it.id} className="h-[5px] w-[5px] rounded-full" style={{ background: it.color ?? KIND_COLORS[it.kind] }} />
                  ))}
                  {its.length > 2 && <span className="text-[8px] leading-none text-dim">+{its.length - 2}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 mb-1 px-1 text-[11px] font-medium tracking-wide text-faint uppercase">
        {selected === today ? "Today" : selected === today + DAY ? "Tomorrow" : new Date(selected).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
      </div>
      {dayItems.length === 0 ? <div className="px-1 pb-1 text-[12px] text-dim">No events</div> : dayItems.map((i) => <ItemRow key={i.id} item={i} now={now} />)}

      {upcoming.length > 0 && (
        <>
          <div className="mt-3 mb-1 px-1 text-[11px] font-medium tracking-wide text-faint uppercase">Coming up</div>
          {upcoming.map((i) => (
            <ItemRow key={i.id} item={i} now={now} showDate />
          ))}
        </>
      )}
    </>
  );
}

function ItemRow({ item, now, showDate }: { item: CalendarItem; now: number; showDate?: boolean }) {
  const hour24 = useSettings((s) => s.clock24h);
  const time = item.allDay ? "All day" : `${timeOfDay(new Date(item.start), { hour24 })}${item.end && item.end > item.start ? ` - ${timeOfDay(new Date(item.end), { hour24 })}` : ""}`;
  const date = showDate ? new Date(item.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "";
  const live = !item.allDay && item.start <= now && (item.end ?? item.start) > now;
  const soon = !item.allDay && item.start > now && item.start - now < 3 * 3600_000;
  return (
    <div className="group flex items-start gap-2.5 rounded-lg px-1 py-1.5 hover:bg-hover">
      <span className="mt-[3px] h-[28px] w-[3px] shrink-0 rounded-full" style={{ background: item.color ?? KIND_COLORS[item.kind] }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-fg">{item.title}</div>
        <div className="truncate text-[11.5px] text-dim">
          {[date, time, item.detail, item.kind !== "event" && item.kind !== "meeting" ? KIND_LABELS[item.kind] : item.source].filter(Boolean).join(" · ")}
        </div>
      </div>
      {(live || soon) && <span className={cx("mt-0.5 shrink-0 rounded-md px-1.5 py-px text-[10.5px] font-medium", live ? "bg-good/15 text-good" : "bg-accent/15 text-accent")}>{live ? "Now" : untilText(item.start, now)}</span>}
      {item.url && <IconButton icon={ExternalLink} label={item.kind === "meeting" ? "Join" : "Open"} size={14} className="-mt-0.5" onClick={() => call("shell", "open", { target: item.url }).catch(() => {})} />}
    </div>
  );
}

function CalendarsView({ readOnly }: { readOnly: boolean }) {
  const feeds = useCalendar((s) => s.feeds);
  const local = useCalendar((s) => s.local);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const add = async () => {
    if (readOnly || !url.trim()) return;
    setBusy(true);
    setError(null);
    const problem = await addFeed(url);
    setBusy(false);
    if (problem) setError(problem);
    else setUrl("");
  };

  return (
    <>
      <Section title="Your calendars">
        {feeds.length === 0 && <div className="py-2.5 text-[12px] text-dim">None linked yet. Google, Outlook and iCloud can each give you a private iCal link.</div>}
        {feeds.map((f) => (
          <div key={f.id} className="group flex items-center gap-2 border-b border-card-line py-2 last:border-0">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: f.color }} />
            <div className="min-w-0 flex-1">
              <input
                className="w-full truncate bg-transparent text-[13px] text-fg outline-none"
                defaultValue={f.name}
                aria-label="Calendar name"
                onBlur={(e) => renameFeed(f.id, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              <div className={cx("text-[11px] leading-snug", f.error ? "text-bad" : "text-dim")}>
                {f.error ?? `${f.count ?? 0} events · updated ${f.lastOk ? relativeTime(f.lastOk) : "never"}`}
              </div>
            </div>
            {refreshing === f.id ? (
              <Spinner />
            ) : (
              <IconButton
                icon={RefreshCw}
                label="Refresh"
                size={14}
                onClick={() => {
                  setRefreshing(f.id);
                  void refreshFeed(f.id).finally(() => setRefreshing(null));
                }}
              />
            )}
            <IconButton icon={Trash2} label="Remove calendar" size={14} className="opacity-60 group-hover:opacity-100 hover:text-bad" onClick={() => void removeFeed(f.id)} />
          </div>
        ))}
      </Section>

      <div className="mb-1.5 px-1 text-[12px] font-medium text-fg">Add a calendar by its iCal link</div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <TextInput placeholder="https://calendar.google.com/…/basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy || readOnly} spellCheck={false} autoComplete="off" />
        <Button type="submit" variant="primary" disabled={busy || !url.trim() || readOnly}>
          {busy ? <Spinner /> : "Add"}
        </Button>
      </form>
      {error && <ErrorState className="mt-2" message={error} />}
      <ul className="mt-2 mb-3 space-y-1 px-1 text-[11.5px] leading-snug text-dim">
        <li><b className="font-medium text-fg">Google:</b> open Settings, pick your calendar, go to Integrate calendar and take the link labelled "Secret address in iCal format".</li>
        <li><b className="font-medium text-fg">Outlook:</b> in Settings → Calendar → Shared calendars, publish a calendar and copy its ICS link.</li>
        <li><b className="font-medium text-fg">iCloud:</b> in Calendar, click the calendar's share icon, turn on Public Calendar and copy the webcal:// link.</li>
        <li>GlintBar only reads the link, checks it every 15 minutes and keeps it on this PC.</li>
      </ul>

      <AddLocalEvent readOnly={readOnly} />
      {local.length > 0 && (
        <Section title="Added in GlintBar" className="mt-3 mb-0">
          {local.slice(-8).map((e) => (
            <div key={e.id} className="group flex items-center gap-2 border-b border-card-line py-2 text-[12.5px] last:border-0">
              <span className="min-w-0 flex-1 truncate">{e.title}</span>
              <span className="text-dim">{new Date(e.start).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
              <IconButton icon={Trash2} label="Delete" size={13} onClick={() => removeLocalEvent(e.id)} />
            </div>
          ))}
        </Section>
      )}
      {feeds.length === 0 && local.length === 0 && <EmptyState className="py-3" title="Renewal and payout dates appear automatically" message="Connected revenue and AI-limit widgets put their dates on this calendar." />}
    </>
  );
}

function AddLocalEvent({ readOnly }: { readOnly: boolean }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("");
  const add = () => {
    if (readOnly || !title.trim()) return;
    const [y, m, d] = date.split("-").map(Number);
    if (!y || !m || !d) return;
    let start: number;
    let allDay = true;
    if (time) {
      const [h, mi] = time.split(":").map(Number);
      start = new Date(y, m - 1, d, h, mi).getTime();
      allDay = false;
    } else start = new Date(y, m - 1, d).getTime();
    addLocalEvent({ title: title.trim().slice(0, 200), start, end: allDay ? start + DAY : start + 3600_000, allDay });
    setTitle("");
  };
  return (
    <form
      className="flex flex-wrap items-center gap-1.5 rounded-xl bg-input p-2"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <TextInput className="min-w-[140px] flex-1" placeholder="New event title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 rounded-lg border border-card-line bg-input px-1.5 text-[12px] text-fg outline-none focus:border-accent" />
      <input type="time" aria-label="Time (leave empty for all day)" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 w-[86px] rounded-lg border border-card-line bg-input px-1.5 text-[12px] text-fg outline-none focus:border-accent" />
      <IconButton icon={Plus} label="Add event" type="submit" />
    </form>
  );
}
