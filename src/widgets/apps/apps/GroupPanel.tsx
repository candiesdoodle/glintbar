import { Ungroup } from "lucide-react";
import { useState } from "react";
import type { Anchor } from "../../../dock/ui";
import { Button, TextInput } from "../../../ui";
import { activate } from "../shared/actions";
import { buildDockApps, type DockApp } from "../shared/grouping";
import { FloatingPanel, usePopup } from "../shared/popups";
import type { PinGroup, WindowInfo } from "../types";
import { AppVisual } from "./AppVisual";
import type { AppStyle, Metrics } from "./config";

/** An app group, opened: its apps (click to open or switch), its name, and Ungroup. */
export function GroupPanel({
  group,
  windows,
  anchor,
  m,
  style,
  onRename,
  onUngroup,
  onStack,
  keepOpenOn,
}: {
  group: PinGroup;
  windows: WindowInfo[];
  anchor: Anchor;
  m: Metrics;
  style: AppStyle;
  onRename: (name: string) => void;
  onUngroup: () => void;
  onStack: (app: DockApp) => void;
  keepOpenOn?: () => Element | null;
}) {
  const [name, setName] = useState(group.name);
  const apps = buildDockApps(group.items, windows, { showRunning: false });
  const cell = Math.max(40, Math.min(56, Math.round(m.height * 1.05)));
  const gm: Metrics = { height: cell, slot: cell, icon: Math.round(cell * 0.66), gap: 6, pad: 0 };
  const cols = Math.min(4, Math.max(2, apps.length));
  return (
    <FloatingPanel id="apps-group" anchor={anchor} width={cols * (cell + 26) + 28} keepOpenOn={keepOpenOn} className="p-3">
      <TextInput
        value={name}
        aria-label="Group name"
        className="mb-2.5 h-7 border-transparent bg-transparent text-center text-[13.5px] font-semibold"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => onRename(name.trim() || "Apps")}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <div
        className="grid gap-x-2 gap-y-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, ["--g-radius-tile" as string]: `${Math.round(cell * 0.27)}px` }}
      >
        {apps.map((a) => (
          <button
            key={a.key}
            type="button"
            className="g-press flex flex-col items-center gap-1 rounded-lg py-1 hover:bg-hover"
            onClick={() => {
              const next = activate(a);
              if (next === "stack") onStack(a);
              else usePopup.setState({ open: null });
            }}
          >
            <AppVisual app={a} m={gm} style={style} />
            <span className="w-full truncate px-0.5 text-center text-[11px] text-fg">{a.name}</span>
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex justify-center">
        <Button
          size="sm"
          variant="ghost"
          icon={Ungroup}
          onClick={() => {
            usePopup.setState({ open: null });
            onUngroup();
          }}
        >
          Ungroup
        </Button>
      </div>
    </FloatingPanel>
  );
}
