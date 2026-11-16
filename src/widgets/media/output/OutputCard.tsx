import { useState } from "react";
import { Check, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import { call, useService } from "../../../core/backend";
import { describeError } from "../../../core/http";
import type { CardProps } from "../../../core/widget";
import { Button, CardFrame, cx, EmptyState, ErrorState, IconButton, ListRow, Section, Skeleton, Slider } from "../../../ui";
import { FillSlider } from "../../../ui/FillSlider";
import { SAMPLE_APPS, SAMPLE_OUTPUTS } from "../samples";
import { AppGlyph, useAudio } from "../shared";
import type { AppVolume, AudioDevice } from "../types";
import { deviceIcon, openSoundSettings, setMuted, setVolume, useOptimistic, volumeIcon } from "../volume";

export function OutputCard({ isSample }: CardProps) {
  const audio = useAudio(isSample);
  const out = audio?.output ?? null;
  const [volume, changeVolume] = useOptimistic(out?.volume, (v) => {
    if (!isSample) setVolume(v);
  });
  const vol = Math.round(volume ?? 0);
  const muted = Boolean(out?.muted);
  const Icon = volumeIcon(vol, muted);

  const apps = useService<AppVolume[]>("media", "apps", undefined, { refreshMs: 3000, enabled: !isSample });
  const outputs = useService<AudioDevice[]>("media", "outputs", undefined, { refreshMs: 15_000, enabled: !isSample });
  const appList = isSample ? SAMPLE_APPS : apps.data;
  const outList = isSample ? SAMPLE_OUTPUTS : outputs.data;
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const pick = async (d: AudioDevice) => {
    if (isSample || d.isDefault) return;
    setSwitching(d.id);
    setSwitchError(null);
    try {
      await call("media", "set_output", { id: d.id });
      outputs.refresh();
      apps.refresh();
    } catch (e) {
      setSwitchError(`Switching to ${d.name} failed. ${describeError(e)}`);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <CardFrame
      title="Sound"
      subtitle={out ? [out.name, out.detail].filter(Boolean).join(" · ") : audio === undefined ? "…" : "No output device"}
      icon={Volume2}
      footer={
        <>
          <Button size="sm" variant="ghost" icon={SlidersHorizontal} onClick={() => openSoundSettings("apps-volume")}>
            Volume mixer
          </Button>
          <span className="flex-1" />
          <Button size="sm" onClick={() => openSoundSettings("sound")}>
            Sound settings
          </Button>
        </>
      }
    >
      {audio !== undefined && !out ? (
        <EmptyState icon={VolumeX} title="No speakers or headphones" message="Windows sees no playback device. Connect speakers or headphones, or switch them on." />
      ) : (
        <div className="mb-3 flex items-center gap-2">
          <FillSlider
            label="Volume"
            value={vol}
            height={44}
            icon={<Icon size={18} />}
            trailing={muted ? "Muted" : `${vol}%`}
            color={muted ? "var(--g-faint)" : "var(--g-accent)"}
            onChange={changeVolume}
          />
          <IconButton
            icon={muted ? VolumeX : Volume2}
            label={muted ? "Unmute" : "Mute"}
            className={cx("h-11 w-11 shrink-0 rounded-[14px]", muted ? "bg-bad/15 text-bad" : "bg-track")}
            size={18}
            onClick={() => {
              if (!isSample) setMuted(!muted).catch(() => {});
            }}
          />
        </div>
      )}

      {(out || audio === undefined || isSample) && (
      <>
      <Section title="Apps">
        {!appList ? (
          apps.error ? (
            <ErrorState className="my-2" message="GlintBar could not load per-app volumes." onRetry={apps.refresh} />
          ) : (
            <div className="space-y-2 py-2.5">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-4/5" />
            </div>
          )
        ) : appList.length === 0 ? (
          <div className="py-3 text-[12px] text-dim">No apps are playing sound at the moment.</div>
        ) : (
          <div className="py-1">
            {appList.map((a) => (
              <AppRow key={a.key} app={a} isSample={isSample} onChanged={apps.refresh} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Output" className="mb-0">
        <div className="-mx-2 py-1">
          {!outList ? (
            <div className="px-2 py-2.5">
              <Skeleton className="h-5 w-3/4" />
            </div>
          ) : outList.length === 0 ? (
            <div className="px-2 py-2.5 text-[12px] text-dim">Windows lists no output devices.</div>
          ) : (
            outList.map((d) => {
              const DIcon = deviceIcon(d.name, d.detail);
              return (
                <ListRow
                  key={d.id}
                  leading={<DIcon size={16} className={cx("shrink-0", d.isDefault ? "text-accent" : "text-dim")} />}
                  title={d.name}
                  subtitle={d.detail || undefined}
                  right={switching === d.id ? "…" : d.isDefault ? <Check size={16} className="text-accent" /> : ""}
                  onClick={() => void pick(d)}
                />
              );
            })
          )}
        </div>
        {switchError && <ErrorState className="mb-2" message={switchError} />}
      </Section>
      </>
      )}
    </CardFrame>
  );
}

function AppRow({ app, isSample, onChanged }: { app: AppVolume; isSample: boolean; onChanged: () => void }) {
  const [muted, setLocalMuted] = useState<boolean | null>(null);
  const [volume, change] = useOptimistic(app.volume, (v) => {
    if (!isSample) call("media", "set_app_volume", { ids: app.ids, volume: v }).catch(() => onChanged());
  });
  const isMuted = muted ?? app.muted;
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-track">
        {app.system ? <Volume2 size={15} className="text-dim" /> : <AppGlyph appId={app.exe} appName={app.name} size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cx("truncate text-[12.5px]", app.active ? "text-fg" : "text-dim")}>{app.name}</span>
          <span className="shrink-0 text-[11px] text-faint tabular-nums">{isMuted ? "Muted" : `${Math.round(volume ?? 0)}%`}</span>
        </div>
        <Slider label={`${app.name} volume`} value={Math.round(volume ?? 0)} onChange={change} className={cx("-my-0.5", isMuted && "opacity-50")} />
      </div>
      <IconButton
        icon={isMuted ? VolumeX : Volume2}
        label={isMuted ? `Unmute ${app.name}` : `Mute ${app.name}`}
        className={isMuted ? "text-bad" : undefined}
        size={15}
        onClick={() => {
          const next = !isMuted;
          setLocalMuted(next);
          if (!isSample)
            call("media", "set_app_volume", { ids: app.ids, muted: next })
              .then(onChanged)
              .catch(() => onChanged())
              .finally(() => setTimeout(() => setLocalMuted(null), 400));
        }}
      />
    </div>
  );
}
