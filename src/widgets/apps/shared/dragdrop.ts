/**
 * Files dragged in from Explorer. Tauri reports native drags for the whole window; this routes
 * them to the element under the pointer that has `data-glintbar-drop="<zone id>"`.
 * In the browser preview HTML5 drag events stand in (they carry file names, not paths).
 */
import { useEffect, useRef } from "react";
import { isTauri } from "../../../core/backend";

export interface FileDrag {
  type: "over" | "drop" | "leave";
  paths: string[];
  /** Client CSS px. */
  x: number;
  y: number;
  /** The element under the pointer (inside the zone). */
  target: HTMLElement | null;
}

type Handler = (e: FileDrag) => void;

const zones = new Map<string, { current: Handler }>();
let installed = false;
let lastZone: string | null = null;
let lastPaths: string[] = [];

function dispatch(type: "over" | "drop", paths: string[], x: number, y: number) {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const zoneEl = el?.closest<HTMLElement>("[data-glintbar-drop]") ?? null;
  const zone = zoneEl?.dataset.glintbarDrop ?? null;
  if (lastZone && lastZone !== zone) zones.get(lastZone)?.current({ type: "leave", paths, x, y, target: null });
  lastZone = type === "drop" ? null : zone;
  if (zone) zones.get(zone)?.current({ type, paths, x, y, target: el });
  if (type === "drop") lastPaths = [];
}

function leave() {
  if (lastZone) zones.get(lastZone)?.current({ type: "leave", paths: lastPaths, x: 0, y: 0, target: null });
  lastZone = null;
  lastPaths = [];
}

async function installTauri() {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  await getCurrentWebview().onDragDropEvent((ev) => {
    const p = ev.payload;
    if (p.type === "leave") {
      leave();
      return;
    }
    if (p.type === "enter") lastPaths = p.paths;
    const dpr = window.devicePixelRatio || 1;
    const x = p.position.x / dpr;
    const y = p.position.y / dpr;
    if (p.type === "drop") dispatch("drop", p.paths, x, y);
    else dispatch("over", lastPaths, x, y);
  });
}

function installBrowser() {
  const names = (e: DragEvent) => [...(e.dataTransfer?.files ?? [])].map((f) => `C:\\Users\\you\\Downloads\\${f.name}`);
  window.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dispatch("over", [], e.clientX, e.clientY);
  });
  window.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dispatch("drop", names(e), e.clientX, e.clientY);
  });
  window.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) leave();
  });
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  if (isTauri) installTauri().catch((e) => console.warn("file drop unavailable", e));
  else installBrowser();
}

/** Receives files dragged over / dropped on elements marked `data-glintbar-drop={id}`. */
export function useFileDrop(id: string, handler: Handler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    install();
    zones.set(id, ref);
    return () => {
      if (zones.get(id) === ref) zones.delete(id);
    };
  }, [id]);
}
