import { useEffect, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { describeError, httpJson } from "../../core/http";
import { ListRow, Spinner, TextInput } from "../../ui";
import type { Place } from "./shared";

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  timezone?: string;
}

/** Looks a city up by name (Open-Meteo geocoding, no key). */
export async function searchCities(query: string): Promise<Place[]> {
  const r = await httpJson<{ results?: GeoResult[] }>("https://geocoding-api.open-meteo.com/v1/search", {
    query: { name: query, count: 8, language: (navigator.language || "en").split("-")[0], format: "json" },
    timeoutMs: 10_000,
  });
  return (r.results ?? []).map((g) => ({ name: g.name, country: g.country, admin: g.admin1, lat: g.latitude, lon: g.longitude, tz: g.timezone }));
}

/**
 * Search box + results. `extra` lets callers offer instant local matches (popular cities for
 * the world clocks) above the online results.
 */
export function CityPicker({
  onPick,
  placeholder = "Type a city name…",
  extra,
  autoFocus,
}: {
  onPick: (p: Place) => void;
  placeholder?: string;
  extra?: (query: string) => Array<{ key: string; title: string; subtitle?: string; pick: () => void }>;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setError(null);
      setBusy(false);
      return;
    }
    const id = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      searchCities(query)
        .then((r) => {
          if (id !== seq.current) return;
          setResults(r);
          setError(r.length ? null : `Nothing matches “${query}”.`);
        })
        .catch((e) => id === seq.current && setError(describeError(e)))
        .finally(() => id === seq.current && setBusy(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const local = extra ? extra(q.trim()) : [];
  return (
    <div className="py-2">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-8" autoFocus={autoFocus} spellCheck={false} />
        {busy && (
          <span className="absolute top-1/2 right-2.5 -translate-y-1/2">
            <Spinner size={12} />
          </span>
        )}
      </div>
      {(local.length > 0 || results.length > 0 || error) && (
        <div className="-mx-2 mt-1.5 max-h-[200px] overflow-y-auto">
          {local.map((r) => (
            <ListRow key={r.key} icon={MapPin} title={r.title} subtitle={r.subtitle} onClick={r.pick} />
          ))}
          {results.map((p) => (
            <ListRow
              key={`${p.lat},${p.lon}`}
              icon={MapPin}
              title={p.name}
              subtitle={[p.admin, p.country].filter(Boolean).join(", ")}
              onClick={() => {
                onPick(p);
                setQ("");
              }}
            />
          ))}
          {error && <div className="px-2 py-1.5 text-[12px] text-dim">{error}</div>}
        </div>
      )}
    </div>
  );
}
