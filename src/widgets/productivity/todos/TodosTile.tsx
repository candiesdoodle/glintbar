import { Check, Plus } from "lucide-react";
import { useNow } from "../../../core/useVisible";
import type { TileProps } from "../../../core/widget";
import { Ring, TileFrame } from "../../../ui";
import { TileSampleBadge } from "../shared/TileBadge";
import { openTodos, SAMPLE_TODOS, todayProgress, todoActions, useTodos } from "./store";

export function TodosTile({ size, isSample }: TileProps) {
  const real = useTodos((s) => s.items);
  useNow("minute"); // "done today" rolls over at midnight
  const items = isSample ? SAMPLE_TODOS : real;
  const open = openTodos(items);
  const next = open[0];
  const { done, total } = todayProgress(items);
  const ring = Math.round(size * 0.7);
  const big = Math.max(11, Math.round(size * 0.3));
  const small = Math.max(9, Math.round(size * 0.22));
  const twoLines = size >= 64;

  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.16)]" title={next ? `Next: ${next.text}` : "To-dos"}>
      {isSample && <TileSampleBadge />}
      <button
        type="button"
        aria-label={next ? `Mark "${next.text}" done` : "All done"}
        title={next ? "Mark done" : undefined}
        className="g-press shrink-0 rounded-full"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (!next) return;
          e.stopPropagation();
          if (!isSample) todoActions.toggle(next.id);
        }}
      >
        <Ring value={done} max={Math.max(1, total)} size={ring} color={next ? "var(--g-accent)" : "var(--g-good)"}>
          {next ? (
            <span className="font-semibold tabular-nums" style={{ fontSize: Math.round(ring * 0.3) }}>
              {open.length}
            </span>
          ) : (
            <Check size={Math.round(ring * 0.42)} className="text-good" strokeWidth={2.5} />
          )}
        </Ring>
      </button>
      <div className="min-w-0 flex-1 leading-tight">
        <div className={"flex items-center gap-1 text-dim" + (isSample ? " pr-[30px]" : "")} style={{ fontSize: small }}>
          <span className="truncate">{next ? `${done} of ${total} done` : total ? "All done today" : "To-dos"}</span>
        </div>
        <div className={twoLines ? "line-clamp-2 font-medium" : "truncate font-medium"} style={{ fontSize: big }}>
          {next ? next.text : total ? "Nothing left" : (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-dim">
              <Plus size={big} /> Add a task
            </span>
          )}
        </div>
      </div>
    </TileFrame>
  );
}
