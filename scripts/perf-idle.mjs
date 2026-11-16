#!/usr/bin/env node
/**
 * Idle cost of the built UI in headless Chromium (mock backend): frames, paints and main-thread
 * time while the dock sits idle with no pointer over it. No dependencies (Node 22+ WebSocket).
 *
 *   npx vite build && npx vite preview --port 4173 &
 *   node scripts/perf-idle.mjs "http://localhost:4173/?reset=1&profile=bare" 10
 *   (dock=clocks.clock for the floor; env: SETTLE_MS before measuring, default 6000 — use
 *   12000+ so start-up animations are over; CHROMIUM binary; WINDOW size; PERF_TMP profile dir)
 *
 * Prints one JSON line: the running CSS/Web animations at the start, frames drawn (compositor
 * DrawFrame), main-thread Paint / Layout / style recalcs, rAF callbacks, timers fired, and task /
 * script / layout / style time over the window (Performance.getMetrics deltas, ms).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:4173/?reset=1";
const seconds = Number(process.argv[3]) || 10;
const settle = Number(process.env.SETTLE_MS) || 6000;
const bin = process.env.CHROMIUM || "chromium";
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(process.env.PERF_TMP || tmpdir(), "glintbar-perf-"));

const chrome = spawn(bin, [
  "--headless", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run",
  "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--window-size=" + (process.env.WINDOW || "1600,800"), "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error("chromium did not start");
}

let ws, nextId = 1;
const waiting = new Map();
const listeners = [];
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => waiting.set(id, { res, rej }));
}

function metrics(list) {
  const m = {};
  for (const { name, value } of list.metrics) m[name] = value;
  return m;
}

try {
  ws = new WebSocket(await target());
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const w = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? w.rej(new Error(msg.error.message)) : w.res(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  };
  const problems = [];
  listeners.push((m) => {
    if (m.method === "Runtime.exceptionThrown") problems.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text).slice(0, 300));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Performance.enable", { timeDomain: "threadTicks" });
  await send("Page.navigate", { url });
  await sleep(settle);
  // Pointer far away from the dock, like the smoke driver does.
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  await sleep(500);
  const probe = await send("Runtime.evaluate", {
    expression: "JSON.stringify({tiles: document.querySelectorAll('[data-glintbar-tile]').length, root: (document.getElementById('root')?.innerHTML || '').slice(0, 200), bodyLen: document.body.innerHTML.length, scripts: [...document.scripts].map(s => s.src).join(' '), visibility: document.visibilityState, size: innerWidth + 'x' + innerHeight})",
    returnByValue: true,
  });
  const page = JSON.parse(probe.result.value);
  // Running CSS animations / transitions: an infinite one is a frame every vsync.
  const anim = await send("Runtime.evaluate", {
    expression: `JSON.stringify(document.getAnimations().filter(a => a.playState === "running").map(a => {
      const t = a.effect && a.effect.target; const el = t && (t.closest ? t : null);
      const tile = el && el.closest && el.closest("[data-glintbar-tile]");
      return (a.animationName || a.transitionProperty || a.constructor.name) + " on " + (t ? (t.tagName + "." + String(t.className && t.className.baseVal !== undefined ? t.className.baseVal : t.className).slice(0, 60)) : "?") + (tile ? " in " + tile.dataset.glintbarTile : "") + " iter " + (a.effect && a.effect.getTiming().iterations);
    }).slice(0, 30))`,
    returnByValue: true,
  });
  const animations = JSON.parse(anim.result.value);

  const events = [];
  let done;
  const finished = new Promise((r) => (done = r));
  listeners.push((m) => {
    if (m.method === "Tracing.dataCollected") events.push(...m.params.value);
    if (m.method === "Tracing.tracingComplete") done();
  });
  await send("Tracing.start", {
    traceConfig: {
      includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "viz", "cc", "blink"],
      recordMode: "recordContinuously",
    },
    transferMode: "ReportEvents",
  });
  const m0 = metrics(await send("Performance.getMetrics"));
  await sleep(seconds * 1000);
  const m1 = metrics(await send("Performance.getMetrics"));
  await send("Tracing.end");
  await finished;

  const count = (name) => events.filter((e) => e.name === name && e.ph !== "E").length;
  const dur = (name) => Math.round(events.filter((e) => e.name === name && e.dur).reduce((s, e) => s + e.dur, 0) / 1000);
  const timers = {};
  for (const e of events) if (e.name === "TimerFire") {
    const k = String(e.args?.data?.timerId ?? "?");
    timers[k] = (timers[k] || 0) + 1;
  }
  const out = {
    url, seconds, page: { tiles: page.tiles, size: page.size, visibility: page.visibility }, animations, problems: problems.slice(0, 5),
    framesDrawn: count("DrawFrame"),
    framesPresented: count("Display::DrawAndSwap") || count("DisplayScheduler::DrawAndSwap") || null,
    beginMainFrames: count("BeginMainThreadFrame") || count("ThreadProxy::BeginMainFrame") || count("ProxyMain::BeginMainFrame"),
    paints: count("Paint"),
    layouts: count("Layout"),
    styleRecalcs: count("UpdateLayoutTree"),
    animationFrames: count("FireAnimationFrame"),
    timersFired: count("TimerFire"),
    timerIds: Object.keys(timers).length,
    taskMs: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000),
    scriptMs: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000),
    layoutMs: Math.round((m1.LayoutDuration - m0.LayoutDuration) * 1000),
    styleMs: Math.round((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000),
    paintMsTrace: dur("Paint"),
  };
  if (process.env.SHOT) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.SHOT, Buffer.from(shot.data, "base64"));
  }
  console.log(JSON.stringify(out));
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGKILL");
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
