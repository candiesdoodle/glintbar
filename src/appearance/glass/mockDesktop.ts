/**
 * Browser preview only: a procedurally drawn "desktop" (a dusk sky, a sun over a lake, mountains,
 * two app windows) used both as the page background and as the image behind the glass, so
 * screenshots show the refraction exactly over what the page shows. Drawn once per viewport size.
 */

let cached: { w: number; h: number; canvas: HTMLCanvasElement; url: string } | null = null;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, light: boolean, rand: () => number) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = light ? "#f4f5f8" : "#1e2230";
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x, y, w, h, 12);
  ctx.clip();
  // title bar
  ctx.fillStyle = light ? "#e6e8ee" : "#262b3b";
  ctx.fillRect(x, y, w, 34);
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x + 18 + i * 18, y + 17, 5.5, 0, Math.PI * 2);
    ctx.fill();
  });
  // sidebar
  const sw = Math.min(170, w * 0.3);
  ctx.fillStyle = light ? "#2f6bff" : "#3a2f7a";
  ctx.fillRect(x, y + 34, sw, h - 34);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  for (let i = 0; i < 9; i++) {
    roundRect(ctx, x + 16, y + 56 + i * 30, sw * (0.45 + rand() * 0.4), 9, 4.5);
    ctx.fill();
  }
  // content: a chart card and coloured tiles
  const cx = x + sw + 22;
  const cw = w - sw - 44;
  ctx.fillStyle = light ? "#11131a" : "#e9ecf5";
  ctx.font = "600 22px Segoe UI, system-ui, sans-serif";
  ctx.fillText("Quarterly report", cx, y + 74);
  const colours = ["#ff6b6b", "#ffd166", "#06d6a0", "#118ab2", "#9b5de5", "#f15bb5"];
  for (let i = 0; i < 6; i++) {
    const bw = (cw - 5 * 12) / 6;
    const bh = 40 + rand() * 120;
    ctx.fillStyle = colours[i];
    roundRect(ctx, cx + i * (bw + 12), y + 250 - bh, bw, bh, 6);
    ctx.fill();
  }
  ctx.fillStyle = light ? "rgba(17,19,26,0.18)" : "rgba(233,236,245,0.18)";
  for (let i = 0; i < 12; i++) {
    roundRect(ctx, cx, y + 280 + i * 24, cw * (0.5 + rand() * 0.5), 10, 5);
    ctx.fill();
  }
  // stripes near the bottom: straight lines make the bending easy to see
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = colours[i % colours.length];
    ctx.fillRect(cx + (i * cw) / 14, y + h - 150, cw / 28, 150);
  }
  ctx.restore();
}

function paint(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const rand = rng(7);

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#0a1640");
  sky.addColorStop(0.38, "#3a2c8c");
  sky.addColorStop(0.62, "#c94f8a");
  sky.addColorStop(0.74, "#f59a62");
  sky.addColorStop(1, "#2a1d55");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // stars
  for (let i = 0; i < 220; i++) {
    const x = rand() * w;
    const y = rand() * h * 0.45;
    ctx.fillStyle = `rgba(255,255,255,${0.25 + rand() * 0.6})`;
    ctx.fillRect(x, y, rand() < 0.1 ? 2 : 1, rand() < 0.1 ? 2 : 1);
  }

  // sun glow
  const sx = w * 0.66;
  const sy = h * 0.7;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.55);
  glow.addColorStop(0, "rgba(255,236,170,0.95)");
  glow.addColorStop(0.12, "rgba(255,190,120,0.7)");
  glow.addColorStop(0.45, "rgba(255,120,140,0.18)");
  glow.addColorStop(1, "rgba(255,120,140,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // mountain ridges
  const ridges = [
    { base: 0.66, amp: 0.12, colour: "#5a3c8f" },
    { base: 0.72, amp: 0.09, colour: "#3b2a6e" },
    { base: 0.78, amp: 0.06, colour: "#221a4a" },
  ];
  ridges.forEach((rd, k) => {
    const p1 = rand() * 10;
    const p2 = rand() * 10;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) {
      const u = x / w;
      const y =
        h * rd.base -
        h * rd.amp * (0.55 * Math.sin(u * (5 + k) + p1) + 0.3 * Math.sin(u * (13 + k * 3) + p2) + 0.15 * Math.sin(u * 37 + p1));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = rd.colour;
    ctx.fill();
  });

  // lake with the sun's reflection
  const lakeTop = h * 0.8;
  const lake = ctx.createLinearGradient(0, lakeTop, 0, h);
  lake.addColorStop(0, "#f08a6a");
  lake.addColorStop(0.35, "#8a3f86");
  lake.addColorStop(1, "#1d1745");
  ctx.fillStyle = lake;
  ctx.fillRect(0, lakeTop, w, h - lakeTop);
  for (let i = 0; i < 70; i++) {
    const y = lakeTop + rand() * (h - lakeTop);
    const len = 30 + rand() * 220;
    const x = sx - len / 2 + (rand() - 0.5) * w * 0.35;
    ctx.fillStyle = `rgba(255,226,170,${0.25 + rand() * 0.55})`;
    ctx.fillRect(x, y, len, 1.5 + rand() * 2);
  }

  // app windows reaching under the dock
  drawWindow(ctx, w * 0.05, h * 0.36, Math.min(w * 0.42, 720), h * 0.72, true, rand);
  drawWindow(ctx, w * 0.62, -h * 0.06, Math.min(w * 0.32, 520), h * 0.3, false, rand);

  // a sticky note on the right
  ctx.save();
  ctx.translate(w * 0.82, h * 0.74);
  ctx.rotate(-0.04);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#ffe066";
  ctx.fillRect(0, 0, 220, 240);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#4a3b00";
  ctx.font = "600 20px Segoe UI, system-ui, sans-serif";
  ctx.fillText("Ship v1.0", 18, 38);
  ctx.font = "16px Segoe UI, system-ui, sans-serif";
  ["glass shader", "settings", "picker", "themes"].forEach((t, i) => ctx.fillText("- " + t, 18, 72 + i * 26));
  ctx.restore();
  return c;
}

let preview: string | null = null;
/** A small desktop picture for the theme gallery (drawn once). */
export function previewDesktopUrl(): string {
  if (!preview) preview = paint(420, 240).toDataURL("image/jpeg", 0.85);
  return preview;
}

/** The desktop for the current viewport (cached until the size changes). */
export function mockDesktop(): { canvas: HTMLCanvasElement; url: string } {
  const w = Math.max(320, Math.round(window.innerWidth));
  const h = Math.max(200, Math.round(window.innerHeight));
  if (cached && cached.w === w && cached.h === h) return cached;
  const canvas = paint(w, h);
  cached = { w, h, canvas, url: canvas.toDataURL("image/jpeg", 0.9) };
  return cached;
}

/** Shows the mock desktop as the page background (browser preview). */
export function showMockDesktop(): void {
  const d = mockDesktop();
  document.body.style.background = `#140f2e url("${d.url}") 0 0 / 100% 100% no-repeat`;
}
