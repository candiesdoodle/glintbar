import { useTopic } from "../../../core/backend";
import { bytes } from "../../../core/format";
import type { RecycleInfo } from "../types";

export const SAMPLE_BIN: RecycleInfo = { count: 23, bytes: Math.round(1.4 * 1024 ** 3) };

/** The bin, live (Rust checks every few seconds while a tile shows it). */
export function useBin(isSample: boolean): RecycleInfo | undefined {
  const live = useTopic<RecycleInfo>("apps", "recycle", { enabled: !isSample });
  return isSample ? SAMPLE_BIN : live;
}

/** 0..1: how full the bin looks (log scale, 4 GB looks full). */
export function fullness(info: RecycleInfo | undefined): number {
  if (!info || info.count === 0) return 0;
  const mb = info.bytes / 1024 ** 2;
  return Math.min(1, Math.max(0.12, Math.log10(1 + mb) / Math.log10(1 + 4096)));
}

export function describeBin(info: RecycleInfo | undefined): string {
  if (!info) return "…";
  if (info.count === 0) return "Empty";
  return `${info.count} item${info.count === 1 ? "" : "s"} · ${bytes(info.bytes)}`;
}

/** A bin that fills up with what's in it. */
export function BinArt({ size, fill, active }: { size: number; fill: number; active?: boolean }) {
  const h = 30 * fill;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <clipPath id="glintbar-bin-body">
          <path d="M11 15h26l-2.4 25.2A4 4 0 0 1 30.6 44H17.4a4 4 0 0 1-4-3.8z" />
        </clipPath>
      </defs>
      <path d="M11 15h26l-2.4 25.2A4 4 0 0 1 30.6 44H17.4a4 4 0 0 1-4-3.8z" fill="var(--g-track)" />
      <g clipPath="url(#glintbar-bin-body)">
        <rect x="8" y={44 - h} width="32" height={h} fill="var(--g-accent)" opacity={0.85} style={{ transition: "y 500ms ease, height 500ms ease" }} />
        {fill > 0 && (
          <>
            <rect x="15" y={44 - h + 3} width="6" height="5" rx="1.2" fill="var(--g-on-accent)" opacity="0.45" transform={`rotate(-12 18 ${44 - h + 5})`} />
            <rect x="25" y={44 - h + 6} width="7" height="4" rx="1.2" fill="var(--g-on-accent)" opacity="0.35" transform={`rotate(9 28 ${44 - h + 8})`} />
          </>
        )}
      </g>
      <path d="M11 15h26l-2.4 25.2A4 4 0 0 1 30.6 44H17.4a4 4 0 0 1-4-3.8z" fill="none" stroke="var(--g-dim)" strokeWidth="2" />
      <path d="M19.5 22v15M24 22v15M28.5 22v15" stroke="var(--g-dim)" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
      <g style={{ transform: active ? "rotate(-14deg)" : "none", transformOrigin: "9px 12px", transition: "transform 200ms ease" }}>
        <rect x="8" y="10" width="32" height="4" rx="2" fill="var(--g-dim)" />
        <path d="M20 10V8a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" fill="none" stroke="var(--g-dim)" strokeWidth="2" />
      </g>
    </svg>
  );
}
