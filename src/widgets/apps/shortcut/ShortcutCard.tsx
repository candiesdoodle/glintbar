import { AppWindow, ExternalLink } from "lucide-react";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, Section } from "../../../ui";
import { launchEntry, reveal } from "../shared/actions";
import { AppIcon } from "../shared/AppIcon";
import { AppPicker } from "../shared/AppPicker";
import type { ShortcutConfig } from "./index";

export function ShortcutCard({ config, setConfig, isSample, close }: CardProps<ShortcutConfig>) {
  const e = config.entry;
  return (
    <CardFrame title={e ? e.name : "App or Folder"} subtitle={e ? "Opens on click; right-click the tile to pick something else" : "Choose an app, file or folder for this tile"} icon={AppWindow}>
      {e && (
        <div className="mb-3 flex items-center gap-3 rounded-xl bg-input px-3 py-2.5">
          <AppIcon source={e.icon} name={e.name} kind={e.kind} size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-fg">{e.name}</div>
            <div className="truncate text-[11px] text-dim">{e.target.replace(/^shell:AppsFolder\\/, "")}</div>
          </div>
          <Button size="sm" onClick={() => launchEntry(e)}>
            Open
          </Button>
        </div>
      )}
      <Section title={e ? "Change to" : "Choose"}>
        <div className="py-3">
          <AppPicker
            isSample={isSample}
            maxHeight={230}
            onPick={(entry) => {
              setConfig({ entry });
              close();
            }}
          />
        </div>
      </Section>
      {e && /^[a-z]:\\/i.test(e.target) && (
        <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => reveal(e.target)}>
          Show in File Explorer
        </Button>
      )}
    </CardFrame>
  );
}
