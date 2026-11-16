/** Small colour helpers (hex only; the themes use CSS for everything else). */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** WCAG relative luminance 0-1. */
export function luminance(c: Rgb): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** Black or white text, whichever reads better on `hex`. */
export function textOn(hex: string): string {
  const c = parseHex(hex);
  if (!c) return "#ffffff";
  return luminance(c) > 0.42 ? "#0d0d12" : "#ffffff";
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/**
 * Keeps an accent readable on the theme: very dark accents are lifted on dark themes, very light
 * ones deepened on light themes (an album cover can be almost black or almost white).
 */
export function fitAccent(hex: string, lightTheme: boolean): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const l = luminance(c);
  if (!lightTheme && l < 0.08) return toHex(mix(c, { r: 255, g: 255, b: 255 }, 0.35));
  if (lightTheme && l > 0.6) return toHex(mix(c, { r: 0, g: 0, b: 0 }, 0.3));
  return toHex(c);
}
