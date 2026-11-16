import { AppWindow, Camera, Copy, FolderOpen, Monitor, SquareDashed } from "lucide-react";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, ErrorState, Section, Segmented, SettingRow, TextInput, Toggle } from "../../../ui";
import { openTarget, reveal } from "../shared/actions";
import { capture, fileName, useShots, type ScreenshotConfig } from "./shared";

export function ScreenshotCard({ config, setConfig, isSample, close }: CardProps<ScreenshotConfig>) {
  const last = useShots((s) => s.last);
  const busy = useShots((s) => s.busy);
  const error = useShots((s) => s.error);
  const take = (mode: "screen" | "window" | "region") => {
    // Close first so the card isn't in the picture.
    close();
    setTimeout(() => void capture(mode, config, isSample), 350);
  };
  return (
    <CardFrame title="Screenshot Capture" subtitle={config.save ? "Goes to a file and the clipboard" : "Clipboard only"} icon={Camera}>
      <div className="grid grid-cols-3 gap-2">
        {[
          { mode: "screen" as const, icon: Monitor, label: "Screen" },
          { mode: "window" as const, icon: AppWindow, label: "Window" },
          { mode: "region" as const, icon: SquareDashed, label: "Region" },
        ].map((b) => (
          <button
            key={b.mode}
            type="button"
            disabled={isSample || !!busy}
            className="g-press flex flex-col items-center gap-1.5 rounded-xl bg-input py-3 text-[12px] text-fg hover:bg-hover disabled:opacity-50"
            onClick={() => take(b.mode)}
          >
            <b.icon size={20} className="text-accent" />
            {b.label}
          </button>
        ))}
      </div>
      {error && <ErrorState className="mt-3" message={error} />}
      {last && (
        <Section title="Last capture" className="mt-3">
          <div className="py-3">
            {last.thumb && <img src={last.thumb} alt="" className="w-full rounded-lg border border-card-line" />}
            <div className="mt-2 truncate text-[12px] text-fg">{fileName(last.path) || "On the clipboard"}</div>
            <div className="text-[11px] text-dim">
              {last.width} × {last.height}
              {last.copied ? " · copied" : ""}
            </div>
            {last.path && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" icon={FolderOpen} onClick={() => reveal(last.path!)}>
                  Show in folder
                </Button>
                <Button size="sm" variant="ghost" icon={Copy} onClick={() => openTarget(last.path!)}>
                  Open
                </Button>
              </div>
            )}
          </div>
        </Section>
      )}
      <Section title="Options" className="mt-3">
        <SettingRow label="Save to a file">
          <Toggle checked={config.save} onChange={(save) => setConfig({ save })} label="Save to a file" />
        </SettingRow>
        <SettingRow label="Copy to the clipboard">
          <Toggle checked={config.clipboard || !config.save} disabled={!config.save} onChange={(clipboard) => setConfig({ clipboard })} label="Copy to the clipboard" />
        </SettingRow>
        <SettingRow label="Delay">
          <Segmented
            value={String(config.delay)}
            onChange={(v) => setConfig({ delay: Number(v) })}
            options={[
              { value: "0", label: "None" },
              { value: "3", label: "3 s" },
              { value: "5", label: "5 s" },
              { value: "10", label: "10 s" },
            ]}
          />
        </SettingRow>
        {config.save && (
          <div className="pb-3">
            <div className="mb-1 text-[12px] text-dim">Folder</div>
            <TextInput value={config.folder} placeholder="Pictures\Screenshots" onChange={(e) => setConfig({ folder: e.target.value })} />
          </div>
        )}
      </Section>
      <p className="text-[11.5px] leading-snug text-faint">Region hands over to the Windows snipping overlay, and the area you select is copied to the clipboard.</p>
    </CardFrame>
  );
}
