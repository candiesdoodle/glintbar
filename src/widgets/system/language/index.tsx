import { Check, Keyboard, Languages } from "lucide-react";
import { useState } from "react";
import { call, useTopic } from "../../../core/backend";
import { describeError } from "../../../core/http";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, EmptyState, ErrorState, ListRow, Skeleton, TileFrame } from "../../../ui";
import { fs } from "../shared/format";
import type { LanguageState } from "../shared/types";

function LanguageTile({ size }: TileProps) {
  const s = useTopic<LanguageState>("system", "language");
  const cur = s?.current;
  const big = Math.round(size * (size < 40 ? 0.32 : 0.3));
  return (
    <TileFrame padded={false} className="flex-col justify-center leading-none" title={cur ? `${cur.language}${cur.layout ? ` · ${cur.layout} keyboard` : ""}` : "Keyboard layout"}>
      {cur ? (
        <>
          <span className="font-semibold tracking-wide" style={{ fontSize: big }}>
            {cur.short}
          </span>
          {size >= 40 && cur.region && (
            <span className="mt-[3px] text-dim" style={{ fontSize: fs(size, 0.18, 8) }}>
              {cur.region}
            </span>
          )}
        </>
      ) : (
        <Languages size={Math.round(size * 0.4)} className="text-faint" />
      )}
    </TileFrame>
  );
}

function LanguageCard({ close }: CardProps) {
  const s = useTopic<LanguageState>("system", "language");
  const [error, setError] = useState<string | null>(null);
  const choose = (id: string) => {
    setError(null);
    call("system", "language_set", { id })
      .then(() => close())
      .catch((e) => setError(describeError(e)));
  };
  return (
    <CardFrame title="Keyboard" subtitle={s?.current ? s.current.language : "…"} icon={Keyboard}>
      {!s ? (
        <div className="flex flex-col gap-2 py-1">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : s.layouts.length === 0 ? (
        <EmptyState icon={Languages} title="No keyboard layouts" message="Windows returned no installed input languages." />
      ) : (
        <div className="-mx-2">
          {s.layouts.map((l) => (
            <ListRow
              key={l.id}
              leading={<span className="grid h-7 w-9 shrink-0 place-items-center rounded-md bg-input text-[11px] font-semibold tracking-wide">{l.short}</span>}
              title={l.language}
              subtitle={l.layout ? `${l.layout} keyboard` : undefined}
              right={s.current?.id === l.id ? <Check size={15} className="text-accent" /> : ""}
              onClick={() => choose(l.id)}
            />
          ))}
        </div>
      )}
      {error && <ErrorState className="mt-2" message={error} />}
      <p className="mt-2 px-1 text-[11px] text-faint">The change applies to the window you last typed in. Pressing Win + Space also cycles layouts.</p>
    </CardFrame>
  );
}

export default defineWidget({
  id: "system.language",
  name: "Language",
  category: "System",
  description: "The active keyboard layout, with a way to pick another.",
  keywords: ["keyboard", "layout", "input", "language", "switch", "ime"],
  icon: Languages,
  size: "s",
  Tile: LanguageTile,
  Card: LanguageCard,
  cardSize: { width: 300 },
});
