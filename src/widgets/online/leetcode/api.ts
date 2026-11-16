import { httpJson } from "../../../core/http";
import { guard, type Account, type Ctx } from "../../finance/shared/account";
import { PlainError } from "../../finance/shared/poll";
import { dayKey, rng } from "../../finance/shared/sample";

export interface LeetResponse {
  data?: {
    matchedUser: null | {
      username: string;
      submitStatsGlobal: { acSubmissionNum: Array<{ difficulty: string; count: number }> };
      userCalendar: { streak: number; totalActiveDays: number; submissionCalendar: string } | null;
    };
    allQuestionsCount?: Array<{ difficulty: string; count: number }>;
  };
  errors?: Array<{ message: string }>;
}

export interface LeetData {
  username: string;
  solved: number;
  easy: number;
  medium: number;
  hard: number;
  totals: { easy: number; medium: number; hard: number; all: number };
  /** Consecutive days with a submission, ending today (or yesterday). */
  streak: number;
  /** LeetCode's own best streak this year. */
  maxStreak: number;
  activeDays: number;
  /** Submissions per local day, last 182 days, oldest first. */
  calendar: Array<{ date: string; count: number }>;
}

const QUERY = `query glintbar($username: String!) {
  matchedUser(username: $username) {
    username
    submitStatsGlobal { acSubmissionNum { difficulty count } }
    userCalendar { streak totalActiveDays submissionCalendar }
  }
  allQuestionsCount { difficulty count }
}`;

/** submissionCalendar keys are UTC-midnight unix seconds. */
export function parseCalendar(json: string, days = 182, now = new Date()): Array<{ date: string; count: number }> {
  let raw: Record<string, number> = {};
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    raw = {};
  }
  const by = new Map<string, number>();
  for (const [ts, n] of Object.entries(raw)) {
    const d = new Date(Number(ts) * 1000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    by.set(key, (by.get(key) ?? 0) + Number(n));
  }
  const out: Array<{ date: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12));
    out.push({ date: key, count: by.get(key) ?? 0 });
  }
  return out;
}

export function currentStreak(cal: Array<{ count: number }>): number {
  let i = cal.length - 1;
  if (i >= 0 && cal[i].count === 0) i--;
  let n = 0;
  for (; i >= 0 && cal[i].count > 0; i--) n++;
  return n;
}

export function mapLeet(res: LeetResponse, now = new Date()): LeetData {
  if (res.errors?.length && !res.data?.matchedUser) throw new PlainError(`LeetCode: ${res.errors[0].message}`);
  const u = res.data?.matchedUser;
  if (!u) throw new PlainError("No LeetCode user goes by that name. Use the name from your profile URL (leetcode.com/u/<name>).");
  const n = (d: string, list: Array<{ difficulty: string; count: number }> = []) => list.find((x) => x.difficulty === d)?.count ?? 0;
  const ac = u.submitStatsGlobal.acSubmissionNum;
  const all = res.data?.allQuestionsCount ?? [];
  const calendar = parseCalendar(u.userCalendar?.submissionCalendar ?? "{}", 182, now);
  return {
    username: u.username,
    solved: n("All", ac),
    easy: n("Easy", ac),
    medium: n("Medium", ac),
    hard: n("Hard", ac),
    totals: { easy: n("Easy", all), medium: n("Medium", all), hard: n("Hard", all), all: n("All", all) },
    streak: currentStreak(calendar),
    maxStreak: u.userCalendar?.streak ?? 0,
    activeDays: u.userCalendar?.totalActiveDays ?? 0,
    calendar,
  };
}

const NAME = "LeetCode";

export async function loadLeet(ctx: Ctx): Promise<LeetData> {
  const username = (ctx.settings.username ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/leetcode\.com\/(u\/)?/i, "").replace(/\/.*$/, "");
  if (!username) throw new PlainError("Fill in your LeetCode username.");
  const res = await guard(NAME, () =>
    httpJson<LeetResponse>("https://leetcode.com/graphql", {
      method: "POST",
      headers: { Referer: "https://leetcode.com", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GlintBar" },
      body: { query: QUERY, variables: { username } },
    }),
  );
  return mapLeet(res);
}

export function sampleLeet(): LeetData {
  const r = rng("leet");
  const now = new Date();
  const calendar: Array<{ date: string; count: number }> = [];
  for (let i = 181; i >= 0; i--) calendar.push({ date: dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12)), count: i < 14 ? 1 + Math.round(r() * 3) : r() > 0.45 ? Math.round(r() * 5) : 0 });
  return {
    username: "you",
    solved: 412,
    easy: 168,
    medium: 205,
    hard: 39,
    totals: { easy: 880, medium: 1850, hard: 830, all: 3560 },
    streak: currentStreak(calendar),
    maxStreak: 31,
    activeDays: 214,
    calendar,
  };
}

export const leetAccount: Account = {
  ns: "online.leetcode",
  name: NAME,
  ids: ["online.leetcode"],
  spec: {
    fields: [{ key: "username", label: "Username", placeholder: "your-name", help: "Reads your public profile, so no key or account setup is needed." }],
    guide: { steps: ["Enter the username that appears in your profile URL, leetcode.com/u/<name>."], url: "https://leetcode.com/", linkLabel: "Open LeetCode" },
    test: async (values) => {
      await loadLeet({ secret: () => "", settings: values, testing: true });
    },
  },
};
