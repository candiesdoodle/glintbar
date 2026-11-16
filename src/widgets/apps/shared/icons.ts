/**
 * App/file icons from Rust (`apps.icon` -> PNG data URL, cached on disk there) with an
 * in-memory cache here, shared by every tile. Sources: a path, "aumid:<id>", "thumb:<path>",
 * or "sample:<key>" (built-in sample art, no backend call).
 */
import { useEffect, useState } from "react";
import { call } from "../../../core/backend";
import { sampleIcon } from "./sample";

const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

/** Icon pixel sizes we ask Rust for (keeps the cache small). */
const BUCKETS = [32, 48, 64, 96, 128, 256];

export function iconBucket(cssPx: number): number {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const want = cssPx * dpr;
  return BUCKETS.find((b) => b >= want) ?? 256;
}

export function loadIcon(source: string, size: number): Promise<string | null> {
  if (source.startsWith("sample:")) return Promise.resolve(sampleIcon(source));
  const key = `${size}|${source}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  let p = pending.get(key);
  if (!p) {
    p = call<string | null>("apps", "icon", { source, size })
      .catch(() => null)
      .then((url) => {
        cache.set(key, url);
        pending.delete(key);
        return url;
      });
    pending.set(key, p);
  }
  return p;
}

/** The icon's data URL (undefined while loading, null when there is none). */
export function useIcon(source: string | undefined, cssPx: number): string | null | undefined {
  const size = iconBucket(cssPx);
  const key = source ? `${size}|${source}` : "";
  const [url, setUrl] = useState<string | null | undefined>(() =>
    !source ? null : source.startsWith("sample:") ? sampleIcon(source) : cache.get(key),
  );
  useEffect(() => {
    if (!source) {
      setUrl(null);
      return;
    }
    let live = true;
    if (cache.has(key)) setUrl(cache.get(key) ?? null);
    else void loadIcon(source, size).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [source, size, key]);
  return url;
}
