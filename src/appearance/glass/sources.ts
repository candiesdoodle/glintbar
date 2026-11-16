/**
 * Where the image behind the bar comes from.
 *
 * - Tauri: the Rust capture loop (services/appearance/glass.rs) sends JPEG frames over a Channel
 *   while the `appearance/glass` topic is subscribed; we decode off the main thread
 *   (createImageBitmap), hand the bitmap to the renderer and ack, so at most one frame is in
 *   flight. Nothing arrives while nothing behind the dock changes.
 * - Browser preview: a crop of the procedural mock desktop, redrawn only when the bar moves.
 */
import { Channel } from "@tauri-apps/api/core";
import { call, isTauri, on } from "../../core/backend";
import { WINDOW_LABEL } from "../../core/windowLabel";
import type { GlassImage } from "./renderer";
import { mockDesktop, showMockDesktop } from "./mockDesktop";

export interface GlassFrame {
  image: GlassImage;
  width: number;
  height: number;
  /** Area the image covers, client CSS px: left, top, right, bottom. */
  rect: [number, number, number, number];
  /** Mean luma 0-1 of what is behind. */
  luma: number;
}

export interface GlassStatus {
  tier: "starting" | "capture" | "wallpaper" | "plain" | "paused";
  reason?: string | null;
  resting?: boolean;
}

export interface SourceOptions {
  fps: 30 | 60;
  source: "auto" | "wallpaper";
}

export interface FrameSink {
  frame(f: GlassFrame): void;
  status(s: GlassStatus): void;
}

export interface FrameSource {
  start(): void;
  stop(): void;
  /** The bar moved or resized (client CSS px). */
  setRect(r: DOMRect): void;
  setOptions(o: SourceOptions): void;
  /** The renderer drew the last frame. */
  drawn(): void;
  dispose(): void;
}

const MARGIN = 20;
const MAGIC = 0x31534c47;
const HEADER = 40;

export function createSource(sink: FrameSink, opts: SourceOptions): FrameSource {
  return isTauri ? new TauriSource(sink, opts) : new MockSource(sink);
}

class TauriSource implements FrameSource {
  private channel: Channel<ArrayBuffer> | null = null;
  private off: (() => void) | null = null;
  private rect: DOMRect | null = null;
  private configTimer: ReturnType<typeof setTimeout> | undefined;
  private decoding = false;
  private pending: ArrayBuffer | null = null;
  private lastSeq = 0;
  private running = false;

  constructor(
    private sink: FrameSink,
    private opts: SourceOptions,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (buf) => this.onMessage(buf);
    this.channel = channel;
    call("appearance", "glass_attach", { channel, label: WINDOW_LABEL })
      .then(() => {
        if (!this.running) return;
        this.sendConfig();
        this.off = on<GlassStatus>("appearance", "glass", (s) => this.sink.status(s));
      })
      .catch((e) => {
        console.warn("[glass] attach failed", e);
        this.sink.status({ tier: "plain", reason: "attach-failed" });
      });
  }

  stop(): void {
    this.running = false;
    // Late frames from the old capture session are dropped.
    if (this.channel) this.channel.onmessage = () => {};
    this.channel = null;
    this.off?.();
    this.off = null;
    this.pending = null;
  }

  setRect(r: DOMRect): void {
    this.rect = r;
    clearTimeout(this.configTimer);
    this.configTimer = setTimeout(() => this.sendConfig(), 40);
  }

  setOptions(o: SourceOptions): void {
    this.opts = o;
    this.sendConfig();
  }

  private sendConfig(): void {
    if (!this.running || !this.rect) return;
    const r = this.rect;
    call("appearance", "glass_config", {
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      margin: MARGIN,
      maxFps: this.opts.fps,
      scale: 0.5,
      source: this.opts.source,
      quality: 72,
      label: WINDOW_LABEL,
    }).catch(() => {});
  }

  private onMessage(buf: ArrayBuffer): void {
    if (!this.running || !(buf instanceof ArrayBuffer) || buf.byteLength <= HEADER) return;
    if (this.decoding) {
      this.pending = buf; // keep only the newest
      return;
    }
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== MAGIC) return;
    const seq = dv.getUint32(4, true);
    const width = dv.getUint16(8, true);
    const height = dv.getUint16(10, true);
    const rect: [number, number, number, number] = [dv.getFloat32(12, true), dv.getFloat32(16, true), dv.getFloat32(20, true), dv.getFloat32(24, true)];
    const luma = dv.getFloat32(28, true);
    this.decoding = true;
    createImageBitmap(new Blob([new Uint8Array(buf, HEADER)], { type: "image/jpeg" }))
      .then((image) => {
        this.lastSeq = seq;
        if (this.running) this.sink.frame({ image, width, height, rect, luma });
        else image.close();
      })
      .catch(() => {
        this.drawn();
      })
      .finally(() => {
        this.decoding = false;
        const next = this.pending;
        this.pending = null;
        if (next) this.onMessage(next);
      });
  }

  drawn(): void {
    call("appearance", "glass_ack", { seq: this.lastSeq }).catch(() => {});
  }

  dispose(): void {
    this.stop();
    clearTimeout(this.configTimer);
  }
}

class MockSource implements FrameSource {
  private rect: DOMRect | null = null;
  private running = false;
  private lastKey = "";
  private onResize = () => {
    showMockDesktop();
    this.lastKey = "";
    this.emit();
  };

  constructor(private sink: FrameSink) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    showMockDesktop();
    window.addEventListener("resize", this.onResize);
    this.sink.status({ tier: "capture" });
    this.lastKey = "";
    this.emit();
  }

  stop(): void {
    this.running = false;
    window.removeEventListener("resize", this.onResize);
  }

  setRect(r: DOMRect): void {
    this.rect = r;
    this.emit();
  }

  setOptions(): void {}
  drawn(): void {}

  private emit(): void {
    if (!this.running || !this.rect || this.rect.width < 1) return;
    const desk = mockDesktop().canvas;
    const r = this.rect;
    const l = Math.max(0, Math.floor(r.left - MARGIN));
    const t = Math.max(0, Math.floor(r.top - MARGIN));
    const rr = Math.min(desk.width, Math.ceil(r.right + MARGIN));
    const b = Math.min(desk.height, Math.ceil(r.bottom + MARGIN));
    const key = [l, t, rr, b, desk.width, desk.height].join(",");
    if (key === this.lastKey || rr - l < 2 || b - t < 2) return;
    this.lastKey = key;
    // Same resolution as the real capture: half a CSS px.
    const w = Math.max(1, Math.round((rr - l) * 0.5));
    const h = Math.max(1, Math.round((b - t) * 0.5));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(desk, l, t, rr - l, b - t, 0, 0, w, h);
    const sample = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < sample.length; i += 4 * 9) {
      sum += 0.2126 * sample[i] + 0.7152 * sample[i + 1] + 0.0722 * sample[i + 2];
      n++;
    }
    this.sink.frame({ image: c, width: w, height: h, rect: [l, t, rr, b], luma: n ? sum / n / 255 : 0.3 });
  }

  dispose(): void {
    this.stop();
  }
}
