import { currencySymbol } from "../../../core/format";
import { appColor } from "../shared/apps";

const COLORS: Record<string, string> = {
  USD: "#2f9e62", EUR: "#3b6cff", GBP: "#7b4dd8", JPY: "#e5484d", CNY: "#d9363e", INR: "#f08c2e", CAD: "#c9363e", AUD: "#1f8a9e",
  CHF: "#d6453d", RUB: "#4361c2", UZS: "#1aa3a3", KZT: "#16a5c8", TRY: "#e0464c", BRL: "#2a9d55", KRW: "#3a5bd9", MXN: "#2e8b57",
};

/** A round chip with the currency's symbol (flag emoji don't render on Windows). */
export function CurrencyChip({ code, size }: { code: string; size: number }) {
  const sym = currencySymbol(code);
  const text = sym && sym !== code && sym.length <= 3 ? sym : code.slice(0, 2);
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: COLORS[code] ?? appColor(code), fontSize: Math.round(size * (text.length > 2 ? 0.34 : text.length > 1 ? 0.42 : 0.55)) }}
      aria-hidden
    >
      {text}
    </span>
  );
}
