/**
 * Screen fit (Settings > Dock > On smaller screens): on a short screen the bar - tiles, padding,
 * gaps, distance from the edge - is drawn smaller. Cards, menus and panels keep their size.
 *
 * Rust decides the factor for each dock window from that window's monitor (shell
 * model::fit_factor) and reports it with `shell.window_info` and `svc://shell/fit`; the page only
 * applies it. It is per window and not saved. The geometry sent to Rust (shell.ts) stays at the
 * set size: Rust multiplies the strip by the same factor, so the page's strip is
 * `stripThickness(dock) * fit` CSS px, which is what the window reserves.
 */
import { useMemo } from "react";
import { create } from "zustand";
import { SIZE_RANGE, stripThickness, useDock, type DockState } from "./layout";

interface FitState {
  /** 1 = the size as set. */
  fit: number;
  /** Height of this window's monitor in logical px (0 = not known yet). */
  screenHeight: number;
  /** Rust's counter for this window's fit; an older report is ignored. */
  seq: number;
}

export const useFit = create<FitState>()(() => ({ fit: 1, screenHeight: 0, seq: -1 }));

let forced: number | null = null;

/** Browser preview (?fit=0.8): this factor, whatever the shell reports. */
export function forceFit(fit: number): void {
  if (!Number.isFinite(fit) || fit <= 0) return;
  forced = Math.max(0.3, Math.min(2, fit));
  useFit.setState({ fit: forced });
}

/** A report from Rust (`window_info` or `svc://shell/fit`). */
export function applyFit(p: { fit?: number; screenHeight?: number; seq?: number }): void {
  const seq = typeof p.seq === "number" ? p.seq : 0;
  const cur = useFit.getState();
  if (seq < cur.seq) return;
  const fit = typeof p.fit === "number" && Number.isFinite(p.fit) && p.fit > 0 ? p.fit : 1;
  const screenHeight = typeof p.screenHeight === "number" && Number.isFinite(p.screenHeight) ? p.screenHeight : cur.screenHeight;
  useFit.setState({ fit: forced ?? fit, screenHeight, seq });
}

/** The bar's measures in CSS px at factor `fit`. */
export interface BarMetrics {
  fit: number;
  /** Tile height. */
  size: number;
  padding: number;
  distance: number;
  /** Gap between tiles. */
  spacing: number;
  /** The strip at the screen edge: always stripThickness(dock) * fit, like Rust's. */
  thickness: number;
}

type Measures = Pick<DockState, "sizePx" | "padding" | "distance" | "spacing">;

/** Pure, exported for tests. */
export function barMetrics(d: Measures, fit: number): BarMetrics {
  const base = stripThickness(d);
  const f = Number.isFinite(fit) && fit > 0 ? fit : 1;
  if (f === 1) return { fit: 1, size: d.sizePx, padding: d.padding, distance: d.distance, spacing: d.spacing, thickness: base };
  const thickness = base * f;
  const padding = d.padding * f;
  const distance = d.distance * f;
  // The tile gets what is left of the strip after padding, distance and the bar's 1 px border
  // (which does not scale), in whole px; the rest (under 1 px) stays empty above the bar.
  const size = Math.max(1, Math.floor(thickness - 2 * padding - distance - 2 + 1e-6));
  return { fit: f, size, padding, distance, spacing: Math.round(d.spacing * f), thickness };
}

/**
 * The smallest factor that keeps the tile at least the Height slider's minimum (sent to Rust
 * as `fitMin`; Rust never goes below it). At most 1: a dock set below the minimum stays as set.
 */
export function fitMinFor(d: Pick<DockState, "sizePx" | "padding" | "distance">): number {
  // Tile + border at factor 1; barMetrics gives the tile room * fit - 2.
  const room = stripThickness(d) - 2 * d.padding - d.distance;
  if (room <= 0) return 0;
  return Math.min(1, Math.ceil(((SIZE_RANGE.min + 2) / room) * 10000) / 10000);
}

export function currentBarMetrics(): BarMetrics {
  return barMetrics(useDock.getState(), useFit.getState().fit);
}

/** The bar's measures for this window, at its screen fit. */
export function useBarMetrics(): BarMetrics {
  const sizePx = useDock((s) => s.sizePx);
  const padding = useDock((s) => s.padding);
  const distance = useDock((s) => s.distance);
  const spacing = useDock((s) => s.spacing);
  const fit = useFit((s) => s.fit);
  return useMemo(() => barMetrics({ sizePx, padding, distance, spacing }, fit), [sizePx, padding, distance, spacing, fit]);
}

/** The strip's height in CSS px as drawn (popovers sit right above it). */
export function useStripThickness(): number {
  const base = useDock(stripThickness);
  const fit = useFit((s) => s.fit);
  return fit === 1 ? base : base * fit;
}
