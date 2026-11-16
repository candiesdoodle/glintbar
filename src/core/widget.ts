/**
 * The widget contract. A widget is a folder `src/widgets/<domain>/<name>/` whose `index.tsx`
 * default-exports `defineWidget({...})`. It is discovered automatically (src/core/registry.ts);
 * its id must be "<domain>.<name>".
 */
import { lazy, type ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

/** Tile width in units of the dock height: s = square, m = 2:1, l = 3:1, xl = 4:1. */
export type WidgetSize = "s" | "m" | "l" | "xl";
export const SIZE_UNITS: Record<WidgetSize, number> = { s: 1, m: 2, l: 3, xl: 4 };

export const CATEGORIES = [
  "AI",
  "Productivity",
  "Finance",
  "System",
  "Media & Audio",
  "Analytics",
  "Developer",
  "Online & Mail",
  "Social",
  "Apps & Files",
  "Weather",
  "Stocks",
  "Clocks",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type WidgetConfig = Record<string, unknown>;

export interface TileProps<C extends WidgetConfig = WidgetConfig> {
  instanceId: string;
  /** `defaultConfig` merged with what the user changed. */
  config: C;
  setConfig: (patch: Partial<C>) => void;
  /** Tile height in CSS px (the dock size). Width = units × size + gaps. */
  size: number;
  /** Opens this tile's card (the dock also opens it on click). */
  openCard: () => void;
  /** Show sample numbers: not connected yet, or rendered as a picker preview. */
  isSample: boolean;
}

export interface CardProps<C extends WidgetConfig = WidgetConfig> {
  instanceId: string;
  config: C;
  setConfig: (patch: Partial<C>) => void;
  close: () => void;
  isSample: boolean;
}

export interface ConnectField {
  /** Secret fields are stored in Credential Manager as "<widgetId>.<key>"; others in the instance config. */
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  optional?: boolean;
}

export interface ConnectSpec {
  fields: ConnectField[];
  guide?: { steps: string[]; url?: string; linkLabel?: string };
  /** Verify the values with one cheap request; throw (e.g. HttpError) with a readable message. */
  test?: (values: Record<string, string>) => Promise<void>;
}

export interface WidgetDef<C extends WidgetConfig = WidgetConfig> {
  /** "<domain>.<folder>", e.g. "system.cpu". */
  id: string;
  name: string;
  category: Category;
  /** One line for the picker. */
  description: string;
  keywords?: string[];
  icon?: LucideIcon;
  size: WidgetSize;
  /**
   * "content": the dock sizes the tile to its content (the Tile sets its own width, e.g. the Apps
   * tile grows with every app). `size` is then only the picker preview's width.
   */
  fit?: "content";
  /** The dock shows the widget's name above the tile on hover (Settings > Names on hover). Set
   *  false when the tile shows names of its own. Default true. */
  hoverName?: boolean;
  Tile: ComponentType<TileProps<C>>;
  Card?: ComponentType<CardProps<C>>;
  /** Card width in px (default 320) and an optional max height. */
  cardSize?: { width: number; height?: number };
  /** Custom connect flow (OAuth, sign-in detection). Call `setConnected(id, true)` when done. */
  Connect?: ComponentType<CardProps<C>>;
  /** Declarative connect form (keys pasted by the user). */
  connect?: ConnectSpec;
  /**
   * Right-click on a connected tile offers this as "Disconnect" (or `disconnectLabel`). Widgets
   * with a declarative `connect` get one that forgets their keys; give one with a custom `Connect`.
   * While not connected the menu offers "Connect…" (opens the card's connect screen).
   */
  disconnect?: () => void | Promise<void>;
  disconnectLabel?: string;
  defaultConfig?: C;
  /** Picker preview; default renders `Tile` with `isSample`. */
  preview?: ComponentType<{ size: number }>;
  /** Allow several instances on the dock (default true). */
  multiple?: boolean;
}

/** Identity helper that gives `config` its type inside Tile/Card. */
export function defineWidget<C extends WidgetConfig = WidgetConfig>(def: WidgetDef<C>): WidgetDef<C> {
  return def;
}

export function tileWidth(size: WidgetSize, height: number, spacing: number): number {
  const units = SIZE_UNITS[size];
  return Math.round(units * height + (units - 1) * spacing);
}

/**
 * A component loaded the first time it renders (cards, heavy panels), so a widget's chunk stays
 * small: `Card: lazyPart(() => import("./MyCard").then((m) => m.MyCard))`. The dock renders
 * cards inside a Suspense boundary.
 */
export function lazyPart<P>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  return lazy(() => load().then((C) => ({ default: C }))) as unknown as ComponentType<P>;
}
