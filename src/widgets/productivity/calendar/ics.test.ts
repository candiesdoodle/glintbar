import { describe, expect, it } from "vitest";
import { expandRule, parseDuration, parseIcs, parseRule, resolveZone, wallToInstant } from "./ics";

const wrap = (body: string) => ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Work", body.trim(), "END:VCALENDAR"].join("\r\n");
const Y2026 = Date.UTC(2026, 0, 1);
const Y2028 = Date.UTC(2028, 0, 1);

describe("ics", () => {
  it("reads a simple UTC event, unfolding and escapes", () => {
    const cal = parseIcs(
      wrap(`BEGIN:VEVENT
UID:a1
DTSTART:20261116T090000Z
DTEND:20261116T093000Z
SUMMARY:Stand-up\\, daily
DESCRIPTION:Join: https://meet.google.com/abc-defg-hij
 \\nsecond line
END:VEVENT`),
      Y2026,
      Y2028,
    );
    expect(cal.name).toBe("Work");
    expect(cal.events).toHaveLength(1);
    const e = cal.events[0];
    expect(e.title).toBe("Stand-up, daily");
    expect(e.start).toBe(Date.UTC(2026, 10, 16, 9));
    expect(e.end - e.start).toBe(30 * 60_000);
    expect(e.meeting).toBe(true);
    expect(e.url).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("handles TZID across a DST change", () => {
    const cal = parseIcs(
      wrap(`BEGIN:VEVENT
UID:w1
DTSTART;TZID=Europe/Berlin:20261020T090000
DURATION:PT1H
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:Weekly
END:VEVENT`),
      Y2026,
      Y2028,
    );
    expect(cal.events.map((e) => new Date(e.start).toISOString())).toEqual([
      "2026-10-20T07:00:00.000Z", // CEST (UTC+2)
      "2026-10-27T08:00:00.000Z", // CET after 25 Oct
      "2026-11-03T08:00:00.000Z",
    ]);
  });

  it("maps Windows zone names", () => {
    expect(resolveZone("Pacific Standard Time")).toBe("America/Los_Angeles");
    expect(resolveZone("/mozilla.org/20050126_1/Europe/London")).toBe("Europe/London");
    expect(resolveZone("Nowhere/Land")).toBeNull();
    expect(wallToInstant(Date.UTC(2026, 6, 1, 12), "America/New_York")).toBe(Date.UTC(2026, 6, 1, 16));
  });

  it("all-day events, EXDATE and UNTIL", () => {
    const cal = parseIcs(
      wrap(`BEGIN:VEVENT
UID:d1
DTSTART;VALUE=DATE:20261102
DTEND;VALUE=DATE:20261103
RRULE:FREQ=DAILY;UNTIL=20261106
EXDATE;VALUE=DATE:20261104
SUMMARY:Off-site
END:VEVENT`),
      Y2026,
      Y2028,
    );
    expect(cal.events.map((e) => new Date(e.start).getDate())).toEqual([2, 3, 5, 6]);
    expect(cal.events.every((e) => e.allDay)).toBe(true);
    const e = cal.events[0];
    expect(new Date(e.end).getDate()).toBe(3);
  });

  it("EXDATE with TZID removes one timed instance; RECURRENCE-ID moves another", () => {
    const cal = parseIcs(
      wrap(`BEGIN:VEVENT
UID:r1
DTSTART;TZID=America/New_York:20261102T100000
DTEND;TZID=America/New_York:20261102T110000
RRULE:FREQ=DAILY;COUNT=4
EXDATE;TZID=America/New_York:20261103T100000
SUMMARY:Sync
END:VEVENT
BEGIN:VEVENT
UID:r1
RECURRENCE-ID;TZID=America/New_York:20261104T100000
DTSTART;TZID=America/New_York:20261104T150000
DTEND;TZID=America/New_York:20261104T160000
SUMMARY:Sync (moved)
END:VEVENT`),
      Y2026,
      Y2028,
    );
    expect(cal.events.map((e) => [e.title, new Date(e.start).toISOString()])).toEqual([
      ["Sync", "2026-11-02T15:00:00.000Z"],
      ["Sync (moved)", "2026-11-04T20:00:00.000Z"],
      ["Sync", "2026-11-05T15:00:00.000Z"],
    ]);
  });

  it("skips cancelled events and rejects non-calendars", () => {
    const cal = parseIcs(wrap("BEGIN:VEVENT\nUID:x\nDTSTART:20261116T090000Z\nSTATUS:CANCELLED\nEND:VEVENT"), Y2026, Y2028);
    expect(cal.events).toHaveLength(0);
    expect(() => parseIcs("<html>sign in</html>", Y2026, Y2028)).toThrow();
  });

  it("monthly BYDAY ordinals, BYMONTHDAY negatives, yearly and BYSETPOS", () => {
    const start = Date.UTC(2026, 0, 1, 9);
    const fmt = (ts: number[]) => ts.map((t) => new Date(t).toISOString().slice(0, 10));
    expect(fmt(expandRule(parseRule("FREQ=MONTHLY;BYDAY=2TU;COUNT=3")!, start, 0, Y2028))).toEqual(["2026-01-13", "2026-02-10", "2026-03-10"]);
    expect(fmt(expandRule(parseRule("FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3")!, start, 0, Y2028))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(fmt(expandRule(parseRule("FREQ=YEARLY;BYMONTH=11;BYDAY=4TH;COUNT=2")!, start, 0, Y2028 + 400 * 86400000))).toEqual(["2026-11-26", "2027-11-25"]);
    expect(fmt(expandRule(parseRule("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=2")!, start, 0, Y2028))).toEqual(["2026-01-30", "2026-02-27"]);
    expect(fmt(expandRule(parseRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=4")!, start, 0, Y2028))).toEqual(["2026-01-02", "2026-01-12", "2026-01-16", "2026-01-26"]);
    // Jan 31 monthly: months without a 31st are skipped.
    expect(fmt(expandRule(parseRule("FREQ=MONTHLY;COUNT=3")!, Date.UTC(2026, 0, 31), 0, Y2028))).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("parses durations", () => {
    expect(parseDuration("PT1H30M")).toBe(90 * 60_000);
    expect(parseDuration("P1W")).toBe(7 * 86_400_000);
    expect(parseDuration("-PT15M")).toBe(-15 * 60_000);
  });
});
