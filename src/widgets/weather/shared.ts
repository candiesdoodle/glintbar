/**
 * One weather store for every tile (and for other slices): `useWeather()`.
 *
 * - The city and units are app-wide (`weather.place`, `weather.units`); every weather tile,
 *   the 7 Days / Today / Clock & Weather clocks and other slices read the same data.
 * - One Open-Meteo request serves everyone, at most every 15 minutes, only while some tile
 *   that uses it is visible. The last answer is kept (`weather.cache`) so tiles show it
 *   offline and right after start.
 * - On first use the city is guessed from this PC's time zone ("Europe/Berlin" -> Berlin, checked
 *   against the zone Open-Meteo reports for it). Until a city is known (a "UTC" zone, offline),
 *   tiles show sample weather with the sample badge and "Pick your city".
 *
 * Temperatures are stored in °C and wind in km/h; format with `temp()` / `wind()`.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { describeError, httpJson } from "../../core/http";
import { getStored, setStored, useStored } from "../../core/store";
import { useInterval, useIsVisible } from "../../core/useVisible";
import { updateGeneral, useGeneralPrefs } from "../../settings/keys";

export interface Place {
  name: string;
  country?: string;
  admin?: string;
  lat: number;
  lon: number;
  /** IANA zone of the place. */
  tz?: string;
  /** Guessed from the PC's time zone rather than picked. */
  auto?: boolean;
}

export type Units = "c" | "f";

export interface HourWeather {
  /** Unix ms */
  time: number;
  temp: number;
  code: number;
  /** Chance of rain, 0-100 */
  pop: number;
  isDay: boolean;
}

export interface DayWeather {
  /** Unix ms of local midnight */
  date: number;
  code: number;
  max: number;
  min: number;
  sunrise: number;
  sunset: number;
  pop: number;
  /** mm */
  precip: number;
  /** km/h */
  windMax: number;
  uv: number;
}

export interface WeatherData {
  place: Place;
  /** Unix ms */
  fetchedAt: number;
  /** The place's zone as Open-Meteo reports it. */
  tz: string;
  current: {
    temp: number;
    feels: number;
    humidity: number;
    code: number;
    isDay: boolean;
    /** km/h */
    wind: number;
    /** degrees, where the wind comes from */
    windDir: number;
    gusts: number;
    /** mm in the last hour */
    precip: number;
  };
  /** From the current hour, 48 entries. */
  hourly: HourWeather[];
  /** Today first, 7 days. */
  daily: DayWeather[];
}

export interface WeatherView {
  data: WeatherData;
  /** No city picked yet (or a picker preview): `data` is sample weather. */
  isSample: boolean;
  place: Place | null;
  /** Settings > General > Temperature. */
  units: Units;
  /** Settings > General > Measurements, as "c" (km/h) or "f" (mph) for `wind()`. */
  windUnits: Units;
  loading: boolean;
  /** Plain-language problem with the last refresh; `data` is then the last good answer. */
  error: string | null;
  /** True when `data` is older than one refresh period (offline). */
  stale: boolean;
  refresh: () => void;
}

export const REFRESH_MS = 15 * 60_000;
const PLACE_KEY = "weather.place";
const CACHE_KEY = "weather.cache";

export function defaultUnits(): Units {
  const region = (typeof navigator !== "undefined" ? navigator.language : "en-US").split("-")[1]?.toUpperCase();
  return region && ["US", "LR", "MM", "BS", "BZ", "KY", "PW"].includes(region) ? "f" : "c";
}

// ---- fetching -------------------------------------------------------------------------------

interface Status {
  loading: boolean;
  error: string | null;
}
const useStatus = create<Status>()(() => ({ loading: false, error: null }));
let inflight: Promise<void> | null = null;

interface ForecastResponse {
  timezone: string;
  current: Record<string, number>;
  hourly: Record<string, number[]>;
  daily: Record<string, number[]>;
}

function samePlace(a: Place | null | undefined, b: Place | null | undefined): boolean {
  return Boolean(a && b && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4);
}

export async function fetchWeather(place: Place): Promise<WeatherData> {
  const r = await httpJson<ForecastResponse>("https://api.open-meteo.com/v1/forecast", {
    query: {
      latitude: place.lat.toFixed(4),
      longitude: place.lon.toFixed(4),
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      hourly: "temperature_2m,weather_code,precipitation_probability,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max",
      timezone: "auto",
      timeformat: "unixtime",
      forecast_days: 7,
    },
    timeoutMs: 15_000,
  });
  const c = r.current ?? {};
  const h = r.hourly ?? {};
  const d = r.daily ?? {};
  const now = Date.now();
  const hourStart = now - 3600_000;
  const hourly: HourWeather[] = (h.time ?? [])
    .map((t, i) => ({
      time: t * 1000,
      temp: h.temperature_2m?.[i] ?? NaN,
      code: h.weather_code?.[i] ?? 0,
      pop: h.precipitation_probability?.[i] ?? 0,
      isDay: (h.is_day?.[i] ?? 1) === 1,
    }))
    .filter((x) => x.time > hourStart)
    .slice(0, 48);
  const daily: DayWeather[] = (d.time ?? []).map((t, i) => ({
    date: t * 1000,
    code: d.weather_code?.[i] ?? 0,
    max: d.temperature_2m_max?.[i] ?? NaN,
    min: d.temperature_2m_min?.[i] ?? NaN,
    sunrise: (d.sunrise?.[i] ?? 0) * 1000,
    sunset: (d.sunset?.[i] ?? 0) * 1000,
    pop: d.precipitation_probability_max?.[i] ?? 0,
    precip: d.precipitation_sum?.[i] ?? 0,
    windMax: d.wind_speed_10m_max?.[i] ?? 0,
    uv: d.uv_index_max?.[i] ?? 0,
  }));
  if (!Number.isFinite(c.temperature_2m) || daily.length === 0) throw new Error("Open-Meteo returned data GlintBar couldn't read.");
  return {
    place,
    fetchedAt: now,
    tz: r.timezone || place.tz || "",
    current: {
      temp: c.temperature_2m,
      feels: c.apparent_temperature ?? c.temperature_2m,
      humidity: c.relative_humidity_2m ?? 0,
      code: c.weather_code ?? 0,
      isDay: (c.is_day ?? 1) === 1,
      wind: c.wind_speed_10m ?? 0,
      windDir: c.wind_direction_10m ?? 0,
      gusts: c.wind_gusts_10m ?? 0,
      precip: c.precipitation ?? 0,
    },
    hourly,
    daily,
  };
}

/** Fetches when the cache is missing, for another place, or older than 15 minutes. */
export function ensureFresh(force = false): Promise<void> {
  const place = getStored<Place | null>(PLACE_KEY, null);
  if (!place) return Promise.resolve();
  const cache = getStored<WeatherData | null>(CACHE_KEY, null);
  const fresh = cache && samePlace(cache.place, place) && Date.now() - cache.fetchedAt < REFRESH_MS;
  if (fresh && !force) return Promise.resolve();
  if (inflight) return inflight;
  useStatus.setState({ loading: true });
  inflight = fetchWeather(place)
    .then((data) => {
      // The city may have changed while the request ran.
      if (samePlace(getStored<Place | null>(PLACE_KEY, null), place)) setStored(CACHE_KEY, data);
      useStatus.setState({ loading: false, error: null });
    })
    .catch((e) => {
      useStatus.setState({ loading: false, error: e instanceof Error && !("kind" in e) ? e.message : describeError(e) });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Sets the city for every weather tile and fetches its weather. */
export function setPlace(place: Place): void {
  setStored(PLACE_KEY, place);
  useStatus.setState({ error: null });
  void ensureFresh(true);
}

let detecting: Promise<void> | null = null;
let detectTried = false;

/** Old zone names browsers (ICU) still report, and the names Open-Meteo uses. */
const ZONE_ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Dacca": "Asia/Dhaka",
  "Asia/Thimbu": "Asia/Thimphu",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Godthab": "America/Nuuk",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Louisville": "America/Kentucky/Louisville",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};
const canonicalZone = (tz: string): string => ZONE_ALIASES[tz] ?? tz;

/**
 * First run: the city named by this PC's time zone, looked up once per start and kept only when
 * Open-Meteo places that city in the same zone. Never overrides a picked city.
 */
export function detectPlace(): Promise<void> {
  if (detectTried || getStored<Place | null>(PLACE_KEY, null)) return detecting ?? Promise.resolve();
  detectTried = true;
  let tz = "";
  try {
    tz = canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
  } catch {
    /* no Intl zone */
  }
  const city = tz.includes("/") && !/^Etc\//.test(tz) ? (tz.split("/").pop() ?? "").replace(/_/g, " ") : "";
  if (!city) return Promise.resolve();
  detecting = httpJson<{ results?: Array<{ name: string; latitude: number; longitude: number; country?: string; admin1?: string; timezone?: string }> }>(
    "https://geocoding-api.open-meteo.com/v1/search",
    { query: { name: city, count: 10, language: (navigator.language || "en").split("-")[0], format: "json" }, timeoutMs: 10_000 },
  )
    .then((r) => {
      const hit = (r.results ?? []).find((g) => canonicalZone(g.timezone ?? "") === tz);
      if (!hit || getStored<Place | null>(PLACE_KEY, null)) return;
      setPlace({ name: hit.name, country: hit.country, admin: hit.admin1, lat: hit.latitude, lon: hit.longitude, tz: hit.timezone, auto: true });
    })
    .catch(() => {
      // Offline or blocked: try again on the next start.
      detectTried = false;
    })
    .finally(() => {
      detecting = null;
    });
  return detecting;
}

/** Temperature units are app-wide: Settings > General > Temperature. */
export function setUnits(units: Units): void {
  updateGeneral({ temperature: units });
}

// ---- the hook -------------------------------------------------------------------------------

/**
 * Weather for the picked city. Fetches only while the calling tile is visible; pass
 * `sample: true` for picker previews (no request is made).
 */
export function useWeather(opts: { sample?: boolean } = {}): WeatherView {
  const [place] = useStored<Place | null>(PLACE_KEY, null);
  const units = useGeneralPrefs((p) => p.temperature);
  const windUnits: Units = useGeneralPrefs((p) => p.units) === "imperial" ? "f" : "c";
  const [cache] = useStored<WeatherData | null>(CACHE_KEY, null);
  const status = useStatus();
  const visible = useIsVisible();
  const active = !opts.sample && Boolean(place) && visible;

  useEffect(() => {
    if (active) void ensureFresh();
  }, [active, place?.lat, place?.lon]);
  useEffect(() => {
    if (!opts.sample && !place && visible) void detectPlace();
  }, [opts.sample, place, visible]);
  // Checks once a minute whether 15 minutes have passed (and retries after an error).
  useInterval(() => void ensureFresh(), active ? 60_000 : null);

  const usable = cache && samePlace(cache.place, place) ? cache : null;
  if (opts.sample || !place || !usable) {
    return {
      data: sampleWeather(place?.name),
      isSample: opts.sample || !place,
      place,
      units,
      windUnits,
      loading: Boolean(place) && !opts.sample && (status.loading || !status.error),
      error: place && !opts.sample ? status.error : null,
      stale: false,
      refresh: () => void ensureFresh(true),
    };
  }
  return {
    data: usable,
    isSample: false,
    place,
    units,
    windUnits,
    loading: status.loading,
    error: status.error,
    stale: Date.now() - usable.fetchedAt > REFRESH_MS * 2,
    refresh: () => void ensureFresh(true),
  };
}

// ---- formatting -------------------------------------------------------------------------------

export function toUnits(c: number, units: Units): number {
  return units === "f" ? c * 1.8 + 32 : c;
}

/** "12°" (rounded, in the user's units). */
export function temp(c: number, units: Units, withUnit = false): string {
  if (!Number.isFinite(c)) return "–";
  const v = Math.round(toUnits(c, units));
  return `${v === 0 ? 0 : v}°${withUnit ? units.toUpperCase() : ""}`;
}

/** "12 km/h" or "7 mph". */
export function wind(kmh: number, units: Units): string {
  if (!Number.isFinite(kmh)) return "–";
  return units === "f" ? `${Math.round(kmh / 1.609)} mph` : `${Math.round(kmh)} km/h`;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** "14:00" / "2 PM" in the place's zone. */
export function hourLabel(ms: number, tz: string, hour24: boolean): string {
  try {
    return new Intl.DateTimeFormat(undefined, hour24 ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz || undefined } : { hour: "numeric", timeZone: tz || undefined }).format(ms);
  } catch {
    return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric" });
  }
}

/** "07:12" / "7:12 AM" in the place's zone. */
export function timeLabel(ms: number, tz: string, hour24: boolean): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: hour24 ? "2-digit" : "numeric", minute: "2-digit", hourCycle: hour24 ? "h23" : "h12", timeZone: tz || undefined }).format(ms);
  } catch {
    return new Date(ms).toLocaleTimeString();
  }
}

/** "Mon" in the place's zone (`date` is the place's local midnight). */
export function weekdayLabel(ms: number, tz: string, style: "short" | "long" = "short"): string {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: style, timeZone: tz || undefined }).format(ms + 12 * 3600_000);
  } catch {
    return new Date(ms).toLocaleDateString(undefined, { weekday: style });
  }
}

/** Today's entry (the first day whose date is today at the place). */
export function today(data: WeatherData): DayWeather | undefined {
  const now = Date.now();
  return data.daily.find((d) => now >= d.date && now < d.date + 86_400_000) ?? data.daily[0];
}

export function placeLabel(p: Place | null | undefined): string {
  if (!p) return "";
  return p.name;
}

// ---- sample weather ---------------------------------------------------------------------------

/** Believable weather for previews and until a city is picked: mild, partly cloudy. */
export function sampleWeather(name?: string): WeatherData {
  const now = Date.now();
  const hour = 3600_000;
  const h0 = new Date();
  h0.setMinutes(0, 0, 0);
  const startHour = h0.getTime();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const base = midnight.getTime();
  const curve = (t: number) => 14 + 5 * Math.sin(((new Date(t).getHours() - 9) / 24) * 2 * Math.PI);
  const codes = [2, 3, 61, 1, 0, 2, 80];
  const hourly: HourWeather[] = Array.from({ length: 48 }, (_, i) => {
    const t = startHour + i * hour;
    const h = new Date(t).getHours();
    return { time: t, temp: Math.round(curve(t) * 10) / 10, code: i > 5 && i < 9 ? 61 : h > 19 || h < 7 ? 1 : 2, pop: i > 4 && i < 10 ? 60 : 10, isDay: h >= 7 && h < 18 };
  });
  const daily: DayWeather[] = Array.from({ length: 7 }, (_, i) => ({
    date: base + i * 86_400_000,
    code: codes[i],
    max: [19, 17, 15, 18, 21, 20, 16][i],
    min: [10, 9, 8, 9, 11, 12, 9][i],
    sunrise: base + i * 86_400_000 + 7 * hour + 18 * 60_000,
    sunset: base + i * 86_400_000 + 17 * hour + 2 * 60_000,
    pop: [10, 35, 80, 15, 5, 20, 60][i],
    precip: [0, 0.4, 6.2, 0, 0, 0.2, 3.1][i],
    windMax: [14, 18, 26, 12, 9, 11, 22][i],
    uv: [3, 2, 1, 3, 4, 4, 2][i],
  }));
  return {
    place: { name: name || "Lisbon", country: "Portugal", lat: 38.72, lon: -9.14, tz: "" },
    fetchedAt: now,
    tz: "",
    current: { temp: Math.round(curve(now) * 10) / 10, feels: Math.round((curve(now) - 1) * 10) / 10, humidity: 64, code: 2, isDay: new Date().getHours() >= 7 && new Date().getHours() < 18, wind: 13, windDir: 300, gusts: 24, precip: 0 },
    hourly,
    daily,
  };
}
