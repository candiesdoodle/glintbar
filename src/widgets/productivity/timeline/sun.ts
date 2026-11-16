/** Sunrise and sunset (NOAA's simple algorithm, about a minute of error) and a location guess. */

const RAD = Math.PI / 180;

function sunEvent(dayStart: Date, lat: number, lon: number, rising: boolean): number | null {
  const start = new Date(dayStart.getFullYear(), 0, 0);
  const n = Math.floor((dayStart.getTime() - start.getTime()) / 86_400_000);
  const lngHour = lon / 15;
  const t = n + ((rising ? 6 : 18) - lngHour) / 24;
  const m = 0.9856 * t - 3.289;
  let l = m + 1.916 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 282.634;
  l = ((l % 360) + 360) % 360;
  let ra = Math.atan(0.91764 * Math.tan(l * RAD)) / RAD;
  ra = ((ra % 360) + 360) % 360;
  ra = (ra + Math.floor(l / 90) * 90 - Math.floor(ra / 90) * 90) / 15;
  const sinDec = 0.39782 * Math.sin(l * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(90.833 * RAD) - sinDec * Math.sin(lat * RAD)) / (cosDec * Math.cos(lat * RAD));
  if (cosH > 1 || cosH < -1) return null;
  const h = (rising ? 360 - Math.acos(cosH) / RAD : Math.acos(cosH) / RAD) / 15;
  const tt = h + ra - 0.06571 * t - 6.622;
  const ut = (((tt - lngHour) % 24) + 24) % 24;
  const utcMidnight = Date.UTC(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate());
  let ms = utcMidnight + ut * 3600_000;
  // Keep it on the local day asked for.
  const localStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate()).getTime();
  if (ms < localStart) ms += 86_400_000;
  if (ms >= localStart + 86_400_000) ms -= 86_400_000;
  return ms;
}

export function sunTimes(day: Date, lat: number, lon: number): { rise: number | null; set: number | null } {
  return { rise: sunEvent(day, lat, lon, true), set: sunEvent(day, lat, lon, false) };
}

const ZONES: Record<string, [number, number, string]> = {
  "Europe/London": [51.5, -0.13, "London"], "Europe/Berlin": [52.52, 13.4, "Berlin"], "Europe/Paris": [48.86, 2.35, "Paris"],
  "Europe/Madrid": [40.42, -3.7, "Madrid"], "Europe/Rome": [41.9, 12.5, "Rome"], "Europe/Amsterdam": [52.37, 4.9, "Amsterdam"],
  "Europe/Warsaw": [52.23, 21.01, "Warsaw"], "Europe/Kiev": [50.45, 30.52, "Kyiv"], "Europe/Kyiv": [50.45, 30.52, "Kyiv"],
  "Europe/Moscow": [55.75, 37.62, "Moscow"], "Europe/Istanbul": [41.01, 28.98, "Istanbul"], "Europe/Stockholm": [59.33, 18.07, "Stockholm"],
  "Asia/Tashkent": [41.3, 69.24, "Tashkent"], "Asia/Almaty": [43.24, 76.89, "Almaty"], "Asia/Dubai": [25.2, 55.27, "Dubai"],
  "Asia/Kolkata": [28.61, 77.21, "New Delhi"], "Asia/Calcutta": [28.61, 77.21, "New Delhi"], "Asia/Shanghai": [31.23, 121.47, "Shanghai"],
  "Asia/Tokyo": [35.68, 139.69, "Tokyo"], "Asia/Seoul": [37.57, 126.98, "Seoul"], "Asia/Singapore": [1.35, 103.82, "Singapore"],
  "Asia/Jakarta": [-6.2, 106.85, "Jakarta"], "Asia/Bangkok": [13.76, 100.5, "Bangkok"], "Asia/Hong_Kong": [22.32, 114.17, "Hong Kong"],
  "Australia/Sydney": [-33.87, 151.21, "Sydney"], "Australia/Melbourne": [-37.81, 144.96, "Melbourne"], "Pacific/Auckland": [-36.85, 174.76, "Auckland"],
  "America/New_York": [40.71, -74.0, "New York"], "America/Chicago": [41.88, -87.63, "Chicago"], "America/Denver": [39.74, -104.99, "Denver"],
  "America/Los_Angeles": [34.05, -118.24, "Los Angeles"], "America/Toronto": [43.65, -79.38, "Toronto"], "America/Vancouver": [49.28, -123.12, "Vancouver"],
  "America/Mexico_City": [19.43, -99.13, "Mexico City"], "America/Sao_Paulo": [-23.55, -46.63, "São Paulo"], "America/Buenos_Aires": [-34.6, -58.38, "Buenos Aires"],
  "Africa/Cairo": [30.04, 31.24, "Cairo"], "Africa/Lagos": [6.52, 3.38, "Lagos"], "Africa/Johannesburg": [-26.2, 28.05, "Johannesburg"],
};

/** Coordinates for the PC's time zone (good enough for sunrise within a few minutes). */
export function guessLocation(): { lat: number; lon: number; place: string } {
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    tz = "";
  }
  const z = ZONES[tz];
  if (z) return { lat: z[0], lon: z[1], place: z[2] };
  const offsetH = -new Date().getTimezoneOffset() / 60;
  return { lat: 45, lon: Math.max(-180, Math.min(180, offsetH * 15)), place: tz.split("/").pop()?.replace(/_/g, " ") || "Your time zone" };
}
