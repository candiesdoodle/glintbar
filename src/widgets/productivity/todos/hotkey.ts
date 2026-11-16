/**
 * Alt+T opens the to-do card from anywhere. The shell slice registers the global hotkey and emits
 * `svc://shell/hotkey` with the hotkey's name ("todo"); inside the dock window Alt+T also works.
 */
import { ListTodo } from "lucide-react";
import { notify } from "../../../automations/alerts";
import { on } from "../../../core/backend";
import { isTest, WINDOW_LABEL } from "../shared/env";
import { openWidgetCard } from "../shared/openCard";

function hotkeyName(p: unknown): string | undefined {
  if (typeof p === "string") return p;
  if (p && typeof p === "object") {
    const o = p as { name?: unknown; id?: unknown };
    if (typeof o.name === "string") return o.name;
    if (typeof o.id === "string") return o.id;
  }
  return undefined;
}

export function openTodoCard(): void {
  if (openWidgetCard("productivity.todos")) return;
  notify({ kind: "todo", key: "todo-hotkey", title: "Todos is not on the dock", body: "Put the Todos widget on the dock and Alt+T will open your list.", icon: ListTodo, silent: true });
}

let started = false;
export function startTodoHotkey(): void {
  if (started || isTest || typeof window === "undefined") return;
  started = true;
  on<unknown>("shell", "hotkey", (p) => {
    if (hotkeyName(p) !== "todo") return;
    // The shell names the dock under the pointer; other docks ignore the press.
    const label = p && typeof p === "object" ? (p as { label?: unknown }).label : undefined;
    if (typeof label === "string" && label && label !== WINDOW_LABEL) return;
    openTodoCard();
  });
  window.addEventListener("keydown", (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyT") {
      e.preventDefault();
      openTodoCard();
    }
  });
}
