import { useState } from "react";
import { ExternalLink, FileText, FolderOpen, Power, RotateCw } from "lucide-react";
import iconUrl from "../../../assets/icon.svg";
import { call, useService } from "../../core/backend";
import { Button } from "../../ui/controls";
import { Group, Row } from "../parts";

interface AppInfo {
  name: string;
  version: string;
  dataDir: string;
  logFile: string;
  os?: string;
}

/** What ships inside GlintBar and under which licence (THIRD_PARTY_NOTICES.md has the details). */
const LIBRARIES: Array<[string, string]> = [
  ["Tauri", "Apache-2.0 or MIT"],
  ["windows-rs", "MIT or Apache-2.0"],
  ["React", "MIT"],
  ["zustand", "MIT"],
  ["Tailwind CSS", "MIT"],
  ["Lucide icons", "ISC"],
  ["Simple Icons", "CC0-1.0"],
  ["Rust crates (serde, tokio, reqwest, …)", "MIT / Apache-2.0"],
  ["SQLite", "Public domain"],
];

const SHORTCUTS: Array<[string, string]> = [
  ["Win + Alt + T", "Control the dock from the keyboard: arrow keys to move, Enter to open, Esc to exit"],
  ["Alt + T", "Opens your to-do list when the To-dos widget is on the dock"],
  ["Scroll on the dock", "Scrolls to widgets that don't fit on screen"],
];

const open = (target: string) => call("shell", "open", { target }).catch(() => {});

export function AboutPage() {
  const info = useService<AppInfo>("app", "info");
  const [notices, setNotices] = useState<string | null>(null);
  return (
    <>
      <div className="mb-5 flex flex-col items-center gap-2 rounded-[14px] border border-card-line bg-input px-4 py-6 text-center">
        <img src={iconUrl} alt="" className="h-16 w-16 drop-shadow-[0_6px_14px_rgba(0,0,0,0.25)]" draggable={false} />
        <div className="text-[19px] font-semibold tracking-tight text-fg">GlintBar</div>
        <div className="text-[12px] text-dim tabular-nums">Version {info.data?.version ?? "…"} · MIT licence</div>
        <p className="max-w-[340px] text-[12px] leading-snug text-dim">
          Live widgets on a Windows dock. GlintBar has no account, server or telemetry, and every widget connects directly to its own service.
        </p>
      </div>
      <Group title="Files" footer="These folders hold no keys or passwords. Those are stored in Windows Credential Manager.">
        <Row label="Settings and data" description={info.data?.dataDir}>
          <Button size="sm" icon={FolderOpen} onClick={() => call("app", "open_data_dir").catch(() => {})}>
            Open
          </Button>
        </Row>
        <Row label="Log files" description={info.data?.logFile}>
          <Button size="sm" icon={FileText} onClick={() => call("app", "open_logs").catch(() => {})}>
            Open
          </Button>
        </Row>
      </Group>
      <Group title="Keyboard">
        {SHORTCUTS.map(([keys, what]) => (
          <Row key={keys} label={keys} description={what} />
        ))}
      </Group>
      <Group title="Licences" footer="Weather data by Open-Meteo.com, licensed under CC BY 4.0.">
        <Row label="GlintBar" description="Copyright (c) 2026 The GlintBar Authors">
          <span className="text-[12px] text-dim">MIT</span>
        </Row>
        {LIBRARIES.map(([name, licence]) => (
          <Row key={name} label={name}>
            <span className="text-[12px] text-dim">{licence}</span>
          </Row>
        ))}
        <Row label="Third-party notices" description="Full licence texts and credits for code taken from other projects.">
          <Button
            size="sm"
            icon={FileText}
            onClick={() => {
              if (notices !== null) return setNotices(null);
              import("../../../THIRD_PARTY_NOTICES.md?raw").then((m) => setNotices(m.default)).catch(() => setNotices("The notices file failed to load."));
            }}
          >
            {notices === null ? "Show" : "Hide"}
          </Button>
        </Row>
        {notices !== null && <pre className="g-scroll-y mx-3.5 mb-3 max-h-[220px] overflow-y-auto rounded-lg bg-input p-3 text-[11px] leading-snug whitespace-pre-wrap text-dim">{notices}</pre>}
        <Row label="Open-Meteo" description="Weather and city search">
          <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => open("https://open-meteo.com/")}>
            open-meteo.com
          </Button>
        </Row>
      </Group>
      <div className="flex gap-2">
        <Button icon={RotateCw} onClick={() => call("app", "relaunch").catch(() => {})}>
          Restart GlintBar
        </Button>
        <Button variant="danger" icon={Power} onClick={() => call("app", "quit").catch(() => {})}>
          Quit GlintBar
        </Button>
      </div>
    </>
  );
}
