import { describe, expect, it } from "vitest";
import { htmlUrl, mapCalendar, mapNotifications, mapOverview, reviewRequests, streaks, type ContribDay, type GhNotification } from "./shared/github";
import { toWeeks } from "./shared/ContributionGrid";
import { currentStreak, mapLeet, parseCalendar } from "./leetcode/api";
import { mapMessage, senderName } from "./gmail/api";
import { mapPhotos, wallpaperUrl } from "./wallpaper/api";

describe("GitHub", () => {
  it("maps the contribution calendar and streaks", () => {
    const res = {
      viewer: {
        login: "octo",
        contributionsCollection: {
          contributionCalendar: {
            totalContributions: 9,
            weeks: [
              {
                contributionDays: [
                  { date: "2026-11-08", contributionCount: 0, contributionLevel: "NONE" },
                  { date: "2026-11-09", contributionCount: 2, contributionLevel: "FIRST_QUARTILE" },
                  { date: "2026-11-10", contributionCount: 3, contributionLevel: "SECOND_QUARTILE" },
                  { date: "2026-11-11", contributionCount: 0, contributionLevel: "NONE" },
                  { date: "2026-11-12", contributionCount: 1, contributionLevel: "FIRST_QUARTILE" },
                  { date: "2026-11-13", contributionCount: 1, contributionLevel: "FIRST_QUARTILE" },
                  { date: "2026-11-14", contributionCount: 1, contributionLevel: "FIRST_QUARTILE" },
                ],
              },
              { contributionDays: [{ date: "2026-11-15", contributionCount: 1, contributionLevel: "FOURTH_QUARTILE" }, { date: "2026-11-16", contributionCount: 0, contributionLevel: "NONE" }] },
            ],
          },
        },
      },
    };
    const c = mapCalendar(res, "2026-11-16");
    expect(c.total).toBe(9);
    expect(c.days).toHaveLength(9);
    expect(c.days[7].level).toBe(4);
    // Today is still empty: the streak from yesterday counts.
    expect(c.current).toBe(4);
    expect(c.longest).toBe(4);
    expect(toWeeks(c.days)).toHaveLength(2);
    const d = (date: string, count: number): ContribDay => ({ date, count, level: count ? 1 : 0 });
    expect(streaks([d("2026-11-14", 1), d("2026-11-15", 0), d("2026-11-16", 0)], "2026-11-16").current).toBe(0);
  });

  it("maps notifications to html links", () => {
    const n = {
      id: "1",
      reason: "review_requested",
      updated_at: "2026-11-16T10:00:00Z",
      subject: { title: "Fix it", type: "PullRequest", url: "https://api.github.com/repos/acme/api/pulls/482" },
      repository: { full_name: "acme/api", html_url: "https://github.com/acme/api" },
    };
    expect(htmlUrl(n)).toBe("https://github.com/acme/api/pull/482");
    const m = mapNotifications([n, { ...n, id: "2", subject: { ...n.subject, url: null } }], false);
    expect(m.count).toBe(2);
    expect(m.items[1].url).toBe("https://github.com/acme/api");
  });

  it("adds up stars and open PRs", () => {
    const o = mapOverview({
      viewer: {
        login: "octo",
        pullRequests: { totalCount: 3, nodes: [{ title: "PR", url: "u", repository: { nameWithOwner: "a/b" } }] },
        repositories: { nodes: [{ name: "x", url: "u", stargazerCount: 10 }, { name: "y", url: "u", stargazerCount: 5 }] },
      },
    });
    expect(o.stars).toBe(15);
    expect(o.openPrs).toBe(3);
    expect(o.prs[0].repo).toBe("a/b");
  });
});

describe("LeetCode", () => {
  const now = new Date(2026, 10, 16, 12);
  const utcDay = (y: number, m: number, d: number) => String(Date.UTC(y, m - 1, d) / 1000);
  it("maps solved counts and computes the current streak", () => {
    const cal = JSON.stringify({ [utcDay(2026, 11, 16)]: 2, [utcDay(2026, 11, 15)]: 1, [utcDay(2026, 11, 13)]: 4 });
    const d = mapLeet(
      {
        data: {
          matchedUser: {
            username: "ada",
            submitStatsGlobal: { acSubmissionNum: [{ difficulty: "All", count: 253 }, { difficulty: "Easy", count: 60 }, { difficulty: "Medium", count: 141 }, { difficulty: "Hard", count: 52 }] },
            userCalendar: { streak: 9, totalActiveDays: 120, submissionCalendar: cal },
          },
          allQuestionsCount: [{ difficulty: "All", count: 3500 }, { difficulty: "Easy", count: 880 }, { difficulty: "Medium", count: 1800 }, { difficulty: "Hard", count: 820 }],
        },
      },
      now,
    );
    expect(d.solved).toBe(253);
    expect(d.hard).toBe(52);
    expect(d.totals.medium).toBe(1800);
    expect(d.streak).toBe(2);
    expect(d.maxStreak).toBe(9);
    expect(parseCalendar("not json", 3, now)).toEqual([
      { date: "2026-11-14", count: 0 },
      { date: "2026-11-15", count: 0 },
      { date: "2026-11-16", count: 0 },
    ]);
    expect(currentStreak([{ count: 1 }, { count: 1 }, { count: 0 }])).toBe(2);
    expect(() => mapLeet({ data: { matchedUser: null } })).toThrow(/No LeetCode user/);
  });
});

describe("Gmail", () => {
  it("maps message metadata", () => {
    expect(senderName('"Ada Lovelace" <ada@example.com>')).toBe("Ada Lovelace");
    expect(senderName("<ada@example.com>")).toBe("ada@example.com");
    const m = mapMessage({
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX", "UNREAD"],
      snippet: "It&#39;s ready",
      internalDate: "1763290000000",
      payload: { headers: [{ name: "From", value: "Ada <ada@example.com>" }, { name: "Subject", value: "Hello" }] },
    });
    expect(m).toMatchObject({ from: "Ada", subject: "Hello", snippet: "It's ready", unread: true, starred: false, at: 1763290000000 });
  });
});

describe("Unsplash", () => {
  it("keeps landscape photos and builds a 4K download URL", () => {
    const base = { color: "#123", alt_description: "lake", urls: { raw: "https://images.unsplash.com/photo-1?ixid=abc", full: "", regular: "", small: "s", thumb: "t" }, links: { html: "https://unsplash.com/photos/1", download_location: "https://api.unsplash.com/photos/1/download" }, user: { name: "Ann", links: { html: "https://unsplash.com/@ann" } } };
    const list = mapPhotos([
      { ...base, id: "1", width: 6000, height: 4000 },
      { ...base, id: "2", width: 3000, height: 4500 },
    ]);
    expect(list.map((p) => p.id)).toEqual(["1"]);
    expect(list[0].page).toContain("utm_source=glintbar");
    expect(wallpaperUrl(list[0])).toBe("https://images.unsplash.com/photo-1?ixid=abc&w=3840&fit=max&fm=jpg&q=85");
  });
});

describe("github review requests", () => {
  it("keeps only pull requests waiting for your review", () => {
    const base: GhNotification = {
      id: "7",
      reason: "review_requested",
      updated_at: "2026-01-01T00:00:00Z",
      subject: { title: "Fix login", type: "PullRequest", url: "https://api.github.com/repos/o/r/pulls/3" },
      repository: { full_name: "o/r", html_url: "https://github.com/o/r" },
    };
    const out = reviewRequests([base, { ...base, id: "8", reason: "mention" }, { ...base, id: "9", subject: { ...base.subject, type: "Issue" } }]);
    expect(out).toEqual([{ id: "gh-7", title: "Fix login (o/r)", url: "https://github.com/o/r/pull/3", from: "GitHub" }]);
  });
});
