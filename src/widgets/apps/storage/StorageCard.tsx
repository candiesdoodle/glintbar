import { ExternalLink, FolderOpen, HardDrive, Usb } from "lucide-react";
import { useService } from "../../../core/backend";
import { bytes } from "../../../core/format";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, cx, ErrorState, ProgressBar, Section, Skeleton, Stat } from "../../../ui";
import { openTarget } from "../shared/actions";
import type { FolderSize } from "../types";
import { fullIn, pickDrive, usageColor, usedShare, useDrives, useForecast, type StorageConfig } from "./shared";

const GB = 1024 ** 3;
const SAMPLE_SIZES: FolderSize[] = [
  { name: "Videos", path: "", bytes: 61 * GB, approx: false },
  { name: "Downloads", path: "", bytes: 38.2 * GB, approx: false },
  { name: "Pictures", path: "", bytes: 24.5 * GB, approx: false },
  { name: "Documents", path: "", bytes: 12.8 * GB, approx: false },
];

export function StorageCard({ config, setConfig, isSample }: CardProps<StorageConfig>) {
  const { drives, history, error, refresh } = useDrives(isSample);
  const d = pickDrive(drives, config.root);
  const days = useForecast(d, history, isSample);
  const sizes = useService<FolderSize[]>("apps", "folder_sizes", { root: d?.root ?? "" }, { enabled: !isSample && !!d && d.kind === "fixed" });
  const folders = isSample ? SAMPLE_SIZES : (sizes.data ?? []);
  const share = d ? usedShare(d) : 0;
  const used = d ? d.total - d.free : 0;
  const topFolder = Math.max(1, ...folders.map((f) => f.bytes));
  return (
    <CardFrame
      title="Storage"
      subtitle={d ? `${d.label || "Local Disk"} (${d.letter}:) · ${d.fs}` : "Your drives"}
      icon={HardDrive}
      footer={
        <>
          <Button size="sm" icon={FolderOpen} disabled={!d} onClick={() => d && !isSample && openTarget(d.root)}>
            Open {d ? `${d.letter}:` : "drive"}
          </Button>
          <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => !isSample && openTarget("ms-settings:storagesense")}>
            Storage settings
          </Button>
        </>
      }
    >
      {drives && drives.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {drives.map((x) => (
            <button
              key={x.root}
              type="button"
              onClick={() => setConfig({ root: x.root })}
              className={cx(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors",
                x.root === d?.root ? "bg-accent text-on-accent" : "bg-input text-dim hover:text-fg",
              )}
            >
              {x.kind === "removable" ? <Usb size={13} /> : <HardDrive size={13} />}
              {x.letter}:
              <span className="opacity-75">{x.label || (x.kind === "removable" ? "USB" : "Disk")}</span>
            </button>
          ))}
        </div>
      )}
      {error && !drives && <ErrorState message="Your drive list could not be loaded." onRetry={refresh} />}
      {!drives && !error && <Skeleton className="h-24 w-full" />}
      {d && (
        <>
          <div className="flex items-end justify-between">
            <div className="text-[30px] leading-none font-semibold tabular-nums">{bytes(d.free, 1)}</div>
            <div className="pb-0.5 text-[12px] text-dim">free of {bytes(d.total, 0)}</div>
          </div>
          <ProgressBar className="mt-2.5" value={share * 100} color={usageColor(share)} height={10} />
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat label="Used" value={bytes(used, 0)} sub={`${Math.round(share * 100)}%`} />
            <Stat label="Free" value={bytes(d.free, 0)} />
            <Stat label="Current trend" value={fullIn(days) ? `${days} d` : "–"} sub={fullIn(days) ? "until full" : "not getting fuller"} />
          </div>
          {d.kind === "fixed" && (
            <Section title="User folder sizes" className="mt-4">
              <div className="space-y-2.5 py-3">
                {!isSample && sizes.loading && !sizes.data && [0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
                {!isSample && sizes.data && folders.length === 0 && <div className="text-[12px] text-dim">None of your user folders live on this drive.</div>}
                {folders.map((f) => (
                  <button key={f.name} type="button" className="block w-full text-left" onClick={() => f.path && !isSample && openTarget(f.path)}>
                    <div className="mb-1 flex items-baseline justify-between text-[12px]">
                      <span className="text-fg">{f.name}</span>
                      <span className="text-dim tabular-nums">
                        {f.approx ? "≥ " : ""}
                        {bytes(f.bytes, 1)}
                      </span>
                    </div>
                    <ProgressBar value={f.bytes} max={topFolder} height={5} color="var(--g-dim)" />
                  </button>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </CardFrame>
  );
}
