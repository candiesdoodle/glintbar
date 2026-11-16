import { ChevronRight, Command as CommandGlyph } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useService } from "../../../core/backend";
import type { TileProps } from "../../../core/widget";
import { cx, TileFrame } from "../../../ui";
import { AppIcon } from "../shared/AppIcon";
import { anchorOf, closePopup, FloatingPanel, openPopup, usePopup } from "../shared/popups";
import { SAMPLE_APPS } from "../shared/sample";
import type { AppEntry } from "../types";
import { findCommands, type Match } from "./catalog";
import { CommandIcon } from "./CommandIcon";
import { runMatch } from "./run";

function label(m: Match): string {
  return m.kind === "app" ? m.app.name : m.command.title;
}

export function CommandsTile({ instanceId, size, isSample }: TileProps) {
  const [text, setText] = useState("");
  const [sel, setSel] = useState(0);
  const [armed, setArmed] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const installed = useService<AppEntry[]>("apps", "installed", undefined, { enabled: !isSample });
  const apps = isSample ? SAMPLE_APPS : (installed.data ?? []);
  const matches = useMemo(() => findCommands(text, apps, 7), [text, apps]);
  const open = usePopup((s) => s.open?.owner === instanceId && s.open.kind === "suggest");
  const font = Math.max(11, Math.round(size * 0.3));

  const update = (value: string) => {
    setText(value);
    setSel(0);
    setArmed(null);
    if (value.trim()) {
      if (!usePopup.getState().open || usePopup.getState().open?.owner !== instanceId) {
        openPopup({ kind: "suggest", owner: instanceId, key: "suggest", anchor: anchorOf(root.current) });
      }
    } else closePopup("suggest");
  };
  const run = (m: Match | undefined) => {
    if (!m) return;
    const id = m.kind === "command" ? m.command.id : m.app.id;
    if (m.kind === "command" && m.command.confirm && armed !== id) {
      setArmed(id);
      return;
    }
    runMatch(m, isSample);
    setText("");
    setArmed(null);
    closePopup("suggest");
    input.current?.blur();
  };

  return (
    <div ref={root} className="h-full w-full">
      <TileFrame className="gap-[calc(var(--tile-h)*0.12)]" title="Type a command">
        <CommandGlyph size={Math.round(size * 0.34)} className="shrink-0 text-dim" />
        <input
          ref={input}
          value={text}
          disabled={isSample}
          spellCheck={false}
          aria-label="Type a command"
          placeholder={size >= 40 ? "App or action" : "Command"}
          className="h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-faint"
          style={{ fontSize: font }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => update(e.target.value)}
          onBlur={() => setTimeout(() => !text && closePopup("suggest"), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(matches.length - 1, s + 1));
              setArmed(null);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
              setArmed(null);
            } else if (e.key === "Enter") run(matches[sel]);
            else if (e.key === "Escape") {
              update("");
              input.current?.blur();
            }
          }}
        />
      </TileFrame>
      {open && text.trim() && (
        <FloatingPanel id="apps-suggest" anchor={anchorOf(root.current)} width={300} className="py-1.5" keepOpenOn={() => root.current} onClose={() => update("")}>
          {matches.length === 0 && <div className="px-3.5 py-3 text-[12.5px] text-dim">No app or action called “{text.trim()}”.</div>}
          {matches.map((m, i) => {
            const id = m.kind === "command" ? m.command.id : m.app.id + m.app.target;
            const confirming = m.kind === "command" && armed === m.command.id;
            return (
              <button
                key={id}
                type="button"
                className={cx("mx-1.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left", i === sel ? "bg-accent/15" : "hover:bg-hover")}
                onPointerDown={(e) => e.preventDefault()}
                onMouseEnter={() => setSel(i)}
                onClick={() => run(m)}
              >
                {m.kind === "app" ? <AppIcon source={m.app.icon} name={m.app.name} size={22} /> : <CommandIcon name={m.command.icon} size={22} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-fg">{label(m)}</span>
                  <span className={cx("block truncate text-[11px]", confirming ? "text-warn" : "text-faint")}>
                    {confirming ? "Press Enter a second time to run it" : m.kind === "app" ? "App" : "Action"}
                  </span>
                </span>
                {i === sel && <ChevronRight size={14} className="shrink-0 text-faint" />}
              </button>
            );
          })}
        </FloatingPanel>
      )}
    </div>
  );
}
