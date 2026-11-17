import { dockActions, SIZE_PRESETS, SIZE_RANGE, useDock, type SizePreset } from "../../dock/layout";
import { Segmented, Toggle } from "../../ui/controls";
import { dockAlign, updateDockPrefs, useDockPrefs, type DockAlign, type TaskbarMode } from "../keys";
import { Group, RangeRow, Row } from "../parts";

/** px -> the preset it matches, or "custom". */
function presetFor(px: number): SizePreset {
  return (Object.entries(SIZE_PRESETS).find(([, v]) => v === px)?.[0] ?? "custom") as SizePreset;
}

export function DockPage() {
  const d = useDock();
  const p = useDockPrefs();
  const setSize = (px: number) => dockActions.update({ sizePx: px, sizePreset: presetFor(px) });
  // Older layouts only know hideTaskbar: show "Leave it alone" when it is off.
  const taskbar: TaskbarMode = !d.hideTaskbar && p.taskbarMode === "hidden" ? "leave" : p.taskbarMode;
  const setTaskbar = (mode: TaskbarMode) => {
    updateDockPrefs({ taskbarMode: mode });
    dockActions.update({ hideTaskbar: mode === "hidden" });
  };

  return (
    <>
      <Group title="Size">
        <Row label="Size" info="S matches the height of the Windows taskbar and L is meant for large or high-DPI screens. For any other height, use the Height slider below.">
          <Segmented
            value={d.sizePreset}
            options={[
              { value: "s" as SizePreset, label: "S" },
              { value: "m" as SizePreset, label: "M" },
              { value: "l" as SizePreset, label: "L" },
              ...(d.sizePreset === "custom" ? [{ value: "custom" as SizePreset, label: `${d.sizePx}px` }] : []),
            ]}
            onChange={(v) => v !== "custom" && setSize(SIZE_PRESETS[v])}
          />
        </Row>
        <RangeRow label="Height" info="Sets the widget height. The dock resizes live while you move the slider." value={d.sizePx} min={SIZE_RANGE.min} max={SIZE_RANGE.max} onChange={setSize} />
      </Group>

      <Group title="Spacing">
        <RangeRow label="Spacing" info="Space left between neighbouring widgets." value={d.spacing} min={0} max={24} onChange={(v) => dockActions.update({ spacing: v })} />
        <RangeRow label="Padding" info="Room inside the dock around its widgets." value={d.padding} min={0} max={16} onChange={(v) => dockActions.update({ padding: v })} />
        <RangeRow
          label="Distance from edge"
          info="Leaves a gap between the dock and the screen edge. At 0 the dock touches the edge."
          value={d.distance}
          min={0}
          max={40}
          onChange={(v) => dockActions.update({ distance: v })}
        />
      </Group>

      <Group title="Position">
        <Row label="Screen edge" info="Choose which edge holds the dock. Cards and menus always open toward the centre.">
          <Segmented
            value={d.edge}
            options={[
              { value: "bottom", label: "Bottom" },
              { value: "top", label: "Top" },
            ]}
            onChange={(v) => dockActions.update({ edge: v })}
          />
        </Row>
        <Row label="Full width" info="Stretch the dock across the full screen width, as the taskbar does. Off, the bar is centred and only as wide as its widgets.">
          <Toggle label="Full width" checked={d.fullWidth} onChange={(v) => dockActions.update({ fullWidth: v })} />
        </Row>
        {d.fullWidth && (
          <Row
            label="Align widgets"
            info="Choose where widgets line up on a full-width dock. Fill: widgets stretch to span the whole bar (Apps keeps its width). If there are too many to fit, they begin at the left and you can scroll."
          >
            <Segmented
              value={dockAlign(p.fullWidthAlign)}
              options={[
                { value: "left" as DockAlign, label: "Left" },
                { value: "center" as DockAlign, label: "Center" },
                { value: "right" as DockAlign, label: "Right" },
                { value: "fill" as DockAlign, label: "Fill" },
              ]}
              onChange={(v) => updateDockPrefs({ fullWidthAlign: v })}
            />
          </Row>
        )}
        <Row
          label="Displays"
          info="Main: one dock, on your primary display. All: each display gets its own dock with its own reserved space. Follow: one dock that jumps to another display when you rest the pointer at its edge."
        >
          <Segmented
            value={p.displays}
            options={[
              { value: "main", label: "Main" },
              { value: "all", label: "All" },
              { value: "follow", label: "Follow" },
            ]}
            onChange={(v) => updateDockPrefs({ displays: v })}
          />
        </Row>
        <Row label="Lock dock" info="Stops the dock from being dragged to another edge. Widgets can be rearranged only with the Widgets picker open.">
          <Toggle label="Lock dock" checked={p.lockDock} onChange={(v) => updateDockPrefs({ lockDock: v })} />
        </Row>
      </Group>

      <Group title="Behaviour">
        <Row label="Auto-hide" info="Hides the dock until you push the pointer against its screen edge or press the Windows key.">
          <Toggle label="Auto-hide" checked={d.autoHide} onChange={(v) => dockActions.update({ autoHide: v })} />
        </Row>
        <Row label="Show on desktop" info="Needs auto-hide. The dock stays visible while you look at the bare desktop with no window on top." disabled={!d.autoHide}>
          <Toggle label="Show on desktop" checked={p.showOnDesktop} onChange={(v) => updateDockPrefs({ showOnDesktop: v })} />
        </Row>
        <Row label="Magnification" info="App icons get bigger under the pointer as you move along the dock.">
          <Toggle label="Magnification" checked={p.magnification} onChange={(v) => updateDockPrefs({ magnification: v })} />
        </Row>
        <RangeRow
          label="Magnified size"
          info="The largest size an icon reaches, as a percentage of its normal size."
          value={Math.round(p.magnifyScale * 100)}
          min={120}
          max={200}
          step={5}
          format={(v) => `${v}%`}
          disabled={!p.magnification}
          onChange={(v) => updateDockPrefs({ magnifyScale: v / 100 })}
        />
        <Row label="Window previews" info="Hover over a running app to get a preview of each of its windows.">
          <Toggle label="Window previews" checked={p.windowPreviews} onChange={(v) => updateDockPrefs({ windowPreviews: v })} />
        </Row>
      </Group>

      <Group title="Windows taskbar" footer="No Windows files are modified. When GlintBar quits, your taskbar returns to its previous state.">
        <Row label="Taskbar" info="Hidden: GlintBar hides the taskbar for as long as it runs. Auto-hide: GlintBar turns on the taskbar's built-in auto-hide. Leave it alone: no change to the taskbar.">
          <Segmented
            value={taskbar}
            options={[
              { value: "hidden", label: "Hidden" },
              { value: "autohide", label: "Auto-hide" },
              { value: "leave", label: "Leave it alone" },
            ]}
            onChange={setTaskbar}
          />
        </Row>
        <Row label="Keep windows clear of the dock" info="Reserves the dock's strip, so maximised windows end where the dock begins.">
          <Toggle label="Keep windows clear of the dock" checked={d.reserveSpace} onChange={(v) => dockActions.update({ reserveSpace: v })} />
        </Row>
      </Group>
    </>
  );
}
