# GlintBar — engineering guide

GlintBar swaps the Windows 10/11 taskbar for a bar of live widget tiles. It is an
independent project: all code, text, artwork and widget descriptions are written for it.

Stack: Tauri 2 (Rust, WebView2) + React 19 + TypeScript (strict) + Vite + Tailwind v4 + zustand.
Icons: `lucide-react`; brand glyphs: `simple-icons` (import single icons, e.g. `import { siStripe } from "simple-icons"`).

## Hard rules

- **Never compile Rust locally** (no cargo build/check/test/clippy, no tauri dev/build). Rust is
  checked on GitHub Actions (`check.yml`, `build.yml`, manual triggers, the lead runs them).
  `cargo fetch --target x86_64-pc-windows-msvc` is fine (download only).
- Because nothing compiles locally, **look up every signature** in `~/.cargo/registry/src/*/`
  (`windows-0.62.2`, `tauri-2.12.5`, ...). The `windows` crate must stay on Tauri's version (0.62).
  Its traps: many params are `Option<HWND>`; most functions return `windows::core::Result`;
  `BOOL` lives in `windows::core` (`.as_bool()`); `Option<*mut T>` params need
  `Some(&mut x as *mut T)` (no coercion inside `Some`); strings: `w!("...")` or `&HSTRING`.
  Add missing feature flags to `src-tauri/Cargo.toml`. Gate Win32 code with `#[cfg(windows)]`.
- Prefer simple Rust: owned types, explicit error mapping (`SvcError`), no clever generics.
- No global installs. Commit locally with plain messages, no trailers. Don't push.
- Keep it light: no heavy UI libraries, no per-frame work when idle, nothing polls when no tile needs it.
- Light TS checks only: `npx tsc --noEmit`, `npx vitest run <paths>`, `npx vite build`.

## Branches and releases

- All work goes on the `development` branch. Test builds are manual runs of `build.yml` on it
  (`gh workflow run build.yml --ref development`); the installers are the run's
  `glintbar-installers` artifact.
- `main` only moves when a version is released: fast-forward it to the tested `development`
  commit, then create the release from that commit with the installers of its green build. After
  the release, update `bucket/glintbar.json` (version, URL, SHA-256 of the setup exe) on
  `development` and fast-forward `main` again.
- Nothing is released from any other branch, and no workflow publishes a release by itself.

## Layout and ownership (vertical slices)

```
src-tauri/src/
  lib.rs              app setup (shared — don't edit)
  registry.rs         ServiceRegistry, Registrar, svc_call      (core)
  subscriptions.rs    demand-driven topics                      (core)
  events.rs           emit(app, service, topic, &payload)       (core)
  lifecycle.rs        cleanup on exit/logoff/panic              (core)
  error.rs win.rs paths.rs logging.rs                           (core)
  migrate.rs          one-time copy of data and saved keys from the app's earlier name (core)
  services/mod.rs     one `mod` + one `register` line per domain (shared)
  services/core/      store, secrets, http, fs, shell.open/run, app, smoke (CI harness)
  services/<domain>/  shell, apps, system, media, productivity, ai, online, appearance
src/
  core/               backend bridge, mock (+ mockBare: ?profile=bare), store, secrets, http,
                      format, widget contract (core)
  ui/                 shared tile/card primitives, TileNotice for empty states (core)
  dock/               the dock shell: bar, tiles, cards, context menu, overlay/focus, keyboard
                      navigation (keyNav), welcome hint (shell slice)
  picker/             the Widgets… panel (lazy-loaded)
  settings/           Settings panel: pages/ (General, Dock, Appearance, Automations, About),
                      keys.ts (every preference store and who reads it), backup import/export
  appearance/         themes, accent, follow-system, live glass (WebGL refraction)
  automations/        rules engine (pause music before meetings, limit warnings, summaries),
                      alerts above the dock, its Settings page
  smoke/              CI smoke harness, loaded only with GLINTBAR_SMOKE=1 or ?smoke=1 (QA-owned)
  widgets/<domain>/<widget>/index.tsx   one folder per widget (auto-discovered)
  widgets/<domain>/mock.ts              browser sample data for that domain (auto-loaded)
  widgets/<domain>/background.ts        start-up work for a domain (always loaded)
```

A slice owns `src-tauri/src/services/<domain>/` and `src/widgets/<domain>/`. Adding a widget or
service must not touch any other file, except `services/mod.rs` (already has all 8 domains) and
`Cargo.toml` for new deps/features. Frontend-only domains (e.g. `widgets/clocks`) need no Rust.
If a shared file truly blocks you, make the smallest edit and say so.

## IPC conventions

- One command: `svc_call(service, method, args)`. Service = domain name (`"system"`), method
  snake_case (`"cpu_info"`), args/results are JSON with camelCase fields
  (`#[serde(rename_all = "camelCase")]` on Rust structs; mirror them in a `types.ts`).
- Errors reach TS as `BackendError { code, message }`; codes: bad_args, unknown_method, not_found,
  denied, missing_secret, offline, timeout, http, io, unsupported, internal. Show users plain words
  (`describeError` in `src/core/http.ts`).
- Events: `svc://<service>/<topic>`. Live data is a **topic** that only runs while subscribed.
- Store keys: prefix with your domain (`"media.lastPlayer"`). Core keys: `settings`, `dock`,
  `connections`, `shell.geometry`.
- Secrets: never in the store. Use `secretRef("<widgetId>.<field>")` inside http requests; Rust
  substitutes the value, so keys never enter the UI. Never log args or secrets.

## Recipe: add a widget (reference: `src/widgets/clocks/clock`)

1. Create `src/widgets/<domain>/<name>/index.tsx` default-exporting
   `defineWidget({ id: "<domain>.<name>", name, category, description, size, Tile, Card?, defaultConfig? })`.
   `size`: s/m/l/xl = 1/2/3/4 dock heights wide. Category must be one of `CATEGORIES`.
2. `Tile` gets `{ config, setConfig, size, openCard, isSample }`. Wrap content in `<TileFrame>`,
   scale fonts from `size` (tile height). The dock opens the Card on click.
3. `Card` gets `{ config, setConfig, close, isSample }`; use `<CardFrame>`, `Section`, `SettingRow`.
4. Use only theme colours (`bg-tile text-fg text-dim border-line bg-accent text-good/warn/bad`,
   or `var(--g-*)`) so all six themes work.
5. Timers: `useNow`, `useInterval`, `useService(..., { refreshMs })`, `useTopic` — they all pause
   when the tile is off-screen or the dock is hidden. Never call raw `setInterval` in a tile.
6. Run `npx vitest run src/core/registry.test.tsx` — it renders every tile in sample mode.
7. Widgets are code-split: a folder loads only when its tile is on the dock (or the picker opens).
   Never rely on module side effects in `index.tsx`; work that must always run goes in
   `src/widgets/<domain>/background.ts` (loaded at start-up). Put big cards behind
   `Card: lazyPart(() => import("./MyCard").then((m) => m.MyCard))`. A tile whose width follows
   its content sets `fit: "content"` and its own width (see apps.apps).

Account widgets: add `connect: { fields: [{ key: "apiKey", label: "API key", secret: true }], guide: { steps, url }, test? }`.
Until connected the tile gets `isSample: true` (show believable sample numbers + `<SampleBadge>`)
and clicking opens the generated `ConnectForm`. Then fetch with
`httpJson(url, { headers: { Authorization: \`Bearer ${secretRef("<widgetId>.apiKey")}\` } })`.
Custom flows (OAuth, local sign-in detection): provide `Connect` and call `setConnected(id, true)`,
plus `disconnect` (and `disconnectLabel: "Sign out"` for OAuth) for the tile's right-click menu.

## Recipe: add a service (reference: `src-tauri/src/services/system` + `src/widgets/system/cpu`)

```rust
// services/<domain>/mod.rs
pub fn register(reg: &mut Registrar) {
    reg.add("system", "cpu_info", |_app: AppHandle, _: NoArgs| async move { Ok(cpu::info()?) });
    reg.add_blocking("system", "heavy", |_app: AppHandle, a: HeavyArgs| heavy(a)); // Win32/COM/files
    reg.poller("system", "cpu", Duration::from_secs(1), |_app: AppHandle| cpu::sample()); // live topic
    reg.on_topic("media", "session", |app, generation| { /* start event source */ }, |app| { /* stop */ });
    reg.on_setup(|app| { /* main thread, once */ });
    reg.on_cleanup(|| { /* exit, logoff, fatal panic: must be quick and idempotent */ });
}
```

- Handlers return `SvcResult<T>` (`T: Serialize`); args are any `Deserialize` struct (missing args
  = `{}`, so `#[serde(default)]` fields work) or `NoArgs`.
- Push events with `events::emit(&app, "<domain>", "<topic>", &payload)`; inside an `on_topic`
  loop stop when `!subscriptions::is_current(&key, generation)`.
- Shared helpers: `services::core::{store, secrets, http::fetch, fs, launch}`, `crate::win::{reg_string, reg_dword}`.
- UI side: `call<T>(service, method, args)`, `useService<T>(...)`, `useTopic<T>(service, topic)`.
- Add browser sample data in `src/widgets/<domain>/mock.ts`:
  `mockService("system", { cpu_info: () => ({...}) })`, `mockTopic("system", "cpu", { every: 1000, sample })`.

## Window model (services/shell, src/dock)

One transparent, frameless, always-on-top, skip-taskbar, non-activating window on the primary
monitor. Normally it is just the dock strip (`thickness` CSS px = size + 2×padding + distance + 2);
popovers register their height (`useOverlaySize`) and the window grows away from the edge via
`shell.set_overlay`. The strip is reserved with SHAppBarMessage (maximised windows stop at it); the
Windows taskbar is hidden while GlintBar runs and restored on exit, logoff, main-thread panic, and on
the next start if a crash left `%APPDATA%\GlintBar\taskbar-hidden.json` behind. Text inputs flip the
window to focusable (`shell.set_focusable`). Re-layout on display/DPI/work-area change and Explorer
restart. Also implemented: auto-hide (with "show on desktop"), hiding under full-screen apps,
docks on every display or following the mouse (extra windows share the "dock" layout), closing
popovers on clicks in other apps (`svc://shell/outside-click`) and Esc, dragging the dock to
another edge or screen, global hotkeys (`shell.hotkeys_set` -> `svc://shell/hotkey`).
A watchdog (`services/shell/watchdog.rs`) re-checks every dock every 4 s and after focus/display
changes (exists, shown, topmost, in place, region covers the bar), repairs it and logs one
"dock watchdog" info line saying what was wrong. Compare monitors by device name, never HMONITOR.

## Checking your work

- `npx tsc --noEmit` · `npx vitest run src/widgets/<domain>` · `npx vite build`
- Look at it: `npx vite preview --port 4173` then
  `chromium --headless --no-sandbox --hide-scrollbars --virtual-time-budget=4000 --screenshot=/path/out.png --window-size=1600,800 "http://localhost:4173/?card=<widgetId>"`
  (headless viewport is ~87 px shorter than the window). Params: `theme`, `edge`, `size`,
  `panel=widgets|settings`, `section`, `card`, `dock=<id>,<id>`, `keys=1`, `reset=1`, and
  `profile=bare` (no battery, audio, radios, media session, sensor or AI sign-ins: the payloads a
  real Windows Server returned). Keep screenshots out of the repo.
- After an IPC change: `node scripts/check-ipc.mjs`.

## Empty states and sample data

- Hardware or data that isn't there (no battery, no audio device, nothing playing, no sensor) gets
  a deliberate state: `TileNotice` on the tile (short words, fits size m at size S), an
  `EmptyState` in the card. Never NaN, "undefined", a fake 0 % or a lone icon in a wide tile.
- Sample numbers (with `TileSampleBadge`) only for account tiles that aren't connected yet and
  in picker previews. Hardware and local widgets never show sample data on a real PC.
- The default dock (`DEFAULT_WIDGETS` in src/dock/layout.ts) holds only widgets that work with no
  setup. Background trackers (Screen Time) run only while a widget needs them.
