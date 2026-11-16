/**
 * Sample apps and icons: used by the browser mock and by picker previews (isSample), so the
 * Apps tiles always have something believable to show. Icons are generated SVGs (brand glyphs
 * from simple-icons where one exists, plain shapes otherwise).
 */
import { siDiscord, siFigma, siGooglechrome, siNotion, siObsidian, siSpotify, siSteam, siTelegram } from "simple-icons";
import type { AppEntry, Pin, WindowInfo } from "../types";

function svgUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** A rounded-square app icon with a 24-unit glyph path centred on it. */
export function glyphIcon(path: string, bg: string, fg = "#ffffff", bg2?: string): string {
  const fill = bg2 ? "url(#g)" : bg;
  const grad = bg2
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>`
    : "";
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${grad}<rect x="2" y="2" width="60" height="60" rx="15" fill="${fill}"/><g transform="translate(15 15) scale(1.4167)"><path d="${path}" fill="${fg}"/></g></svg>`,
  );
}

function shapeIcon(body: string): string {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`);
}

export const FOLDER_ICON = shapeIcon(
  '<path d="M6 16a5 5 0 0 1 5-5h14l6 6h22a5 5 0 0 1 5 5v26a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5z" fill="#e8a91c"/><path d="M6 24a5 5 0 0 1 5-5h42a5 5 0 0 1 5 5v24a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5z" fill="#ffc83d"/>',
);
export const FILE_ICON = shapeIcon(
  '<path d="M16 6h22l12 12v36a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z" fill="#f3f4f8"/><path d="M38 6l12 12H42a4 4 0 0 1-4-4z" fill="#c9ccd6"/><rect x="19" y="28" width="24" height="3" rx="1.5" fill="#9aa0b4"/><rect x="19" y="35" width="24" height="3" rx="1.5" fill="#9aa0b4"/><rect x="19" y="42" width="16" height="3" rx="1.5" fill="#9aa0b4"/>',
);
const IMAGE_ICON = shapeIcon(
  '<rect x="6" y="10" width="52" height="44" rx="7" fill="#3b82f6"/><circle cx="22" cy="25" r="6" fill="#fde68a"/><path d="M6 46l15-14 11 10 9-7 17 15v2a7 7 0 0 1-7 7H13a7 7 0 0 1-7-7z" fill="#1e40af"/>',
);
const PDF_ICON = shapeIcon(
  '<path d="M16 6h22l12 12v36a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z" fill="#e5484d"/><path d="M38 6l12 12H42a4 4 0 0 1-4-4z" fill="#b4232a"/><text x="31" y="44" font-family="Segoe UI,Arial" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">PDF</text>',
);
const SHEET_ICON = shapeIcon(
  '<rect x="8" y="8" width="48" height="48" rx="8" fill="#1f9d55"/><path d="M18 20h28M18 30h28M18 40h28M30 20v24" stroke="#d1fae5" stroke-width="3"/>',
);
const DOC_ICON = shapeIcon(
  '<rect x="8" y="8" width="48" height="48" rx="8" fill="#2b6cd9"/><path d="M19 22l5 20 8-14 8 14 5-20" stroke="#fff" stroke-width="4" fill="none" stroke-linejoin="round"/>',
);

const EXPLORER = shapeIcon(
  '<rect x="2" y="2" width="60" height="60" rx="15" fill="#20324d"/><path d="M12 22a4 4 0 0 1 4-4h10l4 4h18a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z" fill="#f2b52b"/><path d="M12 28a4 4 0 0 1 4-4h32a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z" fill="#ffd257"/>',
);
const EDGE = shapeIcon(
  '<defs><linearGradient id="e" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#36c3f0"/><stop offset="1" stop-color="#0c59a4"/></linearGradient><linearGradient id="f" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2fd18b"/><stop offset="1" stop-color="#1b9de2"/></linearGradient></defs><circle cx="32" cy="32" r="27" fill="url(#e)"/><path d="M14 40c4 9 14 14 24 12 7-1 13-6 15-12-6 5-17 6-24 1-5-3-6-9-3-13-7 0-12 5-12 12z" fill="url(#f)"/><circle cx="34" cy="27" r="8" fill="#0b3f7a" opacity=".55"/>',
);
const TERMINAL = shapeIcon(
  '<rect x="2" y="2" width="60" height="60" rx="15" fill="#1b1b1f"/><rect x="2" y="2" width="60" height="12" rx="6" fill="#2d2d33"/><path d="M15 26l10 7-10 7" stroke="#e8e8ee" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="29" y="38" width="16" height="4" rx="2" fill="#e8e8ee"/>',
);
const CODE = shapeIcon(
  '<rect x="2" y="2" width="60" height="60" rx="15" fill="#1677d2"/><path d="M42 12l-20 18-9-7-4 3v12l4 3 9-7 20 18 8-4V16zM22 32l20 14V18z" fill="#fff" fill-rule="evenodd"/>',
);
const SETTINGS = shapeIcon(
  '<rect x="2" y="2" width="60" height="60" rx="15" fill="#5b6475"/><circle cx="32" cy="32" r="13" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="6 4"/><circle cx="32" cy="32" r="6" fill="#fff"/>',
);
const NOTEPAD = shapeIcon(
  '<rect x="10" y="6" width="44" height="52" rx="7" fill="#38bdf8"/><rect x="16" y="16" width="32" height="36" rx="3" fill="#f0f9ff"/><path d="M21 25h22M21 32h22M21 39h14" stroke="#0369a1" stroke-width="3" stroke-linecap="round"/>',
);
const CALC = shapeIcon(
  '<rect x="2" y="2" width="60" height="60" rx="15" fill="#34343c"/><rect x="13" y="12" width="38" height="12" rx="3" fill="#9ca3af"/><g fill="#e5e7eb"><rect x="13" y="30" width="10" height="9" rx="2"/><rect x="27" y="30" width="10" height="9" rx="2"/><rect x="13" y="43" width="10" height="9" rx="2"/><rect x="27" y="43" width="10" height="9" rx="2"/></g><rect x="41" y="30" width="10" height="22" rx="2" fill="#f59e0b"/>',
);
const OUTLOOK = shapeIcon(
  '<rect x="2" y="2" width="60" height="60" rx="15" fill="#0f6cbd"/><rect x="12" y="18" width="40" height="28" rx="4" fill="#fff"/><path d="M12 22l20 14 20-14" stroke="#0f6cbd" stroke-width="3" fill="none"/>',
);

/** Brand glyph for a sample app by id. */
export const SAMPLE_ICONS: Record<string, string> = {
  explorer: EXPLORER,
  edge: EDGE,
  chrome: glyphIcon(siGooglechrome.path, "#ffffff", "#" + siGooglechrome.hex),
  terminal: TERMINAL,
  code: CODE,
  spotify: glyphIcon(siSpotify.path, "#121212", "#" + siSpotify.hex),
  discord: glyphIcon(siDiscord.path, "#" + siDiscord.hex),
  telegram: glyphIcon(siTelegram.path, "#2aabee", "#ffffff", "#229ed9"),
  figma: glyphIcon(siFigma.path, "#1e1e1e"),
  steam: glyphIcon(siSteam.path, "#1b2838", "#ffffff", "#2a475e"),
  notion: glyphIcon(siNotion.path, "#ffffff", "#111111"),
  obsidian: glyphIcon(siObsidian.path, "#2b2340", "#a88bfa"),
  settings: SETTINGS,
  notepad: NOTEPAD,
  calculator: CALC,
  outlook: OUTLOOK,
  folder: FOLDER_ICON,
  file: FILE_ICON,
};

function app(key: string, name: string, extra: Partial<AppEntry>): AppEntry {
  const aumid = extra.aumid ?? null;
  const exe = extra.exe ?? null;
  return {
    id: aumid ? `aumid:${aumid.toLowerCase()}` : exe ? `exe:${exe.toLowerCase()}` : `path:${key}`,
    name,
    kind: "app",
    target: aumid ? `shell:AppsFolder\\${aumid}` : (exe ?? key),
    args: null,
    aumid,
    exe,
    icon: `sample:${key}`,
    ...extra,
  };
}

const PF = "c:\\program files";
const LAD = "c:\\users\\you\\appdata\\local";

export const SAMPLE_APPS: AppEntry[] = [
  app("explorer", "File Explorer", { aumid: "Microsoft.Windows.Explorer", exe: "c:\\windows\\explorer.exe" }),
  app("edge", "Microsoft Edge", { aumid: "MSEdge", exe: `${PF} (x86)\\microsoft\\edge\\application\\msedge.exe` }),
  app("chrome", "Google Chrome", { aumid: "Chrome", exe: `${PF}\\google\\chrome\\application\\chrome.exe` }),
  app("terminal", "Terminal", { aumid: "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App" }),
  app("code", "Visual Studio Code", { exe: `${LAD}\\programs\\microsoft vs code\\code.exe` }),
  app("spotify", "Spotify", { aumid: "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" }),
  app("discord", "Discord", { aumid: "com.squirrel.Discord.Discord", exe: `${LAD}\\discord\\app-1.0.9188\\discord.exe` }),
  app("telegram", "Telegram", { exe: "c:\\users\\you\\appdata\\roaming\\telegram desktop\\telegram.exe" }),
  app("figma", "Figma", { exe: `${LAD}\\figma\\figma.exe` }),
  app("steam", "Steam", { exe: `${PF} (x86)\\steam\\steam.exe` }),
  app("notion", "Notion", { exe: `${LAD}\\programs\\notion\\notion.exe` }),
  app("obsidian", "Obsidian", { exe: `${LAD}\\programs\\obsidian\\obsidian.exe` }),
  app("outlook", "Outlook", { aumid: "Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookforWindows" }),
  app("settings", "Settings", { aumid: "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel" }),
  app("notepad", "Notepad", { aumid: "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App" }),
  app("calculator", "Calculator", { aumid: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" }),
];

export function sampleApp(key: string): AppEntry {
  return SAMPLE_APPS.find((a) => a.icon === `sample:${key}`) ?? SAMPLE_APPS[0];
}

export const SAMPLE_DOWNLOADS: AppEntry = {
  id: "path:c:\\users\\you\\downloads",
  name: "Downloads",
  kind: "folder",
  target: "C:\\Users\\you\\Downloads",
  args: null,
  aumid: null,
  exe: null,
  icon: "sample:folder",
};

/** The pins a fresh Apps tile starts with in the preview. */
export const SAMPLE_PINS: Pin[] = [
  sampleApp("explorer"),
  sampleApp("edge"),
  sampleApp("terminal"),
  sampleApp("code"),
  sampleApp("spotify"),
  {
    kind: "group",
    id: "group:sample",
    name: "Chat",
    items: [sampleApp("discord"), sampleApp("telegram"), sampleApp("outlook")],
  },
  SAMPLE_DOWNLOADS,
];

/** Open windows for the preview. */
export function sampleWindows(): WindowInfo[] {
  const w = (hwnd: number, key: string, title: string, extra: Partial<WindowInfo> = {}): WindowInfo => {
    const a = sampleApp(key);
    return {
      hwnd,
      pid: 4000 + hwnd,
      title,
      exe: a.exe ?? null,
      aumid: a.aumid ?? null,
      appName: a.name,
      minimized: false,
      foreground: false,
      flashing: false,
      hung: false,
      ...extra,
    };
  };
  return [
    w(1001, "code", "dock.tsx - glintbar - Visual Studio Code", { foreground: true }),
    w(1002, "edge", "Release notes - Work - Microsoft Edge"),
    w(1003, "edge", "(4) Inbox - Outlook - Microsoft Edge"),
    w(1004, "explorer", "Downloads"),
    w(1005, "spotify", "Spotify Premium", { minimized: true }),
    w(1006, "telegram", "Telegram (12)", { flashing: true }),
    w(1007, "figma", "Dock icons – Figma"),
    w(1008, "terminal", "PowerShell"),
  ];
}

/** An icon for a path by its extension (preview only). */
export function sampleFileIcon(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp"].includes(ext)) return IMAGE_ICON;
  if (ext === "pdf") return PDF_ICON;
  if (["xlsx", "xls", "csv"].includes(ext)) return SHEET_ICON;
  if (["docx", "doc"].includes(ext)) return DOC_ICON;
  if (!path.includes(".") || /\\(downloads|documents|desktop|pictures|projects|music|videos)$/i.test(path)) return FOLDER_ICON;
  return FILE_ICON;
}

/** Sample icon for any source string (preview and mock). */
export function sampleIcon(source: string): string {
  if (source.startsWith("sample:")) return SAMPLE_ICONS[source.slice(7)] ?? sampleFileIcon(source.slice(7));
  const lower = source.toLowerCase();
  const hit = SAMPLE_APPS.find(
    (a) =>
      lower.includes(a.icon.slice(7)) ||
      (a.aumid && lower.includes(a.aumid.toLowerCase())) ||
      (a.exe && lower === a.exe.toLowerCase()),
  );
  if (hit) return SAMPLE_ICONS[hit.icon.slice(7)];
  return sampleFileIcon(source.replace(/^thumb:/, ""));
}
