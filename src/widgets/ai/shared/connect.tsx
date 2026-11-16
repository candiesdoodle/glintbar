/**
 * The connect screen for tiles that read a tool's own sign-in on this PC: what to do, what was
 * found, and "Check again". Nothing is typed in; the tile connects as soon as the sign-in is found.
 */
import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { setConnected } from "../../../core/connections";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, Spinner } from "../../../ui";
import { claudeLocalSource, isDetected, limitSource, openCodeSource } from "./data";
import { TOOLS } from "./tools";
import type { LimitTool } from "./types";

export function makeLocalConnect(widgetId: string, tool: LimitTool | "opencode", steps: string[], vendor: string) {
  return function LocalConnect(_: CardProps) {
    const [checking, setChecking] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const name = TOOLS[tool].name;

    const check = async () => {
      setChecking(true);
      try {
        const src = tool === "opencode" ? openCodeSource() : limitSource(tool);
        await src.refresh();
        const state = src.getState();
        const data = state.data as { status?: string; message?: string | null } | undefined;
        let found = isDetected(data?.status);
        if (!found && tool === "claude") {
          // Not signed in, but Claude Code has history here: the tile can still count tokens.
          const local = claudeLocalSource();
          await local.refresh();
          found = Boolean(local.getState().data?.found && local.getState().data?.series.length);
        }
        if (found) {
          setConnected(widgetId, true);
          return;
        }
        setMessage(data?.message ?? (state.error ? "The check didn't go through. Give it a moment and retry." : null));
      } finally {
        setChecking(false);
      }
    };

    useEffect(() => {
      void check();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <CardFrame title={`Connect ${name}`} subtitle="Showing a sample until GlintBar finds your login" icon={LogIn}>
        <div className="flex flex-col gap-3">
          <ol className="list-decimal space-y-1 pl-5 text-[12px] leading-snug text-dim">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {message && <div className="rounded-lg bg-warn/10 px-3 py-2.5 text-[12px] leading-snug text-fg">{message}</div>}
          <div className="flex items-center justify-end gap-2">
            {checking && <Spinner />}
            <Button variant="primary" onClick={() => void check()} disabled={checking}>
              {checking ? "Checking…" : "Check again"}
            </Button>
          </div>
          <p className="text-[11px] leading-snug text-faint">
            GlintBar reads what {name}'s tool saved on this PC and never changes it. It is shared with {vendor} only. To disconnect, sign out in that tool.
          </p>
        </div>
      </CardFrame>
    );
  };
}
