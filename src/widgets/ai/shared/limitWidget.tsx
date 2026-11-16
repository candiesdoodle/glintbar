/**
 * Tile and card factories for the limit-window tools (ChatGPT, Gemini, GLM, Grok, Cursor; Claude
 * builds on the same pieces). One reading, two or three windows, reset times always shown.
 */
import type { ComponentType, ReactNode } from "react";
import { useNow } from "../../../core/useVisible";
import type { CardProps, TileProps } from "../../../core/widget";
import { Ring, Section } from "../../../ui";
import { pct, resetIn, resetShort, usageColor } from "./format";
import { AiCardFrame, LimitBlock, LimitsSkeleton, PlanBlock, StatusNote } from "./card";
import { useAutoConnect, useLimitTool } from "./data";
import { sampleReading } from "./samples";
import { TOOLS } from "./tools";
import { AiTileFrame, Glyph, LimitRows, TileMessage, tightest, tileProblem } from "./ui";
import type { AiLimit, LimitTool, ToolReading } from "./types";

export interface LimitWidgetOptions {
  tool: LimitTool;
  widgetId: string;
  /** Which windows the tile shows (default: the first two). */
  pick?: (limits: AiLimit[]) => AiLimit[];
  /** "rows" (default) or a single ring for the tightest window. */
  layout?: "rows" | "ring";
  /** The vendor has no way to read usage: numbers are always a labelled sample. */
  previewOnly?: boolean;
  /** Probe for the tool's local sign-in while the tile is a sample. */
  autoConnect?: boolean;
}

export function tileTitle(name: string, limits: AiLimit[], now: number): string {
  return [name, ...limits.map((l) => `${l.label} ${pct(l.usedPct)}${l.resetsAt ? `, resets in ${resetIn(l.resetsAt, now)}` : ""}`)].join(" · ");
}

export function RingBody({ tool, limit, size, now, compact }: { tool: LimitTool; limit: AiLimit; size: number; now: number; compact?: boolean }) {
  const ring = Math.round(size * (compact ? (size < 40 ? 0.56 : 0.62) : 0.74));
  return (
    <>
      <Ring value={limit.usedPct} size={ring} color={usageColor(limit.usedPct)}>
        <Glyph tool={tool} size={Math.round(ring * 0.42)} className="text-dim" />
      </Ring>
      <div className="min-w-0 leading-none">
        <div className="font-semibold tabular-nums" style={{ fontSize: Math.round(size * 0.36) }}>
          {pct(limit.usedPct)}
        </div>
        <div className="mt-[3px] truncate text-dim tabular-nums" style={{ fontSize: Math.max(8.5, Math.round(size * 0.21)) }}>
          {limit.resetsAt ? `${size >= 40 ? "↻ " : ""}${resetShort(limit.resetsAt, now)}` : limit.label}
        </div>
      </div>
    </>
  );
}

export function makeLimitTile(o: LimitWidgetOptions): ComponentType<TileProps> {
  const pick = o.pick ?? ((l: AiLimit[]) => l.slice(0, 2));
  const name = TOOLS[o.tool].name;
  return function LimitTile({ size, isSample, instanceId }: TileProps) {
    useAutoConnect(o.widgetId, o.tool, Boolean(o.autoConnect) && isSample, instanceId);
    const view = useLimitTool(o.tool, isSample);
    const now = useNow("minute").getTime();
    const real = view.data;
    const numbers: ToolReading | undefined = o.previewOnly ? sampleReading(o.tool, now) : real;
    const limits = pick(numbers?.limits ?? []);
    const problem = o.previewOnly ? null : tileProblem(real, real ? undefined : view.error);
    const sample = isSample || Boolean(o.previewOnly);
    let body: ReactNode;
    if (!numbers && view.loading) body = <TileMessage tool={o.tool} size={size} text="Checking…" />;
    else if (problem) body = <TileMessage tool={o.tool} size={size} text={o.layout === "ring" ? problem.short : problem.text} tone={problem.tone} sub={name} />;
    else if (!limits.length) body = <TileMessage tool={o.tool} size={size} text={name} sub="–" />;
    else if (o.layout === "ring") body = <RingBody tool={o.tool} limit={tightest(limits)!} size={size} now={now} compact={sample} />;
    else
      body = (
        <>
          {size >= 40 && <Glyph tool={o.tool} size={Math.round(size * 0.36)} className="text-dim" />}
          <LimitRows limits={limits} size={size} now={now} />
        </>
      );
    return (
      <AiTileFrame sample={sample} stale={Boolean(view.error && real)} title={problem ? `${name}: ${real?.message ?? problem.text}` : tileTitle(name, limits, now)}>
        {body}
      </AiTileFrame>
    );
  };
}

export function makeLimitCard(o: LimitWidgetOptions & { extra?: ComponentType<{ reading: ToolReading | undefined; sample: boolean }> }): ComponentType<CardProps> {
  const Extra = o.extra;
  return function LimitCard({ isSample }: CardProps) {
    const view = useLimitTool(o.tool, isSample);
    const now = useNow("minute").getTime();
    const real = view.data;
    const numbers = o.previewOnly ? sampleReading(o.tool, now) : real;
    const sample = isSample || Boolean(o.previewOnly);
    return (
      <AiCardFrame tool={o.tool} view={view} sample={sample}>
        {!isSample && <StatusNote tool={o.tool} view={view} onCheck={view.refresh} />}
        {!numbers && view.loading && <LimitsSkeleton />}
        {numbers && numbers.limits.length > 0 && (
          <Section title={o.previewOnly ? "Sample figures - not yours yet" : undefined}>
            <div className="divide-y divide-card-line">
              {numbers.limits.map((l) => (
                <LimitBlock key={l.window} limit={l} now={now} chart={!o.previewOnly || l === numbers.limits[0]} />
              ))}
            </div>
          </Section>
        )}
        {real && <PlanBlock reading={real} />}
        {Extra && <Extra reading={real} sample={isSample} />}
      </AiCardFrame>
    );
  };
}
