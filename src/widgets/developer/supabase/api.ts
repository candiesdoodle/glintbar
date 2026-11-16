import { HttpError, httpJson } from "../../../core/http";
import { guard, type Account, type Ctx } from "../../finance/shared/account";
import { PlainError } from "../../finance/shared/poll";
import { sampleSeries } from "../../finance/shared/sample";

export interface SbProject {
  ref: string;
  name: string;
  region: string;
  status: string;
  created_at?: string;
}
export interface SbCountsResponse {
  result?: Array<{ timestamp: string | number; total_auth_requests?: number; total_rest_requests?: number; total_storage_requests?: number; total_realtime_requests?: number }>;
  error?: unknown;
}
export interface SbHealth {
  name: string;
  status: string;
  healthy?: boolean;
  error?: string;
}

export interface SupabaseData {
  project: { ref: string; name: string; region: string; status: string };
  /** Requests in the last 24 h and the 24 h before. */
  requests: number;
  prevRequests: number;
  byService: { rest: number; auth: number; storage: number; realtime: number };
  /** Per bucket, oldest first (for the line). */
  series: number[];
  health: Array<{ name: string; ok: boolean; status: string }>;
  db?: { users: number; newUsers: number; bytes: number };
  /** Section problems in plain words ("Database: the token has no Database read permission"). */
  problems: string[];
}

const NAME = "Supabase";
const API = "https://api.supabase.com/v1";
const auth = (ctx: Ctx) => ({ Authorization: `Bearer ${ctx.secret("token")}` });

export function pickProject(list: SbProject[], wanted: string | undefined): SbProject {
  const w = (wanted ?? "").trim().toLowerCase();
  if (w) {
    const hit = list.find((p) => p.ref.toLowerCase() === w || p.name.toLowerCase() === w);
    if (!hit) throw new PlainError(`No Supabase project matches "${wanted}". Use its exact name or reference ID.`);
    return hit;
  }
  const p = list.find((x) => x.status === "ACTIVE_HEALTHY") ?? list[0];
  if (!p) throw new PlainError("No Supabase projects are visible to this token.");
  return p;
}

const tsMs = (t: string | number) => (typeof t === "number" ? (t > 1e14 ? t / 1000 : t) : Date.parse(t));

/** Splits usage buckets into the last 24 h and the 24 h before. */
export function splitCounts(res: SbCountsResponse, now = Date.now()): Pick<SupabaseData, "requests" | "prevRequests" | "byService" | "series"> {
  const rows = [...(res.result ?? [])].sort((a, b) => tsMs(a.timestamp) - tsMs(b.timestamp));
  const by = { rest: 0, auth: 0, storage: 0, realtime: 0 };
  let requests = 0;
  let prevRequests = 0;
  const series: number[] = [];
  for (const r of rows) {
    const total = (r.total_rest_requests ?? 0) + (r.total_auth_requests ?? 0) + (r.total_storage_requests ?? 0) + (r.total_realtime_requests ?? 0);
    const age = now - tsMs(r.timestamp);
    if (age <= 86_400_000) {
      requests += total;
      by.rest += r.total_rest_requests ?? 0;
      by.auth += r.total_auth_requests ?? 0;
      by.storage += r.total_storage_requests ?? 0;
      by.realtime += r.total_realtime_requests ?? 0;
      series.push(total);
    } else if (age <= 2 * 86_400_000) prevRequests += total;
  }
  return { requests, prevRequests, byService: by, series };
}

const DB_SQL = "select (select count(*) from auth.users)::int as users, (select count(*) from auth.users where created_at > now() - interval '7 days')::int as new_users, pg_database_size(current_database())::bigint as bytes";

export function parseDbRows(res: unknown): { users: number; newUsers: number; bytes: number } | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = Array.isArray(res) ? res : Array.isArray((res as any)?.result) ? (res as any).result : [];
  const r = rows[0];
  if (!r) return undefined;
  return { users: Number(r.users ?? 0), newUsers: Number(r.new_users ?? 0), bytes: Number(r.bytes ?? 0) };
}

export async function loadSupabase(ctx: Ctx): Promise<SupabaseData> {
  const list = await guard(NAME, () => httpJson<SbProject[]>(`${API}/projects`, { headers: auth(ctx) }), { unauthorized: "The token was rejected by Supabase. Paste it again or make a new one." });
  const p = pickProject(list, ctx.settings.project);
  const problems: string[] = [];
  const [counts, health, db] = await Promise.all([
    httpJson<SbCountsResponse>(`${API}/projects/${p.ref}/analytics/endpoints/usage.api-counts`, { headers: auth(ctx), query: { interval: "3day" } }).catch((e) => {
      problems.push(e instanceof HttpError && e.kind === "forbidden" ? "API requests: the token has no Analytics read permission" : "API requests: unavailable at the moment");
      return undefined;
    }),
    httpJson<SbHealth[]>(`${API}/projects/${p.ref}/health`, { headers: auth(ctx), query: { services: "auth,db,rest,realtime,storage", timeout_ms: 4000 } }).catch(() => undefined),
    httpJson<unknown>(`${API}/projects/${p.ref}/database/query/read-only`, { method: "POST", headers: auth(ctx), body: { query: DB_SQL }, timeoutMs: 15_000 }).catch((e) => {
      if (e instanceof HttpError && e.kind === "forbidden") problems.push("Database: the token has no Database read permission");
      else if (e instanceof HttpError && (e.kind === "server" || e.kind === "timeout")) problems.push("Database: no reply - is the project paused?");
      else problems.push("Database: unavailable at the moment");
      return undefined;
    }),
  ]);
  const c = counts ? splitCounts(counts) : { requests: 0, prevRequests: 0, byService: { rest: 0, auth: 0, storage: 0, realtime: 0 }, series: [] };
  return {
    project: { ref: p.ref, name: p.name, region: p.region, status: p.status },
    ...c,
    health: (health ?? []).map((h) => ({ name: h.name, ok: h.status === "ACTIVE_HEALTHY" || h.healthy === true, status: h.status })),
    db: db ? parseDbRows(db) : undefined,
    problems,
  };
}

export function sampleSupabase(): SupabaseData {
  const series = sampleSeries("supabase", 24, 1450, { integer: true, noise: 0.3, weekly: 0, trend: 0.1 });
  const requests = series.reduce((a, b) => a + b, 0);
  return {
    project: { ref: "abcdefghijklmnopqrst", name: "my-app", region: "eu-central-1", status: "ACTIVE_HEALTHY" },
    requests,
    prevRequests: Math.round(requests * 0.91),
    byService: { rest: Math.round(requests * 0.71), auth: Math.round(requests * 0.16), storage: Math.round(requests * 0.09), realtime: Math.round(requests * 0.04) },
    series,
    health: ["auth", "db", "rest", "realtime", "storage"].map((name) => ({ name, ok: true, status: "ACTIVE_HEALTHY" })),
    db: { users: 2841, newUsers: 63, bytes: 412 * 1024 * 1024 },
    problems: [],
  };
}

export const supabaseAccount: Account = {
  ns: "developer.supabase",
  name: NAME,
  ids: ["developer.supabase"],
  spec: {
    fields: [
      { key: "token", label: "Token", secret: true, placeholder: "sbp_…" },
      { key: "project", label: "Project", optional: true, help: "Name or reference ID of the project. Leave blank to use the first healthy one." },
    ],
    guide: {
      steps: ["In Supabase, go to Account → Access tokens and make a new token.", "A scoped token needs read access to projects, the database and analytics usage.", "Copy the sbp_… token."],
      url: "https://supabase.com/dashboard/account/tokens",
      linkLabel: "Open Supabase tokens",
    },
    test: async (values) => {
      const list = await guard(NAME, () => httpJson<SbProject[]>(`${API}/projects`, { headers: { Authorization: `Bearer ${values.token}` } }), { unauthorized: "The token was rejected by Supabase. Paste it again or make a new one." });
      pickProject(list, values.project);
    },
  },
};
