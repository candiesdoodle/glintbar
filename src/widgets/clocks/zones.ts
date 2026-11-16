/** Time-zone helpers for the clocks (Intl only, formatters cached per zone). */

export interface ZoneParts {
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday */
  weekday: number;
  day: number;
  /** 0-based */
  month: number;
  year: number;
  /** Minutes ahead of UTC. */
  offset: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isValidZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock time in `tz` (an IANA name; "" = this PC's zone). */
export function zoned(d: Date, tz: string): ZoneParts {
  if (!tz || !isValidZone(tz)) {
    return {
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
      weekday: d.getDay(),
      day: d.getDate(),
      month: d.getMonth(),
      year: d.getFullYear(),
      offset: -d.getTimezoneOffset(),
    };
  }
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(d)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const day = Number(parts.day);
  const month = Number(parts.month) - 1;
  const year = Number(parts.year);
  const asUtc = Date.UTC(year, month, day, hour, minute, second);
  const offset = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  return { hour, minute, second, weekday: WEEKDAYS.indexOf(parts.weekday), day, month, year, offset };
}

/** "+5:30", "-8", "+0" relative to this PC (or to UTC with `fromUtc`). */
export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const a = Math.abs(minutes);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** "Today", "Tomorrow", "Yesterday" for a zone's date compared to this PC's date. */
export function dayRelation(p: ZoneParts, local: Date): string {
  const a = Date.UTC(p.year, p.month, p.day);
  const b = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate());
  const diff = Math.round((a - b) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : "";
}

/** "14:05" or "2:05 PM" from zone parts. */
export function formatHM(p: Pick<ZoneParts, "hour" | "minute">, hour24: boolean): { main: string; period: string } {
  const mm = String(p.minute).padStart(2, "0");
  if (hour24) return { main: `${String(p.hour).padStart(2, "0")}:${mm}`, period: "" };
  return { main: `${p.hour % 12 || 12}:${mm}`, period: p.hour >= 12 ? "PM" : "AM" };
}

export interface ClockCity {
  name: string;
  /** IANA zone */
  tz: string;
  country?: string;
}

/** Offered before the user types anything; searching also queries the geocoding service. */
export const POPULAR_CITIES: ClockCity[] = [
  { name: "London", tz: "Europe/London", country: "United Kingdom" },
  { name: "New York", tz: "America/New_York", country: "United States" },
  { name: "San Francisco", tz: "America/Los_Angeles", country: "United States" },
  { name: "Chicago", tz: "America/Chicago", country: "United States" },
  { name: "Denver", tz: "America/Denver", country: "United States" },
  { name: "Toronto", tz: "America/Toronto", country: "Canada" },
  { name: "Vancouver", tz: "America/Vancouver", country: "Canada" },
  { name: "Mexico City", tz: "America/Mexico_City", country: "Mexico" },
  { name: "São Paulo", tz: "America/Sao_Paulo", country: "Brazil" },
  { name: "Buenos Aires", tz: "America/Argentina/Buenos_Aires", country: "Argentina" },
  { name: "Paris", tz: "Europe/Paris", country: "France" },
  { name: "Berlin", tz: "Europe/Berlin", country: "Germany" },
  { name: "Madrid", tz: "Europe/Madrid", country: "Spain" },
  { name: "Rome", tz: "Europe/Rome", country: "Italy" },
  { name: "Amsterdam", tz: "Europe/Amsterdam", country: "Netherlands" },
  { name: "Stockholm", tz: "Europe/Stockholm", country: "Sweden" },
  { name: "Warsaw", tz: "Europe/Warsaw", country: "Poland" },
  { name: "Kyiv", tz: "Europe/Kyiv", country: "Ukraine" },
  { name: "Istanbul", tz: "Europe/Istanbul", country: "Türkiye" },
  { name: "Moscow", tz: "Europe/Moscow", country: "Russia" },
  { name: "Cairo", tz: "Africa/Cairo", country: "Egypt" },
  { name: "Lagos", tz: "Africa/Lagos", country: "Nigeria" },
  { name: "Nairobi", tz: "Africa/Nairobi", country: "Kenya" },
  { name: "Johannesburg", tz: "Africa/Johannesburg", country: "South Africa" },
  { name: "Dubai", tz: "Asia/Dubai", country: "United Arab Emirates" },
  { name: "Tashkent", tz: "Asia/Tashkent", country: "Uzbekistan" },
  { name: "Karachi", tz: "Asia/Karachi", country: "Pakistan" },
  { name: "Mumbai", tz: "Asia/Kolkata", country: "India" },
  { name: "Bengaluru", tz: "Asia/Kolkata", country: "India" },
  { name: "Dhaka", tz: "Asia/Dhaka", country: "Bangladesh" },
  { name: "Bangkok", tz: "Asia/Bangkok", country: "Thailand" },
  { name: "Jakarta", tz: "Asia/Jakarta", country: "Indonesia" },
  { name: "Singapore", tz: "Asia/Singapore", country: "Singapore" },
  { name: "Hong Kong", tz: "Asia/Hong_Kong", country: "China" },
  { name: "Shanghai", tz: "Asia/Shanghai", country: "China" },
  { name: "Taipei", tz: "Asia/Taipei", country: "Taiwan" },
  { name: "Seoul", tz: "Asia/Seoul", country: "South Korea" },
  { name: "Tokyo", tz: "Asia/Tokyo", country: "Japan" },
  { name: "Sydney", tz: "Australia/Sydney", country: "Australia" },
  { name: "Melbourne", tz: "Australia/Melbourne", country: "Australia" },
  { name: "Perth", tz: "Australia/Perth", country: "Australia" },
  { name: "Auckland", tz: "Pacific/Auckland", country: "New Zealand" },
  { name: "Honolulu", tz: "Pacific/Honolulu", country: "United States" },
  { name: "Reykjavík", tz: "Atlantic/Reykjavik", country: "Iceland" },
  { name: "UTC", tz: "UTC" },
];
