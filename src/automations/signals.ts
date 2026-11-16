import { getStored, subscribeKey } from "../core/store";

/**
 * What other slices tell the automations engine. Each call replaces that source's last report;
 * a slice that never reports (not connected, not built yet) simply means the matching rule
 * stays quiet.
 *
 *   reportAiLimits("ai.claude", [{ id: "session", label: "Claude session", usedPct: 82, resetsAt }])
 *   reportReviewRequests("online.github", [{ id: "pr-123", title: "Fix login", url }])
 */

export interface AiLimitSignal {
  /** Unique within the source, e.g. "session" or "weekly". */
  id: string;
  /** "Claude session", "ChatGPT weekly". */
  label: string;
  /** 0-100 */
  usedPct: number;
  /** Unix ms when the window resets, if known. */
  resetsAt?: number;
}

export interface ReviewRequestSignal {
  id: string;
  title: string;
  url?: string;
  /** "GitHub", "Linear" */
  from?: string;
}

type Listener = () => void;

const aiLimits = new Map<string, { at: number; items: AiLimitSignal[] }>();
const reviews = new Map<string, { at: number; items: ReviewRequestSignal[] }>();
const listeners = new Set<Listener>();

function changed() {
  for (const l of [...listeners]) l();
}

export function reportAiLimits(source: string, items: AiLimitSignal[]): void {
  aiLimits.set(source, { at: Date.now(), items: items.filter((i) => Number.isFinite(i.usedPct)) });
  changed();
}

export function reportReviewRequests(source: string, items: ReviewRequestSignal[]): void {
  reviews.set(source, { at: Date.now(), items });
  changed();
}

/** Reports older than this are ignored (the slice stopped refreshing). */
const FRESH_MS = 6 * 3600_000;

/** What the AI slice keeps under the store key "ai.signals" (read loosely; it may change). */
interface AiStoreSignal {
  id?: string;
  tool?: string;
  toolName?: string;
  label?: string;
  usedPct?: number;
  resetsAt?: number | null;
  at?: number;
}

function fromAiStore(): Array<AiLimitSignal & { source: string }> {
  const saved = getStored<{ items?: AiStoreSignal[] } | null>("ai.signals", null);
  const now = Date.now();
  const out: Array<AiLimitSignal & { source: string }> = [];
  for (const s of saved?.items ?? []) {
    if (!s || typeof s.usedPct !== "number" || !s.id) continue;
    if (s.at && now - s.at > FRESH_MS) continue;
    const name = s.toolName ?? s.tool ?? "AI";
    const label = s.label ? (s.label.toLowerCase().startsWith(name.toLowerCase()) ? s.label : `${name} ${s.label.toLowerCase()}`) : name;
    out.push({ id: s.id, label, usedPct: s.usedPct, resetsAt: s.resetsAt ?? undefined, source: `ai.${s.tool ?? "store"}` });
  }
  return out;
}

export function currentAiLimits(): Array<AiLimitSignal & { source: string }> {
  const out: Array<AiLimitSignal & { source: string }> = [];
  const now = Date.now();
  for (const [source, r] of aiLimits) {
    if (now - r.at > FRESH_MS) continue;
    for (const i of r.items) out.push({ ...i, source });
  }
  // The AI slice also publishes on its own; merge without duplicates.
  const seen = new Set(out.map((o) => `${o.source}:${o.id}`));
  for (const s of fromAiStore()) if (!seen.has(`${s.source}:${s.id}`)) out.push(s);
  return out;
}

export function currentReviewRequests(): Array<ReviewRequestSignal & { source: string }> {
  const out: Array<ReviewRequestSignal & { source: string }> = [];
  for (const [source, r] of reviews) for (const i of r.items) out.push({ ...i, source });
  return out;
}

export function onSignals(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Loose bridges, so slices can report without importing this module:
// - the AI slice's store key "ai.signals" (and its "glintbar:ai-limits" window event)
// - a window event "glintbar:review-requests" with detail { source, items: ReviewRequestSignal[] }
subscribeKey("ai.signals", changed);
if (typeof window !== "undefined") {
  window.addEventListener("glintbar:ai-limits", () => changed());
  window.addEventListener("glintbar:review-requests", (e) => {
    const d = (e as CustomEvent<{ source?: string; items?: ReviewRequestSignal[] }>).detail;
    if (d && Array.isArray(d.items)) reportReviewRequests(d.source ?? "unknown", d.items.filter((i) => i && i.id && i.title));
  });
}
