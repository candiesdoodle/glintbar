import { useEffect, useRef } from "react";
import { Pin, PinOff, Plus, StickyNote, Trash2 } from "lucide-react";
import { relativeTime } from "../../../core/format";
import type { CardProps } from "../../../core/widget";
import { CardFrame, cx, IconButton, SampleBadge } from "../../../ui";
import { MAX_NOTE, noteActions, noteTitle, SAMPLE_NOTES, sortNotes, useNotes } from "./store";

export function NotesCard({ isSample }: CardProps) {
  const realNotes = useNotes((s) => s.notes);
  const realActive = useNotes((s) => s.activeId);
  const notes = sortNotes(isSample ? SAMPLE_NOTES : realNotes);
  const activeId = isSample ? notes[0]?.id : realActive && notes.some((n) => n.id === realActive) ? realActive : notes[0]?.id;
  const active = notes.find((n) => n.id === activeId);
  const area = useRef<HTMLTextAreaElement>(null);

  // A first visit gets an empty note to type into.
  useEffect(() => {
    if (!isSample && useNotes.getState().notes.length === 0) noteActions.create();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = area.current;
    if (el && !isSample) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [activeId, isSample]);

  return (
    <CardFrame
      title="Notes"
      icon={StickyNote}
      subtitle={active ? `Edited ${relativeTime(active.updatedAt)} · stored on this PC` : "Stored on this PC only"}
      actions={
        <>
          {isSample && <SampleBadge />}
          <IconButton icon={Plus} label="New note" onClick={() => !isSample && noteActions.create()} />
        </>
      }
    >
      <div className="flex h-[300px] gap-2">
        <ul className="g-scroll-y w-[128px] shrink-0 overflow-y-auto">
          {notes.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => !isSample && noteActions.select(n.id)}
                className={cx("mb-0.5 w-full rounded-lg px-2 py-1.5 text-left", n.id === activeId ? "bg-accent/15" : "hover:bg-hover")}
              >
                <div className="flex items-center gap-1">
                  {n.pinned && <Pin size={10} className="shrink-0 text-accent" />}
                  <span className={cx("truncate text-[12.5px]", n.id === activeId ? "font-medium text-fg" : "text-fg")}>{noteTitle(n)}</span>
                </div>
                <div className="truncate text-[10.5px] text-faint">{relativeTime(n.updatedAt)}</div>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 flex-1 flex-col rounded-xl bg-input">
          {active ? (
            <>
              <textarea
                ref={area}
                value={active.text}
                readOnly={isSample}
                maxLength={MAX_NOTE}
                placeholder="Write something…"
                onChange={(e) => noteActions.update(active.id, e.target.value)}
                className="g-scroll-y min-h-0 flex-1 resize-none bg-transparent p-3 text-[13px] leading-relaxed text-fg outline-none placeholder:text-faint"
                spellCheck
              />
              <div className="flex items-center justify-between border-t border-card-line px-2 py-1">
                <span className="text-[10.5px] text-faint tabular-nums">{active.text.length.toLocaleString()} characters</span>
                <div className="flex">
                  <IconButton icon={active.pinned ? PinOff : Pin} label={active.pinned ? "Unpin" : "Pin to top"} size={14} onClick={() => !isSample && noteActions.togglePin(active.id)} />
                  <IconButton icon={Trash2} label="Delete note" size={14} onClick={() => !isSample && noteActions.remove(active.id)} />
                </div>
              </div>
            </>
          ) : (
            <button type="button" className="m-auto text-[12px] text-dim" onClick={() => noteActions.create()}>
              Create a note
            </button>
          )}
        </div>
      </div>
    </CardFrame>
  );
}
