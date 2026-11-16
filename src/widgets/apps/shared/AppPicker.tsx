import { FolderPlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { call, useService } from "../../../core/backend";
import { ErrorState, Skeleton, TextInput } from "../../../ui";
import type { AppEntry } from "../types";
import { AppIcon } from "./AppIcon";
import { SAMPLE_APPS } from "./sample";

/** Search the installed apps (everything in Start), or type a folder/file path. */
export function AppPicker({
  onPick,
  isSample,
  exclude,
  maxHeight = 220,
}: {
  onPick: (e: AppEntry) => void;
  isSample?: boolean;
  exclude?: (e: AppEntry) => boolean;
  maxHeight?: number;
}) {
  const [q, setQ] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const installed = useService<AppEntry[]>("apps", "installed", undefined, { enabled: !isSample });
  const all = isSample ? SAMPLE_APPS : (installed.data ?? []);
  const looksLikePath = /^([a-z]:[\\/]|\\\\|%|~)/i.test(q.trim());
  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return all
      .filter((e) => !exclude?.(e))
      .filter((e) => words.every((w) => e.name.toLowerCase().includes(w)))
      .slice(0, 60);
  }, [all, q, exclude]);

  const addPath = () => {
    setPathError(null);
    call<AppEntry[]>("apps", "resolve", { paths: [q.trim()] })
      .then((r) => {
        if (r?.[0]) {
          onPick(r[0]);
          setQ("");
        } else setPathError("That path doesn't point to anything.");
      })
      .catch(() => setPathError("That path doesn't point to anything."));
  };

  return (
    <div>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
        <TextInput
          value={q}
          placeholder="Find an app or paste a path…"
          className="pl-8"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (looksLikePath) addPath();
            else if (list[0]) onPick(list[0]);
          }}
        />
      </div>
      {looksLikePath && (
        <button type="button" className="mt-1.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-fg hover:bg-hover" onClick={addPath}>
          <FolderPlus size={15} className="text-accent" />
          <span className="min-w-0 flex-1 truncate">Add “{q.trim()}”</span>
        </button>
      )}
      {pathError && <div className="mt-1 px-2 text-[11.5px] text-bad">{pathError}</div>}
      <div className="g-scroll-y mt-1.5 overflow-y-auto" style={{ maxHeight }}>
        {installed.error && !isSample && <ErrorState message="Your installed apps couldn't be loaded." onRetry={installed.refresh} />}
        {!isSample && installed.loading && !installed.data && (
          <div className="space-y-2 p-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )}
        {list.map((e) => (
          <button
            key={e.id + e.target}
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
            onClick={() => onPick(e)}
          >
            <AppIcon source={e.icon} name={e.name} kind={e.kind} size={20} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{e.name}</span>
          </button>
        ))}
        {(installed.data || isSample) && list.length === 0 && !looksLikePath && (
          <div className="py-4 text-center text-[12px] text-dim">Nothing called “{q}” is installed.</div>
        )}
      </div>
    </div>
  );
}
