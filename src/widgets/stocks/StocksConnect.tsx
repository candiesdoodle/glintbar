import { useState, type FormEvent } from "react";
import { ExternalLink, KeyRound, LogOut } from "lucide-react";
import { call } from "../../core/backend";
import { Button, CardFrame, ErrorState, TextInput } from "../../ui";
import { finnhubMessage, forgetKey, normalizeSymbol, parseSymbols, saveKey, testKey } from "./finnhub";

/**
 * Connect form for both stock widgets: one Finnhub key (checked with one real read) and the
 * tickers. Saving marks Stock Chart and Stock Watchlist connected.
 */
export function StocksConnect({ symbols, max, onSymbols }: { symbols: string[]; max: number; onSymbols: (s: string[]) => void }) {
  const [key, setKey] = useState("");
  const [tickers, setTickers] = useState(symbols.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const k = key.trim();
    const list = parseSymbols(tickers, max);
    if (!k) return setError("Enter your Finnhub API key first.");
    if (!list.length) return setError("Enter one or more tickers, such as AAPL.");
    setBusy(true);
    setError(null);
    try {
      await testKey(k, list[0]);
      await saveKey(k);
      onSymbols(list);
    } catch (err) {
      setError(finnhubMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardFrame title="Connect Stocks" subtitle="Uses Finnhub; the free plan works" icon={KeyRound}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <ol className="list-decimal space-y-1 pl-5 text-[12px] leading-snug text-dim">
          <li>Sign up for a free Finnhub account and verify your email address.</li>
          <li>Your Finnhub dashboard shows an API key. Copy it.</li>
          <li>{max === 1 ? "Enter the key and the ticker you want" : `Enter the key and up to ${max} tickers`} below, then press Connect.</li>
        </ol>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-fg">Finnhub API key</span>
          <TextInput type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="c1a2b3…" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-fg">Tickers</span>
          <TextInput spellCheck={false} value={tickers} onChange={(e) => setTickers(e.target.value)} placeholder="AAPL, MSFT" onBlur={() => setTickers(parseSymbols(tickers, max).map(normalizeSymbol).join(", "))} />
          <span className="text-[11px] text-faint">Separate them with commas (max {max}).</span>
        </label>
        {error && <ErrorState message={error} />}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" icon={ExternalLink} onClick={() => call("shell", "open", { target: "https://finnhub.io/dashboard" })}>
            Finnhub dashboard
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Connect"}
          </Button>
        </div>
        <p className="text-[11px] leading-snug text-faint">GlintBar keeps the key in Windows Credential Manager on this PC. It goes only to Finnhub, and only to fetch prices.</p>
      </form>
    </CardFrame>
  );
}

export function DisconnectButton() {
  return (
    <Button size="sm" variant="ghost" icon={LogOut} onClick={() => void forgetKey()}>
      Disconnect
    </Button>
  );
}

/** Comma-separated ticker editor for cards. */
export function TickerField({ symbols, max, onSave }: { symbols: string[]; max: number; onSave: (s: string[]) => void }) {
  const [text, setText] = useState(symbols.join(", "));
  const list = parseSymbols(text, max);
  const changed = list.join(",") !== symbols.join(",");
  return (
    <form
      className="flex items-center gap-2 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (list.length) onSave(list);
      }}
    >
      <TextInput value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder={max === 1 ? "AAPL" : "AAPL, MSFT, NVDA"} />
      <Button type="submit" size="sm" variant={changed ? "primary" : "secondary"} disabled={!changed || !list.length}>
        Save
      </Button>
    </form>
  );
}
