import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx, IconButton } from "../../ui";

/** A Monday-first month calendar with today marked; arrows move between months. */
export function MonthGrid({ today }: { today: Date }) {
  const [offset, setOffset] = useState(0);
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const isThisMonth = first.getFullYear() === today.getFullYear() && first.getMonth() === today.getMonth();
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));
  return (
    <div className="rounded-xl bg-input p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <IconButton icon={ChevronLeft} label="Previous month" onClick={() => setOffset((o) => o - 1)} />
        <button type="button" className="text-[13px] font-medium" onClick={() => setOffset(0)}>
          {first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </button>
        <IconButton icon={ChevronRight} label="Next month" onClick={() => setOffset((o) => o + 1)} />
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[11.5px] tabular-nums">
        {weekdays.map((d, i) => (
          <div key={i} className="pb-1 text-[10.5px] text-faint">
            {d}
          </div>
        ))}
        {cells.map((d, i) => (
          <div key={i} className="grid h-7 place-items-center">
            {d && <span className={cx("grid h-6 w-6 place-items-center rounded-full", isThisMonth && d === today.getDate() ? "bg-accent font-semibold text-on-accent" : "text-fg")}>{d}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
