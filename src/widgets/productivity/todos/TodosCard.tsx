import { useState } from "react";
import { Bell, BellRing, ChevronDown, ChevronRight, ExternalLink, ListTodo, Trash2 } from "lucide-react";
import { call } from "../../../core/backend";
import { relativeTime, timeOfDay } from "../../../core/format";
import { useSettings } from "../../../core/store";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, cx, EmptyState, IconButton, SampleBadge, TextInput } from "../../../ui";
import { fromLocalInput, nextAt, sameDay, toLocalInput } from "../shared/time";
import { SAMPLE_TODOS, todayProgress, todoActions, useTodos, type Todo } from "./store";

export function TodosCard({ isSample }: CardProps) {
  const real = useTodos((s) => s.items);
  const items = isSample ? SAMPLE_TODOS : real;
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const p = todayProgress(items);

  const add = () => {
    if (isSample) return;
    if (todoActions.add(text)) setText("");
  };

  return (
    <CardFrame
      title="To-dos"
      icon={ListTodo}
      subtitle={`${open.length} open · ${p.done} done today · Alt+T to open`}
      actions={isSample ? <SampleBadge /> : undefined}
    >
      <form
        className="mb-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <TextInput autoFocus placeholder="Type a task and hit Enter" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        <Button type="submit" variant="primary" disabled={!text.trim()}>
          Add
        </Button>
      </form>

      {open.length === 0 ? (
        <EmptyState icon={ListTodo} title={done.length ? "All done" : "No tasks yet"} message={done.length ? "Every task on your list is checked off." : "Type a task above; the dock tile shows the first open one."} />
      ) : (
        <ul className="-mx-1">
          {open.map((t, idx) => (
            <TodoRow key={t.id} todo={t} first={idx === 0} last={idx === open.length - 1} readOnly={isSample} />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="mt-2 border-t border-card-line pt-2">
          <div className="flex items-center justify-between">
            <button type="button" className="flex items-center gap-1 text-[12px] text-dim hover:text-fg" onClick={() => setShowDone((v) => !v)}>
              {showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Completed ({done.length})
            </button>
            {showDone && !isSample && (
              <Button size="sm" variant="ghost" onClick={() => todoActions.clearDone()}>
                Clear
              </Button>
            )}
          </div>
          {showDone && (
            <ul className="-mx-1 mt-1">
              {done.slice(0, 50).map((t) => (
                <TodoRow key={t.id} todo={t} first last readOnly={isSample} />
              ))}
            </ul>
          )}
        </div>
      )}
    </CardFrame>
  );
}

function TodoRow({ todo, readOnly }: { todo: Todo; first: boolean; last: boolean; readOnly: boolean }) {
  const hour24 = useSettings((s) => s.clock24h);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.text);
  const [picking, setPicking] = useState(false);
  const pending = todo.remindAt && !todo.remindedAt && !todo.done;
  const when = todo.remindAt
    ? sameDay(todo.remindAt, Date.now())
      ? timeOfDay(new Date(todo.remindAt), { hour24 })
      : `${new Date(todo.remindAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${timeOfDay(new Date(todo.remindAt), { hour24 })}`
    : "";

  return (
    <li className="group rounded-lg px-1 hover:bg-hover">
      <div className="flex items-center gap-2 py-1.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={todo.done}
          aria-label={todo.done ? "Mark as not done" : "Mark as done"}
          disabled={readOnly}
          onClick={() => todoActions.toggle(todo.id)}
          className={cx("g-press grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2", todo.done ? "border-good bg-good text-white" : "border-track hover:border-accent")}
        >
          {todo.done && (
            <svg viewBox="0 0 12 12" width={10} height={10} aria-hidden>
              <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              className="w-full rounded bg-input px-1 text-[13px] text-fg outline-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                todoActions.rename(todo.id, draft);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setDraft(todo.text);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className={cx("block w-full truncate text-left text-[13px]", todo.done ? "text-faint line-through" : "text-fg")}
              onDoubleClick={() => !readOnly && !todo.done && setEditing(true)}
              title={readOnly || todo.done ? todo.text : "Double-click to change the text"}
            >
              {todo.text}
            </button>
          )}
          {(pending || todo.source || (todo.done && todo.doneAt)) && (
            <div className="flex items-center gap-1.5 text-[11px] text-dim">
              {pending && (
                <span className="inline-flex items-center gap-0.5 text-accent">
                  <BellRing size={11} /> {when}
                </span>
              )}
              {todo.source && <span>{todo.source}</span>}
              {todo.done && todo.doneAt && <span>Done {relativeTime(todo.doneAt)}</span>}
            </div>
          )}
        </div>
        {todo.url && <IconButton icon={ExternalLink} label="Open" size={14} onClick={() => call("shell", "open", { target: todo.url })} />}
        {!todo.done && !readOnly && (
          <IconButton icon={pending ? BellRing : Bell} label="Reminder" size={14} className={pending ? "text-accent" : "opacity-0 group-hover:opacity-100 focus:opacity-100"} onClick={() => setPicking((v) => !v)} />
        )}
        {!readOnly && <IconButton icon={Trash2} label="Delete" size={14} className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => todoActions.remove(todo.id)} />}
      </div>
      {picking && <ReminderPicker todo={todo} close={() => setPicking(false)} />}
    </li>
  );
}

function ReminderPicker({ todo, close }: { todo: Todo; close: () => void }) {
  const [custom, setCustom] = useState(() => toLocalInput(todo.remindAt ?? Date.now() + 3600_000));
  const setAt = (t: number) => {
    todoActions.setReminder(todo.id, t);
    close();
  };
  return (
    <div className="mb-2 ml-6 rounded-lg bg-input p-2">
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => setAt(Date.now() + 30 * 60_000)}>In 30 min</Button>
        <Button size="sm" onClick={() => setAt(Date.now() + 3600_000)}>In 1 hour</Button>
        <Button size="sm" onClick={() => setAt(nextAt(18))}>This evening</Button>
        <Button size="sm" onClick={() => setAt(nextAt(9) + (new Date().getHours() < 9 ? 86_400_000 : 0))}>Tomorrow 9:00</Button>
      </div>
      <div className="flex items-center gap-1.5">
        <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-7 min-w-0 flex-1 rounded-md border border-card-line bg-input px-1.5 text-[12px] text-fg outline-none focus:border-accent" />
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const t = fromLocalInput(custom);
            if (t && t > Date.now()) setAt(t);
          }}
        >
          Set
        </Button>
        {todo.remindAt && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              todoActions.setReminder(todo.id, undefined);
              close();
            }}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
