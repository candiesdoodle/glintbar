#!/usr/bin/env node
// Static IPC cross-check: every (service, method) and (service, topic) the TypeScript UI uses must
// exist in Rust. Runs anywhere Node runs (no Rust toolchain needed).
//
//   node scripts/check-ipc.mjs                 report; exit 1 when the UI uses a name Rust lacks
//   node scripts/check-ipc.mjs --json          the same report as JSON on stdout
//   node scripts/check-ipc.mjs --write-manifest   also writes src/smoke/rust-ipc.json (the list of
//                                              Rust registrations the smoke self-test uses)
//
// Rust side: reg.add / add_blocking / poller / on_topic in src-tauri/src/services, plus events
// emitted with events::emit(app, "svc", "topic", ..) and the shell's own emit("topic") helpers.
// UI side: call / useService / useTopic / on / peekTopic, command tuples (call: ["svc", "m"]),
// mockService / mockTopic. Test files are ignored. Dynamic names are listed, not checked.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUST_DIR = join(ROOT, "src-tauri", "src", "services");
const TS_DIR = join(ROOT, "src");
const MANIFEST = join(ROOT, "src", "smoke", "rust-ipc.json");

const args = new Set(process.argv.slice(2));

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "target") continue;
      walk(p, exts, out);
    } else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split(sep).join("/");

/** Blanks out comments but keeps line numbers and string contents (URLs keep their "//"). */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "\x60") {
      const q = c;
      out += c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        i++;
      }
      if (i < n) out += src[i];
      i++;
      continue;
    }
    if (c === "'") {
      // TS string, or a Rust char literal ('"', '\'') / lifetime ('a). Only treat it as a string
      // when it closes on the same line within a short distance.
      const m = /^'(?:\\.|[^'\\\n]){0,200}'/.exec(src.slice(i, i + 210));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

// ---- Rust -------------------------------------------------------------------------------------

function scanRust() {
  const methods = [];
  const topics = [];
  for (const file of walk(RUST_DIR, [".rs"])) {
    const src = stripComments(readFileSync(file, "utf8"));
    const f = rel(file);
    const reMethod = /\.\s*(add|add_blocking)\s*\(\s*"([\w-]+)"\s*,\s*"([\w-]+)"\s*,\s*(?:move\s*)?\|\s*(?:mut\s+)?\w+\s*(?::\s*[\w:]+)?\s*,\s*(?:mut\s+)?(\w+)\s*(?::\s*([\w:<>]+))?\s*\|/g;
    for (const m of src.matchAll(reMethod)) {
      methods.push({ service: m[2], method: m[3], kind: m[1], args: (m[5] ?? "?").replace(/^crate::registry::/, ""), file: f, line: lineOf(src, m.index) });
    }
    // Registrations the closure regex above did not understand (still count them).
    const reLoose = /\.\s*(add|add_blocking)\s*\(\s*"([\w-]+)"\s*,\s*"([\w-]+)"/g;
    for (const m of src.matchAll(reLoose)) {
      if (!methods.some((x) => x.file === f && x.service === m[2] && x.method === m[3])) {
        methods.push({ service: m[2], method: m[3], kind: m[1], args: "?", file: f, line: lineOf(src, m.index) });
      }
    }
    const reTopic = /\.\s*(poller|on_topic)\s*\(\s*"([\w-]+)"\s*,\s*"([\w/-]+)"\s*,\s*(?:Duration::from_(secs|millis)\(\s*(\d+)\s*\))?/g;
    for (const m of src.matchAll(reTopic)) {
      const everyMs = m[5] ? Number(m[5]) * (m[4] === "secs" ? 1000 : 1) : undefined;
      topics.push({ service: m[2], topic: m[3], kind: m[1], everyMs, file: f, line: lineOf(src, m.index) });
    }
    const reEmit = /events::emit\s*\(\s*&?\s*\w+\s*,\s*"([\w-]+)"\s*,\s*"([\w/-]+)"/g;
    for (const m of src.matchAll(reEmit)) topics.push({ service: m[1], topic: m[2], kind: "emit", file: f, line: lineOf(src, m.index) });
    // services/shell: window::emit("topic", ..), emit_to_labels("topic", ..), events::event_name("shell", "topic")
    if (f.includes("/services/shell/")) {
      const reShell = /\b(?:emit|emit_to_labels)\s*\(\s*"([\w/-]+)"/g;
      for (const m of src.matchAll(reShell)) topics.push({ service: "shell", topic: m[1], kind: "emit", file: f, line: lineOf(src, m.index) });
    }
    const reName = /event_name\s*\(\s*"([\w-]+)"\s*,\s*"([\w/-]+)"/g;
    for (const m of src.matchAll(reName)) topics.push({ service: m[1], topic: m[2], kind: "emit", file: f, line: lineOf(src, m.index) });
  }
  return { methods, topics };
}

// ---- TypeScript -------------------------------------------------------------------------------

/** Top-level keys of the object literal starting at src[open] === "{". */
function objectKeys(src, open) {
  const keys = [];
  let depth = 0;
  let expectKey = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "\x60") {
      if (depth === 1 && expectKey && c !== "\x60") {
        const end = src.indexOf(c, i + 1);
        const after = src.slice(end + 1).match(/^\s*([:(])/);
        if (after) keys.push(src.slice(i + 1, end));
        expectKey = false;
        i = end;
        continue;
      }
      // skip the string
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      i = j;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      depth++;
      if (depth === 1) expectKey = true;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (depth === 1 && c === ",") {
      expectKey = true;
      continue;
    }
    if (depth === 1 && expectKey && /[A-Za-z_$]/.test(c)) {
      const m = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*([:(,}])/.exec(src.slice(i));
      if (m) keys.push(m[1]);
      expectKey = false;
      continue;
    }
    if (depth === 1 && expectKey && c === ".") expectKey = false; // ...spread
  }
  return keys;
}

function scanTs() {
  const uses = []; // {kind: "method"|"topic", service, name, file, line, via}
  const mocks = []; // {kind, service, name, file, line}
  const dynamic = [];
  const files = walk(TS_DIR, [".ts", ".tsx"]).filter((p) => !/\.test\.tsx?$/.test(p) && !p.includes(sep + "test" + sep));
  const Q = "[\"'\x60]";
  const generic = "(?:<(?:[^<>()]|<(?:[^<>]|<[^<>]*>)*>)*>)?";
  for (const file of files) {
    const f = rel(file);
    if (f === "src/core/backend.ts") continue; // the bridge itself (generic service/method params)
    const src = stripComments(readFileSync(file, "utf8"));
    const reCall = new RegExp("\\b(call|useService)\\s*" + generic + "\\s*\\(\\s*" + Q + "([\\w-]+)" + Q + "\\s*,\\s*" + Q + "([\\w-]+)" + Q, "g");
    for (const m of src.matchAll(reCall)) uses.push({ kind: "method", service: m[2], name: m[3], file: f, line: lineOf(src, m.index), via: m[1] });
    const reTopic = new RegExp("(?<![\\w.])(useTopic|on|peekTopic)\\s*" + generic + "\\s*\\(\\s*" + Q + "([\\w-]+)" + Q + "\\s*,\\s*" + Q + "([\\w/-]+)" + Q, "g");
    for (const m of src.matchAll(reTopic)) uses.push({ kind: "topic", service: m[2], name: m[3], file: f, line: lineOf(src, m.index), via: m[1] });
    const reTuple = /\bcall\s*:\s*\[\s*["']([\w-]+)["']\s*,\s*["']([\w-]+)["']\s*\]/g;
    for (const m of src.matchAll(reTuple)) uses.push({ kind: "method", service: m[1], name: m[2], file: f, line: lineOf(src, m.index), via: "call-tuple" });
    const reDyn = new RegExp("\\b(call|useService|useTopic)\\s*" + generic + "\\s*\\(\\s*(?:" + Q + "[\\w-]+" + Q + "\\s*,\\s*)?(?![\"'\x60\\s])([^,)]{1,40})", "g");
    for (const m of src.matchAll(reDyn)) {
      dynamic.push({ file: f, line: lineOf(src, m.index), text: m[0].slice(0, 80) });
    }
    const reMockSvc = new RegExp("\\bmockService\\s*\\(\\s*" + Q + "([\\w-]+)" + Q + "\\s*,\\s*\\{", "g");
    for (const m of src.matchAll(reMockSvc)) {
      const open = m.index + m[0].length - 1;
      for (const k of objectKeys(src, open)) mocks.push({ kind: "method", service: m[1], name: k, file: f, line: lineOf(src, m.index) });
    }
    const reMockTopic = new RegExp("\\b(mockTopic|mockEmit)\\s*" + generic + "\\s*\\(\\s*" + Q + "([\\w-]+)" + Q + "\\s*,\\s*" + Q + "([\\w/-]+)" + Q, "g");
    for (const m of src.matchAll(reMockTopic)) mocks.push({ kind: "topic", service: m[2], name: m[3], file: f, line: lineOf(src, m.index) });
  }
  return { uses, mocks, dynamic };
}

// ---- compare ----------------------------------------------------------------------------------

const rust = scanRust();
const ts = scanTs();

const rustMethods = new Set(rust.methods.map((m) => m.service + "." + m.method));
const rustTopics = new Set(rust.topics.map((t) => t.service + "/" + t.topic));
// core.subscribe accepts any key, but only topics Rust registers or emits ever deliver anything.

function group(list, keyOf) {
  const map = new Map();
  for (const x of list) {
    const k = keyOf(x);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(x);
  }
  return map;
}

const missingMethods = [];
for (const [k, list] of group(ts.uses.filter((u) => u.kind === "method"), (u) => u.service + "." + u.name)) {
  if (!rustMethods.has(k)) missingMethods.push({ name: k, at: list.map((u) => u.file + ":" + u.line) });
}
const missingTopics = [];
for (const [k, list] of group(ts.uses.filter((u) => u.kind === "topic"), (u) => u.service + "/" + u.name)) {
  if (!rustTopics.has(k)) missingTopics.push({ name: k, at: list.map((u) => u.file + ":" + u.line) });
}
const mockOnly = [];
for (const [k, list] of group(ts.mocks, (m) => (m.kind === "method" ? m.service + "." + m.name : m.service + "/" + m.name))) {
  const known = list[0].kind === "method" ? rustMethods.has(k) : rustTopics.has(k);
  if (!known) mockOnly.push({ name: k, at: list.map((m) => m.file + ":" + m.line) });
}
const usedMethods = new Set(ts.uses.filter((u) => u.kind === "method").map((u) => u.service + "." + u.name));
const unusedRust = [...rustMethods].filter((k) => !usedMethods.has(k)).sort();
const dupes = [...group(rust.methods, (m) => m.service + "." + m.method)].filter(([, l]) => l.length > 1).map(([k, l]) => ({ name: k, at: l.map((m) => m.file + ":" + m.line) }));

const report = {
  rust: { methods: rustMethods.size, topics: rustTopics.size },
  ui: { methodUses: ts.uses.filter((u) => u.kind === "method").length, topicUses: ts.uses.filter((u) => u.kind === "topic").length, mocks: ts.mocks.length },
  missingMethods,
  missingTopics,
  duplicateRegistrations: dupes,
  mockOnly,
  unusedRustMethods: unusedRust,
  dynamicCalls: ts.dynamic,
};

if (args.has("--write-manifest")) {
  const uniq = (list, key) => [...new Map(list.map((x) => [key(x), x])).values()];
  const manifest = {
    note: "Generated by scripts/check-ipc.mjs --write-manifest from the Rust sources. Do not edit.",
    methods: uniq(rust.methods, (m) => m.service + "." + m.method)
      .map(({ service, method, kind, args: a, file, line }) => ({ service, method, kind, args: a, file, line }))
      .sort((a, b) => (a.service + "." + a.method).localeCompare(b.service + "." + b.method)),
    topics: uniq(rust.topics, (t) => t.service + "/" + t.topic + "/" + (t.kind === "emit" ? "emit" : "reg"))
      .filter((t, _i, all) => t.kind !== "emit" || !all.some((o) => o.kind !== "emit" && o.service === t.service && o.topic === t.topic))
      .map(({ service, topic, kind, everyMs }) => ({ service, topic, kind, everyMs }))
      .sort((a, b) => (a.service + "/" + a.topic).localeCompare(b.service + "/" + b.topic)),
  };
  mkdirSync(dirname(MANIFEST), { recursive: true });
  // One entry per line keeps the diff readable when a slice adds a method.
  const lines = (list) => list.map((x) => "  " + JSON.stringify(x)).join(",\n");
  const text = '{\n "note": ' + JSON.stringify(manifest.note) + ',\n "methods": [\n' + lines(manifest.methods) + '\n ],\n "topics": [\n' + lines(manifest.topics) + "\n ]\n}\n";
  JSON.parse(text);
  writeFileSync(MANIFEST, text);
}

const failed = missingMethods.length > 0 || missingTopics.length > 0 || dupes.length > 0;

if (args.has("--json")) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  const p = (s) => process.stdout.write(s + "\n");
  p("Rust: " + report.rust.methods + " methods, " + report.rust.topics + " topics (registered or emitted)");
  p("UI:   " + report.ui.methodUses + " method uses, " + report.ui.topicUses + " topic uses, " + report.ui.mocks + " mock entries");
  const list = (title, items) => {
    if (!items.length) return;
    p("");
    p(title + " (" + items.length + "):");
    for (const it of items) p("  " + it.name + "    " + it.at.slice(0, 4).join(", ") + (it.at.length > 4 ? " (+" + (it.at.length - 4) + ")" : ""));
  };
  list("UI calls a method Rust does not register", missingMethods);
  list("UI listens to a topic Rust never registers or emits", missingTopics);
  list("Registered twice in Rust (panics at start-up)", dupes);
  list("Mocked but not in Rust (warning)", mockOnly);
  if (ts.dynamic.length) {
    p("");
    p("Dynamic names, not checked (" + ts.dynamic.length + "):");
    for (const d of ts.dynamic) p("  " + d.file + ":" + d.line + "  " + d.text);
  }
  if (args.has("--verbose") && unusedRust.length) {
    p("");
    p("Rust methods no UI code calls (" + unusedRust.length + "): " + unusedRust.join(", "));
  }
  p("");
  p(failed ? "FAIL: the UI uses names that Rust does not provide." : "OK: every name the UI uses exists in Rust.");
}
process.exit(failed ? 1 : 0);
