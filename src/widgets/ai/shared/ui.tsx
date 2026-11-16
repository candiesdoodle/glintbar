/** Tile building blocks shared by the AI widgets. Theme colours only. */
import type { ReactNode } from "react";
import { BackendError } from "../../../core/backend";
import { HttpError } from "../../../core/http";
import { ProgressBar, TileFrame, TileSampleBadge, cx } from "../../../ui";
import { pct, resetShort, usageColor } from "./format";
import { TOOLS } from "./tools";
import type { AiLimit, ToolId, ToolReading } from "./types";

export function Glyph({ tool, size, className }: { tool: ToolId; size: number; className?: string }) {
  const meta = TOOLS[tool];
  if (meta.glyph) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={cx("shrink-0", className)} aria-hidden>
        <path d={meta.glyph.path} fill="currentColor" />
      </svg>
    );
  }
  const Icon = meta.icon;
  return <Icon size={size} className={cx("shrink-0", className)} strokeWidth={2} />;
}

/**
 * Tile surface. Sample numbers get the shared sample marker (TileSampleBadge, a corner dot on
 * dock-sized tiles); a kept older reading gets a small hollow dot.
 */
export function AiTileFrame({ children, title, sample, stale, className }: { children: ReactNode; title?: string; sample?: boolean; stale?: boolean; className?: string }) {
  return (
    <TileFrame
      className={cx("gap-[calc(var(--tile-h)*0.16)]", className)}
      title={sample ? `${title ?? ""} (sample numbers)`.trim() : title}
    >
      {children}
      {sample && <TileSampleBadge />}
      {!sample && stale && <span className="absolute top-[3px] right-[3px] h-[6px] w-[6px] rounded-full border border-warn" title="Refresh failed; older numbers shown" aria-label="Refresh failed; older numbers shown" />}
    </TileFrame>
  );
}

/** Columns of value-over-label (e.g. session / week / top model). The last column truncates. */
export function StatColumns({ items, size }: { items: Array<{ value: string; label: string }>; size: number }) {
  const big = Math.max(9.5, Math.round(size * 0.27));
  const small = Math.max(8, Math.round(size * 0.19));
  return (
    <div className="flex min-w-0 flex-1 items-center leading-none" style={{ gap: Math.round(size * 0.14) }}>
      {items.map((it, i) => (
        <div key={it.label} className={cx("min-w-0", i === items.length - 1 ? "flex-1" : "shrink-0")}>
          <div className="truncate font-semibold tabular-nums" style={{ fontSize: i === items.length - 1 && items.length > 2 ? Math.round(big * 0.88) : big }}>
            {it.value}
          </div>
          <div className="mt-[3px] truncate text-faint" style={{ fontSize: small }}>
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The label a tile row uses (cards use the full label). */
export function tileLabel(l: AiLimit): string {
  switch (l.window) {
    case "session":
      return "5h";
    case "weekly":
      return "Week";
    case "daily_flash":
      return "Flash";
    case "weekly_opus":
      return "Opus";
    case "weekly_sonnet":
      return "Son.";
    case "monthly_mcp":
      return "MCP";
    case "extra":
      return "Extra";
    default:
      return l.label;
  }
}

/** Up to three compact rows (label, bar, percentage, time to reset), aligned as a grid. */
export function LimitRows({ limits, size, now, showReset = true, scale = 0.22 }: { limits: AiLimit[]; size: number; now: number; showReset?: boolean; scale?: number }) {
  const font = Math.max(8.5, Math.round(size * scale));
  const bar = Math.max(3, Math.round(size * 0.09));
  return (
    <div
      className="grid min-w-0 flex-1 items-center leading-none"
      style={{
        gridTemplateColumns: showReset ? "auto minmax(8px, 1fr) auto auto" : "auto minmax(8px, 1fr) auto",
        columnGap: Math.max(3, Math.round(size * 0.08)),
        rowGap: Math.round(size * 0.13),
        fontSize: font,
      }}
    >
      {limits.map((l) => (
        <div key={l.window} className="contents">
          <span className="whitespace-nowrap text-dim">{tileLabel(l)}</span>
          <ProgressBar value={l.usedPct} color={usageColor(l.usedPct)} height={bar} />
          <span className="text-right font-semibold whitespace-nowrap tabular-nums">{pct(l.usedPct)}</span>
          {showReset && <span className="text-right whitespace-nowrap text-faint tabular-nums">{resetShort(l.resetsAt, now) || "–"}</span>}
        </div>
      ))}
    </div>
  );
}

/** Short words for a tile when there is nothing (current) to show. */
export interface TileProblem {
  text: string;
  /** For narrow spots (m tiles, AI Limits halves). */
  short: string;
  tone: "warn" | "dim";
}

export function tileProblem(r: ToolReading | undefined, error: unknown): TileProblem | null {
  if (r) {
    switch (r.status) {
      case "expired":
        return { text: "Sign-in expired", short: "Expired", tone: "warn" };
      case "signed_out":
        return { text: "Not signed in", short: "Sign in", tone: "warn" };
      case "not_installed":
        return { text: "Not set up", short: "Set up", tone: "dim" };
      case "unavailable":
        return { text: "Not available yet", short: "N/A yet", tone: "dim" };
      default:
        if (r.status === "ok" && r.limits.length === 0) return { text: "No limits yet", short: "No data", tone: "dim" };
        return null;
    }
  }
  if (error) return isOffline(error) ? { text: "Offline", short: "Offline", tone: "warn" } : { text: "Can't read it", short: "Error", tone: "warn" };
  return null;
}

export function isOffline(e: unknown): boolean {
  if (e instanceof BackendError) return e.code === "offline" || e.code === "timeout";
  if (e instanceof HttpError) return e.kind === "offline" || e.kind === "timeout";
  return false;
}

/** A glyph next to one or two lines of plain words (status or loading). */
export function TileMessage({ tool, size, text, sub, tone = "dim" }: { tool: ToolId; size: number; text: string; sub?: string; tone?: "warn" | "dim" }) {
  return (
    <>
      <Glyph tool={tool} size={Math.round(size * 0.42)} className="text-dim" />
      <div className="min-w-0 leading-tight">
        <div className={cx("truncate font-medium", tone === "warn" ? "text-warn" : "text-dim")} style={{ fontSize: Math.max(9, Math.round(size * 0.24)) }}>
          {text}
        </div>
        {sub && (
          <div className="truncate text-faint" style={{ fontSize: Math.max(8, Math.round(size * 0.2)) }}>
            {sub}
          </div>
        )}
      </div>
    </>
  );
}

/** The limit closest to running out (what a one-number tile shows). */
export function tightest(limits: AiLimit[]): AiLimit | undefined {
  return [...limits].filter((l) => l.window !== "extra").sort((a, b) => b.usedPct - a.usedPct)[0];
}
