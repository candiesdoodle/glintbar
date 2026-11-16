import { siWhatsapp } from "simple-icons";

export function WhatsAppGlyph({ size, muted }: { size: number; muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ color: muted ? "var(--g-faint)" : `#${siWhatsapp.hex}` }}>
      <path d={siWhatsapp.path} fill="currentColor" />
    </svg>
  );
}
