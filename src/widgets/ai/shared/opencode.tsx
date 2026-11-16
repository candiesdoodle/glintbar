/** OpenCode Usage and OpenCode Plan Usage: tiles and their shared card (local history, offline). */
import { duration, shortNumber } from "../../../core/format";
import { useNow } from "../../../core/useVisible";
import type { CardProps, TileProps } from "../../../core/widget";
import { AreaChart, ProgressBar, Section, Stat } from "../../../ui";
import { AiCardFrame, LimitsSkeleton, PlanRow, StatusNote } from "./card";
import { makeLocalConnect } from "./connect";
import { useAutoConnect, useOpenCode } from "./data";
import { cash, modelName, pct, startOfDay, sumSince } from "./format";
import { AiTileFrame, Glyph, StatColumns, TileMessage, tileProblem, type TileProblem } from "./ui";
import type { OpenCodeUsage } from "./types";

export const openCodeConnect = (widgetId: string) =>
  makeLocalConnect(
    widgetId,
    "opencode",
    ["Set up OpenCode and launch it once with the opencode command.", "Use Check again. GlintBar looks at the data OpenCode stores on this PC and sends nothing online."],
    "nobody - it stays on this PC",
  );

function problemOf(d: OpenCodeUsage | undefined, error: unknown): TileProblem | null {
  if (d?.status === "not_installed") return { text: "Not set up", short: "Not set up", tone: "dim" };
  if (d?.status === "unavailable") return { text: "Can't read it", short: "Error", tone: "warn" };
  if (d && !d.session) return { text: "No sessions", short: "No sessions", tone: "dim" };
  return tileProblem(undefined, d ? undefined : error);
}

function useOc(isSample: boolean, instanceId: string, widgetId: string) {
  useAutoConnect(widgetId, "opencode", isSample, instanceId);
  const view = useOpenCode(isSample);
  return { view, d: view.data, problem: problemOf(view.data, view.error) };
}

export function OpenCodeTile({ size, isSample, instanceId }: TileProps) {
  const { view, d, problem } = useOc(isSample, instanceId, "ai.opencode");
  const s = d?.session;
  let body;
  if (!d && view.loading) body = <TileMessage tool="opencode" size={size} text="Checking…" />;
  else if (problem || !s) body = <TileMessage tool="opencode" size={size} text={problem?.short ?? "OpenCode"} tone={problem?.tone} sub="OpenCode" />;
  else
    body = (
      <>
        <Glyph tool="opencode" size={Math.round(size * 0.42)} className="text-dim" />
        <div className="min-w-0 leading-none">
          <div className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.34) }}>
            {shortNumber(s.usage.total)}
          </div>
          <div className="mt-[3px] truncate text-dim tabular-nums" style={{ fontSize: Math.max(8.5, Math.round(size * 0.2)) }}>
            session
          </div>
        </div>
      </>
    );
  const title = s ? `OpenCode session: ${shortNumber(s.usage.total)} tokens${s.title ? ` - ${s.title}` : ""}` : "OpenCode";
  return (
    <AiTileFrame sample={isSample} stale={Boolean(view.error && d)} title={title}>
      {body}
    </AiTileFrame>
  );
}

export function OpenCodePlanTile({ size, isSample, instanceId }: TileProps) {
  const { view, d, problem } = useOc(isSample, instanceId, "ai.opencode-plan");
  const top = d?.models[0]?.model;
  let body;
  if (!d && view.loading) body = <TileMessage tool="opencode" size={size} text="Checking…" />;
  else if (problem && problem.text !== "No sessions") body = <TileMessage tool="opencode" size={size} text={problem.text} tone={problem.tone} sub="OpenCode" />;
  else
    body = (
      <>
        {size >= 50 && <Glyph tool="opencode" size={Math.round(size * 0.36)} className="text-dim" />}
        <StatColumns
          size={size}
          items={[
            { value: shortNumber(d?.session?.usage.total ?? 0), label: "session" },
            { value: shortNumber(d?.week.total ?? 0), label: "week" },
            { value: top ? modelName(top) : "–", label: "top model" },
          ]}
        />
      </>
    );
  const title = d ? `OpenCode: session ${shortNumber(d.session?.usage.total ?? 0)} · week ${shortNumber(d.week.total)} tokens${top ? ` · top model ${top}` : ""}` : "OpenCode";
  return (
    <AiTileFrame sample={isSample} stale={Boolean(view.error && d)} title={title}>
      {body}
    </AiTileFrame>
  );
}

export function OpenCodeCard({ isSample }: CardProps) {
  const view = useOpenCode(isSample);
  const now = useNow("minute").getTime();
  const d = view.data;
  const s = d?.session;
  const week = d?.week;
  const series = d?.series ?? [];
  // Hourly series -> a value per hour for the last 7 days (zeros included), for the chart.
  const end = Math.floor(now / 3_600_000) * 3_600_000;
  const hours: number[] = [];
  const byHour = new Map(series);
  for (let t = end - 7 * 86_400_000 + 3_600_000; t <= end; t += 3_600_000) hours.push(byHour.get(t) ?? 0);
  const total = (d?.models ?? []).reduce((a, m) => a + m.total, 0) || 1;
  return (
    <AiCardFrame tool="opencode" view={view} sample={isSample}>
      {!isSample && <StatusNote tool="opencode" view={view} onCheck={view.refresh} />}
      {!d && view.loading && <LimitsSkeleton />}
      {s && (
        <Section title="This session">
          <div className="py-3">
            <div className="truncate text-[12.5px] text-dim">{s.title || "Untitled session"}</div>
            <div className="mt-1 flex items-end justify-between">
              <div className="text-[26px] leading-none font-semibold tabular-nums">{shortNumber(s.usage.total)}</div>
              <div className="text-[11px] text-faint">tokens · {s.usage.messages} replies</div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Stat label="Cost" value={cash(s.usage.cost)} />
              <Stat label="Model" value={modelName(s.model)} />
              <Stat label="Running" value={duration(Math.max(60, (s.updated - s.started) / 1000))} />
            </div>
          </div>
        </Section>
      )}
      {week && (
        <Section title="Last 7 days">
          <div className="py-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Tokens" value={shortNumber(week.total)} />
              <Stat label="Today" value={shortNumber(sumSince(series, startOfDay(now)))} />
              <Stat label="Cost" value={cash(week.cost)} />
            </div>
            {week.total > 0 && <AreaChart className="mt-3" data={hours} min={0} height={56} />}
            <div className="mt-1 flex justify-between text-[10.5px] text-faint">
              <span>7 days ago</span>
              <span>now</span>
            </div>
          </div>
        </Section>
      )}
      {d && d.models.length > 0 && (
        <Section title="Models this week">
          <div className="space-y-2 py-3">
            {d.models.slice(0, 5).map((m) => (
              <div key={m.model}>
                <div className="flex justify-between text-[12px]">
                  <span className="truncate text-fg">{modelName(m.model)}</span>
                  <span className="text-dim tabular-nums">
                    {shortNumber(m.total)} · {pct((m.total / total) * 100)}
                  </span>
                </div>
                <ProgressBar className="mt-1" value={m.total} max={total} height={4} />
              </div>
            ))}
          </div>
        </Section>
      )}
      {week && (
        <Section>
          <div className="divide-y divide-card-line">
            <PlanRow label="Cache reads">{shortNumber(week.tokens.cacheRead)}</PlanRow>
            <PlanRow label="Cache writes">{shortNumber(week.tokens.cacheWrite)}</PlanRow>
          </div>
        </Section>
      )}
    </AiCardFrame>
  );
}
