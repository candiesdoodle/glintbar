import { StickyNote } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { NotesTile } from "./NotesTile";

export default defineWidget({
  id: "productivity.notes",
  name: "Notes",
  category: "Productivity",
  description: "Shows your most recent note on the tile; click it to keep writing.",
  keywords: ["note", "notepad", "scratchpad", "memo", "text"],
  icon: StickyNote,
  size: "l",
  multiple: false,
  Tile: NotesTile,
  Card: lazyPart(() => import("./NotesCard").then((m) => m.NotesCard)),
  cardSize: { width: 420 },
});
