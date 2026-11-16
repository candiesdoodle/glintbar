import { CornerDownLeft, Folder, Globe, Search } from "lucide-react";
import { useState } from "react";
import type { TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import type { SearchConfig } from "./index";
import { describeIntent, intentFor } from "./logic";
import { runSearch } from "./run";

export function SearchTile({ config, setConfig, size, isSample }: TileProps<SearchConfig>) {
  const [text, setText] = useState("");
  const intent = intentFor(text, config.engine);
  const font = Math.max(11, Math.round(size * 0.3));
  const Icon = intent?.kind === "path" ? Folder : intent?.kind === "url" ? Globe : Search;
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.12)]" title={describeIntent(intent, config.engine) || "Web search or a path to open"}>
      <Icon size={Math.round(size * 0.36)} className="shrink-0 text-dim" />
      <input
        value={text}
        disabled={isSample}
        spellCheck={false}
        aria-label="Search or enter a path"
        placeholder={size >= 40 ? "Search or path" : "Search"}
        className="h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-faint"
        style={{ fontSize: font }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setText("");
            (e.target as HTMLInputElement).blur();
          }
          if (e.key !== "Enter") return;
          const history = runSearch(text, config.engine, config.history, isSample);
          if (history) {
            setConfig({ history });
            setText("");
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {text && <CornerDownLeft size={Math.round(size * 0.28)} className="shrink-0 text-faint" />}
    </TileFrame>
  );
}
