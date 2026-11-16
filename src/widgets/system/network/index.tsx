import { ArrowDown, ArrowUp, Cable, Network, Signal, Wifi } from "lucide-react";
import { useService, useTopic } from "../../../core/backend";
import { bytes } from "../../../core/format";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { CardFrame, ErrorState, ListRow, Section, Stat, TileFrame } from "../../../ui";
import { fs, linkSpeed, rate, rateParts } from "../shared/format";
import { NetChart, niceMax } from "../shared/NetChart";
import type { Adapter, NetSample } from "../shared/types";

function NetTile({ size }: TileProps) {
  const s = useTopic<NetSample>("system", "network");
  const d = rateParts(s?.down ?? 0);
  const u = rateParts(s?.up ?? 0);
  const big = fs(size, 0.25, 9);
  const small = fs(size, 0.17, 7);
  const icon = Math.max(8, Math.round(size * 0.2));
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.14)]" title={s ? `Download ${rate(s.down)}\nUpload ${rate(s.up)}` : "Network"}>
      <div className="flex shrink-0 flex-col justify-center gap-[3px] leading-none" style={{ minWidth: size * 0.95 }}>
        <div className="flex items-baseline gap-[3px]">
          <ArrowDown size={icon} className="self-center text-accent" strokeWidth={2.6} />
          <span className="font-semibold tabular-nums" style={{ fontSize: big }}>
            {s ? d.value : "–"}
          </span>
          <span className="text-dim" style={{ fontSize: small }}>
            {d.unit}
          </span>
        </div>
        <div className="flex items-baseline gap-[3px]">
          <ArrowUp size={icon} className="self-center text-dim" strokeWidth={2.6} />
          <span className="font-semibold tabular-nums text-dim" style={{ fontSize: big }}>
            {s ? u.value : "–"}
          </span>
          <span className="text-faint" style={{ fontSize: small }}>
            {u.unit}
          </span>
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-hidden rounded-[6px]">
        <NetChart down={s?.downHistory ?? []} up={s?.upHistory ?? []} at={s?.at} slots={24} height={Math.round(size * 0.62)} />
      </div>
    </TileFrame>
  );
}

function kindIcon(kind: Adapter["kind"]) {
  if (kind === "wifi") return Wifi;
  if (kind === "ethernet") return Cable;
  if (kind === "cellular") return Signal;
  return Network;
}

function NetCard(_: CardProps) {
  const s = useTopic<NetSample>("system", "network");
  const adapters = useService<Adapter[]>("system", "network_adapters", undefined, { refreshMs: 15_000 });
  const hist = [...(s?.downHistory ?? []), ...(s?.upHistory ?? [])];
  const peakDown = s?.downHistory.length ? Math.max(...s.downHistory) : undefined;
  const peakUp = s?.upHistory.length ? Math.max(...s.upHistory) : undefined;
  const scale = niceMax(hist.length ? Math.max(...hist) : 0);
  const active = (adapters.data ?? []).filter((a) => a.up);
  const received = active.reduce((n, a) => n + a.received, 0);
  const sent = active.reduce((n, a) => n + a.sent, 0);
  return (
    <CardFrame title="Network" subtitle={active.length ? active.map((a) => a.name).join(", ") : adapters.loading ? "…" : "Not connected"} icon={Network}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1 text-[11px] text-dim">
            <ArrowDown size={12} className="text-accent" /> Download
          </div>
          <div className="text-[26px] leading-tight font-semibold tabular-nums">{s ? rate(s.down) : "–"}</div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-[11px] text-dim">
            <ArrowUp size={12} /> Upload
          </div>
          <div className="text-[26px] leading-tight font-semibold tabular-nums text-dim">{s ? rate(s.up) : "–"}</div>
        </div>
      </div>
      <div className="relative mt-3 overflow-hidden rounded-xl bg-input px-2 py-2">
        <NetChart down={s?.downHistory ?? []} up={s?.upHistory ?? []} at={s?.at} slots={60} height={90} grid />
        <div className="pointer-events-none absolute top-1.5 right-2.5 text-[10px] text-faint tabular-nums">{rate(scale)}</div>
        <div className="pointer-events-none absolute top-1.5 left-2.5 text-[10px] text-faint">Last minute</div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Peak down" value={peakDown === undefined ? "–" : rate(peakDown)} />
        <Stat label="Peak up" value={peakUp === undefined ? "–" : rate(peakUp)} />
        <Stat label="Since start-up" value={active.length ? bytes(received + sent) : "–"} sub={active.length ? `${bytes(received)} down` : undefined} />
      </div>
      <Section title="Adapters" className="mt-4 mb-0">
        <div className="-mx-2 py-1">
          {(adapters.data ?? []).map((a) => (
            <ListRow
              key={a.name}
              icon={kindIcon(a.kind)}
              title={a.name}
              subtitle={a.description}
              right={a.up ? <span className="text-good">{linkSpeed(a.linkBps) || "Connected"}</span> : <span className="text-faint">Off</span>}
            />
          ))}
          {adapters.data?.length === 0 && <div className="px-2 py-2 text-[12px] text-dim">Windows reports no network adapters.</div>}
        </div>
      </Section>
      {adapters.error && <ErrorState className="mt-3" message="GlintBar could not list the network adapters." onRetry={adapters.refresh} />}
    </CardFrame>
  );
}

export default defineWidget({
  id: "system.network",
  name: "Network",
  category: "System",
  description: "Live download and upload speeds beside a scrolling chart.",
  keywords: ["internet", "speed", "bandwidth", "download", "upload", "wifi", "ethernet"],
  icon: Network,
  size: "l",
  Tile: NetTile,
  Card: NetCard,
  cardSize: { width: 360 },
});
