/**
 * One floating panel at a time for the apps slice (app menus, window previews, stacks, groups),
 * rendered in a portal so tile transforms can't move it. Closes on Esc, a press elsewhere, the
 * dock opening its own card or menu, or the window losing focus.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Popover } from "../../../dock/Popover";
import { onDismiss, useDockUi, type Anchor } from "../../../dock/ui";

export type PopupKind = "menu" | "preview" | "group" | "stack" | "suggest";

export interface PopupState {
  kind: PopupKind;
  /** Which tile and item opened it. */
  owner: string;
  key: string;
  anchor: Anchor;
}

/**
 * `lift`: extra px between the dock and these panels. With magnification on, the Apps tile sets
 * it so menus and previews sit above the enlarged icons instead of over them.
 */
export const usePopup = create<{ open: PopupState | null; lift: number }>()(() => ({ open: null, lift: 0 }));

export function openPopup(p: PopupState): void {
  const ui = useDockUi.getState();
  if (ui.card || ui.menu) useDockUi.setState({ card: null, menu: null });
  usePopup.setState({ open: p });
}

export function closePopup(kind?: PopupKind): void {
  const cur = usePopup.getState().open;
  if (!cur || (kind && cur.kind !== kind)) return;
  usePopup.setState({ open: null });
}

// Esc and clicks in other apps while the dock has no keyboard focus (see dock/ui.ts).
onDismiss(() => {
  if (!usePopup.getState().open) return false;
  usePopup.setState({ open: null });
  return true;
});

useDockUi.subscribe((s, prev) => {
  if ((s.card && s.card !== prev.card) || (s.menu && s.menu !== prev.menu) || (s.panel && !prev.panel) || (s.hidden && !prev.hidden)) {
    usePopup.setState({ open: null });
  }
});

export function anchorOf(el: Element | null): Anchor {
  const r = el?.getBoundingClientRect();
  return r ? { left: r.left, width: r.width } : { left: 0, width: 0 };
}

/** A panel above (or below, for a top dock) the dock, anchored on an item. */
export function FloatingPanel({
  id,
  anchor,
  width,
  maxHeight,
  className,
  keepOpenOn,
  onClose,
  children,
}: {
  id: string;
  anchor: Anchor;
  width: number;
  maxHeight?: number;
  className?: string;
  /** Presses inside this element (the item that opened it) don't close the panel. */
  keepOpenOn?: () => Element | null;
  onClose?: () => void;
  children: ReactNode;
}) {
  const lift = usePopup((s) => s.lift);
  const close = useRef(onClose ?? (() => usePopup.setState({ open: null })));
  close.current = onClose ?? (() => usePopup.setState({ open: null }));
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest(`[data-glintbar-panel="${id}"]`)) return;
      const keep = keepOpenOn?.();
      if (keep && t && keep.contains(t)) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    const onBlur = () => close.current();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [id, keepOpenOn]);
  return createPortal(
    <Popover id={id} anchor={anchor} width={width} maxHeight={maxHeight} className={className} offset={lift}>
      {/* React events from a portal still reach the tile that rendered it: without this, a click
          in a panel would also count as a click on the tile and open its card. */}
      <div className="contents" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </Popover>,
    document.body,
  );
}

/** A row in an apps-slice menu. */
export function MenuItem({
  icon,
  label,
  hint,
  danger,
  onSelect,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={"mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover " + (danger ? "text-bad" : "text-fg")}
      onClick={() => {
        usePopup.setState({ open: null });
        onSelect();
      }}
    >
      {icon && <span className={"grid w-4 shrink-0 place-items-center " + (danger ? "text-bad" : "text-dim")}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[11px] text-faint">{hint}</span>}
    </button>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="px-3.5 pt-2 pb-1 text-[10.5px] font-medium tracking-wide text-faint uppercase">{children}</div>;
}

export function MenuDivider() {
  return <div className="my-1 border-t border-card-line" />;
}
