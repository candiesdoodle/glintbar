import { describe, expect, it } from "vitest";
import { lastDays } from "../finance/shared/sample";
import { linearData } from "./linear/api";
import { parseResendDate, resendSeries } from "./resend/api";
import { parseDbRows, pickProject, splitCounts } from "./supabase/api";

const now = new Date(2026, 10, 16, 12);

describe("developer mappings", () => {
  it("Resend: Postgres-style dates, daily counts and delivery share", () => {
    expect(parseResendDate("2026-04-03 22:13:42.674981+00")).toBe(Date.parse("2026-04-03T22:13:42.674Z"));
    const days = lastDays(14, now);
    const at = (d: number, h = 12) => {
      const x = new Date(2026, 10, d, h);
      const p = (n: number) => String(n).padStart(2, "0");
      return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())} ${p(x.getUTCHours())}:${p(x.getUTCMinutes())}:00.000000+00`;
    };
    const s = resendSeries(
      [
        { id: "1", created_at: at(16), last_event: "delivered" },
        { id: "2", created_at: at(16), last_event: "opened" },
        { id: "3", created_at: at(15), last_event: "bounced" },
        { id: "4", created_at: at(5), last_event: "delivered" },
      ],
      days,
      false,
      [{ name: "mail.example.com", status: "verified" }],
    );
    expect(s.values[13]).toBe(2);
    expect(s.values[12]).toBe(1);
    expect(s.values[2]).toBe(1);
    expect(s.stats?.find((x) => x.label === "Delivered · 7d")?.value).toBe("67%");
    expect(s.stats?.find((x) => x.label === "Bounced")?.value).toBe("1");
    expect(s.rows?.[0]).toEqual({ title: "mail.example.com", right: "Verified" });
  });

  it("Linear: counts by state type, due dates and finished per day", () => {
    const issue = (state: string, extra: object = {}) => ({ identifier: "ENG-1", title: "t", url: "u", priority: 0, dueDate: null, state: { name: state, type: state }, ...extra });
    const d = linearData(
      {
        data: {
          viewer: {
            open: {
              nodes: [
                issue("started", { priority: 1 }),
                issue("started", { dueDate: "2026-11-10" }),
                issue("unstarted", { dueDate: "2026-11-18" }),
                issue("backlog"),
                issue("triage"),
              ],
            },
            done: { nodes: [{ completedAt: new Date(2026, 10, 16, 9).toISOString() }, { completedAt: new Date(2026, 10, 16, 10).toISOString() }, { completedAt: new Date(2026, 10, 3, 10).toISOString() }] },
          },
        },
      },
      now,
    );
    expect(d.open).toBe(5);
    expect(d.inProgress).toBe(2);
    expect(d.todo).toBe(1);
    expect(d.backlog).toBe(2);
    expect(d.overdue).toBe(1);
    expect(d.dueThisWeek).toBe(1);
    expect(d.urgent).toBe(1);
    expect(d.doneDaily[13]).toBe(2);
    expect(d.doneDaily[0]).toBe(1);
    expect(d.done7).toBe(2);
    expect(d.active[0].priority).toBe(1);
    expect(() => linearData({ errors: [{ message: "Authentication required" }] })).toThrow(/Authentication/);
  });

  it("Supabase: last 24 h vs the day before, project pick, SQL rows", () => {
    const t = now.getTime();
    const c = splitCounts(
      {
        result: [
          { timestamp: new Date(t - 2 * 3600_000).toISOString(), total_rest_requests: 100, total_auth_requests: 10, total_storage_requests: 5, total_realtime_requests: 1 },
          { timestamp: new Date(t - 30 * 3600_000).toISOString(), total_rest_requests: 50, total_auth_requests: 0, total_storage_requests: 0, total_realtime_requests: 0 },
          { timestamp: (t - 60 * 3600_000) * 1000, total_rest_requests: 999 },
        ],
      },
      t,
    );
    expect(c.requests).toBe(116);
    expect(c.prevRequests).toBe(50);
    expect(c.byService.rest).toBe(100);
    const list = [
      { ref: "aaaaaaaaaaaaaaaaaaaa", name: "paused-app", region: "us-east-1", status: "INACTIVE" },
      { ref: "bbbbbbbbbbbbbbbbbbbb", name: "my-app", region: "eu-central-1", status: "ACTIVE_HEALTHY" },
    ];
    expect(pickProject(list, "").name).toBe("my-app");
    expect(pickProject(list, "AAAAAAAAAAAAAAAAAAAA").name).toBe("paused-app");
    expect(() => pickProject(list, "nope")).toThrow(/No Supabase project/);
    expect(parseDbRows([{ users: 12, new_users: 3, bytes: "1048576" }])).toEqual({ users: 12, newUsers: 3, bytes: 1048576 });
    expect(parseDbRows({ result: [] })).toBeUndefined();
  });
});
