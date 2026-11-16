import { httpJson } from "../../../core/http";
import { guard, type Account, type Ctx } from "../../finance/shared/account";
import { PlainError } from "../../finance/shared/poll";
import { dayKey, lastDays, rng, sampleSeries, startOfDay } from "../../finance/shared/sample";

export interface LinearIssue {
  identifier: string;
  title: string;
  url: string;
  priority: number;
  dueDate: string | null;
  completedAt?: string | null;
  state: { name: string; type: string };
}
export interface LinearResponse {
  data?: { viewer: { name?: string; open: { nodes: LinearIssue[] }; done: { nodes: Array<{ completedAt: string | null }> } } };
  errors?: Array<{ message: string }>;
}

export interface LinearData {
  open: number;
  inProgress: number;
  todo: number;
  backlog: number;
  overdue: number;
  dueThisWeek: number;
  urgent: number;
  done7: number;
  /** Issues finished per day, 14 days. */
  doneDaily: number[];
  days: string[];
  active: Array<Pick<LinearIssue, "identifier" | "title" | "url" | "priority" | "dueDate"> & { state: string }>;
}

const NAME = "Linear";
const API = "https://api.linear.app/graphql";

export const LINEAR_QUERY = `query GlintBar($since: DateTimeOrDuration!) {
  viewer {
    name
    open: assignedIssues(first: 250, filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
      nodes { identifier title url priority dueDate state { name type } }
    }
    done: assignedIssues(first: 250, filter: { completedAt: { gte: $since } }) {
      nodes { completedAt }
    }
  }
}`;

export function linearData(res: LinearResponse, now = new Date()): LinearData {
  if (res.errors?.length) throw new PlainError(`Linear: ${res.errors[0].message}`);
  const v = res.data?.viewer;
  const open = v?.open.nodes ?? [];
  const days = lastDays(14, now);
  const today = dayKey(now);
  const weekEnd = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const doneBy = new Map<string, number>();
  for (const d of v?.done.nodes ?? []) if (d.completedAt) doneBy.set(dayKey(new Date(d.completedAt)), (doneBy.get(dayKey(new Date(d.completedAt))) ?? 0) + 1);
  const doneDaily = days.map((d) => doneBy.get(d) ?? 0);
  const started = open.filter((i) => i.state.type === "started");
  return {
    open: open.length,
    inProgress: started.length,
    todo: open.filter((i) => i.state.type === "unstarted").length,
    backlog: open.filter((i) => i.state.type === "backlog" || i.state.type === "triage").length,
    overdue: open.filter((i) => i.dueDate && i.dueDate < today).length,
    dueThisWeek: open.filter((i) => i.dueDate && i.dueDate >= today && i.dueDate <= weekEnd).length,
    urgent: open.filter((i) => i.priority === 1).length,
    done7: doneDaily.slice(-7).reduce((a, b) => a + b, 0),
    doneDaily,
    days,
    active: [...started, ...open.filter((i) => i.state.type === "unstarted")]
      .sort((a, b) => (a.priority || 9) - (b.priority || 9))
      .slice(0, 6)
      .map((i) => ({ identifier: i.identifier, title: i.title, url: i.url, priority: i.priority, dueDate: i.dueDate, state: i.state.name })),
  };
}

export async function loadLinear(ctx: Ctx): Promise<LinearData> {
  const res = await guard(NAME, () =>
    httpJson<LinearResponse>(API, { method: "POST", headers: { Authorization: ctx.secret("apiKey") }, body: { query: LINEAR_QUERY, variables: { since: startOfDay(13).toISOString() } } }),
  );
  return linearData(res);
}

export function sampleLinear(): LinearData {
  const r = rng("linear");
  const days = lastDays(14);
  return {
    open: 12,
    inProgress: 4,
    todo: 5,
    backlog: 3,
    overdue: 1,
    dueThisWeek: 3,
    urgent: 1,
    done7: 9,
    doneDaily: sampleSeries("linear", 14, 1.4, { integer: true, noise: 0.9 }).map((v) => (r() < 0.15 ? 0 : v)),
    days,
    active: [
      { identifier: "ENG-412", title: "Retry webhooks with backoff", url: "https://linear.app", priority: 1, dueDate: dayKey(new Date()), state: "In Progress" },
      { identifier: "ENG-398", title: "Dark mode for the settings page", url: "https://linear.app", priority: 2, dueDate: null, state: "In Progress" },
      { identifier: "ENG-377", title: "Speed up the search index build", url: "https://linear.app", priority: 3, dueDate: null, state: "In Review" },
      { identifier: "ENG-430", title: "Onboarding checklist copy", url: "https://linear.app", priority: 4, dueDate: null, state: "Todo" },
    ],
  };
}

export const linearAccount: Account = {
  ns: "developer.linear",
  name: NAME,
  ids: ["developer.linear"],
  spec: {
    fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "lin_api_…" }],
    guide: { steps: ["Go to Settings → Security & access in Linear.", "In the Personal API keys section, make a key. Read access is all it needs.", "Copy the lin_api_… key."], url: "https://linear.app/settings/account/security", linkLabel: "Open Linear settings" },
    test: async (values) => {
      const res = await guard(NAME, () => httpJson<LinearResponse>(API, { method: "POST", headers: { Authorization: values.apiKey }, body: { query: "{ viewer { id } }" } }));
      if (res.errors?.length) throw new PlainError(`Linear: ${res.errors[0].message}`);
    },
  },
};
