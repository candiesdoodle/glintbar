import { CityPicker } from "../weather/CityPicker";
import { POPULAR_CITIES, type ClockCity } from "./zones";

/** City search for the world clocks: instant matches from a built-in list, then online results. */
export function ZonePicker({ onPick, autoFocus }: { onPick: (c: ClockCity) => void; autoFocus?: boolean }) {
  return (
    <CityPicker
      autoFocus={autoFocus}
      placeholder="Find a city…"
      onPick={(p) => {
        if (p.tz) onPick({ name: p.name, tz: p.tz, country: p.country });
      }}
      extra={(q) => {
        const query = q.toLowerCase();
        const list = query ? POPULAR_CITIES.filter((c) => c.name.toLowerCase().startsWith(query) || c.country?.toLowerCase().startsWith(query)) : POPULAR_CITIES.slice(0, 6);
        return list.slice(0, 6).map((c) => ({ key: `${c.name}|${c.tz}`, title: c.name, subtitle: c.country, pick: () => onPick(c) }));
      }}
    />
  );
}
