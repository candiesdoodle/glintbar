import { Command as CommandGlyph } from "lucide-react";
import type { CardProps } from "../../../core/widget";
import { CardFrame, Section } from "../../../ui";
import { COMMANDS } from "./catalog";
import { CommandIcon } from "./CommandIcon";
import { runMatch } from "./run";

export function CommandsCard({ isSample, close }: CardProps) {
  return (
    <CardFrame title="Commands" subtitle="In the tile, type an app name or one of the actions below" icon={CommandGlyph}>
      <Section title="Actions">
        <div className="-mx-2 py-1">
          {COMMANDS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
              onClick={() => {
                if (c.confirm) return;
                runMatch({ kind: "command", command: c, score: 0 }, isSample);
                close();
              }}
            >
              <CommandIcon name={c.icon} size={22} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{c.title}</span>
              <span className="truncate text-[11px] text-faint">{c.confirm ? "run by typing" : c.words[0]}</span>
            </button>
          ))}
        </div>
      </Section>
      <p className="text-[11.5px] leading-snug text-faint">Choose a result with the arrow keys and press Enter. Shut down, restart, sleep and sign out need a second Enter.</p>
    </CardFrame>
  );
}
