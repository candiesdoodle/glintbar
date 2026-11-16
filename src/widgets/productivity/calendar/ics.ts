/**
 * A small RFC 5545 reader: VEVENTs with DTSTART/DTEND/DURATION (UTC, TZID or floating, all-day),
 * RRULE (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY incl. ordinals,
 * BYMONTHDAY, BYMONTH, BYSETPOS), EXDATE, RECURRENCE-ID overrides and STATUS:CANCELLED.
 * Recurrences are expanded in the event's own time zone, so 09:00 stays 09:00 across DST.
 */

export interface IcsOccurrence {
  uid: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location?: string;
  description?: string;
  url?: string;
  /** Has attendees or a video-call link. */
  meeting: boolean;
}

export interface IcsCalendar {
  name?: string;
  events: IcsOccurrence[];
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

// ---- lines ------------------------------------------------------------------------------------

export function unfold(text: string): string[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return body
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((l) => l.length > 0);
}

export function parseLine(line: string): Prop | null {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let cur = "";
  inQuote = false;
  for (const c of head) {
    if (c === '"') inQuote = !inQuote;
    if (c === ";" && !inQuote) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: parts[0].toUpperCase(), params, value };
}

export function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

// ---- time zones -------------------------------------------------------------------------------

/** Common Windows (Outlook/Exchange) zone names. */
const WINDOWS_ZONES: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Central Standard Time": "America/Chicago",
  "Central America Standard Time": "America/Guatemala",
  "Canada Central Standard Time": "America/Regina",
  "Mexico Standard Time": "America/Mexico_City",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Eastern Standard Time": "America/New_York",
  "US Eastern Standard Time": "America/Indianapolis",
  "SA Pacific Standard Time": "America/Bogota",
  "Atlantic Standard Time": "America/Halifax",
  "Venezuela Standard Time": "America/Caracas",
  "Newfoundland Standard Time": "America/St_Johns",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Buenos_Aires",
  "SA Eastern Standard Time": "America/Cayenne",
  "Pacific SA Standard Time": "America/Santiago",
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "E. Europe Standard Time": "Europe/Chisinau",
  "GTB Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev",
  "Israel Standard Time": "Asia/Jerusalem",
  "Egypt Standard Time": "Africa/Cairo",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Turkey Standard Time": "Europe/Istanbul",
  "Russian Standard Time": "Europe/Moscow",
  "Arab Standard Time": "Asia/Riyadh",
  "Arabian Standard Time": "Asia/Dubai",
  "Iran Standard Time": "Asia/Tehran",
  "Afghanistan Standard Time": "Asia/Kabul",
  "Pakistan Standard Time": "Asia/Karachi",
  "West Asia Standard Time": "Asia/Tashkent",
  "India Standard Time": "Asia/Kolkata",
  "Sri Lanka Standard Time": "Asia/Colombo",
  "Nepal Standard Time": "Asia/Katmandu",
  "Central Asia Standard Time": "Asia/Almaty",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok",
  "China Standard Time": "Asia/Shanghai",
  "Singapore Standard Time": "Asia/Singapore",
  "Taipei Standard Time": "Asia/Taipei",
  "W. Australia Standard Time": "Australia/Perth",
  "Korea Standard Time": "Asia/Seoul",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "Tasmania Standard Time": "Australia/Hobart",
  "New Zealand Standard Time": "Pacific/Auckland",
};

const zoneOk = new Map<string, boolean>();
function validZone(tz: string): boolean {
  let ok = zoneOk.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    zoneOk.set(tz, ok);
  }
  return ok;
}

/** An IANA zone for a TZID, or null (= treat as local time). */
export function resolveZone(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const t = tzid.trim();
  if (!t) return null;
  if (WINDOWS_ZONES[t]) return WINDOWS_ZONES[t];
  if (validZone(t)) return t;
  // "/mozilla.org/20050126_1/Europe/London" and similar prefixed ids.
  const m = /([A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)$/.exec(t);
  if (m && validZone(m[1])) return m[1];
  return null;
}

const fmts = new Map<string, Intl.DateTimeFormat>();
function zoneOffsetMs(utcMs: number, tz: string): number {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmts.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(utcMs))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * "Wall" times are the date/time fields encoded with Date.UTC (no zone). This turns one into a
 * real instant: in `tz`, as UTC (`"UTC"`), or in the PC's local zone (`null`).
 */
export function wallToInstant(wall: number, tz: string | null): number {
  if (tz === "UTC") return wall;
  if (tz === null) {
    const d = new Date(wall);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
  }
  const o1 = zoneOffsetMs(wall, tz);
  let t = wall - o1;
  const o2 = zoneOffsetMs(t, tz);
  if (o2 !== o1) t = wall - o2;
  return t;
}

interface DateValue {
  wall: number;
  tz: string | null;
  allDay: boolean;
}

export function parseDate(value: string, params: Record<string, string>): DateValue | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const allDay = params.VALUE === "DATE" || h === undefined;
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), allDay ? 0 : Number(h), allDay ? 0 : Number(mi), allDay ? 0 : Number(s ?? 0));
  const tz = allDay ? null : z ? "UTC" : resolveZone(params.TZID);
  return { wall, tz, allDay };
}

/** "P1DT2H", "PT45M", "-PT15M", "P2W" -> ms */
export function parseDuration(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((Number(w ?? 0) * 7 + Number(d ?? 0)) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
}

// ---- recurrence -------------------------------------------------------------------------------

const DAY = 86_400_000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  /** Wall ms (inclusive). */
  until?: number;
  untilIsUtc: boolean;
  byDay: Array<{ n: number; wd: number }>;
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
}

export function parseRule(v: string): Rule | null {
  const kv: Record<string, string> = {};
  for (const part of v.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = kv.FREQ as Rule["freq"];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const nums = (s?: string) => (s ? s.split(",").map(Number).filter((n) => Number.isFinite(n) && n !== 0) : []);
  const byDay = (kv.BYDAY ? kv.BYDAY.split(",") : [])
    .map((t) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(t.trim().toUpperCase()))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ n: m[1] ? Number(m[1]) : 0, wd: WEEKDAYS.indexOf(m[2]) }));
  let until: number | undefined;
  let untilIsUtc = false;
  if (kv.UNTIL) {
    const u = parseDate(kv.UNTIL, {});
    if (u) {
      untilIsUtc = u.tz === "UTC";
      until = u.allDay ? u.wall + DAY - 1 : u.wall;
    }
  }
  return {
    freq,
    interval: Math.max(1, Number(kv.INTERVAL) || 1),
    count: kv.COUNT ? Math.max(0, Number(kv.COUNT)) : undefined,
    until,
    untilIsUtc,
    byDay,
    byMonthDay: nums(kv.BYMONTHDAY),
    byMonth: nums(kv.BYMONTH),
    bySetPos: nums(kv.BYSETPOS),
  };
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** Days (wall ms at 00:00) in month y/m0 on weekday wd; n = ordinal (0 = every, -1 = last). */
function weekdaysInMonth(y: number, m0: number, wd: number, n: number): number[] {
  const out: number[] = [];
  const dim = daysInMonth(y, m0);
  for (let d = 1; d <= dim; d++) {
    const t = Date.UTC(y, m0, d);
    if (new Date(t).getUTCDay() === wd) out.push(t);
  }
  if (n === 0) return out;
  const pick = n > 0 ? out[n - 1] : out[out.length + n];
  return pick === undefined ? [] : [pick];
}

function daysForMonth(rule: Rule, y: number, m0: number, startDay: number): number[] {
  let days: number[] = [];
  if (rule.byMonthDay.length) {
    const dim = daysInMonth(y, m0);
    for (const md of rule.byMonthDay) {
      const d = md > 0 ? md : dim + md + 1;
      if (d >= 1 && d <= dim) days.push(Date.UTC(y, m0, d));
    }
    if (rule.byDay.length) days = days.filter((t) => rule.byDay.some((b) => b.wd === new Date(t).getUTCDay()));
  } else if (rule.byDay.length) {
    for (const b of rule.byDay) days.push(...weekdaysInMonth(y, m0, b.wd, b.n));
  } else if (startDay <= daysInMonth(y, m0)) {
    days.push(Date.UTC(y, m0, startDay));
  }
  return days;
}

/**
 * Wall-clock start times of a recurring event between `fromWall` and `toWall` (inclusive).
 * COUNT is counted from the first occurrence; `untilWall` overrides the rule's UNTIL (already
 * converted to wall time). Capped at `limit` results.
 */
export function expandRule(rule: Rule, startWall: number, fromWall: number, toWall: number, limit = 1000, untilWall = rule.until): number[] {
  const out: number[] = [];
  const s = new Date(startWall);
  const timeOfDay = startWall - Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  let produced = 0;
  const max = rule.count ?? Infinity;
  const endWall = Math.min(toWall, untilWall ?? Infinity);
  for (let k = 0; k < 20000; k++) {
    let candidates: number[] = [];
    let periodStart: number;
    if (rule.freq === "DAILY") {
      periodStart = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + k * rule.interval);
      const d = new Date(periodStart);
      const okDay = !rule.byDay.length || rule.byDay.some((b) => b.wd === d.getUTCDay());
      const okMonth = !rule.byMonth.length || rule.byMonth.includes(d.getUTCMonth() + 1);
      const okMd = !rule.byMonthDay.length || rule.byMonthDay.includes(d.getUTCDate());
      if (okDay && okMonth && okMd) candidates = [periodStart];
    } else if (rule.freq === "WEEKLY") {
      const monday = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() - ((s.getUTCDay() + 6) % 7));
      periodStart = monday + k * rule.interval * 7 * DAY;
      const wds = rule.byDay.length ? rule.byDay.map((b) => b.wd) : [s.getUTCDay()];
      candidates = wds.map((wd) => periodStart + ((wd + 6) % 7) * DAY);
      if (rule.byMonth.length) candidates = candidates.filter((t) => rule.byMonth.includes(new Date(t).getUTCMonth() + 1));
    } else if (rule.freq === "MONTHLY") {
      const total = s.getUTCMonth() + k * rule.interval;
      const y = s.getUTCFullYear() + Math.floor(total / 12);
      const m0 = total % 12;
      periodStart = Date.UTC(y, m0, 1);
      if (!rule.byMonth.length || rule.byMonth.includes(m0 + 1)) candidates = daysForMonth(rule, y, m0, s.getUTCDate());
    } else {
      const y = s.getUTCFullYear() + k * rule.interval;
      periodStart = Date.UTC(y, 0, 1);
      const months = rule.byMonth.length ? rule.byMonth.map((m) => m - 1) : [s.getUTCMonth()];
      for (const m0 of months) candidates.push(...daysForMonth(rule, y, m0, s.getUTCDate()));
    }
    if (periodStart > endWall) break;
    candidates = [...new Set(candidates)].sort((a, b) => a - b).map((d) => d + timeOfDay);
    if (rule.bySetPos.length) {
      const all = candidates;
      candidates = rule.bySetPos
        .map((p) => (p > 0 ? all[p - 1] : all[all.length + p]))
        .filter((t): t is number => t !== undefined)
        .sort((a, b) => a - b);
    }
    for (const t of candidates) {
      if (t < startWall) continue;
      if (t > endWall) return out;
      if (produced >= max) return out;
      produced++;
      if (t >= fromWall) {
        out.push(t);
        if (out.length >= limit) return out;
      }
    }
    if (produced >= max) break;
  }
  return out;
}

// ---- calendar ---------------------------------------------------------------------------------

const MEETING_LINK = /(zoom\.us\/j|teams\.microsoft\.com\/l\/meetup|teams\.live\.com|meet\.google\.com|webex\.com|whereby\.com|gotomeet)/i;
const URL_RE = /https?:\/\/[^\s<>"]+/gi;

interface RawEvent {
  props: Prop[];
}

function first(e: RawEvent, name: string): Prop | undefined {
  return e.props.find((p) => p.name === name);
}

function dayKey(wall: number): string {
  return new Date(wall).toISOString().slice(0, 10);
}

/**
 * Parses an .ics file and expands every event into occurrences that overlap [from, to] (ms).
 * Throws when the text is not an iCalendar file.
 */
export function parseIcs(text: string, from: number, to: number): IcsCalendar {
  const lines = unfold(text);
  if (!lines.some((l) => /^BEGIN:VCALENDAR/i.test(l))) throw new Error("not an iCalendar file");
  const events: RawEvent[] = [];
  let name: string | undefined;
  let cur: RawEvent | null = null;
  let depth = 0;
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN") {
      if (p.value.toUpperCase() === "VEVENT" && !cur) {
        cur = { props: [] };
        depth = 0;
      } else if (cur) depth++;
      continue;
    }
    if (p.name === "END") {
      if (cur && depth === 0 && p.value.toUpperCase() === "VEVENT") {
        events.push(cur);
        cur = null;
      } else if (cur) depth--;
      continue;
    }
    if (cur) {
      if (depth === 0) cur.props.push(p);
    } else if (p.name === "X-WR-CALNAME") name = unescapeText(p.value).trim() || undefined;
  }

  // Instances replaced by a RECURRENCE-ID event, by UID.
  const overrides = new Map<string, Set<number>>();
  for (const e of events) {
    const rid = first(e, "RECURRENCE-ID");
    if (!rid) continue;
    const uid = first(e, "UID")?.value ?? "";
    const d = parseDate(rid.value, rid.params);
    if (!d) continue;
    const set = overrides.get(uid) ?? new Set<number>();
    set.add(wallToInstant(d.wall, d.tz));
    overrides.set(uid, set);
  }

  const out: IcsOccurrence[] = [];
  for (const e of events) {
    const status = first(e, "STATUS")?.value.toUpperCase();
    if (status === "CANCELLED") continue;
    const ds = first(e, "DTSTART");
    if (!ds) continue;
    const start = parseDate(ds.value, ds.params);
    if (!start) continue;
    const uid = first(e, "UID")?.value ?? `${ds.value}-${first(e, "SUMMARY")?.value ?? ""}`;
    const de = first(e, "DTEND");
    const endD = de ? parseDate(de.value, de.params) : null;
    // All-day: length in wall days; timed: real length (start and end zones may differ).
    let length: number;
    if (endD) length = start.allDay ? endD.wall - start.wall : wallToInstant(endD.wall, endD.tz) - wallToInstant(start.wall, start.tz);
    else {
      const du = first(e, "DURATION");
      length = du ? parseDuration(du.value) : start.allDay ? DAY : 0;
    }
    if (length < 0) length = 0;

    const title = unescapeText(first(e, "SUMMARY")?.value ?? "").trim() || "(no title)";
    const locProp = first(e, "LOCATION");
    const location = locProp ? unescapeText(locProp.value).trim() || undefined : undefined;
    const descProp = first(e, "DESCRIPTION");
    const description = descProp ? unescapeText(descProp.value) : undefined;
    const urlProp = first(e, "URL")?.value;
    const hay = `${location ?? ""} ${description ?? ""} ${urlProp ?? ""}`;
    const links = hay.match(URL_RE) ?? [];
    const callLink = links.find((l) => MEETING_LINK.test(l));
    const meeting = !start.allDay && (e.props.some((p) => p.name === "ATTENDEE") || Boolean(callLink));

    const make = (wallStart: number): IcsOccurrence => {
      const s = wallToInstant(wallStart, start.tz);
      const end = start.allDay ? wallToInstant(wallStart + length, null) : s + length;
      return { uid, title, start: s, end, allDay: start.allDay, location, description: description?.slice(0, 400), url: callLink ?? urlProp ?? links[0], meeting };
    };

    const rr = first(e, "RRULE");
    if (!rr || first(e, "RECURRENCE-ID")) {
      const occ = make(start.wall);
      if (occ.end >= from && occ.start <= to) out.push(occ);
      continue;
    }
    const rule = parseRule(rr.value);
    if (!rule) continue;
    // A UTC UNTIL against a zoned DTSTART: move it into the event's wall time.
    let untilWall = rule.until;
    if (untilWall !== undefined && rule.untilIsUtc && start.tz !== "UTC") {
      untilWall = untilWall + (untilWall - wallToInstant(untilWall, start.tz));
    }
    const exInstants = new Set<number>();
    const exDays = new Set<string>();
    for (const p of e.props) {
      if (p.name !== "EXDATE") continue;
      for (const v of p.value.split(",")) {
        const d = parseDate(v, p.params);
        if (!d) continue;
        if (d.allDay) exDays.add(dayKey(d.wall));
        else exInstants.add(wallToInstant(d.wall, p.params.TZID || d.tz === "UTC" ? d.tz : start.tz));
      }
    }
    const skip = overrides.get(uid);
    // Expand a little wider in wall time, then filter by real time.
    const walls = expandRule(rule, start.wall, from - length - 2 * DAY, to + 2 * DAY, 800, untilWall);
    for (const w of walls) {
      if (exDays.has(dayKey(w))) continue;
      const occ = make(w);
      if (exInstants.has(occ.start)) continue;
      if (skip?.has(occ.start)) continue;
      if (occ.end >= from && occ.start <= to) out.push(occ);
    }
  }
  out.sort((a, b) => a.start - b.start);
  return { name, events: out };
}
