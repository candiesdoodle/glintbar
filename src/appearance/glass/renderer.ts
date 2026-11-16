/**
 * WebGL2 glass: maps the strip captured behind the bar onto it with lens-like refraction near
 * the rounded border, slight chromatic dispersion, a specular rim and per-theme frost. Glass
 * widgets inside the bar get their own smaller lens and rim.
 *
 * It draws ONLY when asked (`render`): a new frame, a moved/resized bar or a theme change. There
 * is no animation loop. Context loss is survived: the last image is kept and re-uploaded.
 */
import type { GlassLook } from "../themes";

export const MAX_TILES = 32;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GlassScene {
  /** Canvas size in CSS px (= the bar's border box). */
  width: number;
  height: number;
  /** Bar corner radius, CSS px. */
  radius: number;
  /** Widget tiles, canvas-local CSS px. */
  tiles: Rect[];
  tileRadius: number;
  /** Tiles are clipped to this (the scrolling row), canvas-local CSS px. */
  clip: Rect;
  /** Where the texture lies, canvas-local CSS px: left, top, right, bottom. */
  texRect: [number, number, number, number];
  look: GlassLook;
}

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform vec4 uTexRect;
uniform float uTexScale;
uniform float uMaxLod;
uniform float uPx;
uniform float uRadius;
uniform float uBar;
uniform float uBend;
uniform float uBevel;
uniform float uFrost;
uniform float uDisp;
uniform float uRim;
uniform float uSat;
uniform float uBright;
uniform float uTileBend;
uniform float uTileRim;
uniform float uTileRadius;
uniform float uTileFrost;
uniform int uTileCount;
uniform vec4 uTiles[${MAX_TILES}];
uniform vec4 uClip;

float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdRect(vec2 p, vec4 rc, float r) {
  vec2 b = rc.zw * 0.5;
  return sdRound(p - (rc.xy + b), b, min(r, min(b.x, b.y)));
}

// x = signed distance (negative inside), yz = outward normal
vec3 shape(vec2 p, vec4 rc, float r) {
  float d = sdRect(p, rc, r);
  const float e = 0.75;
  vec2 n = vec2(sdRect(p + vec2(e, 0.0), rc, r) - sdRect(p - vec2(e, 0.0), rc, r),
                sdRect(p + vec2(0.0, e), rc, r) - sdRect(p - vec2(0.0, e), rc, r));
  float l = length(n);
  return vec3(d, l > 1e-5 ? n / l : vec2(0.0));
}

vec2 toUv(vec2 p) {
  return (p - uTexRect.xy) / (uTexRect.zw - uTexRect.xy);
}

vec3 frost(vec2 p, float radius) {
  vec2 uv = toUv(p);
  if (radius < 0.75) return texture(uTex, uv).rgb;
  float lod = clamp(log2(max(radius * uTexScale * 0.7, 1.0)), 0.0, uMaxLod);
  vec2 o = vec2(radius * 0.55) / (uTexRect.zw - uTexRect.xy);
  vec3 c = textureLod(uTex, uv, lod).rgb * 0.36;
  c += textureLod(uTex, uv + vec2(o.x, o.y), lod).rgb * 0.16;
  c += textureLod(uTex, uv + vec2(-o.x, o.y), lod).rgb * 0.16;
  c += textureLod(uTex, uv + vec2(o.x, -o.y), lod).rgb * 0.16;
  c += textureLod(uTex, uv + vec2(-o.x, -o.y), lod).rgb * 0.16;
  return c;
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  float aa = uPx;

  vec3 bar = shape(p, vec4(0.0, 0.0, uSize), uRadius);
  float barMask = uBar * clamp(0.5 - bar.x / aa, 0.0, 1.0);

  vec3 tile = vec3(1e5, 0.0, 0.0);
  for (int i = 0; i < ${MAX_TILES}; i++) {
    if (i >= uTileCount) break;
    vec3 s = shape(p, uTiles[i], uTileRadius);
    if (s.x < tile.x) tile = s;
  }
  float clipD = sdRect(p, uClip, 0.0);
  float tileD = max(tile.x, clipD);
  float tileMask = clamp(0.5 - tileD / aa, 0.0, 1.0) * step(0.001, uTileBend + uTileRim);
  float mask = uBar > 0.5 ? barMask : tileMask;
  if (mask <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  // Refraction: near an edge the glass shows what lies a little further out, like a lens rim.
  vec2 off = vec2(0.0);
  float inside = -bar.x;
  if (uBar > 0.5 && uBevel > 0.0) {
    float t = clamp(1.0 - inside / uBevel, 0.0, 1.0);
    off += bar.yz * uBend * t * t * (3.0 - 2.0 * t) * 0.85;
  }
  float tIn = -tile.x;
  if (tileMask > 0.0 && uTileBend > 0.0) {
    float tb = max(uTileRadius * 0.9, 5.0);
    float t2 = clamp(1.0 - tIn / tb, 0.0, 1.0);
    off += tile.yz * uTileBend * t2 * t2;
  }

  // Glass widgets are frostier than the bar around them (softly, across their rim).
  float fr = mix(uFrost, max(uFrost, uTileFrost), tileMask * smoothstep(0.0, 4.0, tIn));
  vec3 col;
  float bendAmt = length(off);
  if (uDisp > 0.0 && bendAmt > 0.05) {
    float k = uDisp * 0.22;
    col.r = frost(p + off * (1.0 + k), fr).r;
    col.g = frost(p + off, fr).g;
    col.b = frost(p + off * (1.0 - k), fr).b;
  } else {
    col = frost(p + off, fr);
  }

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat) * uBright;

  // Specular rim: light from the top left, a fainter bounce on the far side.
  vec2 L = normalize(vec2(-0.4, -1.0));
  if (uBar > 0.5 && uRim > 0.0) {
    float edge = 1.0 - smoothstep(0.0, 1.8, inside);
    float facing = dot(bar.yz, L);
    float spec = edge * (0.22 + 0.78 * max(facing, 0.0)) + edge * 0.4 * max(-facing, 0.0);
    float sheen = pow(clamp(1.0 - inside / max(uBevel * 1.4, 1.0), 0.0, 1.0), 3.0) * max(facing, 0.0) * 0.22;
    col += (spec * 0.55 + sheen) * uRim;
  }
  if (tileMask > 0.0 && uTileRim > 0.0) {
    float edge = 1.0 - smoothstep(0.0, 1.4, tIn);
    float facing = dot(tile.yz, L);
    float spec = edge * (0.15 + 0.85 * max(facing, 0.0)) + edge * 0.3 * max(-facing, 0.0);
    col += spec * 0.45 * uTileRim * tileMask;
  }

  outColor = vec4(clamp(col, 0.0, 1.0) * mask, mask);
}`;

type Uniforms = Record<string, WebGLUniformLocation | null>;
const UNIFORMS = [
  "uTex", "uSize", "uTexRect", "uTexScale", "uMaxLod", "uPx", "uRadius", "uBar", "uBend", "uBevel", "uFrost",
  "uDisp", "uRim", "uSat", "uBright", "uTileBend", "uTileRim", "uTileRadius", "uTileFrost", "uTileCount", "uTiles", "uClip",
];

export type GlassImage = ImageBitmap | HTMLCanvasElement | HTMLImageElement;

export class GlassRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private tex: WebGLTexture | null = null;
  private u: Uniforms = {};
  private image: GlassImage | null = null;
  private imageSize = { w: 0, h: 0 };
  private uploaded = false;
  private lost = false;
  private tiles = new Float32Array(MAX_TILES * 4);
  /** Called after a lost context comes back, so the owner can draw again. */
  onRestored: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener("webglcontextlost", this.handleLost, false);
    canvas.addEventListener("webglcontextrestored", this.handleRestored, false);
    this.init();
  }

  get ok(): boolean {
    return this.gl !== null && this.program !== null && !this.lost;
  }

  get hasImage(): boolean {
    return this.image !== null;
  }

  private handleLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.gl = null;
    this.program = null;
    this.tex = null;
    this.vao = null;
  };

  private handleRestored = () => {
    this.lost = false;
    this.init();
    this.uploaded = false;
    this.onRestored?.();
  };

  private init(): void {
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    });
    if (!gl) return;
    const program = link(gl, VERT, FRAG);
    if (!program) return;
    this.gl = gl;
    this.program = program;
    this.vao = gl.createVertexArray();
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.u = {};
    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(program, name);
  }

  /** The strip behind the bar. The renderer keeps it (for context loss) until the next one. */
  setImage(img: GlassImage, w: number, h: number): void {
    const prev = this.image;
    this.image = img;
    this.imageSize = { w, h };
    this.uploaded = false;
    if (prev && prev !== img && "close" in prev && typeof prev.close === "function") prev.close();
  }

  private upload(): void {
    const gl = this.gl;
    if (!gl || !this.image || this.uploaded) return;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.uploaded = true;
  }

  /** Draws one frame. Returns false when nothing could be drawn (no context or no image). */
  render(scene: GlassScene): boolean {
    const gl = this.gl;
    if (!gl || !this.program || this.lost || !this.image) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.round(scene.width * dpr));
    const ph = Math.max(1, Math.round(scene.height * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.upload();
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    const u = this.u;
    const look = scene.look;
    const [l, t, r, b] = scene.texRect;
    const texW = Math.max(1, this.imageSize.w);
    const texH = Math.max(1, this.imageSize.h);
    gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uSize, scene.width, scene.height);
    gl.uniform4f(u.uTexRect, l, t, r, b);
    gl.uniform1f(u.uTexScale, texW / Math.max(1, r - l));
    gl.uniform1f(u.uMaxLod, Math.floor(Math.log2(Math.max(texW, texH))));
    gl.uniform1f(u.uPx, 1 / dpr);
    gl.uniform1f(u.uRadius, scene.radius);
    gl.uniform1f(u.uBar, look.bar ? 1 : 0);
    gl.uniform1f(u.uBend, look.bend);
    gl.uniform1f(u.uBevel, look.bevel);
    gl.uniform1f(u.uFrost, look.frost);
    gl.uniform1f(u.uDisp, look.dispersion);
    gl.uniform1f(u.uRim, look.rim);
    gl.uniform1f(u.uSat, look.saturation);
    gl.uniform1f(u.uBright, look.brightness);
    gl.uniform1f(u.uTileBend, look.tileBend);
    gl.uniform1f(u.uTileRim, look.tileRim);
    gl.uniform1f(u.uTileRadius, scene.tileRadius);
    gl.uniform1f(u.uTileFrost, look.tileFrost);
    const n = Math.min(scene.tiles.length, MAX_TILES);
    this.tiles.fill(0);
    for (let i = 0; i < n; i++) {
      const tr = scene.tiles[i];
      this.tiles.set([tr.x, tr.y, tr.w, tr.h], i * 4);
    }
    gl.uniform1i(u.uTileCount, n);
    gl.uniform4fv(u.uTiles, this.tiles);
    gl.uniform4f(u.uClip, scene.clip.x, scene.clip.y, scene.clip.w, scene.clip.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  dispose(): void {
    this.canvas.removeEventListener("webglcontextlost", this.handleLost, false);
    this.canvas.removeEventListener("webglcontextrestored", this.handleRestored, false);
    const gl = this.gl;
    if (gl) {
      if (this.tex) gl.deleteTexture(this.tex);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    if (this.image && "close" in this.image && typeof this.image.close === "function") this.image.close();
    this.image = null;
    this.gl = null;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn("[glass] shader:", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn("[glass] link:", gl.getProgramInfoLog(p));
    gl.deleteProgram(p);
    return null;
  }
  return p;
}
