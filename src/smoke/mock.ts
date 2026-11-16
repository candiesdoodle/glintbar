/**
 * Browser preview of the smoke harness (?smoke=1): an in-memory smoke folder, so the command
 * channel can be exercised without Windows. In the console:
 *   await __glintbarSmoke.command("setTheme", { theme: "white" })
 *   __glintbarSmoke.files.get("layout.json")
 */
import { mockService } from "../core/mock";
import manifest from "./rust-ipc.json";

const files = new Map<string, string>();
let seq = 0;

mockService("smoke", {
  status: () => ({ enabled: true, noCaptureExclude: true, dir: "(browser)", pid: 0 }),
  methods: () => [...manifest.methods.map((m) => m.service + "." + m.method)].sort(),
  window: () => {
    const scale = window.devicePixelRatio || 1;
    return {
      label: "main",
      visible: true,
      scale,
      outerX: 0,
      outerY: 0,
      outerWidth: Math.round(window.innerWidth * scale),
      outerHeight: Math.round(window.innerHeight * scale),
      innerX: 0,
      innerY: 0,
      innerWidth: Math.round(window.innerWidth * scale),
      innerHeight: Math.round(window.innerHeight * scale),
      native: null,
    };
  },
  read: ({ name }: { name: string }) => files.get(name) ?? null,
  write: ({ name, text, append }: { name: string; text: string; append?: boolean }) => {
    files.set(name, append ? (files.get(name) ?? "") + text : text);
    return text.length;
  },
  blocked: () => [],
  allow_launch: ({ seconds }: { seconds?: number }) => Math.min(60, seconds ?? 0),
  capture_override: ({ seconds }: { seconds?: number }) => Math.min(60, seconds ?? 0),
  topics: () => manifest.topics.filter((t) => t.kind !== "emit").map((t) => t.service + "/" + t.topic),
});

async function command(action: string, args?: unknown, timeoutMs = 60000): Promise<unknown> {
  const id = "b" + ++seq + "-" + Date.now();
  files.set("command.json", JSON.stringify({ id, action, args }));
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 100));
    const raw = files.get("command-result.json");
    if (!raw) continue;
    const res = JSON.parse(raw) as { id: string; ok: boolean; result?: unknown; error?: string };
    if (res.id !== id) continue;
    if (!res.ok) throw new Error(res.error);
    return res.result;
  }
  throw new Error(action + " timed out");
}

(window as unknown as { __glintbarSmoke: unknown }).__glintbarSmoke = { files, command };
