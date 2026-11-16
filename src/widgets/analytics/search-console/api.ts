import { BackendError } from "../../../core/backend";
import { getStored, setStored } from "../../../core/store";
import { PlainError } from "../../finance/shared/poll";
import { dayKey, sampleSeries } from "../../finance/shared/sample";
import { GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, googleGuide, oauthJson, type OAuthAccount } from "../../online/shared/oauth";

export const scAccount: OAuthAccount = {
  ns: "analytics.search-console",
  name: "Search Console",
  vendor: "Google",
  ids: ["analytics.search-console"],
  authUrl: GOOGLE_AUTH_URL,
  tokenUrl: GOOGLE_TOKEN_URL,
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  extra: { access_type: "offline", prompt: "consent" },
  guide: {
    steps: [...googleGuide("Google Search Console API", "GlintBar Search Console"), "Enter both values below, press Save, then Sign in with Google. A client you already made for Gmail can be reused after you turn this API on."],
    url: "https://console.cloud.google.com/apis/library/searchconsole.googleapis.com",
    linkLabel: "Open Google Cloud",
  },
};

const API = "https://www.googleapis.com/webmasters/v3";
const SITE_KEY = "analytics.search-console.site";

export interface ScRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
export interface ScQueryResponse {
  rows?: ScRow[];
}

export interface ScTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface ScSummary {
  site: string;
  sites: string[];
  days: string[];
  clicks: number[];
  impressions: number[];
  totals: ScTotals;
  prev: ScTotals;
}

export function map403(detail: string): string {
  const d = detail.toLowerCase();
  if (d.includes("has not been used") || d.includes("is disabled") || d.includes("not enabled")) return "Google Search Console API is switched off for your Google Cloud project. Turn it on, then retry after a minute.";
  if (d.includes("permission") || d.includes("not authorized") || d.includes("does not have")) return "The site is not shared with the Google account you signed in with, so GlintBar can't read it in Search Console.";
  return `Google: ${detail || "access denied"}`;
}

const get = <T,>(url: string, body?: object) => oauthJson<T>(scAccount, url, body ? { method: "POST", body } : {}, map403);

export function siteLabel(site: string): string {
  return site.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function getSite(): string {
  return getStored<string>(SITE_KEY, "");
}
export function setSite(site: string): void {
  setStored(SITE_KEY, site);
}

export async function listSites(): Promise<string[]> {
  const res = await get<{ siteEntry?: Array<{ siteUrl: string; permissionLevel?: string }> }>(`${API}/sites`);
  return (res.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => s.siteUrl);
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + n, 12));
}

export function scQuery(site: string, body: object): Promise<ScQueryResponse> {
  return get<ScQueryResponse>(`${API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, body);
}

/** Splits a 2×range daily query into this period and the one before. */
export function summarize(rows: ScRow[], days: string[], prevDays: string[]): Pick<ScSummary, "clicks" | "impressions" | "totals" | "prev"> {
  const by = new Map((rows ?? []).map((r) => [r.keys?.[0] ?? "", r]));
  const tot = (keys: string[]): ScTotals => {
    let clicks = 0;
    let impressions = 0;
    let posW = 0;
    for (const k of keys) {
      const r = by.get(k);
      if (!r) continue;
      clicks += r.clicks;
      impressions += r.impressions;
      posW += r.position * r.impressions;
    }
    return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? posW / impressions : 0 };
  };
  return {
    clicks: days.map((k) => by.get(k)?.clicks ?? 0),
    impressions: days.map((k) => by.get(k)?.impressions ?? 0),
    totals: tot(days),
    prev: tot(prevDays),
  };
}

/** Days ending yesterday (Google's numbers lag, and the latest days are still incomplete). */
export function periodDays(range: number, now = new Date()): { days: string[]; prevDays: string[] } {
  const end = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12));
  const days: string[] = [];
  const prevDays: string[] = [];
  for (let i = range - 1; i >= 0; i--) days.push(addDays(end, -i));
  for (let i = 2 * range - 1; i >= range; i--) prevDays.push(addDays(end, -i));
  return { days, prevDays };
}

export async function resolveSite(): Promise<{ site: string; sites: string[] }> {
  const sites = await listSites();
  if (!sites.length) throw new PlainError("Your Search Console has no verified sites. Add your site there, verify it and press Retry.");
  const saved = getSite();
  const site = sites.includes(saved) ? saved : sites[0];
  return { site, sites };
}

export async function loadSummary(range: number): Promise<ScSummary> {
  const { site, sites } = await resolveSite();
  const { days, prevDays } = periodDays(range);
  const res = await scQuery(site, { startDate: prevDays[0], endDate: days[days.length - 1], dimensions: ["date"], dataState: "all", rowLimit: 500 });
  return { site, sites, days, ...summarize(res.rows ?? [], days, prevDays) };
}

export type TopDim = "query" | "page" | "country" | "device";

export async function loadTop(dim: TopDim, range: number): Promise<ScRow[]> {
  const { site } = await resolveSite();
  const { days } = periodDays(range);
  const res = await scQuery(site, { startDate: days[0], endDate: days[days.length - 1], dimensions: [dim], dataState: "all", rowLimit: 8 });
  return res.rows ?? [];
}

export interface Inspection {
  verdict?: string;
  coverageState?: string;
  lastCrawlTime?: string;
  indexingState?: string;
  pageFetchState?: string;
  robotsTxtState?: string;
}

export async function inspectUrl(url: string): Promise<Inspection> {
  const { site } = await resolveSite();
  try {
    const res = await oauthJson<{ inspectionResult?: { indexStatusResult?: Inspection } }>(
      scAccount,
      "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
      { method: "POST", body: { inspectionUrl: url, siteUrl: site } },
      map403,
    );
    return res.inspectionResult?.indexStatusResult ?? {};
  } catch (e) {
    if (e instanceof BackendError) throw new PlainError("Google did not answer, so the page was not checked.");
    throw e;
  }
}

export function sampleSummary(range: number): ScSummary {
  const { days } = periodDays(range);
  const clicks = sampleSeries(`sc-c${range}`, range, 46, { integer: true, noise: 0.25, trend: 0.2 });
  const impressions = clicks.map((c, i) => Math.round(c * (28 + ((i * 7) % 9))));
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const c = sum(clicks);
  const im = sum(impressions);
  return {
    site: "sc-domain:example.com",
    sites: ["sc-domain:example.com"],
    days,
    clicks,
    impressions,
    totals: { clicks: c, impressions: im, ctr: c / im, position: 14.2 },
    prev: { clicks: Math.round(c * 0.88), impressions: Math.round(im * 0.93), ctr: (c * 0.88) / (im * 0.93), position: 15.1 },
  };
}

export const SAMPLE_TOP: Record<TopDim, ScRow[]> = {
  query: [
    { keys: ["widget dock windows"], clicks: 212, impressions: 4810, ctr: 0.044, position: 6.1 },
    { keys: ["taskbar replacement"], clicks: 148, impressions: 6120, ctr: 0.024, position: 9.8 },
    { keys: ["desktop widgets windows 11"], clicks: 97, impressions: 5230, ctr: 0.019, position: 11.2 },
    { keys: ["revenue widget"], clicks: 61, impressions: 980, ctr: 0.062, position: 4.3 },
  ],
  page: [
    { keys: ["https://example.com/"], clicks: 402, impressions: 9100, ctr: 0.044, position: 7.9 },
    { keys: ["https://example.com/widgets"], clicks: 188, impressions: 6400, ctr: 0.029, position: 10.4 },
    { keys: ["https://example.com/docs/setup"], clicks: 74, impressions: 2100, ctr: 0.035, position: 8.8 },
  ],
  country: [
    { keys: ["usa"], clicks: 311, impressions: 7700, ctr: 0.04, position: 9.1 },
    { keys: ["deu"], clicks: 120, impressions: 3200, ctr: 0.037, position: 10.2 },
    { keys: ["gbr"], clicks: 96, impressions: 2600, ctr: 0.037, position: 9.6 },
    { keys: ["ind"], clicks: 71, impressions: 4100, ctr: 0.017, position: 15.3 },
  ],
  device: [
    { keys: ["DESKTOP"], clicks: 520, impressions: 12800, ctr: 0.041, position: 8.9 },
    { keys: ["MOBILE"], clicks: 161, impressions: 6400, ctr: 0.025, position: 12.6 },
    { keys: ["TABLET"], clicks: 9, impressions: 300, ctr: 0.03, position: 11.1 },
  ],
};
