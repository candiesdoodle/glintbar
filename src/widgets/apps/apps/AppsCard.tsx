import { LayoutGrid, Plus, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { call } from "../../../core/backend";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, Section, Segmented, SettingRow, Slider, Toggle } from "../../../ui";
import { AppIcon } from "../shared/AppIcon";
import { AppPicker } from "../shared/AppPicker";
import { hasPin, removePin } from "../shared/grouping";
import { SAMPLE_PINS } from "../shared/sample";
import { isGroup, type AppEntry, type Pin } from "../types";
import { updateAppearance, updateDockPrefs, updateGeneral } from "../../../settings/keys";
import { DEFAULT_APPS_CONFIG, PREF_ICON_SIZE, useAppsView, type AppsConfig, type AppStyle, type IconSize } from "./config";

function PinRow({ pin, onRemove }: { pin: Pin; onRemove: () => void }) {
  const group = isGroup(pin);
  return (
    <div className="group flex items-center gap-2.5 py-1.5">
      {group ? (
        <span className="grid h-5 w-5 place-items-center rounded-md bg-track text-[10px] font-semibold text-dim">{pin.items.length}</span>
      ) : (
        <AppIcon source={pin.icon} name={pin.name} kind={pin.kind} size={20} />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-fg">{pin.name}</div>
        {group && <div className="truncate text-[11px] text-dim">{pin.items.map((e) => e.name).join(", ")}</div>}
      </div>
      <button type="button" aria-label={`Unpin ${pin.name}`} className="grid h-6 w-6 place-items-center rounded-md text-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg" onClick={onRemove}>
        <X size={13} />
      </button>
    </div>
  );
}

export function AppsCard({ config: own, setConfig, isSample }: CardProps<AppsConfig>) {
  // Look and hover behaviour are app-wide settings (Settings > Appearance and Dock show the same).
  const config = useAppsView(own);
  const pins = isSample ? SAMPLE_PINS : (config.pins ?? []);
  const [adding, setAdding] = useState(false);
  const setPins = (next: Pin[]) => setConfig({ pins: next });
  const reset = () => {
    call<AppEntry[]>("apps", "taskbar_pins")
      .then((list) => setPins(list ?? []))
      .catch(() => {});
  };
  return (
    <CardFrame title="Apps" subtitle="Start button, pins and running apps" icon={LayoutGrid}>
      <Section title="Look">
        <SettingRow label="App icons">
          <Segmented<IconSize>
            value={config.iconSize}
            onChange={(iconSize) => updateAppearance({ appIconSize: PREF_ICON_SIZE[iconSize] })}
            options={[
              { value: "small", label: "Small" },
              { value: "medium", label: "Medium" },
              { value: "large", label: "Large" },
            ]}
          />
        </SettingRow>
        <SettingRow label="Show apps as">
          <Segmented<AppStyle>
            value={config.style}
            onChange={(style) => updateAppearance({ appCards: style === "cards" })}
            options={[
              { value: "cards", label: "Cards" },
              { value: "icons", label: "Icons" },
            ]}
          />
        </SettingRow>
        <SettingRow label="Names on hover">
          <Toggle checked={config.hoverNames} onChange={(hoverNames) => updateGeneral({ hoverNames })} label="Names on hover" />
        </SettingRow>
        <SettingRow label="Magnification" description="Icons get bigger under the mouse pointer.">
          <Toggle checked={config.magnify} onChange={(magnification) => updateDockPrefs({ magnification })} label="Magnification" />
        </SettingRow>
        {config.magnify && (
          <div className="flex items-center gap-3 pb-2.5">
            <span className="text-[11.5px] text-dim">Size</span>
            <Slider value={config.magnifyScale} min={1.2} max={2} step={0.05} onChange={(magnifyScale) => updateDockPrefs({ magnifyScale })} label="Magnification size" />
            <span className="w-9 text-right text-[11.5px] text-dim tabular-nums">{Math.round(config.magnifyScale * 100)}%</span>
          </div>
        )}
      </Section>
      <Section title="Behaviour">
        <SettingRow label="Window previews" description="Hover a running app for thumbnails of its windows.">
          <Toggle checked={config.previews} onChange={(windowPreviews) => updateDockPrefs({ windowPreviews })} label="Window previews" />
        </SettingRow>
        <SettingRow label="Start button">
          <Toggle checked={config.showStart} onChange={(showStart) => setConfig({ showStart })} label="Start button" />
        </SettingRow>
        <SettingRow label="Running apps without a pin">
          <Toggle checked={config.showRunning} onChange={(showRunning) => setConfig({ showRunning })} label="Running apps without a pin" />
        </SettingRow>
      </Section>
      <Section title={`Pinned (${pins.length})`}>
        <div className="py-1">
          {pins.length === 0 && <div className="py-2 text-[12px] text-dim">No pins yet. Add one with the button below, or drag a file, folder or app onto the dock.</div>}
          {pins.map((p) => (
            <PinRow key={p.id} pin={p} onRemove={() => setPins(removePin(pins, p.id))} />
          ))}
        </div>
        {adding && (
          <div className="pb-3">
            <AppPicker
              isSample={isSample}
              exclude={(e) => hasPin(pins, e.id)}
              onPick={(e) => {
                setPins([...pins, e]);
                setAdding(false);
              }}
            />
          </div>
        )}
      </Section>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={Plus} onClick={() => setAdding((a) => !a)}>
          {adding ? "Done" : "Add app or folder"}
        </Button>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset} disabled={isSample}>
          Use taskbar pins
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfig({ ...DEFAULT_APPS_CONFIG, pins: own.pins })}>
          Default options
        </Button>
      </div>
      <p className="mt-3 text-[11.5px] leading-snug text-faint">
        To group apps, drop one onto another. To unpin one, drag it off the dock. Shift-click starts another window, and right-click opens the app's jump list.
      </p>
    </CardFrame>
  );
}
