/**
 * The widget picker's "Apps" section: every installed app (everything in Start). Click one to
 * pin it to the Apps tile, click it again to unpin it. Adds the Apps tile when it isn't on the
 * dock yet. Picked up by src/picker/WidgetPicker.tsx.
 */
import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useService } from "../../core/backend";
import { dockActions, useDock } from "../../dock/layout";
import { ErrorState } from "../../ui/States";
import { cx } from "../../ui/cx";
import { AppIcon } from "./shared/AppIcon";
import { hasPin, removePin } from "./shared/grouping";
import type { AppEntry, Pin } from "./types";

const APPS_WIDGET = "apps.apps";
const FIRST = 48;

export function PickerApps({ query }: { query: string }) {
  const installed = useService<AppEntry[]>("apps", "installed");
  const inst = useDock((s) => s.instances.find((i) => i.widgetId === APPS_WIDGET));
  const pins = (inst?.config.pins as Pin[] | undefined) ?? [];
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (installed.data ?? []).filter((e) => words.every((w) => e.name.toLowerCase().includes(w)));
  }, [installed.data, query]);

  const toggle = (e: AppEntry) => {
    if (!inst) {
      dockActions.add(APPS_WIDGET, { pins: [e] });
      return;
    }
    dockActions.setConfig(inst.instanceId, { pins: hasPin(pins, e.id) ? removePin(pins, e.id) : [...pins, e] });
  };

  if (installed.error) return <ErrorState message="Your installed apps couldn't be loaded." onRetry={installed.refresh} />;
  if (!installed.data) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-[42px] animate-pulse rounded-[10px] border border-card-line bg-input" />
        ))}
      </div>
    );
  }
  if (list.length === 0) return <p className="px-1 py-2 text-[12px] text-dim">{query.trim() ? `Nothing called “${query.trim()}” is installed.` : "No installed apps were found."}</p>;
  const shown = all || query.trim() ? list : list.slice(0, FIRST);
  return (
    <>
      <p className="mb-2 px-1 text-[11.5px] text-dim">Clicking an app adds it to the Apps tile. A second click removes it.</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {shown.map((e) => {
          const pinned = hasPin(pins, e.id);
          return (
            <button
              key={e.id + e.target}
              type="button"
              aria-pressed={pinned}
              title={pinned ? `Unpin ${e.name}` : `Pin ${e.name} to the dock`}
              onClick={() => toggle(e)}
              className={cx(
                "g-press group flex h-[42px] items-center gap-2.5 rounded-[10px] border px-2.5 text-left transition-colors",
                pinned ? "border-transparent ring-2 ring-accent" : "border-card-line bg-input hover:bg-hover",
              )}
              style={pinned ? { background: "var(--g-accent-soft)" } : undefined}
            >
              <AppIcon source={e.icon} name={e.name} kind={e.kind} size={22} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{e.name}</span>
              {pinned ? <Check size={13} strokeWidth={3} className="shrink-0 text-accent" /> : <Plus size={13} className="shrink-0 text-faint opacity-0 group-hover:opacity-100" />}
            </button>
          );
        })}
      </div>
      {!all && !query.trim() && list.length > FIRST && (
        <button type="button" className="mt-2 px-1 text-[12px] text-accent hover:underline" onClick={() => setAll(true)}>
          Show all {list.length} apps
        </button>
      )}
    </>
  );
}
