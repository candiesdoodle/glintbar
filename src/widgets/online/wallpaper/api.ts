import { call } from "../../../core/backend";
import { httpJson } from "../../../core/http";
import { secretRef } from "../../../core/secrets";
import { getStored, setStored } from "../../../core/store";
import { guard, type Account } from "../../finance/shared/account";

export interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  color?: string;
  alt_description?: string | null;
  urls: { raw: string; full: string; regular: string; small: string; thumb: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
}

export interface Photo {
  id: string;
  color: string;
  alt: string;
  thumb: string;
  raw: string;
  page: string;
  download: string;
  author: string;
  authorUrl: string;
}

export interface Topic {
  id: string;
  label: string;
  query: string;
}

export const TOPICS: Topic[] = [
  { id: "featured", label: "Featured", query: "desktop wallpaper" },
  { id: "nature", label: "Nature", query: "nature landscape" },
  { id: "windows", label: "Windows", query: "windows wallpaper" },
  { id: "macbook", label: "MacBook", query: "macbook wallpaper" },
  { id: "space", label: "Space", query: "space galaxy" },
  { id: "abstract", label: "Abstract", query: "abstract gradient" },
  { id: "city", label: "City", query: "city skyline night" },
];

const NAME = "Unsplash";
const API = "https://api.unsplash.com";
const KEY = "online.wallpaper.apiKey";
const headers = () => ({ Authorization: `Client-ID ${secretRef(KEY)}`, "Accept-Version": "v1" });
const UTM = "utm_source=glintbar&utm_medium=referral";

/** Landscape pictures only (the gallery is for desktops). */
export function mapPhotos(list: UnsplashPhoto[]): Photo[] {
  return list
    .filter((p) => p.width > p.height)
    .map((p) => ({
      id: p.id,
      color: p.color ?? "#334",
      alt: p.alt_description ?? "Photo",
      thumb: p.urls.small,
      raw: p.urls.raw,
      page: `${p.links.html}?${UTM}`,
      download: p.links.download_location,
      author: p.user.name,
      authorUrl: `${p.user.links.html}?${UTM}`,
    }));
}

export async function searchPhotos(topic: Topic, page: number): Promise<Photo[]> {
  const res = await guard(NAME, () =>
    httpJson<{ results: UnsplashPhoto[] }>(`${API}/search/photos`, { headers: headers(), query: { query: topic.query, orientation: "landscape", per_page: 12, page, content_filter: "high" } }),
    { unauthorized: "That key was rejected by Unsplash. It needs the Access Key; the Secret key will not work." },
  );
  return mapPhotos(res.results ?? []);
}

export async function randomPhoto(topic: Topic): Promise<Photo | undefined> {
  const res = await guard(NAME, () => httpJson<UnsplashPhoto[]>(`${API}/photos/random`, { headers: headers(), query: { query: topic.query, orientation: "landscape", count: 3, content_filter: "high" } }));
  return mapPhotos(res)[0];
}

/** The URL Rust downloads: big enough for 4K, still JPEG. */
export function wallpaperUrl(p: Photo): string {
  return `${p.raw}${p.raw.includes("?") ? "&" : "?"}w=3840&fit=max&fm=jpg&q=85`;
}

export interface Current {
  id: string;
  thumb: string;
  author: string;
  authorUrl: string;
  page: string;
  at: number;
}

export const CURRENT_KEY = "online.wallpaper.current";
export const ROTATION_KEY = "online.wallpaper.rotation";

export interface Rotation {
  mode: "off" | "daily" | "weekly";
  /** A topic id, or "all". */
  topic: string;
  lastAt: number;
}

export const DEFAULT_ROTATION: Rotation = { mode: "off", topic: "all", lastAt: 0 };

export async function applyPhoto(p: Photo): Promise<void> {
  await call("online", "set_wallpaper", { url: wallpaperUrl(p), id: p.id });
  // Unsplash asks apps to report each download.
  httpJson(p.download, { headers: headers() }).catch(() => {});
  setStored<Current>(CURRENT_KEY, { id: p.id, thumb: p.thumb, author: p.author, authorUrl: p.authorUrl, page: p.page, at: Date.now() });
}

let rotating = false;

/** Called by the tile now and then: changes the wallpaper when a day or week has passed. */
export async function rotateIfDue(now = Date.now()): Promise<boolean> {
  const r = getStored<Rotation>(ROTATION_KEY, DEFAULT_ROTATION);
  if (r.mode === "off" || rotating) return false;
  const period = r.mode === "daily" ? 86_400_000 : 7 * 86_400_000;
  if (now - r.lastAt < period) return false;
  rotating = true;
  try {
    const topic = r.topic === "all" ? TOPICS[Math.floor(Math.random() * TOPICS.length)] : (TOPICS.find((t) => t.id === r.topic) ?? TOPICS[0]);
    const photo = await randomPhoto(topic);
    if (!photo) return false;
    await applyPhoto(photo);
    setStored<Rotation>(ROTATION_KEY, { ...r, lastAt: now });
    return true;
  } finally {
    rotating = false;
  }
}

/** Gradient stand-ins for the preview (no network). */
export const SAMPLE_PHOTOS: Array<Pick<Photo, "id" | "color" | "alt" | "author"> & { css: string }> = [
  { id: "s1", color: "#2d3a6b", alt: "Mountain lake at dawn", author: "Sample", css: "linear-gradient(160deg,#ffb88c 0%,#de6262 35%,#2d3a6b 70%,#0f1c3d 100%)" },
  { id: "s2", color: "#0b3d2e", alt: "Forest valley", author: "Sample", css: "linear-gradient(180deg,#a8e6cf 0%,#3b8d6e 45%,#0b3d2e 100%)" },
  { id: "s3", color: "#141e30", alt: "Night sky", author: "Sample", css: "radial-gradient(circle at 30% 30%,#4b6cb7 0%,#182848 55%,#05070f 100%)" },
  { id: "s4", color: "#ff7e5f", alt: "Desert dunes", author: "Sample", css: "linear-gradient(170deg,#feb47b 0%,#ff7e5f 50%,#7b3f61 100%)" },
  { id: "s5", color: "#1f4068", alt: "Ocean", author: "Sample", css: "linear-gradient(180deg,#89f7fe 0%,#66a6ff 45%,#1f4068 100%)" },
  { id: "s6", color: "#3a1c71", alt: "Abstract waves", author: "Sample", css: "linear-gradient(135deg,#3a1c71 0%,#d76d77 55%,#ffaf7b 100%)" },
  { id: "s7", color: "#232526", alt: "City lights", author: "Sample", css: "linear-gradient(180deg,#414345 0%,#232526 60%,#f7b733 100%)" },
  { id: "s8", color: "#355c7d", alt: "Snowy peaks", author: "Sample", css: "linear-gradient(175deg,#e0eafc 0%,#cfdef3 40%,#355c7d 100%)" },
  { id: "s9", color: "#42275a", alt: "Aurora", author: "Sample", css: "linear-gradient(160deg,#11998e 0%,#38ef7d 30%,#42275a 100%)" },
];

export const wallpaperAccount: Account = {
  ns: "online.wallpaper",
  name: "Unsplash",
  ids: ["online.wallpaper"],
  spec: {
    fields: [{ key: "apiKey", label: "Access Key", secret: true, help: "Paste the Access Key here; the Secret key won't work." }],
    guide: { steps: ["On Unsplash, go to Your apps and press New Application.", "Agree to the terms, give the app a name and finish creating it.", "Copy the Access Key from the Keys section of the app's page."], url: "https://unsplash.com/oauth/applications", linkLabel: "Open Unsplash apps" },
    test: async (values) => {
      await guard(NAME, () => httpJson(`${API}/photos`, { headers: { Authorization: `Client-ID ${values.apiKey}` }, query: { per_page: 1 } }), {
        unauthorized: "That key was rejected by Unsplash. It needs the Access Key; the Secret key will not work.",
      });
    },
  },
};
