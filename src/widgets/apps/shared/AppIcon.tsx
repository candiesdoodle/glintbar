import { File, Folder } from "lucide-react";
import { cx } from "../../../ui";
import { useIcon } from "./icons";

/** Hue from a name, for letter icons of apps without one. */
function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** An app/file/folder icon at `size` CSS px; falls back to a letter (apps) or a glyph. */
export function AppIcon({
  source,
  name,
  size,
  kind = "app",
  className,
}: {
  source: string | undefined;
  name: string;
  size: number;
  kind?: "app" | "folder" | "file" | "url";
  className?: string;
}) {
  const url = useIcon(source, size);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        className={cx("pointer-events-none shrink-0 object-contain select-none", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  if (url === undefined) {
    return <span className={cx("shrink-0 animate-pulse rounded-[22%] bg-track", className)} style={{ width: size * 0.86, height: size * 0.86 }} />;
  }
  if (kind === "folder") return <Folder size={size * 0.9} className={cx("shrink-0 text-warn", className)} strokeWidth={1.6} />;
  if (kind === "file") return <File size={size * 0.9} className={cx("shrink-0 text-dim", className)} strokeWidth={1.6} />;
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className={cx("grid shrink-0 place-items-center rounded-[24%] font-semibold text-white", className)}
      style={{ width: size * 0.9, height: size * 0.9, fontSize: size * 0.42, background: `hsl(${hue(name)} 55% 46%)` }}
    >
      {letter}
    </span>
  );
}
