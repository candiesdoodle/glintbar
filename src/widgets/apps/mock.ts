/** Browser-preview data for the apps slice. Loaded only when there is no Tauri backend. */
import { mockEmit, mockService, mockTopic } from "../../core/mock";
import { SAMPLE_APPS, SAMPLE_DOWNLOADS, sampleApp, sampleIcon, sampleWindows } from "./shared/sample";
import type { AppEntry, Capture, Drive, FolderEntry, FolderSize, JumpList, Recent, RecycleInfo, WindowInfo } from "./types";

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const now = () => Date.now();

// ---- windows ------------------------------------------------------------------------------------

let windows: WindowInfo[] = sampleWindows().map((w) => ({ ...w, flashing: w.flashing }));
let nextHwnd = 2000;

function emitWindows() {
  mockEmit("apps", "windows", windows.map((w) => ({ ...w })));
}

function setForeground(hwnd: number | null) {
  windows = windows.map((w) => ({ ...w, foreground: w.hwnd === hwnd, flashing: w.hwnd === hwnd ? false : w.flashing }));
  // Front-most first, like EnumWindows.
  const front = windows.find((w) => w.hwnd === hwnd);
  if (front) windows = [front, ...windows.filter((w) => w.hwnd !== hwnd)];
}

function focus(hwnd: number) {
  windows = windows.map((w) => (w.hwnd === hwnd ? { ...w, minimized: false } : w));
  setForeground(hwnd);
  emitWindows();
}

mockTopic<WindowInfo[]>("apps", "windows", {
  start: (emit) => {
    emit(windows.map((w) => ({ ...w })));
    // A chat app gets a new message now and then.
    const t = setInterval(() => {
      const tg = windows.find((w) => w.appName === "Telegram");
      if (tg && !tg.foreground) {
        const n = (Number(/\((\d+)\)/.exec(tg.title)?.[1] ?? 0) || 0) + 1;
        windows = windows.map((w) => (w === tg ? { ...w, title: `Telegram (${n})`, flashing: true } : w));
        emitWindows();
      }
    }, 45_000);
    return () => clearInterval(t);
  },
});

function appForTarget(target: string): AppEntry | undefined {
  const t = target.toLowerCase().replace(/^aumid:/, "shell:appsfolder\\");
  return SAMPLE_APPS.find((a) => a.target.toLowerCase() === t || (a.exe && a.exe === t) || t.includes(a.name.toLowerCase()));
}

// ---- jump lists ----------------------------------------------------------------------------------

const DOCS = "C:\\Users\\you\\Documents";
const DL = "C:\\Users\\you\\Downloads";

function jumpFor(aumid?: string, exe?: string): JumpList {
  const id = (aumid ?? exe ?? "").toLowerCase();
  const item = (title: string, target: string, args?: string) => ({ title, target, args: args ?? null, icon: "" });
  const file = (name: string, dir = DOCS) => ({ title: name, target: `${dir}\\${name}`, args: null, icon: `thumb:${dir}\\${name}` });
  if (id.includes("explorer")) {
    return {
      tasks: [],
      pinned: ["Desktop", "Downloads", "Documents", "Pictures", "Projects"].map((n) => ({
        title: n,
        target: `C:\\Users\\you\\${n}`,
        args: null,
        icon: `C:\\Users\\you\\${n}`,
      })),
      recent: [],
    };
  }
  if (id.includes("msedge") || id === "msedge" || id.includes("chrome")) {
    return {
      tasks: [item("New window", exe ?? "msedge.exe", "--new-window"), item("New InPrivate window", exe ?? "msedge.exe", "--inprivate")],
      pinned: [],
      recent: [],
    };
  }
  if (id.includes("telegram")) return { tasks: [item("Quit Telegram", exe ?? "telegram.exe", "-quit")], pinned: [], recent: [] };
  if (id.includes("terminal")) {
    return {
      tasks: [item("Windows PowerShell", "wt.exe", "-p PowerShell"), item("Command Prompt", "wt.exe", "-p cmd"), item("Ubuntu", "wt.exe", "-p Ubuntu")],
      pinned: [],
      recent: [],
    };
  }
  if (id.includes("code")) {
    return {
      tasks: [item("New Window", exe ?? "code.exe", "-n")],
      pinned: [],
      recent: [file("glintbar", "C:\\Users\\you\\Projects"), file("notes.md"), file("budget-2026.xlsx")],
    };
  }
  return { tasks: [], pinned: [], recent: [file("Quarterly report.docx"), file("Invoice 1042.pdf", DL)] };
}

// ---- files ------------------------------------------------------------------------------------

const DOWNLOADS: FolderEntry[] = [
  ["Screenshots", true, 0, 1],
  ["Invoice 1042.pdf", false, 184_000, 2],
  ["holiday-photo.jpg", false, 3_400_000, 5],
  ["budget-2026.xlsx", false, 48_000, 9],
  ["GlintBar-setup.exe", false, 9_800_000, 26],
  ["Quarterly report.docx", false, 260_000, 30],
  ["dock-mockup.png", false, 1_200_000, 47],
  ["fonts.zip", false, 22_000_000, 70],
  ["meeting-notes.txt", false, 4_000, 96],
  ["wallpaper.jpg", false, 5_600_000, 140],
].map(([name, isDir, size, hoursAgo]) => {
  const path = `${DL}\\${name}`;
  return {
    name: name as string,
    path,
    isDir: isDir as boolean,
    size: size as number,
    modified: now() - (hoursAgo as number) * 3600_000,
    icon: isDir ? path : `thumb:${path}`,
  };
});

let recycle: RecycleInfo = { count: 23, bytes: Math.round(1.4 * GB) };

const drives = (): Drive[] => [
  { root: "C:\\", letter: "C", label: "Windows", fs: "NTFS", kind: "fixed", total: 476 * GB, free: Math.round(118.4 * GB), system: true },
  { root: "D:\\", letter: "D", label: "Data", fs: "NTFS", kind: "fixed", total: 931 * GB, free: 612 * GB, system: false },
  { root: "E:\\", letter: "E", label: "USB stick", fs: "exFAT", kind: "removable", total: 58 * GB, free: Math.round(40.6 * GB), system: false },
];

// Seed a month of free-space history so the preview can say "Full in N days".
try {
  const raw = localStorage.getItem("glintbar.store");
  const store = raw ? JSON.parse(raw) : {};
  if (!store["apps.storageHistory"]) {
    const today = Math.floor(now() / 86_400_000);
    const c: Array<[number, number]> = [];
    for (let i = 24; i >= 1; i--) c.push([today - i, Math.round((118.4 + i * 1.55 + Math.sin(i) * 0.8) * GB)]);
    store["apps.storageHistory"] = { "C:\\": c };
    localStorage.setItem("glintbar.store", JSON.stringify(store));
  }
} catch {
  /* storage blocked */
}

function svg(body: string, w = 320, h = 200) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;
}

const ACCENTS: Record<string, string> = {
  edge: "#0c59a4",
  code: "#1677d2",
  explorer: "#f2b52b",
  spotify: "#1ed760",
  telegram: "#2aabee",
  figma: "#a259ff",
  terminal: "#3a3a44",
};

function previewFor(hwnd: number): string | null {
  const w = windows.find((x) => x.hwnd === hwnd);
  if (!w || w.minimized) return null;
  const key = SAMPLE_APPS.find((a) => a.name === w.appName)?.icon.slice(7) ?? "edge";
  const accent = ACCENTS[key] ?? "#6366f1";
  const dark = key === "code" || key === "terminal" || key === "spotify";
  const bg = dark ? "#1e1f24" : "#f7f7fa";
  const line = dark ? "#3a3c46" : "#dcdde4";
  const rows = Array.from({ length: 6 }, (_, i) => `<rect x="${key === "code" ? 70 : 24}" y="${58 + i * 20}" width="${160 - (i % 3) * 34}" height="8" rx="4" fill="${line}"/>`).join("");
  const side = key === "code" || key === "explorer" || key === "telegram" ? `<rect x="0" y="30" width="56" height="170" fill="${dark ? "#25262c" : "#eceef3"}"/>` : "";
  return svg(
    `<rect width="320" height="200" rx="10" fill="${bg}"/><rect width="320" height="30" rx="10" fill="${accent}"/><rect y="20" width="320" height="10" fill="${accent}"/><circle cx="290" cy="15" r="4" fill="#fff" opacity=".8"/><circle cx="276" cy="15" r="4" fill="#fff" opacity=".6"/>${side}${rows}<rect x="210" y="58" width="90" height="70" rx="8" fill="${accent}" opacity=".25"/>`,
  );
}

mockService("apps", {
  taskbar_pins: (): AppEntry[] => ["explorer", "edge", "terminal", "code", "spotify", "outlook"].map(sampleApp),
  installed: (): AppEntry[] => [...SAMPLE_APPS].sort((a, b) => a.name.localeCompare(b.name)),
  windows: () => windows,
  resolve: ({ paths }: { paths: string[] }): AppEntry[] =>
    paths.map((p) => {
      const name = p.split("\\").pop() ?? p;
      const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
      const app = SAMPLE_APPS.find((a) => name.toLowerCase().startsWith(a.name.toLowerCase()));
      if ((ext === "lnk" || ext === "exe") && app) return app;
      if (!ext) return { ...SAMPLE_DOWNLOADS, id: `path:${p.toLowerCase()}`, name, target: p, icon: p };
      return { id: `path:${p.toLowerCase()}`, name, kind: "file", target: p, args: null, aumid: null, exe: null, icon: `thumb:${p}` };
    }),
  icon: ({ source }: { source: string }) => sampleIcon(source),
  preview: ({ hwnd }: { hwnd: number }) => previewFor(hwnd),
  focus: ({ hwnd }: { hwnd: number }) => focus(hwnd),
  toggle: ({ hwnd }: { hwnd: number }) => {
    const w = windows.find((x) => x.hwnd === hwnd);
    if (w?.foreground && !w.minimized) {
      windows = windows.map((x) => (x.hwnd === hwnd ? { ...x, minimized: true, foreground: false } : x));
      emitWindows();
      return true;
    }
    focus(hwnd);
    return false;
  },
  minimize: ({ hwnd }: { hwnd: number }) => {
    windows = windows.map((x) => (x.hwnd === hwnd ? { ...x, minimized: true, foreground: false } : x));
    emitWindows();
  },
  close: ({ hwnd }: { hwnd: number }) => {
    windows = windows.filter((w) => w.hwnd !== hwnd);
    emitWindows();
  },
  end_task: ({ pid }: { pid: number }) => {
    windows = windows.filter((w) => w.pid !== pid);
    emitWindows();
  },
  launch: ({ target }: { target: string }) => {
    const app = appForTarget(target);
    if (!app) {
      console.info("[mock] open", target);
      return;
    }
    const hwnd = nextHwnd++;
    windows = [
      ...windows,
      { hwnd, pid: 9000 + hwnd, title: app.name, exe: app.exe ?? null, aumid: app.aumid ?? null, appName: app.name, minimized: false, foreground: false, flashing: false, hung: false },
    ];
    setForeground(hwnd);
    emitWindows();
  },
  reveal: ({ path }: { path: string }) => console.info("[mock] reveal", path),
  start_menu: () => console.info("[mock] Start"),
  quick_menu: () => console.info("[mock] Win+X"),
  jump_list: ({ aumid, exe }: { aumid?: string; exe?: string }) => jumpFor(aumid, exe),
  list_folder: ({ path }: { path: string }): FolderEntry[] =>
    path.toLowerCase().includes("downloads") ? DOWNLOADS : DOWNLOADS.slice(1, 6).map((e) => ({ ...e, path: e.path.replace(DL, path) })),
  recent: (): Recent => ({
    files: [
      ["Quarterly report.docx", DOCS, 0.3],
      ["holiday-photo.jpg", DL, 1.2],
      ["Invoice 1042.pdf", DL, 3],
      ["Projects", "C:\\Users\\you", 5],
      ["budget-2026.xlsx", DOCS, 20],
      ["notes.md", DOCS, 27],
      ["dock-mockup.png", DL, 49],
    ].map(([name, dir, h]) => {
      const target = `${dir}\\${name}`;
      const folder = !(name as string).includes(".");
      return { name: name as string, target, kind: folder ? "folder" : "file", at: now() - (h as number) * 3600_000, icon: folder ? target : `thumb:${target}` };
    }),
    apps: ["code", "edge", "figma", "spotify", "telegram", "steam"].map((k, i) => {
      const a = sampleApp(k);
      return { name: a.name, target: a.target, kind: "app" as const, at: now() - (i * 2 + 0.2) * 3600_000, icon: a.icon };
    }),
  }),
  recycle_info: () => recycle,
  recycle_empty: () => {
    recycle = { count: 0, bytes: 0 };
    mockEmit("apps", "recycle", recycle);
    return recycle;
  },
  recycle_files: ({ paths }: { paths: string[] }) => {
    recycle = { count: recycle.count + paths.length, bytes: recycle.bytes + paths.length * 3.2 * MB };
    mockEmit("apps", "recycle", recycle);
    return recycle;
  },
  drives,
  folder_sizes: ({ root }: { root: string }): FolderSize[] =>
    root.startsWith("C")
      ? [
          { name: "Videos", path: "C:\\Users\\you\\Videos", bytes: 61 * GB, approx: false },
          { name: "Downloads", path: DL, bytes: 38.2 * GB, approx: false },
          { name: "Pictures", path: "C:\\Users\\you\\Pictures", bytes: 24.5 * GB, approx: false },
          { name: "Documents", path: DOCS, bytes: 12.8 * GB, approx: false },
          { name: "Desktop", path: "C:\\Users\\you\\Desktop", bytes: 3.1 * GB, approx: false },
          { name: "Music", path: "C:\\Users\\you\\Music", bytes: 1.4 * GB, approx: false },
        ]
      : [],
  capture: ({ mode }: { mode: string }): Capture => {
    const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "");
    return {
      path: `C:\\Users\\you\\Pictures\\Screenshots\\Screenshot ${stamp}.png`,
      width: mode === "window" ? 1440 : 2560,
      height: mode === "window" ? 900 : 1440,
      copied: true,
      thumb: previewFor(windows.find((w) => w.foreground)?.hwnd ?? 1001),
    };
  },
  capture_region: () => console.info("[mock] snipping overlay"),
});

mockTopic<RecycleInfo>("apps", "recycle", { every: 4000, sample: () => recycle });
