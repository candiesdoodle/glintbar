/**
 * Settings, laid out like a system settings window: a sidebar of sections and one page at a time.
 * Opens as a panel over the dock (ui.openPanel("settings", section)).
 */
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { Info, PanelBottom, Palette, Settings2, X, Zap } from "lucide-react";
import iconUrl from "../../assets/icon.svg";
import { useService } from "../core/backend";
import { Popover } from "../dock/Popover";
import { useDockUi } from "../dock/ui";
import { IconButton } from "../ui/controls";
import { cx } from "../ui/cx";
import { AboutPage } from "./pages/AboutPage";
import { AppearancePage } from "./pages/AppearancePage";
import { AutomationsPage } from "./pages/AutomationsPage";
import { DockPage } from "./pages/DockPage";
import { GeneralPage } from "./pages/GeneralPage";
import { IconTile } from "./parts";

export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
  colour: string;
  Page: ComponentType;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "general", label: "General", icon: Settings2, colour: "linear-gradient(180deg,#9a9aa2,#6e6e76)", Page: GeneralPage },
  { id: "dock", label: "Dock", icon: PanelBottom, colour: "linear-gradient(180deg,#3d9bff,#0a6cff)", Page: DockPage },
  { id: "appearance", label: "Appearance", icon: Palette, colour: "linear-gradient(180deg,#c56bff,#8a3ffc)", Page: AppearancePage },
  { id: "automations", label: "Automations", icon: Zap, colour: "linear-gradient(180deg,#ffb340,#ff8a00)", Page: AutomationsPage },
  { id: "about", label: "About", icon: Info, colour: "linear-gradient(180deg,#8e9bb0,#5d6a80)", Page: AboutPage },
];

const WIDTH = 800;
const HEIGHT = 560;

export function SettingsPanel() {
  const current = useDockUi((s) => s.settingsSection);
  const section = SETTINGS_SECTIONS.find((s) => s.id === current) ?? SETTINGS_SECTIONS[0];
  const info = useService<{ version: string }>("app", "info");
  const Page = section.Page;
  return (
    <Popover id="panel" anchor="center" width={WIDTH} maxHeight={HEIGHT} className="h-[560px]">
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-card-line bg-[color-mix(in_srgb,var(--g-input)_60%,transparent)] p-2.5" aria-label="Settings sections">
          <div className="mb-2 flex items-center gap-2.5 rounded-[10px] px-1.5 pt-1.5 pb-2.5">
            <img src={iconUrl} alt="" className="h-9 w-9" draggable={false} />
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-fg">GlintBar</div>
              <div className="text-[11px] text-dim tabular-nums">{info.data ? `Version ${info.data.version}` : "Settings"}</div>
            </div>
          </div>
          {SETTINGS_SECTIONS.map((s) => {
            const on = s.id === section.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => useDockUi.setState({ settingsSection: s.id })}
                className={cx("flex items-center gap-2.5 rounded-[8px] px-2 py-[7px] text-left text-[13px] transition-colors", on ? "bg-accent text-on-accent" : "text-fg hover:bg-hover")}
              >
                <IconTile icon={s.icon} colour={s.colour} />
                {s.label}
              </button>
            );
          })}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between px-6 pt-4 pb-3">
            <h2 className="text-[18px] font-semibold tracking-tight text-fg">{section.label}</h2>
            <IconButton icon={X} label="Close settings" onClick={() => useDockUi.setState({ panel: null })} />
          </header>
          <div key={section.id} className="g-scroll-y min-h-0 flex-1 overflow-y-auto px-6 pb-5">
            <Page />
          </div>
        </div>
      </div>
    </Popover>
  );
}
