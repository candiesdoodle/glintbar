import { useEffect, useState, type CSSProperties } from "react";
import { Check, ChevronRight, Image as ImageIcon, RefreshCw } from "lucide-react";
import { call } from "../../../core/backend";
import { useStored } from "../../../core/store";
import { useInterval } from "../../../core/useVisible";
import { defineWidget, type CardProps, type TileProps } from "../../../core/widget";
import { Button, CardFrame, ErrorState, Section, Segmented, SettingRow, Spinner, TileFrame, cx } from "../../../ui";
import { disconnectAccount, makeConnect } from "../../finance/shared/account";
import { AccountFooter, TileSampleBadge } from "../../finance/shared/kit";
import { errorMessage, usePolled } from "../../finance/shared/poll";
import { CURRENT_KEY, DEFAULT_ROTATION, ROTATION_KEY, SAMPLE_PHOTOS, TOPICS, applyPhoto, rotateIfDue, searchPhotos, wallpaperAccount, type Current, type Photo, type Rotation } from "./api";

function WallpaperTile({ size, isSample }: TileProps) {
  const [current] = useStored<Current | null>(CURRENT_KEY, null);
  // Rotation check: on show, then every 30 minutes while the tile is visible.
  useInterval(() => void rotateIfDue().catch(() => {}), isSample ? null : 30 * 60_000);
  useEffect(() => {
    if (!isSample) void rotateIfDue().catch(() => {});
  }, [isSample]);
  const bg = isSample ? SAMPLE_PHOTOS[0].css : current ? `url("${current.thumb}") center / cover` : undefined;
  const small = Math.max(9, Math.round(size * 0.22));
  return (
    <TileFrame padded={false} title={current ? `Photo by ${current.author} on Unsplash` : "Pick a wallpaper from Unsplash"}>
      <div className="absolute inset-0" style={{ background: bg ?? "var(--g-tile)" }} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
      <div className="relative flex h-full w-full flex-col justify-between px-[calc(var(--tile-h)*0.16)] py-[calc(var(--tile-h)*0.1)]">
        <div className="flex justify-end">{isSample && <TileSampleBadge size={size} />}</div>
        <div className="flex items-center gap-[0.3em] text-white" style={{ fontSize: small }}>
          <ImageIcon size={Math.round(small * 1.15)} className="shrink-0" />
          <span className="truncate font-medium drop-shadow">Wallpapers</span>
        </div>
      </div>
    </TileFrame>
  );
}

function Thumb({ style, alt, selected, busy, done, onClick, src }: { style?: CSSProperties; src?: string; alt: string; selected: boolean; busy: boolean; done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={alt}
      className={cx("g-press relative aspect-[16/10] overflow-hidden rounded-lg border-2", selected ? "border-accent" : "border-transparent")}
      style={style}
    >
      {src && <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover" draggable={false} />}
      {(busy || done) && (
        <span className="absolute inset-0 grid place-items-center bg-black/40 text-white">{busy ? <Spinner size={16} /> : <Check size={18} />}</span>
      )}
    </button>
  );
}

function WallpaperCard({ isSample, close }: CardProps) {
  const [topicId, setTopicId] = useState("featured");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current] = useStored<Current | null>(CURRENT_KEY, null);
  const [rotation, setRotation] = useStored<Rotation>(ROTATION_KEY, DEFAULT_ROTATION);
  const topic = TOPICS.find((t) => t.id === topicId) ?? TOPICS[0];
  const photos = usePolled<Photo[]>(isSample ? null : `${wallpaperAccount.ns}:search:${topic.id}:${page}`, () => searchPhotos(topic, page), { refreshMs: 6 * 3600_000, persist: false });
  const chosen = photos.data?.find((p) => p.id === selected);

  const apply = async (p: Photo) => {
    setBusy(p.id);
    setError(null);
    try {
      await applyPhoto(p);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const open = (url: string) => call("shell", "open", { target: url }).catch(() => {});

  return (
    <CardFrame
      title="Wallpaper Gallery"
      subtitle="Landscape photos from Unsplash"
      icon={ImageIcon}
      footer={
        <AccountFooter
          url="https://unsplash.com/?utm_source=glintbar&utm_medium=referral"
          urlLabel="Unsplash"
          onDisconnect={
            isSample
              ? undefined
              : () => {
                  void disconnectAccount(wallpaperAccount);
                  close();
                }
          }
        />
      }
    >
      <div className="g-scroll-x -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {TOPICS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTopicId(t.id);
              setPage(1);
              setSelected(null);
            }}
            className={cx("shrink-0 rounded-full px-2.5 py-1 text-[12px]", t.id === topicId ? "bg-accent text-on-accent" : "bg-input text-dim hover:text-fg")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {isSample
          ? SAMPLE_PHOTOS.map((p) => <Thumb key={p.id} alt={p.alt} style={{ background: p.css }} selected={false} busy={false} done={false} onClick={() => {}} />)
          : photos.data?.slice(0, 9).map((p) => (
              <Thumb key={p.id} src={p.thumb} alt={p.alt} style={{ background: p.color }} selected={p.id === selected} busy={busy === p.id} done={current?.id === p.id && busy !== p.id} onClick={() => setSelected(p.id)} />
            ))}
        {!isSample && !photos.data && photos.loading && Array.from({ length: 9 }, (_, i) => <span key={i} className="aspect-[16/10] animate-pulse rounded-lg bg-track" />)}
      </div>
      {!isSample && Boolean(photos.error) && !photos.data && <ErrorState className="mt-2" message={photos.message} onRetry={photos.refresh} />}
      {error && <ErrorState className="mt-2" message={error} />}
      <div className="mt-2 flex items-center gap-2">
        {chosen ? (
          <>
            <div className="min-w-0 flex-1 text-[11.5px] text-dim">
              Photo by{" "}
              <button type="button" className="text-fg underline-offset-2 hover:underline" onClick={() => open(chosen.authorUrl)}>
                {chosen.author}
              </button>{" "}
              on{" "}
              <button type="button" className="text-fg underline-offset-2 hover:underline" onClick={() => open(chosen.page)}>
                Unsplash
              </button>
            </div>
            <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => apply(chosen)}>
              {busy ? "Setting…" : current?.id === chosen.id ? "Set again" : "Set as wallpaper"}
            </Button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 text-[11.5px] text-faint">{isSample ? "These are sample pictures. Add an Unsplash key to browse real photos." : "Select a photo, then set it as your wallpaper."}</span>
            {!isSample && (
              <Button size="sm" variant="ghost" icon={ChevronRight} onClick={() => setPage((p) => p + 1)}>
                More
              </Button>
            )}
          </>
        )}
      </div>
      <Section title="Change automatically" className="mt-3 mb-0">
        <SettingRow label="Rotate" description={rotation.mode === "off" ? "Your current wallpaper stays as it is." : "GlintBar swaps in a new photo while the dock is running."}>
          <Segmented
            value={rotation.mode}
            options={[
              { value: "off", label: "Off" },
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
            ]}
            onChange={(mode) => setRotation((r) => ({ ...r, mode, lastAt: r.lastAt || Date.now() }))}
          />
        </SettingRow>
        {rotation.mode !== "off" && (
          <SettingRow label="From">
            <select
              className="h-7 rounded-lg border border-card-line bg-input px-1.5 text-[12px] text-fg outline-none"
              value={rotation.topic}
              onChange={(e) => setRotation((r) => ({ ...r, topic: e.target.value }))}
            >
              <option value="all">All themes</option>
              {TOPICS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </SettingRow>
        )}
        {rotation.mode !== "off" && !isSample && (
          <SettingRow label="Next one now">
            <Button
              size="sm"
              icon={RefreshCw}
              onClick={() => {
                setRotation((r) => ({ ...r, lastAt: 0 }));
                void rotateIfDue().catch((e) => setError(errorMessage(e)));
              }}
            >
              Change
            </Button>
          </SettingRow>
        )}
      </Section>
    </CardFrame>
  );
}

export default defineWidget({
  id: "online.wallpaper",
  name: "Wallpaper Gallery",
  category: "Online & Mail",
  description: "Set Unsplash photos as wallpaper, by hand or rotated daily or weekly.",
  keywords: ["wallpaper", "background", "desktop", "unsplash", "photos"],
  icon: ImageIcon,
  size: "m",
  Tile: WallpaperTile,
  Card: WallpaperCard,
  Connect: makeConnect(wallpaperAccount),
  disconnect: () => disconnectAccount(wallpaperAccount),
  cardSize: { width: 400 },
});
