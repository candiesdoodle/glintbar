/** What the Search box does with what you typed: open a path, open a site, or search the web. */

export type Engine = "google" | "bing" | "duckduckgo" | "brave" | "startpage";

export const ENGINES: Record<Engine, { name: string; url: string }> = {
  google: { name: "Google", url: "https://www.google.com/search?q=" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  brave: { name: "Brave", url: "https://search.brave.com/search?q=" },
  startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?q=" },
};

export type Intent = { kind: "path"; target: string } | { kind: "url"; target: string } | { kind: "search"; target: string; query: string };

const PATH = /^([a-z]:([\\/]|$)|\\\\[^\\]|%[a-z_]+%|~([\\/]|$)|shell:)/i;
const URL_LIKE = /^(https?:\/\/\S+|[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?)$/i;

export function intentFor(text: string, engine: Engine): Intent | null {
  const t = text.trim();
  if (!t) return null;
  if (PATH.test(t)) return { kind: "path", target: t };
  if (!/\s/.test(t) && URL_LIKE.test(t)) return { kind: "url", target: /^https?:/i.test(t) ? t : `https://${t}` };
  return { kind: "search", query: t, target: ENGINES[engine].url + encodeURIComponent(t) };
}

export function describeIntent(i: Intent | null, engine: Engine): string {
  if (!i) return "";
  if (i.kind === "path") return "Open folder";
  if (i.kind === "url") return "Open site";
  return `Search ${ENGINES[engine].name}`;
}
