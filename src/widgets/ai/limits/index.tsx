import { Gauge } from "lucide-react";
import { useSettings } from "../../../core/store";
import { useNow } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, ProgressBar, Section, SampleBadge, cx } from "../../../ui";
import { useLimitTool } from "../shared/data";
import { pct, resetAt, resetIn, resetShort, usageColor } from "../shared/format";
import { LIMIT_TOOLS, TOOLS } from "../shared/tools";
import { AiTileFrame, Glyph, tightest, tileProblem } from "../shared/ui";
import type { LimitTool } from "../shared/types";

interface LimitsConfig extends Record<string, unknown> {
  first: LimitTool;
  second: LimitTool;
}

function Half({ tool, size, isSample, now }: { tool: LimitTool; size: number; isSample: boolean; now: number }) {
  const view = useLimitTool(tool, isSample || tool === "grok" || tool === "cursor");
  const r = view.data;
  const problem = tileProblem(r, r ? undefined : view.error);
  const l = tightest(r?.limits ?? []);
  const big = Math.round(size * 0.3);
  const small = Math.max(7.5, Math.round(size * 0.2));
  return (
    <div className="flex min-w-0 flex-1 items-center" style={{ gap: Math.round(size * 0.12) }} title={l ? `${TOOLS[tool].name} ${l.label}: ${pct(l.usedPct)}${l.resetsAt ? `, resets in ${resetIn(l.resetsAt, now)}` : ""}` : TOOLS[tool].name}>
      <Glyph tool={tool} size={Math.round(size * 0.34)} className="text-dim" />
      <div className="min-w-0 leading-none">
        {problem || !l ? (
          <div className={cx("truncate", problem?.tone === "warn" ? "text-warn" : "text-faint")} style={{ fontSize: small }}>
            {problem?.short ?? (view.loading ? "…" : "–")}
          </div>
        ) : (
          <>
            <div className="font-semibold tabular-nums" style={{ fontSize: big, color: l.usedPct >= 70 ? usageColor(l.usedPct) : undefined }}>
              {pct(l.usedPct)}
            </div>
            <div className="mt-[2px] truncate text-faint tabular-nums" style={{ fontSize: small }}>
              {l.resetsAt ? `↻ ${resetShort(l.resetsAt, now)}` : l.label}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LimitsTile({ config, size, isSample }: TileProps<LimitsConfig>) {
  const now = useNow("minute").getTime();
  return (
    <AiTileFrame sample={isSample}>
      <Half tool={config.first} size={size} isSample={isSample} now={now} />
      <div className="h-[55%] w-px shrink-0 bg-track" />
      <Half tool={config.second} size={size} isSample={isSample} now={now} />
    </AiTileFrame>
  );
}

function ToolSection({ tool, isSample, now, hour24 }: { tool: LimitTool; isSample: boolean; now: number; hour24: boolean }) {
  const preview = tool === "grok" || tool === "cursor";
  const view = useLimitTool(tool, isSample || preview);
  const r = view.data;
  const problem = tileProblem(r, r ? undefined : view.error);
  const meta = TOOLS[tool];
  return (
    <Section>
      <div className="flex items-center gap-2 pt-2.5 pb-1">
        <Glyph tool={tool} size={15} className="text-dim" />
        <span className="text-[13px] font-medium text-fg">{meta.name}</span>
        {r?.plan && <span className="truncate text-[11.5px] text-faint">{r.plan}</span>}
        <span className="flex-1" />
        {(isSample || preview) && <SampleBadge />}
      </div>
      {problem || !r?.limits.length ? (
        <div className="pb-2.5 text-[12px] leading-snug text-dim">
          {r?.message ?? (problem ? problem.text : view.loading ? "Checking…" : "No limits yet.")}
        </div>
      ) : (
        <div className="space-y-2 pt-1 pb-3">
          {r.limits.map((l) => (
            <div key={l.window}>
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="text-dim">{l.label}</span>
                <span className="font-semibold tabular-nums" style={{ color: l.usedPct >= 70 ? usageColor(l.usedPct) : undefined }}>
                  {pct(l.usedPct)}
                </span>
              </div>
              <ProgressBar className="mt-1" value={l.usedPct} color={usageColor(l.usedPct)} height={5} />
              <div className="mt-1 text-[11px] text-faint">
                {l.resetsAt ? `Resets in ${resetIn(l.resetsAt, now)} · ${resetAt(l.resetsAt, now, hour24)}` : "Begins when you next use it"}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function Picker({ label, value, onChange }: { label: string; value: LimitTool; onChange: (t: LimitTool) => void }) {
  return (
    <div className="py-2">
      <div className="mb-1.5 text-[12px] text-dim">{label}</div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {LIMIT_TOOLS.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={t === value}
            onClick={() => onChange(t)}
            className={cx(
              "g-press flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] transition-colors",
              t === value ? "bg-accent text-on-accent" : "bg-input text-dim hover:text-fg",
            )}
          >
            <Glyph tool={t} size={12} />
            {TOOLS[t].name}
          </button>
        ))}
      </div>
    </div>
  );
}

function LimitsCard({ config, setConfig, isSample }: CardProps<LimitsConfig>) {
  const now = useNow("minute").getTime();
  const hour24 = useSettings((s) => s.clock24h);
  const order = [config.first, config.second, ...LIMIT_TOOLS.filter((t) => t !== config.first && t !== config.second)];
  return (
    <CardFrame title="AI Limits" subtitle="Usage and refill times for each tool" icon={Gauge}>
      {order.map((t) => (
        <ToolSection key={t} tool={t} isSample={isSample} now={now} hour24={hour24} />
      ))}
      <Section title="On the tile">
        <Picker label="Left" value={config.first} onChange={(first) => setConfig({ first })} />
        <Picker label="Right" value={config.second} onChange={(second) => setConfig({ second })} />
        <div className="pb-2.5 text-[11px] leading-snug text-faint">
          Set up each tool from its own tile (Claude Usage, ChatGPT Usage, GLM Usage…). Tools that use a login already on this PC appear here automatically.
        </div>
      </Section>
    </CardFrame>
  );
}

/** Two AI plans on one tile, every plan's limits in the card. */
export default defineWidget<LimitsConfig>({
  id: "ai.limits",
  name: "AI Limits",
  category: "AI",
  description: "Two AI subscriptions side by side, e.g. Claude next to ChatGPT.",
  keywords: ["claude", "chatgpt", "codex", "gemini", "grok", "cursor", "glm", "limits", "quota", "reset"],
  icon: Gauge,
  size: "l",
  Tile: LimitsTile,
  Card: LimitsCard,
  cardSize: { width: 340, height: 620 },
  defaultConfig: { first: "claude", second: "chatgpt" },
});
