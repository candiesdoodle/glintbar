/**
 * Keeps the glass canvas exactly under the dock bar and redraws it only when something changed:
 * a new frame, the bar or its widgets moved/resized/scrolled, or the look changed. Measuring is
 * event-driven (ResizeObserver, scroll, DOM changes, dock settings); there is no frame loop.
 */
import { useDock } from "../../dock/layout";
import { setGlassTone, setLiveGlass } from "../apply";
import type { GlassLook } from "../themes";
import { GlassRenderer, MAX_TILES, type GlassScene, type Rect } from "./renderer";
import { createSource, type FrameSource, type GlassFrame, type GlassStatus, type SourceOptions } from "./sources";

interface Layout {
  bar: DOMRect;
  radius: number;
  tiles: Rect[];
  tileRadius: number;
  clip: Rect;
  key: string;
}

export class GlassEngine {
  private renderer: GlassRenderer;
  private source: FrameSource;
  private bar: HTMLElement | null = null;
  private layout: Layout | null = null;
  private frameRect: [number, number, number, number] | null = null;
  private raf = 0;
  private drawing = false;
  private shown = false;
  private active = false;
  private plain = false;
  private cleanups: Array<() => void> = [];
  private toneAware = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private look: GlassLook,
    opts: SourceOptions,
  ) {
    this.renderer = new GlassRenderer(canvas);
    this.renderer.onRestored = () => this.draw();
    this.source = createSource(
      {
        frame: (f) => this.onFrame(f),
        status: (s) => this.onStatus(s),
      },
      opts,
    );
    setLiveGlass("fallback");
    if (!this.renderer.ok) {
      this.plain = true;
      return;
    }
    this.findBar();
  }

  setLook(look: GlassLook, toneAware: boolean): void {
    this.look = look;
    this.toneAware = toneAware;
    if (!toneAware) setGlassTone(null);
    this.draw();
  }

  setOptions(o: SourceOptions): void {
    this.source.setOptions(o);
  }

  setActive(on: boolean): void {
    if (on === this.active || this.plain) return;
    this.active = on;
    if (on) {
      this.source.start();
      if (this.layout) this.source.setRect(this.layout.bar);
    } else {
      this.source.stop();
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.source.dispose();
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.renderer.dispose();
    setGlassTone(null);
    setLiveGlass("off");
  }

  // ---- bar tracking ---------------------------------------------------------------------------

  private findBar(): void {
    const found = document.querySelector<HTMLElement>("[data-glintbar-bar]");
    if (found) {
      this.attach(found);
      return;
    }
    const mo = new MutationObserver(() => {
      const el = document.querySelector<HTMLElement>("[data-glintbar-bar]");
      if (el) {
        mo.disconnect();
        this.attach(el);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    this.cleanups.push(() => mo.disconnect());
  }

  private attach(bar: HTMLElement): void {
    this.bar = bar;
    const schedule = () => this.schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(bar);
    // Tiles appear/disappear (children of the scroller).
    const mo = new MutationObserver(schedule);
    mo.observe(bar, { childList: true, subtree: true });
    bar.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    // Dragging a widget moves it with transforms: follow the pointer while it is down.
    let dragging = false;
    const onMove = () => dragging && schedule();
    const onDown = () => {
      dragging = true;
    };
    const onUp = () => {
      if (dragging) {
        dragging = false;
        schedule();
      }
    };
    bar.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    const unsubDock = useDock.subscribe(schedule);
    this.cleanups.push(() => {
      ro.disconnect();
      mo.disconnect();
      bar.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      bar.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      unsubDock();
    });
    // The bar element can be replaced (React remount): look for it again then.
    const parentMo = new MutationObserver(() => {
      if (!bar.isConnected) {
        parentMo.disconnect();
        this.bar = null;
        this.findBar();
      }
    });
    parentMo.observe(document.body, { childList: true, subtree: true });
    this.cleanups.push(() => parentMo.disconnect());
    this.schedule();
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.measure();
    });
  }

  private measure(): void {
    const bar = this.bar;
    if (!bar || !bar.isConnected) return;
    const r = bar.getBoundingClientRect();
    const cs = getComputedStyle(bar);
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    const tileRadius = parseFloat(cs.getPropertyValue("--g-radius-tile")) || 12;
    const els = bar.querySelectorAll<HTMLElement>("[data-glintbar-tile]");
    const tiles: Rect[] = [];
    let clipEl: HTMLElement | null = null;
    for (const el of els) {
      if (!clipEl) clipEl = el.parentElement;
      if (tiles.length >= MAX_TILES) break;
      const t = el.getBoundingClientRect();
      if (t.right < r.left || t.left > r.right || t.width < 1) continue;
      tiles.push({ x: t.left - r.left, y: t.top - r.top, w: t.width, h: t.height });
    }
    const c = clipEl?.getBoundingClientRect();
    const clip: Rect = c ? { x: c.left - r.left, y: c.top - r.top, w: c.width, h: c.height } : { x: 0, y: 0, w: r.width, h: r.height };
    const round = (v: number) => Math.round(v * 2) / 2;
    const key = [r.left, r.top, r.width, r.height, radius, tileRadius, clip.x, clip.w, ...tiles.flatMap((t) => [t.x, t.y, t.w, t.h])].map(round).join(",");
    if (this.layout?.key === key) return;
    const moved =
      !this.layout || this.layout.bar.left !== r.left || this.layout.bar.top !== r.top || this.layout.bar.width !== r.width || this.layout.bar.height !== r.height;
    this.layout = { bar: r, radius, tiles, tileRadius, clip, key };
    const s = this.canvas.style;
    s.left = `${r.left}px`;
    s.top = `${r.top}px`;
    s.width = `${r.width}px`;
    s.height = `${r.height}px`;
    if (moved && this.active) this.source.setRect(r);
    this.draw();
  }

  // ---- frames ---------------------------------------------------------------------------------

  private onFrame(f: GlassFrame): void {
    this.renderer.setImage(f.image, f.width, f.height);
    this.frameRect = f.rect;
    if (this.toneAware) setGlassTone(f.luma);
    this.draw();
    this.source.drawn();
  }

  private onStatus(s: GlassStatus): void {
    if (s.tier === "plain") {
      this.shown = false;
      this.canvas.style.display = "none";
      setLiveGlass("fallback");
    }
  }

  private draw(): void {
    if (this.drawing) return;
    const layout = this.layout;
    const fr = this.frameRect;
    if (!layout || !fr || !this.renderer.hasImage) return;
    this.drawing = true;
    const ox = layout.bar.left;
    const oy = layout.bar.top;
    const scene: GlassScene = {
      width: layout.bar.width,
      height: layout.bar.height,
      radius: layout.radius,
      tiles: layout.tiles,
      tileRadius: layout.tileRadius,
      clip: layout.clip,
      texRect: [fr[0] - ox, fr[1] - oy, fr[2] - ox, fr[3] - oy],
      look: this.look,
    };
    const ok = this.renderer.render(scene);
    this.drawing = false;
    if (ok && !this.shown) {
      this.shown = true;
      this.canvas.style.display = "block";
      setLiveGlass("on");
    }
  }
}
