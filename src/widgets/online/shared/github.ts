/** GitHub: one personal access token shared by GitHub Activity, GitHub and GitHub Overview. */
import { reportReviewRequests, type ReviewRequestSignal } from "../../../automations/signals";
import { HttpError, httpJson } from "../../../core/http";
import { guard, type Account, type Ctx } from "../../finance/shared/account";
import { PlainError } from "../../finance/shared/poll";
import { dayKey, rng } from "../../finance/shared/sample";

const NAME = "GitHub";
const GQL = "https://api.github.com/graphql";
const headers = (ctx: Ctx) => ({ Authorization: `Bearer ${ctx.secret("token")}`, "X-GitHub-Api-Version": "2022-11-28" });

export const githubAccount: Account = {
  ns: "online.github",
  name: NAME,
  ids: ["online.github-activity", "online.github", "online.github-overview"],
  spec: {
    fields: [{ key: "token", label: "Personal access token", secret: true, placeholder: "ghp_…", help: "A classic token with the read:user scope; add notifications to see the unread count." }],
    guide: {
      steps: ["In GitHub, press Generate new token (classic) under Settings → Developer settings → Personal access tokens.", "Select the read:user scope, plus notifications if you want the unread count.", "Press Generate token and copy the ghp_… value."],
      url: "https://github.com/settings/tokens/new?scopes=read:user,notifications&description=GlintBar",
      linkLabel: "Create a token on GitHub",
    },
    test: async (values) => {
      await gql({ secret: (f) => values[f] ?? "", settings: values, testing: true }, "{ viewer { login } }");
    },
  },
};

export async function gql<T>(ctx: Ctx, query: string, variables?: object): Promise<T> {
  const res = await guard(NAME, () => httpJson<{ data?: T; errors?: Array<{ message: string }> }>(GQL, { method: "POST", headers: headers(ctx), body: { query, variables } }), {
    unauthorized: "GitHub refused this token. Paste it once more and confirm it is not past its expiry date.",
  });
  if (res.errors?.length && !res.data) throw new PlainError(`GitHub: ${res.errors[0].message}`);
  return res.data as T;
}

// ---- contributions -----------------------------------------------------------------------------

export type Level = 0 | 1 | 2 | 3 | 4;
export interface ContribDay {
  date: string;
  count: number;
  level: Level;
}
export interface Contributions {
  login: string;
  total: number;
  days: ContribDay[];
  current: number;
  longest: number;
}

const LEVELS: Record<string, Level> = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

export interface CalendarResponse {
  viewer: {
    login: string;
    contributionsCollection: {
      contributionCalendar: {
        totalContributions: number;
        weeks: Array<{ contributionDays: Array<{ date: string; contributionCount: number; contributionLevel: string }> }>;
      };
    };
  };
}

/** Current streak counts today only once you have contributed; a quiet today keeps yesterday's streak. */
export function streaks(days: ContribDay[], today = dayKey(new Date())): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    if (d.date > today) break;
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const past = days.filter((d) => d.date <= today);
  let i = past.length - 1;
  if (i >= 0 && past[i].count === 0) i--;
  let current = 0;
  for (; i >= 0 && past[i].count > 0; i--) current++;
  return { current, longest };
}

export function mapCalendar(res: CalendarResponse, today?: string): Contributions {
  const cal = res.viewer.contributionsCollection.contributionCalendar;
  const days: ContribDay[] = cal.weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? (d.contributionCount > 0 ? 1 : 0) })));
  return { login: res.viewer.login, total: cal.totalContributions, days, ...streaks(days, today) };
}

export async function loadContributions(ctx: Ctx): Promise<Contributions> {
  const res = await gql<CalendarResponse>(
    ctx,
    "{ viewer { login contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } } } } }",
  );
  return mapCalendar(res);
}

export function sampleContributions(): Contributions {
  const r = rng("gh-contrib");
  const days: ContribDay[] = [];
  const now = new Date();
  // 53 weeks ending this Saturday, like GitHub's calendar.
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - now.getDay()));
  for (let i = 53 * 7 - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i, 12);
    const key = dayKey(d);
    if (key > dayKey(now)) continue;
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const recent = i < 20;
    const active = recent || r() > (weekend ? 0.65 : 0.3);
    const count = active ? Math.max(1, Math.round(r() * (weekend ? 4 : 9))) : 0;
    days.push({ date: key, count, level: (count === 0 ? 0 : count < 3 ? 1 : count < 5 ? 2 : count < 7 ? 3 : 4) as Level });
  }
  return { login: "octocat", total: days.reduce((a, d) => a + d.count, 0), days, ...streaks(days) };
}

// ---- notifications & overview --------------------------------------------------------------------

export interface GhNotification {
  id: string;
  reason: string;
  updated_at: string;
  subject: { title: string; type: string; url: string | null };
  repository: { full_name: string; html_url: string };
}

export interface Notifications {
  count: number;
  more: boolean;
  items: Array<{ id: string; title: string; repo: string; type: string; updatedAt: string; url: string }>;
}

/** api.github.com/repos/o/r/pulls/1 -> github.com/o/r/pull/1 */
export function htmlUrl(n: GhNotification): string {
  const api = n.subject.url;
  if (!api) return n.repository.html_url;
  return api.replace("https://api.github.com/repos/", "https://github.com/").replace("/pulls/", "/pull/").replace(/\/commits\//, "/commit/");
}

export function mapNotifications(list: GhNotification[], more: boolean): Notifications {
  return {
    count: list.length,
    more,
    items: list.slice(0, 8).map((n) => ({ id: n.id, title: n.subject.title, repo: n.repository.full_name, type: n.subject.type, updatedAt: n.updated_at, url: htmlUrl(n) })),
  };
}

export const NOTIFICATION_SCOPE_MESSAGE = "With this token GlintBar can't read notifications. Make a token that has the notifications scope.";

export async function loadNotifications(ctx: Ctx): Promise<Notifications> {
  const all: GhNotification[] = [];
  let more = false;
  for (let page = 1; page <= 2; page++) {
    let list: GhNotification[];
    try {
      list = await httpJson<GhNotification[]>("https://api.github.com/notifications", { headers: headers(ctx), query: { per_page: 50, page } });
    } catch (e) {
      if (e instanceof HttpError && (e.kind === "forbidden" || e.kind === "not_found")) throw new PlainError(NOTIFICATION_SCOPE_MESSAGE);
      return guard(NAME, () => Promise.reject(e));
    }
    all.push(...list);
    if (list.length < 50) break;
    more = page === 2;
  }
  reportReviewRequests(REVIEW_SOURCE, reviewRequests(all));
  return mapNotifications(all, more);
}

const REVIEW_SOURCE = "online.github";

/** Unread notifications that ask you to review a pull request (for Automations). */
export function reviewRequests(list: GhNotification[]): ReviewRequestSignal[] {
  return list
    .filter((n) => n.reason === "review_requested" && n.subject.type === "PullRequest")
    .map((n) => ({ id: `gh-${n.id}`, title: `${n.subject.title} (${n.repository.full_name})`, url: htmlUrl(n), from: "GitHub" }));
}

export interface Overview {
  login: string;
  openPrs: number;
  stars: number;
  repos: Array<{ name: string; stars: number; url: string }>;
  prs: Array<{ title: string; repo: string; url: string }>;
  notifications?: number;
  notificationsMore?: boolean;
  notificationsError?: string;
}

export interface OverviewResponse {
  viewer: {
    login: string;
    pullRequests: { totalCount: number; nodes: Array<{ title: string; url: string; repository: { nameWithOwner: string } }> };
    repositories: { nodes: Array<{ name: string; url: string; stargazerCount: number }> };
  };
}

export function mapOverview(res: OverviewResponse): Overview {
  const v = res.viewer;
  return {
    login: v.login,
    openPrs: v.pullRequests.totalCount,
    stars: v.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0),
    repos: v.repositories.nodes.slice(0, 5).map((r) => ({ name: r.name, stars: r.stargazerCount, url: r.url })),
    prs: v.pullRequests.nodes.map((p) => ({ title: p.title, repo: p.repository.nameWithOwner, url: p.url })),
  };
}

export async function loadOverview(ctx: Ctx): Promise<Overview> {
  const res = await gql<OverviewResponse>(
    ctx,
    `{ viewer { login
        pullRequests(states: OPEN, first: 5, orderBy: { field: UPDATED_AT, direction: DESC }) { totalCount nodes { title url repository { nameWithOwner } } }
        repositories(ownerAffiliations: OWNER, first: 100, orderBy: { field: STARGAZERS, direction: DESC }) { nodes { name url stargazerCount } } } }`,
  );
  const o = mapOverview(res);
  try {
    const n = await loadNotifications(ctx);
    o.notifications = n.count;
    o.notificationsMore = n.more;
  } catch (e) {
    o.notificationsError = e instanceof PlainError ? e.message : "Notifications did not load.";
  }
  return o;
}

export function sampleNotifications(): Notifications {
  const t = Date.now();
  return {
    count: 7,
    more: false,
    items: [
      { id: "1", title: "Fix flaky upload test on Windows", repo: "acme/api", type: "PullRequest", updatedAt: new Date(t - 12 * 60_000).toISOString(), url: "https://github.com" },
      { id: "2", title: "Crash when the config file is empty", repo: "acme/cli", type: "Issue", updatedAt: new Date(t - 2 * 3600_000).toISOString(), url: "https://github.com" },
      { id: "3", title: "v2.4.0", repo: "acme/web", type: "Release", updatedAt: new Date(t - 5 * 3600_000).toISOString(), url: "https://github.com" },
      { id: "4", title: "Add dark mode tokens", repo: "acme/design", type: "PullRequest", updatedAt: new Date(t - 26 * 3600_000).toISOString(), url: "https://github.com" },
    ],
  };
}

export function sampleOverview(): Overview {
  return {
    login: "octocat",
    openPrs: 3,
    stars: 1284,
    notifications: 7,
    repos: [
      { name: "tiny-dock", stars: 812, url: "https://github.com" },
      { name: "dotfiles", stars: 301, url: "https://github.com" },
      { name: "color-kit", stars: 171, url: "https://github.com" },
    ],
    prs: [
      { title: "Fix flaky upload test on Windows", repo: "acme/api", url: "https://github.com" },
      { title: "Add dark mode tokens", repo: "acme/design", url: "https://github.com" },
      { title: "Bump deps", repo: "octocat/tiny-dock", url: "https://github.com" },
    ],
  };
}
