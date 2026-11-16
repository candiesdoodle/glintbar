import { StickyNote } from "lucide-react";
import { relativeTime } from "../../../core/format";
import { useNow } from "../../../core/useVisible";
import type { TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../shared/TileBadge";
import { latestNote, noteSnippet, noteTitle, SAMPLE_NOTES, useNotes } from "./store";

export function NotesTile({ size, isSample }: TileProps) {
  const real = useNotes((s) => s.notes);
  const now = useNow("minute");
  const note = latestNote(isSample ? SAMPLE_NOTES : real);
  const big = Math.max(11, Math.round(size * 0.29));
  const small = Math.max(9, Math.round(size * 0.22));
  const icon = Math.round(size * 0.42);
  const snippet = note ? noteSnippet(note) : "";
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.16)]" title={note ? noteTitle(note) : "Notes"}>
      {isSample && <TileSampleBadge />}
      <div className="grid shrink-0 place-items-center rounded-[28%] bg-warn/15 text-warn" style={{ width: Math.round(size * 0.7), height: Math.round(size * 0.7) }}>
        <StickyNote size={icon} />
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className={"truncate font-medium" + (isSample ? " pr-[30px]" : "")} style={{ fontSize: big }}>
          {note ? noteTitle(note) : "New note"}
        </div>
        <div className="flex items-center gap-1 text-dim" style={{ fontSize: small }}>
          <span className="truncate">{note ? snippet || `Edited ${relativeTime(note.updatedAt, now)}` : "Click to write"}</span>
        </div>
      </div>
    </TileFrame>
  );
}
