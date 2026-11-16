import { Clock, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, ListRow, Section, SettingRow, TextInput } from "../../../ui";
import type { SearchConfig } from "./index";
import { describeIntent, ENGINES, intentFor, type Engine } from "./logic";
import { runSearch } from "./run";

export function SearchCard({ config, setConfig, close, isSample }: CardProps<SearchConfig>) {
  const [text, setText] = useState("");
  const intent = intentFor(text, config.engine);
  const go = (value: string) => {
    const history = runSearch(value, config.engine, config.history, isSample);
    if (history) {
      setConfig({ history });
      setText("");
      close();
    }
  };
  return (
    <CardFrame title="Search" subtitle="Web search, websites and local folders" icon={Search}>
      <TextInput
        autoFocus
        value={text}
        placeholder="Type a search, a URL or C:\path…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go(text)}
      />
      <div className="mt-1 mb-3 h-4 px-1 text-[11px] text-faint">{describeIntent(intent, config.engine)}</div>
      <Section title="Search with">
        <SettingRow label="Engine">
          <select
            value={config.engine}
            onChange={(e) => setConfig({ engine: e.target.value as Engine })}
            className="h-7 rounded-lg border border-card-line bg-input px-2 text-[12.5px] text-fg outline-none"
          >
            {(Object.keys(ENGINES) as Engine[]).map((k) => (
              <option key={k} value={k}>
                {ENGINES[k].name}
              </option>
            ))}
          </select>
        </SettingRow>
      </Section>
      {config.history.length > 0 && (
        <Section title="Recent">
          <div className="-mx-2 py-1">
            {config.history.map((h) => (
              <ListRow key={h} icon={Clock} title={h} onClick={() => go(h)} />
            ))}
          </div>
        </Section>
      )}
      {config.history.length > 0 && (
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfig({ history: [] })}>
          Clear recent searches
        </Button>
      )}
    </CardFrame>
  );
}
