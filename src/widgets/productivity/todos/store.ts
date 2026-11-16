/**
 * To-dos, persisted as "productivity.todos". Reminders are wall-clock timestamps scheduled with
 * the automations scheduler, so they fire with the card closed and after a restart (a reminder
 * that came due while GlintBar was closed shows once on start).
 */
import { BellRing } from "lucide-react";
import { notify } from "../../../automations/alerts";
import { cancelPrefix, scheduleAt } from "../../../automations/scheduler";
import { createPersistedStore } from "../../../core/store";
import { runsBackground, uid } from "../shared/env";

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  doneAt?: number;
  /** Unix ms. */
  remindAt?: number;
  /** Set once the reminder has been shown. */
  remindedAt?: number;
  /** "GitHub review" etc. for items added by automations. */
  source?: string;
  url?: string;
  /** Dedupe key for automation-created items. */
  ref?: string;
}

interface TodoState {
  items: Todo[];
}

export const useTodos = createPersistedStore<TodoState>("productivity.todos", { items: [] });

const set = (fn: (items: Todo[]) => Todo[]) => useTodos.setState((s) => ({ items: fn(s.items) }));

export const todoActions = {
  add(text: string, extra: Partial<Todo> = {}): string | null {
    const t = text.trim();
    if (!t) return null;
    if (extra.ref && useTodos.getState().items.some((i) => i.ref === extra.ref)) return null;
    const id = uid("t");
    set((items) => [...items, { id, text: t.slice(0, 500), done: false, createdAt: Date.now(), ...extra }]);
    return id;
  },
  toggle(id: string) {
    set((items) => items.map((i) => (i.id === id ? { ...i, done: !i.done, doneAt: !i.done ? Date.now() : undefined } : i)));
  },
  rename(id: string, text: string) {
    const t = text.trim();
    if (t) set((items) => items.map((i) => (i.id === id ? { ...i, text: t.slice(0, 500) } : i)));
  },
  remove(id: string) {
    set((items) => items.filter((i) => i.id !== id));
  },
  setReminder(id: string, at: number | undefined) {
    set((items) => items.map((i) => (i.id === id ? { ...i, remindAt: at, remindedAt: undefined } : i)));
  },
  clearDone() {
    set((items) => items.filter((i) => !i.done));
  },
  move(id: string, dir: -1 | 1) {
    set((items) => {
      const i = items.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= items.length) return items;
      const next = [...items];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  },
};

/** Open items in list order. */
export function openTodos(items: Todo[]): Todo[] {
  return items.filter((i) => !i.done);
}

/** Done today + open: what the ring shows. */
export function todayProgress(items: Todo[], now = Date.now()): { done: number; total: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const doneToday = items.filter((i) => i.done && (i.doneAt ?? 0) >= start.getTime()).length;
  const open = items.filter((i) => !i.done).length;
  return { done: doneToday, total: doneToday + open };
}

// ---- reminders ----------------------------------------------------------------------------------

function fire(id: string) {
  const item = useTodos.getState().items.find((i) => i.id === id);
  if (!item || item.done || !item.remindAt) return;
  set((items) => items.map((i) => (i.id === id ? { ...i, remindedAt: Date.now() } : i)));
  notify({
    kind: "todo",
    key: `todo:${id}`,
    title: item.text,
    body: "To-do reminder",
    icon: BellRing,
    sticky: true,
    actions: [
      { label: "Done", primary: true, run: () => todoActions.toggle(id) },
      { label: "In 10 min", run: () => todoActions.setReminder(id, Date.now() + 10 * 60_000) },
    ],
  });
}

function reschedule() {
  cancelPrefix("todo:");
  for (const i of useTodos.getState().items) {
    if (i.done || !i.remindAt || i.remindedAt) continue;
    scheduleAt(`todo:${i.id}`, i.remindAt, () => fire(i.id));
  }
}

let started = false;
export function startTodoReminders(): void {
  if (started || !runsBackground) return;
  started = true;
  let last = "";
  useTodos.subscribe((s) => {
    const sig = s.items.map((i) => `${i.id}:${i.done ? 1 : 0}:${i.remindAt ?? ""}:${i.remindedAt ?? ""}`).join("|");
    if (sig !== last) {
      last = sig;
      reschedule();
    }
  });
  reschedule();
}

export const SAMPLE_TODOS: Todo[] = [
  { id: "s1", text: "Send the Q4 invoice to Northwind", done: false, createdAt: 0 },
  { id: "s2", text: "Review Maya's pull request", done: false, createdAt: 0, remindAt: Date.now() + 2 * 3600_000 },
  { id: "s3", text: "Book dentist appointment", done: false, createdAt: 0 },
  { id: "s4", text: "Reply to the landlord", done: true, createdAt: 0, doneAt: Date.now() - 3600_000 },
  { id: "s5", text: "Stretch for ten minutes", done: true, createdAt: 0, doneAt: Date.now() - 7200_000 },
];

