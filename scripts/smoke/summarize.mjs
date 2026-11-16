#!/usr/bin/env node
// Turns one smoke run into one small Markdown file the lead can read.
//
//   node scripts/smoke/summarize.mjs <smoke dir> [--step-summary]
//
// Reads drive.json (scripts/smoke/drive.ps1), selftest.json, tiles.json, console.json, layout.json
// and glintbar.log from <smoke dir>; writes <smoke dir>/summary.md, and appends it to
// $GITHUB_STEP_SUMMARY with --step-summary. Missing files are reported, never fatal.
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] || "smoke";
const toStepSummary = process.argv.includes("--step-summary");

function readJson(name) {
  const p = join(dir, name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    return { __error: String(e) };
  }
}

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 300);
const escLong = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 1200);
const uniq = (list) => [...new Set(list)];
const out = [];
const p = (s = "") => out.push(s);

const drive = readJson("drive.json");
const self = readJson("selftest.json");
const tiles = readJson("tiles.json");
const cons = readJson("console.json");
const layout = readJson("layout.json");
const missing = ["drive.json", "selftest.json", "tiles.json", "console.json", "layout.json"].filter((f) => !existsSync(join(dir, f)));

p("# GlintBar smoke run");
p();
if (drive?.verdict) {
  p(drive.verdict.fail ? "**FAIL**: " + drive.verdict.reasons.join("; ") : "**PASS** (dock rendered, no crash, taskbar restored)");
} else {
  p("**No drive.json**: the driver did not finish (see drive.log).");
}
p();

// ---- overview table
const steps = drive?.steps ?? [];
const failedSteps = steps.filter((s) => s.status === "failed");
const skippedSteps = steps.filter((s) => s.status === "skipped");
const calls = self?.calls ?? [];
const failedCalls = calls.filter((c) => c.status === "error" || c.status === "timeout");
const shapeBad = calls.filter((c) => c.shape?.checked && c.shape.problems?.length);
const native = drive?.firstLayout?.window?.native ?? layout?.window?.native;

p("| Check | Result |");
p("|---|---|");
if (drive) {
  p("| Screen | " + esc((drive.screen?.primaryWidth ?? "?") + "x" + (drive.screen?.primaryHeight ?? "?") + " (" + (drive.resolution ?? "") + ")") + " |");
  p("| Dock rendered | " + (drive.dockRendered ? "yes, " + (drive.firstLayout?.tiles?.length ?? "?") + " tiles" : "**no**") + " |");
  p("| Crashed | " + (drive.crashed ? "**yes**: " + esc(drive.crashInfo) : "no") + " |");
  p("| Quit | " + esc(drive.quit ?? "-") + (drive.exitCode !== undefined && drive.exitCode !== null ? ", exit code " + drive.exitCode : "") + " |");
  p("| Taskbar hidden while running | " + (drive.taskbarWhileRunning ? (!drive.taskbarWhileRunning.visible ? "yes" : "**no**") + ", work area " + (drive.taskbarWhileRunning.workArea ?? []).join(",") : "-") + " |");
  p("| Taskbar + work area restored | " + (drive.taskbarRestored ? "yes" : "**no**") + " (before " + (drive.taskbarBefore?.workArea ?? []).join(",") + ", after " + (drive.taskbarAfter?.workArea ?? []).join(",") + ") |");
}
if (native) {
  const aff = native.displayAffinity;
  p("| Dock capture affinity | " + aff + (aff === 17 ? " **(excluded from capture: screenshots cannot show the dock)**" : aff === 0 ? " (none)" : "") + " |");
}
if (drive) p("| Drive steps | " + (steps.length - failedSteps.length - skippedSteps.length) + " ok, " + failedSteps.length + " failed, " + skippedSteps.length + " skipped, " + (drive.seconds ?? "?") + " s |");
const checks = steps.filter((s) => s.check);
if (checks.length) {
  const ok = checks.filter((s) => s.status === "ok").length;
  p("| Round-two checks | " + ok + "/" + checks.length + " pass" + (checks.length - ok ? " (**" + checks.filter((s) => s.status === "failed").length + " FAIL**, " + checks.filter((s) => s.status === "skipped").length + " skipped)" : "") + " |");
}
const res = drive?.resources;
if (res) {
  p("| Idle CPU (glintbar.exe + WebView2) | " + (res.cpuPercentOfMachine >= res.targetPercent ? "**" : "") + res.cpuPercentOfMachine + " % of the machine" + (res.cpuPercentOfMachine >= res.targetPercent ? "**" : "") + " (" + res.cpuPercentOfOneCore + " % of one core, " + res.cores + " cores, " + res.processes + " processes, target < " + res.targetPercent + " %) |");
  p("| Idle memory | working set " + res.workingSetMB + " MB, private " + res.privateMB + " MB |");
  const kinds = (m) => (m?.byKind ? Object.entries(m.byKind).map(([k, v]) => k + " " + v + " ms").join(", ") : "");
  if (res.byKind) p("| Idle CPU by process kind (default dock) | " + esc(kinds(res)) + " |");
  if (res.baseline) p("| Idle CPU, Clock only (WebView2 floor) | " + res.baseline.cpuPercentOfMachine + " % of the machine (" + res.baseline.cpuPercentOfOneCore + " % of one core); " + esc(kinds(res.baseline)) + "; widgets of the default dock add ~" + res.widgetsPercentOfMachine + " % |");
  if (res.glassLive) p("| Idle CPU, live glass on and resting | " + res.glassLive.cpuPercentOfMachine + " % of the machine (" + res.glassLive.cpuPercentOfOneCore + " % of one core); " + esc(kinds(res.glassLive)) + " |");
  if (res.harnessQuiet === false) p("| Harness quiet during measurement | **no** (the UI did not accept 'quiet': its polling is included) |");
}
if (self && !self.__error) {
  const c = self.counts ?? {};
  p("| Service calls | " + c.ok + " ok, " + c.error + " error, " + c.timeout + " timeout, " + c.denied + " denied, " + c.skipped + " skipped (" + self.runtimeMethods + " registered at run time) |");
  p("| Shape mismatches vs mocks | " + shapeBad.length + " |");
  const topics = self.topics ?? [];
  p("| Topics | " + topics.filter((t) => t.events > 0).length + "/" + topics.length + " delivered" + (self.topicsSilent?.length ? "; silent: " + self.topicsSilent.join(", ") : "") + " |");
  if (self.notAtRuntime?.length) p("| In Rust sources, not registered at run time | " + esc(self.notAtRuntime.join(", ")) + " |");
  if (self.topicsNotAtRuntime?.length) p("| Topics in Rust sources, not registered at run time | " + esc(self.topicsNotAtRuntime.join(", ")) + " |");
  if (self.notInManifest?.length) p("| Registered, not in the manifest | " + esc(self.notInManifest.join(", ")) + " |");
}
if (tiles && !tiles.__error) {
  p("| Widgets rendered | " + tiles.covered + "/" + tiles.widgets + (tiles.crashed?.length ? "; **threw: " + tiles.crashed.join(", ") + "**" : "; none threw") + (tiles.notRendered?.length ? "; not rendered: " + tiles.notRendered.join(", ") : "") + " |");
}
if (cons && !cons.__error) {
  const c = cons.counts ?? {};
  p("| Webview console | " + c.error + " errors, " + c.warn + " warnings, " + c.uncaught + " uncaught, " + c.rejection + " unhandled rejections |");
}
if (drive?.blocked?.length) p("| Side effects blocked by smoke mode | " + esc(uniq(drive.blocked).join(", ")) + " |");
if (missing.length) p("| Missing files | " + missing.join(", ") + " |");
p();

// ---- details
if (checks.length) {
  p("## Round-two checks");
  p();
  p("| Check | Result | Evidence |");
  p("|---|---|---|");
  for (const s of checks) {
    const verdict = s.status === "ok" ? "PASS" : s.status === "failed" ? "**FAIL**" : "SKIP";
    const text = s.status === "failed" ? s.error : s.detail;
    p("| " + esc(s.check) + ": " + esc(s.name) + " | " + verdict + " | " + escLong(text) + " |");
  }
  p();
}
for (const m of [res, res?.baseline, res?.glassLive]) {
  if (!m?.perProcess?.length) continue;
  p("<details><summary>Idle resources per process: " + esc(m.label ?? "default dock") + " (" + m.idleSeconds + " s idle, sampled over " + m.sampleSeconds + " s)</summary>");
  p();
  p("| Process | Kind | PID | CPU ms | Working set MB | Private MB |");
  p("|---|---|---|---|---|---|");
  for (const r of m.perProcess) p("| " + esc(r.name) + " | " + esc(r.kind ?? "") + " | " + r.pid + " | " + r.cpuMs + " | " + r.workingSetMB + " | " + r.privateMB + " |");
  p();
  p("</details>");
  p();
}
if (failedSteps.length) {
  p("## Drive steps that failed");
  p();
  for (const s of failedSteps) p("- **" + esc(s.name) + "**: " + esc(s.error));
  p();
}
if (failedCalls.length) {
  p("## Service calls that failed");
  p();
  p("| Method | Code | Message | ms |");
  p("|---|---|---|---|");
  for (const c of failedCalls) p("| " + c.name + " | " + esc(c.code) + " | " + esc(c.message) + " | " + (c.ms ?? "") + " |");
  p();
}
if (shapeBad.length) {
  p("## Results that do not match what the UI expects (mock shape)");
  p();
  for (const c of shapeBad) p("- **" + c.name + "**: " + esc(c.shape.problems.slice(0, 6).join("; ")));
  p();
}
const topicBad = (self?.topics ?? []).filter((t) => t.shape?.checked && t.shape.problems?.length);
if (topicBad.length) {
  p("## Topic payloads that do not match the mocks");
  p();
  for (const t of topicBad) p("- **" + t.name + "**: " + esc(t.shape.problems.slice(0, 6).join("; ")));
  p();
}
const threw = (tiles?.tiles ?? []).filter((t) => t.crashed);
if (threw.length) {
  p("## Tiles that threw");
  p();
  for (const t of threw) p("- **" + t.widgetId + "** (" + t.batch + "): " + esc(t.crashMessage ?? "error boundary showing"));
  p();
}
const entries = (cons?.entries ?? []).filter((e) => e.level !== "warn");
if (entries.length) {
  p("## Console errors (first 25, deduplicated)");
  p();
  const seen = new Map();
  for (const e of entries) {
    const key = e.text.split("\n")[0].slice(0, 200);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [k, n] of [...seen].slice(0, 25)) p("- " + (n > 1 ? "(" + n + "x) " : "") + "\x60" + esc(k).replace(/\x60/g, "'") + "\x60");
  p();
}
const logFile = existsSync(join(dir, "glintbar.log")) ? join(dir, "glintbar.log") : null;
if (logFile) {
  const lines = readFileSync(logFile, "utf8").split(/\r?\n/).filter((l) => /\b(ERROR|WARN)\b|panicked/.test(l));
  if (lines.length) {
    p("## glintbar.log errors and warnings (first 25, deduplicated)");
    p();
    const seen = new Map();
    for (const l of lines) {
      const key = l.replace(/^\S+\s+/, "").slice(0, 220);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [k, n] of [...seen].slice(0, 25)) p("- " + (n > 1 ? "(" + n + "x) " : "") + "\x60" + esc(k).replace(/\x60/g, "'") + "\x60");
    p();
  }
}
const shots = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".png")).sort() : [];
if (shots.length) {
  p("<details><summary>" + shots.length + " screenshots in the glintbar-smoke artifact</summary>");
  p();
  p(shots.join(", "));
  p();
  p("</details>");
}

const md = out.join("\n") + "\n";
writeFileSync(join(dir, "summary.md"), md);
if (toStepSummary && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
process.stdout.write(md);
