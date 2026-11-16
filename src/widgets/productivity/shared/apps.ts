/** App categories (for the Day Timeline) and stable colours per app. */

export type AppKind = "work" | "communication" | "browsing" | "entertainment" | "other";

const KINDS: Record<Exclude<AppKind, "other">, string[]> = {
  work: [
    "code.exe", "cursor.exe", "windsurf.exe", "devenv.exe", "idea64.exe", "pycharm64.exe", "webstorm64.exe", "rider64.exe", "clion64.exe", "goland64.exe",
    "studio64.exe", "sublime_text.exe", "notepad++.exe", "notepad.exe", "windowsterminal.exe", "wt.exe", "powershell.exe", "pwsh.exe", "cmd.exe",
    "winword.exe", "excel.exe", "powerpnt.exe", "onenote.exe", "notion.exe", "obsidian.exe", "figma.exe", "acrobat.exe", "acrord32.exe",
    "photoshop.exe", "illustrator.exe", "afterfx.exe", "premiere.exe", "blender.exe", "resolve.exe", "linear.exe", "postman.exe", "docker desktop.exe",
    "githubdesktop.exe", "sourcetree.exe", "gitkraken.exe", "explorer.exe", "zed.exe", "claude.exe", "chatgpt.exe",
  ],
  communication: ["slack.exe", "ms-teams.exe", "teams.exe", "discord.exe", "telegram.exe", "whatsapp.exe", "whatsapp.root.exe", "outlook.exe", "olk.exe", "thunderbird.exe", "zoom.exe", "skype.exe", "signal.exe", "mail.exe", "hxoutlook.exe"],
  browsing: ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe", "arc.exe", "zen.exe", "librewolf.exe", "chromium.exe", "floorp.exe"],
  entertainment: ["spotify.exe", "vlc.exe", "steam.exe", "steamwebhelper.exe", "epicgameslauncher.exe", "battle.net.exe", "netflix.exe", "mpc-hc64.exe", "potplayermini64.exe", "music.ui.exe", "video.ui.exe", "applemusic.exe", "tidal.exe", "obs64.exe"],
};

const byKey = new Map<string, AppKind>();
for (const [kind, keys] of Object.entries(KINDS)) for (const k of keys) byKey.set(k, kind as AppKind);

export function appKind(key: string): AppKind {
  return byKey.get(key.toLowerCase()) ?? "other";
}

export const KIND_META: Record<AppKind, { label: string; color: string }> = {
  work: { label: "Work & create", color: "#5b8cff" },
  communication: { label: "Messages & calls", color: "#2bc0c9" },
  browsing: { label: "Web", color: "#b57bff" },
  entertainment: { label: "Music, video & games", color: "#ff7a59" },
  other: { label: "Other apps", color: "#8a8fa3" },
};

const PALETTE = ["#5b8cff", "#34c77b", "#ff7a59", "#b57bff", "#f5a524", "#2bc0c9", "#ff5f8f", "#9bd34a", "#e0a050", "#7a8cff"];

export function appColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Two letters for an app chip: "Visual Studio Code" -> "VS". */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}
