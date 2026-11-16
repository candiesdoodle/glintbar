import { Check, Disc3, Monitor, Palette } from "lucide-react";
import { useService } from "../../core/backend";
import { updateSettings, useSettings, type ThemeId } from "../../core/store";
import { ACCENTS, THEMES, ThemePreview, glassLook } from "../../appearance";
import { Segmented, Toggle } from "../../ui/controls";
import { cx } from "../../ui/cx";
import { updateAppearance, useAppearancePrefs, type IconSize, type WidgetStyle } from "../keys";
import { ChoiceCards, Group, Row } from "../parts";

interface GlassState {
  tier: string;
  reason?: string | null;
  resting?: boolean;
}

export function AppearancePage() {
  return (
    <>
      <ThemeGallery />
      <WidgetStyleGroup />
      <AccentGroup />
      <GlassGroup />
      <AppsGroup />
    </>
  );
}

function useUserAccent(): string | undefined {
  const accent = useSettings((s) => s.accent);
  const source = useAppearancePrefs((s) => s.accentSource);
  return source === "custom" && accent ? accent : undefined;
}

function ThemeGallery() {
  const theme = useSettings((s) => s.theme);
  const prefs = useAppearancePrefs();
  const accent = useUserAccent();
  const pick = (id: ThemeId) => {
    updateSettings({ theme: id });
    // Picking a theme by hand while following Windows changes the theme for the current mode.
    if (prefs.followSystem) {
      const light = THEMES.find((t) => t.id === id)?.light;
      updateAppearance(light ? { lightTheme: id } : { darkTheme: id });
    }
  };
  return (
    <>
      <h3 className="mb-1.5 px-1 text-[12px] font-semibold text-dim">Style</h3>
      <div className="mb-3 grid grid-cols-3 gap-2.5">
        {THEMES.map((t) => {
          const on = t.id === theme;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t.id)}
              aria-pressed={on}
              className={cx("g-press group relative overflow-hidden rounded-[12px] border text-left transition-shadow", on ? "border-transparent ring-2 ring-accent" : "border-card-line hover:ring-1 hover:ring-[var(--g-card-line)]")}
            >
              <ThemePreview theme={t.id} widgetStyle={t.id === "clear" ? prefs.widgetStyle : "frosted"} accent={accent} height={84} />
              <div className="flex items-start gap-2 bg-input px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-fg">{t.name}</div>
                  <div className="truncate text-[11px] text-dim">{t.blurb}</div>
                </div>
                {on && (
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
                    <Check size={10} strokeWidth={3.5} />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <Group>
        <Row label="Match Windows light and dark mode" info="Pick one style for light mode and one for dark, and GlintBar changes along with Windows (Settings > Personalisation > Colours).">
          <Toggle label="Match Windows light and dark mode" checked={prefs.followSystem} onChange={(v) => updateAppearance({ followSystem: v })} />
        </Row>
        {prefs.followSystem && (
          <Row label="In light mode">
            <ThemeSelect value={prefs.lightTheme} onChange={(v) => updateAppearance({ lightTheme: v })} />
          </Row>
        )}
        {prefs.followSystem && (
          <Row label="In dark mode">
            <ThemeSelect value={prefs.darkTheme} onChange={(v) => updateAppearance({ darkTheme: v })} />
          </Row>
        )}
      </Group>
    </>
  );
}

function ThemeSelect({ value, onChange }: { value: ThemeId; onChange: (v: ThemeId) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ThemeId)}
      className="h-7 rounded-[8px] border border-[var(--g-input-line)] bg-input px-2 text-[12.5px] text-fg outline-none"
    >
      {THEMES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

function WidgetStyleGroup() {
  const theme = useSettings((s) => s.theme);
  const style = useAppearancePrefs((s) => s.widgetStyle);
  const accent = useUserAccent();
  const options: Array<{ value: WidgetStyle; label: string }> = [
    { value: "black", label: "Black" },
    { value: "white", label: "White" },
    { value: "frosted", label: "Frosted glass" },
  ];
  return (
    <Group title="Widgets with Clear" footer={theme === "clear" ? undefined : "Applies only to the Clear style."}>
      <Row label="Widget style" info="The Clear style drops the bar, so every widget floats by itself on the desktop. Choose black or white tiles, or frosted glass." stacked>
        <ChoiceCards
          value={style}
          onChange={(v) => updateAppearance({ widgetStyle: v })}
          options={options.map((o) => ({
            ...o,
            preview: (
              <span className="block w-[150px]">
                <ThemePreview theme="clear" widgetStyle={o.value} accent={accent} height={58} />
              </span>
            ),
          }))}
        />
      </Row>
    </Group>
  );
}

function AccentGroup() {
  const accent = useSettings((s) => s.accent);
  const prefs = useAppearancePrefs();
  const custom = prefs.accentSource === "custom";
  const setCustom = (value: string) => {
    updateSettings({ accent: value });
    updateAppearance({ accentSource: "custom" });
  };
  return (
    <Group title="Accent colour" footer="The accent colours toggles, sliders, icons and selection highlights.">
      <Row label="Accent" info="Theme: the colour that comes with the style. Windows: your Windows accent colour. Custom: choose a swatch below or any colour.">
        <Segmented
          value={prefs.accentSource}
          options={[
            { value: "theme", label: "Theme" },
            { value: "windows", label: "Windows" },
            { value: "custom", label: "Custom" },
          ]}
          onChange={(v) => updateAppearance({ accentSource: v })}
        />
      </Row>
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
        {ACCENTS.map((a) => {
          const on = custom && accent.toLowerCase() === a.value;
          return (
            <button
              key={a.value}
              type="button"
              title={a.name}
              aria-label={a.name}
              aria-pressed={on}
              onClick={() => setCustom(a.value)}
              className={cx("g-press grid h-[26px] w-[26px] place-items-center rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]", on && "ring-2 ring-fg ring-offset-2 ring-offset-[var(--g-card)]")}
              style={{ background: a.value }}
            >
              {on && <Check size={13} strokeWidth={3} color={a.value === "#ffd60a" || a.value === "#63e6be" ? "#111" : "#fff"} />}
            </button>
          );
        })}
        <label
          className={cx("g-press relative grid h-[26px] w-[26px] cursor-pointer place-items-center overflow-hidden rounded-full", custom && !ACCENTS.some((a) => a.value === accent.toLowerCase()) && "ring-2 ring-fg ring-offset-2 ring-offset-[var(--g-card)]")}
          style={{ background: "conic-gradient(#ff453a, #ff9f0a, #ffd60a, #30d158, #40c8e0, #0a84ff, #bf5af2, #ff375f, #ff453a)" }}
          title="Any colour"
        >
          <Palette size={13} color="#fff" />
          <input type="color" aria-label="Any colour" value={accent || "#0a84ff"} onChange={(e) => setCustom(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
      </div>
      <Row label="Album art accent" info="Tints the accent from the cover of the song that is playing. Works with players that send cover art to Windows.">
        <span className="flex items-center gap-2">
          <Disc3 size={15} className="text-faint" />
          <Toggle label="Album art accent" checked={prefs.albumArtAccent} onChange={(v) => updateAppearance({ albumArtAccent: v })} />
        </span>
      </Row>
    </Group>
  );
}

const TIER_TEXT: Record<string, string> = {
  starting: "Starting…",
  capture: "Live: showing the screen behind the dock.",
  wallpaper: "Using your desktop picture.",
  plain: "Plain glass: GlintBar can't read the screen or the wallpaper.",
  paused: "Paused",
};
const REASON_TEXT: Record<string, string> = {
  fullscreen: "Paused: a full-screen app is on top.",
  hidden: "Paused: the dock is hidden.",
  "battery-saver": "Paused: battery saver is on.",
  locked: "Paused: the PC is locked.",
  "no-exclusion": "Using your desktop picture: this PC can't hide the dock from screen captures.",
};

function GlassGroup() {
  const theme = useSettings((s) => s.theme);
  const prefs = useAppearancePrefs();
  const hasGlass = glassLook(theme, prefs.widgetStyle) !== null;
  const state = useService<GlassState | null>("appearance", "glass_state", undefined, { refreshMs: 2000, enabled: hasGlass });
  const s = state.data;
  const statusText = !hasGlass
    ? "Live glass needs one of the glass styles (Glass, Midnight, Frosted Glass) or Clear with frosted widgets."
    : !prefs.liveGlass
      ? "Off: the glass uses your desktop picture and the dock is visible in screenshots and recordings."
      : s
        ? (s.reason && REASON_TEXT[s.reason]) ?? TIER_TEXT[s.tier] ?? s.tier
        : "Waiting for the first frame…";
  return (
    <Group title="Glass" footer={statusText}>
      <Row
        label="Live glass"
        info="Refracts and blurs the actual screen content behind the dock, open windows included, updating as it changes. When on, screenshots and screen recordings leave the dock out. When off, the glass uses your desktop picture."
      >
        <span className="flex items-center gap-2">
          <Monitor size={15} className="text-faint" />
          <Toggle label="Live glass" checked={prefs.liveGlass} onChange={(v) => updateAppearance({ liveGlass: v })} />
        </span>
      </Row>
      <Row label="Smoothness" info="The highest refresh rate for the glass when content behind it is moving. 60 fps looks smoother but costs slightly more power." disabled={!prefs.liveGlass}>
        <Segmented
          value={String(prefs.glassFps) as "30" | "60"}
          options={[
            { value: "30", label: "30 fps" },
            { value: "60", label: "60 fps" },
          ]}
          onChange={(v) => updateAppearance({ glassFps: v === "60" ? 60 : 30 })}
        />
      </Row>
      <Row
        label="Show behind the glass"
        info="Screen: the real screen content, windows and all. Wallpaper only: your desktop picture alone, and the dock stays visible in screenshots."
        disabled={!prefs.liveGlass}
      >
        <Segmented
          value={prefs.glassSource}
          options={[
            { value: "auto", label: "Screen" },
            { value: "wallpaper", label: "Wallpaper only" },
          ]}
          onChange={(v) => updateAppearance({ glassSource: v })}
        />
      </Row>
    </Group>
  );
}

function AppsGroup() {
  const prefs = useAppearancePrefs();
  return (
    <Group title="Apps on the dock">
      <Row label="App icon size" info="Sets the icon size for pinned apps, running apps and the Start button.">
        <Segmented
          value={prefs.appIconSize}
          options={[
            { value: "s" as IconSize, label: "Small" },
            { value: "m" as IconSize, label: "Medium" },
            { value: "l" as IconSize, label: "Large" },
          ]}
          onChange={(v) => updateAppearance({ appIconSize: v })}
        />
      </Row>
      <Row label="App cards" info="On: every app gets a tile behind it, like a widget. Off: apps show as bare icons on the bar.">
        <Toggle label="App cards" checked={prefs.appCards} onChange={(v) => updateAppearance({ appCards: v })} />
      </Row>
    </Group>
  );
}
