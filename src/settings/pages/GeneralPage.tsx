import { useEffect, useRef, useState } from "react";
import { Download, FolderOpen, RotateCcw, Upload } from "lucide-react";
import { call, isTauri, useService } from "../../core/backend";
import { updateSettings, useSettings } from "../../core/store";
import { DEFAULT_DOCK, useDock } from "../../dock/layout";
import { Button, Segmented, Toggle } from "../../ui/controls";
import { ErrorState } from "../../ui/States";
import { updateGeneral, useGeneralPrefs } from "../keys";
import { Group, Row } from "../parts";
import { applySettingsFile, exportSettings, parseSettingsFile } from "../transfer";

export function GeneralPage() {
  return (
    <>
      <StartupGroup />
      <ClockGroup />
      <UnitsGroup />
      <LayoutGroup />
      <BackupGroup />
    </>
  );
}

function StartupGroup() {
  // Re-read whenever Settings opens or GlintBar gets focus: Task Manager can switch it off behind our back.
  const autostart = useService<boolean>("app", "autostart_get");
  const { refresh } = autostart;
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  const [busy, setBusy] = useState(false);
  return (
    <Group title="Startup">
      <Row label="Launch at startup" description="Opens GlintBar when you sign in to Windows. Mirrors the Startup apps list in Task Manager, so disabling GlintBar there turns this off.">
        <Toggle
          label="Launch at startup"
          checked={Boolean(autostart.data)}
          disabled={busy || (autostart.loading && autostart.data === undefined)}
          onChange={(v) => {
            setBusy(true);
            call<boolean>("app", "autostart_set", { enabled: v })
              .catch(() => {})
              .finally(() => {
                setBusy(false);
                refresh();
              });
          }}
        />
      </Row>
      {autostart.error && <ErrorState className="m-2" message="Windows didn't return the startup setting." onRetry={refresh} />}
    </Group>
  );
}

function ClockGroup() {
  const clock24h = useSettings((s) => s.clock24h);
  const showSeconds = useSettings((s) => s.showSeconds);
  return (
    <Group title="Clock">
      <Row label="Time format">
        <Segmented
          value={clock24h ? "24" : "12"}
          options={[
            { value: "12", label: "12-hour" },
            { value: "24", label: "24-hour" },
          ]}
          onChange={(v) => updateSettings({ clock24h: v === "24" })}
        />
      </Row>
      <Row label="Show seconds">
        <Toggle label="Show seconds" checked={showSeconds} onChange={(v) => updateSettings({ showSeconds: v })} />
      </Row>
    </Group>
  );
}

function UnitsGroup() {
  const g = useGeneralPrefs();
  return (
    <Group title="Units and names">
      <Row label="Measurements" description="Metric shows wind speed in km/h and Imperial in mph, in the weather widgets.">
        <Segmented
          value={g.units}
          options={[
            { value: "metric", label: "Metric" },
            { value: "imperial", label: "Imperial" },
          ]}
          onChange={(v) => updateGeneral({ units: v })}
        />
      </Row>
      <Row label="Temperature" description="Used by Weather, Clock & Weather, Today and the CPU temperature widget.">
        <Segmented
          value={g.temperature}
          options={[
            { value: "c", label: "°C" },
            { value: "f", label: "°F" },
          ]}
          onChange={(v) => updateGeneral({ temperature: v })}
        />
      </Row>
      <Row label="Names on hover" description="Hovering over an app or widget shows its name in a label above it.">
        <Toggle label="Names on hover" checked={g.hoverNames} onChange={(v) => updateGeneral({ hoverNames: v })} />
      </Row>
    </Group>
  );
}

function LayoutGroup() {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Group title="Layout">
      <Row label="Reset layout" description="Restores the starting set of widgets in their original order. Connected accounts and settings are kept.">
        <Button
          size="sm"
          variant={armed ? "danger" : "secondary"}
          icon={RotateCcw}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              timer.current = setTimeout(() => setArmed(false), 3000);
              return;
            }
            clearTimeout(timer.current);
            setArmed(false);
            useDock.setState({ instances: DEFAULT_DOCK.instances.map((i) => ({ ...i, config: {} })) });
          }}
        >
          {armed ? "Click again to confirm" : "Reset"}
        </Button>
      </Row>
    </Group>
  );
}

function BackupGroup() {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string; folder?: string } | null>(null);
  return (
    <Group title="Backup" footer="An export includes your layout, styles and widget settings. Keys and passwords stay in Windows Credential Manager and are never written to the file.">
      <Row label="Export settings" description="Writes all settings to one file that this PC or another one can import.">
        <Button
          size="sm"
          icon={Download}
          onClick={() => {
            setMessage(null);
            exportSettings()
              .then((r) => setMessage({ tone: "good", text: isTauri ? `Saved to ${r.path}` : `Downloaded ${r.path}`, folder: r.folder }))
              .catch((e) => setMessage({ tone: "bad", text: `Export failed: ${e instanceof Error ? e.message : String(e)}` }));
          }}
        >
          Export…
        </Button>
      </Row>
      <Row label="Import settings" description="Loads an exported file and overwrites the current settings with it.">
        <Button size="sm" icon={Upload} onClick={() => input.current?.click()}>
          Import…
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            f.text()
              .then((text) => {
                const n = applySettingsFile(parseSettingsFile(text));
                setMessage({ tone: "good", text: `Loaded ${n} setting groups from ${f.name}.` });
              })
              .catch((err) => setMessage({ tone: "bad", text: err instanceof Error ? err.message : String(err) }));
          }}
        />
      </Row>
      {message && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 text-[12px]">
          <span className={message.tone === "good" ? "min-w-0 flex-1 break-all text-good" : "min-w-0 flex-1 text-bad"}>{message.text}</span>
          {message.folder && (
            <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => call("shell", "open", { target: message.folder }).catch(() => {})}>
              Show
            </Button>
          )}
        </div>
      )}
    </Group>
  );
}

