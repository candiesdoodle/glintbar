/** Claude Usage and Claude Plan Usage: tiles and their shared card. */
import { shortNumber } from "../../../core/format";
import { useNow } from "../../../core/useVisible";
import type { CardProps, TileProps } from "../../../core/widget";
import { Section, Spinner } from "../../../ui";
import { AiCardFrame, LimitBlock, LimitsSkeleton, PlanBlock, PlanRow, StatusNote } from "./card";
import { makeLocalConnect } from "./connect";
import { useAutoConnect, useClaudeLocal, useLimitTool, type View } from "./data";
import { modelName, pct, startOfDay, sumSince } from "./format";
import { pointsFromSeries } from "./projection";
import { RingBody, tileTitle } from "./limitWidget";
import { AiTileFrame, Glyph, LimitRows, TileMessage, tileProblem } from "./ui";
import type { AiLimit, ClaudeLocal } from "./types";

const MIN = 60_000;
const FIVE_H = 5 * 60 * MIN;

export const CLAUDE_STEPS = [
  "Get Claude Code by running irm https://claude.ai/install.ps1 | iex in PowerShell.",
  "Start claude from a terminal and log in. Your Claude subscription must be Pro or Max.",
  "Back here, use Check again. Real numbers replace the sample once GlintBar finds the login.",
];

export const claudeConnect = (widgetId: string) => makeLocalConnect(widgetId, "claude", CLAUDE_STEPS, "Anthropic");

/** Tokens used since the session window started (or in the last 5 hours). */
function sessionTokens(local: ClaudeLocal | undefined, session: AiLimit | undefined, now: number): number {
  if (!local) return 0;
  const start = session?.resetsAt && session.windowMs ? session.resetsAt - session.windowMs : now - FIVE_H;
  return sumSince(local.series, start);
}

function useClaude(isSample: boolean, instanceId: string, widgetId: string) {
  useAutoConnect(widgetId, "claude", isSample, instanceId);
  const view = useLimitTool("claude", isSample);
  const local = useClaudeLocal(isSample);
  const now = useNow("minute").getTime();
  const r = view.data;
  const problem = tileProblem(r, r ? undefined : view.error);
  const tokens5h = sessionTokens(local.data, r?.limits.find((l) => l.window === "session"), now);
  // Not signed in, but Claude Code has been used here: count tokens from its own history.
  const tokensOnly = Boolean(problem && r?.status !== "expired" && tokens5h > 0);
  return { view, local, now, r, problem, tokens5h, tokensOnly };
}

function TokensBody({ size, tokens }: { size: number; tokens: number }) {
  return (
    <>
      <Glyph tool="claude" size={Math.round(size * 0.42)} className="text-dim" />
      <div className="min-w-0 leading-none">
        <div className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.34) }}>
          {shortNumber(tokens)}
        </div>
        <div className="mt-[3px] truncate text-dim" style={{ fontSize: Math.max(8.5, Math.round(size * 0.2)) }}>
          tokens · 5h
        </div>
      </div>
    </>
  );
}

export function ClaudeUsageTile({ size, isSample, instanceId }: TileProps) {
  const c = useClaude(isSample, instanceId, "ai.claude");
  const session = c.r?.limits.find((l) => l.window === "session") ?? c.r?.limits[0];
  let body;
  if (c.tokensOnly) body = <TokensBody size={size} tokens={c.tokens5h} />;
  else if (!c.r && c.view.loading) body = <TileMessage tool="claude" size={size} text="Checking…" />;
  else if (c.problem) body = <TileMessage tool="claude" size={size} text={c.problem.short} tone={c.problem.tone} sub={c.r?.status === "expired" ? "Reconnect" : "Claude"} />;
  else if (session) body = <RingBody tool="claude" limit={session} size={size} now={c.now} compact={isSample} />;
  else body = <TileMessage tool="claude" size={size} text="Claude" sub="–" />;
  const title = c.problem ? `Claude: ${c.r?.message ?? c.problem.text}` : tileTitle("Claude", session ? [session] : [], c.now);
  return (
    <AiTileFrame sample={isSample} stale={Boolean(c.view.error && c.r)} title={title}>
      {body}
    </AiTileFrame>
  );
}

export function ClaudePlanTile({ size, isSample, instanceId }: TileProps) {
  const c = useClaude(isSample, instanceId, "ai.claude-plan");
  const limits = (c.r?.limits ?? []).filter((l) => l.window === "session" || l.window === "weekly");
  const top = c.local.data?.models[0]?.model;
  const font = Math.max(8.5, Math.round(size * 0.21));
  const model = top ? (
    <div className="min-w-0 shrink-0 border-l border-line pl-[calc(var(--tile-h)*0.16)] leading-none" style={{ maxWidth: size * 1.75 }}>
      <div className="truncate font-semibold" style={{ fontSize: Math.max(9, Math.round(size * 0.22)) }}>
        {modelName(top)}
      </div>
      <div className="mt-[3px] truncate text-faint" style={{ fontSize: font }}>
        top model
      </div>
    </div>
  ) : null;
  let body;
  if (c.tokensOnly)
    body = (
      <>
        <TokensBody size={size} tokens={c.tokens5h} />
        {model}
      </>
    );
  else if (!c.r && c.view.loading) body = <TileMessage tool="claude" size={size} text="Checking…" />;
  else if (c.problem) body = <TileMessage tool="claude" size={size} text={c.problem.text} tone={c.problem.tone} sub={c.r?.status === "expired" ? "Reopen Claude Code to renew" : "Claude"} />;
  else
    body = (
      <>
        {size >= 40 && <Glyph tool="claude" size={Math.round(size * 0.36)} className="text-dim" />}
        <LimitRows limits={limits} size={size} now={c.now} scale={0.2} />
        {model}
      </>
    );
  const title = c.problem ? `Claude: ${c.r?.message ?? c.problem.text}` : `${tileTitle("Claude", limits, c.now)}${top ? ` · Top model ${modelName(top)}` : ""}`;
  return (
    <AiTileFrame sample={isSample} stale={Boolean(c.view.error && c.r)} title={title}>
      {body}
    </AiTileFrame>
  );
}

function ClaudeTokens({ local, session, now }: { local: View<ClaudeLocal>; session: AiLimit | undefined; now: number }) {
  const d = local.data;
  if (!d) return local.loading ? <Spinner /> : null;
  if (!d.found) return null;
  const today = sumSince(d.series, startOfDay(now));
  const inSession = sessionTokens(d, session, now);
  const total = d.models.reduce((s, m) => s + m.tokens, 0) || 1;
  return (
    <Section title="Claude Code tokens">
      <div className="divide-y divide-card-line">
        <PlanRow label={session?.resetsAt ? "This session" : "Last 5 hours"}>{shortNumber(inSession)}</PlanRow>
        <PlanRow label="Today">{shortNumber(today)}</PlanRow>
        <PlanRow label="Last 7 days">{shortNumber(d.week.total)}</PlanRow>
        {d.models.slice(0, 3).map((m, i) => (
          <PlanRow key={m.model} label={i === 0 ? "Most-used model" : ""}>
            <span className={i === 0 ? "font-medium" : "text-dim"}>{modelName(m.model)}</span>
            <span className="ml-2 text-faint">{pct((m.tokens / total) * 100)}</span>
          </PlanRow>
        ))}
      </div>
      <div className="pb-2 text-[11px] leading-snug text-faint">
        {d.pending ? "Reading older history… " : ""}
        Counts input, output and cache-write tokens once per reply. Cache reads are excluded ({shortNumber(d.week.cacheRead)} this week).
      </div>
    </Section>
  );
}

export function ClaudeCard({ isSample }: CardProps) {
  const view = useLimitTool("claude", isSample);
  const local = useClaudeLocal(isSample);
  const now = useNow("minute").getTime();
  const r = view.data;
  const series = local.data?.series ?? [];
  const session = r?.limits.find((l) => l.window === "session");
  return (
    <AiCardFrame tool="claude" view={view} sample={isSample}>
      {!isSample && <StatusNote tool="claude" view={view} onCheck={view.refresh} />}
      {!r && view.loading && <LimitsSkeleton />}
      {r && r.limits.length > 0 && (
        <Section>
          <div className="divide-y divide-card-line">
            {r.limits.map((l) => {
              const points = l.resetsAt && l.windowMs ? pointsFromSeries(series, l.resetsAt - l.windowMs, now, l.usedPct, 5 * MIN) : [];
              return <LimitBlock key={l.window} limit={l} now={now} points={points} chart={l.window !== "extra"} />;
            })}
          </div>
        </Section>
      )}
      <ClaudeTokens local={local} session={session} now={now} />
      {r && <PlanBlock reading={r} />}
    </AiCardFrame>
  );
}
