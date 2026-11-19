//! Dock windows: placement at the screen edge, the reserved strip (app bar), the input region,
//! auto-hide, full-screen suppression, dragging the dock to another edge or screen, and
//! following the pointer between screens.
//!
//! Every dock window ("main", plus "dock-..." windows in Displays = All) is the dock strip plus
//! an overlay area that grows away from the edge for cards and menus. The overlay is sticky: it
//! grows once and stays, so opening a card never resizes the window (no flicker). A window
//! region limits drawing and clicks to what the UI reports as visible (the bar, open cards), so
//! the transparent rest of the window never eats clicks.
//!
//! Threading: Win32 window calls run on the main thread (`on_main`). STATE is never held
//! across a Win32 call, an emit or a store write, so the window procedure and hooks may lock it.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, GetWindowRgnBox, SetWindowRgn, HGDIOBJ, RGN_OR};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows::Win32::UI::Shell::{
    DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass, ABN_FULLSCREENAPP, ABN_POSCHANGED, ABN_STATECHANGE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, GetSystemMetrics, GetWindowDisplayAffinity, GetWindowLongPtrW, GetWindowRect,
    IsWindowVisible, RegisterWindowMessageW, SetForegroundWindow, SetWindowDisplayAffinity, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST, PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMESUSPEND, SM_SWAPBUTTON,
    SPI_SETWORKAREA, STYLESTRUCT, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE,
    SW_SHOWNOACTIVATE, WDA_NONE, WM_ACTIVATE, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_ENDSESSION, WM_HOTKEY, WM_NCDESTROY,
    WM_POWERBROADCAST, WM_SETTINGCHANGE, WM_STYLECHANGING, WM_WINDOWPOSCHANGED, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};

use super::model::{
    desired_visibility, edge_for_point, edge_strip, fit_factor, grown_window, hit_to_window, logical_height, plan,
    sliver, Displays, DockGeometry, Edge, HitRect, PlanMonitor, Rect, TaskbarMode, Visibility, VisibilityInputs,
    MAIN_LABEL,
};
use super::monitors::{self, MonitorInfo};
use super::{appbar, hotkeys, multi, taskbar, watch};
use crate::events;
use crate::services::core::store;

const GEOMETRY_KEY: &str = "shell.geometry";
const SUBCLASS_ID: usize = 0x676c_6e74;
/// Physical px at the edge that stay clickable while auto-hidden.
const SLIVER_PX: i32 = 2;
/// How long the pointer must be away before an auto-hide dock slides away.
const HIDE_DELAY: Duration = Duration::from_millis(650);
/// The UI's slide-out animation; the region shrinks to the sliver after it.
const SLIDE: Duration = Duration::from_millis(230);
/// A programmatic reveal (hotkey) keeps the dock up at least this long.
const REVEAL_HOLD: Duration = Duration::from_millis(2500);

#[derive(Clone, Debug)]
struct Dock {
    label: String,
    hwnd: isize,
    monitor_id: String,
    monitor: Rect,
    /// The monitor's DPI scale (CSS px -> physical px). Never includes `fit`.
    scale: f64,
    /// Screen fit: what the page scales the bar by on this monitor (see model::fit_factor).
    fit: f64,
    /// Height of this dock's monitor in logical px (the page uses it for Proportional).
    screen_height: f64,
    /// Bumped whenever `fit` or `screen_height` changes, so the page can drop an older value.
    fit_seq: u64,
    strip: Option<Rect>,
    reserved: Option<Rect>,
    appbar: bool,
    window: Rect,
    /// CSS px the UI currently needs above the strip (0 = nothing open).
    overlay: f64,
    /// CSS px the window keeps above the strip (only grows, see module docs).
    sticky: f64,
    hits: Vec<HitRect>,
    hit_full: bool,
    /// None = never applied; Some(None) = whole window; Some(Some(list)) = these rects.
    applied_region: Option<Option<Vec<Rect>>>,
    region_ok: bool,
    /// Clickable rects in screen coordinates (for the outside-click hook).
    screen_hits: Vec<Rect>,
    hover: bool,
    held_until: Option<Instant>,
    visibility: Visibility,
    /// The full-screen window covering this dock's screen (0 = none).
    fullscreen_hwnd: isize,
    hide_generation: u64,
    closing: bool,
    shown: bool,
    /// The page called `window_info` (it mounted). A window whose page never does is shown and,
    /// later, reloaded by the watchdog.
    page_ready: bool,
    reloaded: bool,
    created: Instant,
}

impl Dock {
    fn new(label: String, hwnd: isize) -> Dock {
        Dock {
            label,
            hwnd,
            monitor_id: String::new(),
            monitor: Rect::default(),
            scale: 1.0,
            fit: 1.0,
            screen_height: 0.0,
            fit_seq: 0,
            strip: None,
            reserved: None,
            appbar: false,
            window: Rect::default(),
            overlay: 0.0,
            sticky: 0.0,
            hits: Vec::new(),
            hit_full: false,
            applied_region: None,
            region_ok: true,
            screen_hits: Vec::new(),
            hover: false,
            held_until: None,
            visibility: Visibility::Shown,
            fullscreen_hwnd: 0,
            hide_generation: 0,
            closing: false,
            shown: false,
            page_ready: false,
            reloaded: false,
            created: Instant::now(),
        }
    }

    fn set_monitor(&mut self, m: &MonitorInfo) {
        if self.monitor_id != m.id {
            self.reserved = None;
            self.sticky = self.overlay;
            self.fullscreen_hwnd = 0;
        }
        self.monitor_id = m.id.clone();
        self.monitor = m.monitor;
        self.scale = m.scale();
    }
}

#[derive(Default)]
struct State {
    geo: DockGeometry,
    docks: Vec<Dock>,
    /// Displays = Follow: the monitor the dock is on now.
    follow_monitor: String,
    start_open: bool,
    /// Device name of the screen the Start menu opened on ("" = unknown).
    start_monitor: String,
    desktop_in_front: bool,
    /// Label of the dock being dragged.
    drag: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockSnapshot {
    label: String,
    /// The window handle (the smoke harness checks each dock window natively).
    hwnd: i64,
    monitor: String,
    strip: Option<Rect>,
    window: Rect,
    app_bar: bool,
    scale: f64,
    fit: f64,
    overlay: f64,
    sticky: f64,
    visibility: Visibility,
    region_ok: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    geometry: DockGeometry,
    docks: Vec<DockSnapshot>,
    monitors: Vec<MonitorInfo>,
    taskbar_hidden: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    label: String,
    monitor: String,
    primary: bool,
    visibility: Visibility,
    docks: usize,
    /// Screen fit factor for this dock's bar (1 = the size as set).
    fit: f64,
    /// Height of this dock's monitor in logical px (0 = not known yet).
    screen_height: f64,
    fit_seq: u64,
}

/// `svc://shell/fit`: a dock's screen fit changed (its monitor, the display or the settings did).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FitEvent {
    label: String,
    fit: f64,
    screen_height: f64,
    seq: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VisibilityEvent {
    label: String,
    state: Visibility,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LabelEvent {
    label: String,
    at: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PlacementEvent {
    edge: Edge,
    monitor: String,
    at: u64,
}

static STATE: OnceLock<Mutex<State>> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();
static CALLBACK_MSG: AtomicU32 = AtomicU32::new(0);
static TASKBAR_CREATED_MSG: AtomicU32 = AtomicU32::new(0);
static RELAYOUT_PENDING: AtomicBool = AtomicBool::new(false);
static REBUILD_PENDING: AtomicBool = AtomicBool::new(false);
static DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
static FOLLOW_RUNNING: AtomicBool = AtomicBool::new(false);
static REGION_WARNED: AtomicBool = AtomicBool::new(false);

fn state() -> MutexGuard<'static, State> {
    STATE.get_or_init(|| Mutex::new(State::default())).lock().unwrap_or_else(|p| p.into_inner())
}

fn hwnd_of(raw: isize) -> HWND {
    HWND(raw as *mut core::ffi::c_void)
}

fn to_win(r: Rect) -> RECT {
    RECT { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

fn from_win(r: RECT) -> Rect {
    Rect::new(r.left, r.top, r.right, r.bottom)
}

pub(super) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(super) fn app() -> Option<&'static AppHandle> {
    APP.get()
}

/// Runs `f` on the main (UI) thread. From the main thread itself Tauri runs it immediately.
pub(super) fn on_main<F: FnOnce() + Send + 'static>(f: F) {
    if let Some(app) = APP.get() {
        if let Err(e) = app.run_on_main_thread(f) {
            tracing::warn!("could not reach the main thread: {e}");
        }
    }
}

/// Emits `svc://shell/<topic>` without remembering it: these are per-window or one-shot events,
/// so a page that subscribes later must not get a stale replay (it asks `window_info` instead).
pub(super) fn emit<P: Serialize + Clone>(topic: &str, payload: P) {
    if let Some(app) = APP.get() {
        if let Err(e) = app.emit(&events::event_name("shell", topic), payload) {
            tracing::warn!(%topic, "emit failed: {e}");
        }
    }
}

/// Emits `topic` {label, at} for each label (one-shot events; the UI ignores stale replays).
pub(super) fn emit_to_labels(topic: &'static str, labels: Vec<String>) {
    tauri::async_runtime::spawn(async move {
        for label in labels {
            emit(topic, LabelEvent { label, at: now_ms() });
        }
    });
}

fn persist(geo: &DockGeometry) {
    let app = match APP.get() {
        Some(a) => a,
        None => return,
    };
    match serde_json::to_value(geo) {
        Ok(v) => store::set_value(app, GEOMETRY_KEY, v),
        Err(e) => tracing::warn!("could not save the dock geometry: {e}"),
    }
}

fn labels() -> Vec<String> {
    state().docks.iter().filter(|d| !d.closing).map(|d| d.label.clone()).collect()
}

/// Debounced relayout of every dock; safe to request from inside the window procedure.
fn schedule_relayout() {
    if RELAYOUT_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async {
        tokio::time::sleep(Duration::from_millis(80)).await;
        on_main(|| {
            RELAYOUT_PENDING.store(false, Ordering::SeqCst);
            apply_all();
        });
    });
}

/// After sleep/resume (or anything that may have made the shell forget us): register every
/// app bar from scratch, hide the taskbar again and place every dock.
fn schedule_rebuild(reason: &'static str, forget_only: bool) {
    if REBUILD_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    tracing::info!(reason, "re-registering the dock with the shell");
    tauri::async_runtime::spawn(async move {
        // Explorer needs a moment after a restart or resume before it accepts app bars again.
        tokio::time::sleep(Duration::from_millis(1500)).await;
        on_main(move || {
            REBUILD_PENDING.store(false, Ordering::SeqCst);
            let bars: Vec<isize> = {
                let mut s = state();
                let mut out = Vec::new();
                for d in s.docks.iter_mut() {
                    if d.appbar {
                        out.push(d.hwnd);
                    }
                    d.appbar = false;
                    d.reserved = None;
                }
                out
            };
            if !forget_only {
                for raw in bars {
                    unsafe { appbar::unregister(hwnd_of(raw)) };
                }
            }
            apply_all();
            multi::schedule_reconcile();
        });
    });
}

// ---- public API (called from mod.rs handlers on any thread) --------------------------------

/// Main thread, from Tauri setup.
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
    taskbar::recover_if_needed();
    super::crash::install();

    let saved: DockGeometry = store::get_as(GEOMETRY_KEY).unwrap_or_default();
    {
        let mut s = state();
        s.geo = saved.sanitized();
        s.follow_monitor = s.geo.monitor.clone();
    }
    unsafe {
        CALLBACK_MSG.store(RegisterWindowMessageW(w!("GlintBar.AppBarNotify")), Ordering::SeqCst);
        TASKBAR_CREATED_MSG.store(RegisterWindowMessageW(w!("TaskbarCreated")), Ordering::SeqCst);
    }
    let window = match app.get_webview_window(MAIN_LABEL) {
        Some(w) => w,
        None => {
            tracing::error!("the main window is missing");
            return;
        }
    };
    attach(&window);
    apply_all();
    if let Err(e) = window.show() {
        tracing::error!("could not show the dock: {e}");
    }
    if let Some(d) = state().docks.iter_mut().find(|d| d.label == MAIN_LABEL) {
        d.shown = true;
    }
    if let Some(raw) = main_hwnd() {
        set_topmost(hwnd_of(raw));
    }
    watch::install();
    super::watchdog::start();
    multi::schedule_reconcile();
    ensure_follow_poller();
    for l in labels() {
        update_visibility(&l);
    }
    let placed = state().geo.clone();
    tracing::info!(geometry = ?placed, "dock window placed");
    log_diagnostics("start");
    // Again once the page has loaded and reported its clickable areas, and once settled.
    schedule_diagnostics("start+3s", Duration::from_secs(3));
    schedule_diagnostics("start+15s", Duration::from_secs(15));
}

pub(super) fn fmt_rect(r: Rect) -> String {
    format!("{},{},{},{} ({}x{})", r.left, r.top, r.right, r.bottom, r.width(), r.height())
}

/// Logs (info) one dock window's placement as Windows reports it, so a dock that is not on
/// screen can be diagnosed from the log alone. Main thread.
pub(super) fn log_diagnostics(reason: &'static str) {
    let docks: Vec<Dock> = state().docks.clone();
    let (geo, taskbar_hidden) = (state().geo.clone(), taskbar::is_hidden());
    for d in docks {
        if d.hwnd == 0 {
            continue;
        }
        let h = hwnd_of(d.hwnd);
        let mut wr = RECT::default();
        let window = match unsafe { GetWindowRect(h, &mut wr as *mut RECT) } {
            Ok(()) => Some(from_win(wr)),
            Err(_) => None,
        };
        let visible = unsafe { IsWindowVisible(h) }.as_bool();
        let mut rb = RECT::default();
        let kind = unsafe { GetWindowRgnBox(h, &mut rb as *mut RECT) }.0;
        // 0 = no region (the whole window), 1 = empty, otherwise the region's bounding box.
        let region = match kind {
            0 => "whole window".to_string(),
            1 => "EMPTY".to_string(),
            _ => fmt_rect(from_win(rb)),
        };
        let mut affinity: u32 = 0;
        let affinity = match unsafe { GetWindowDisplayAffinity(h, &mut affinity as *mut u32) } {
            Ok(()) => affinity,
            Err(_) => u32::MAX,
        };
        let exstyle = unsafe { GetWindowLongPtrW(h, GWL_EXSTYLE) } as u64;
        let on_monitor = window
            .map(|w| w.left < d.monitor.right && w.right > d.monitor.left && w.top < d.monitor.bottom && w.bottom > d.monitor.top)
            .unwrap_or(false);
        tracing::info!(
            reason,
            label = %d.label,
            visible,
            window = %window.map(fmt_rect).unwrap_or_else(|| "unknown".into()),
            region = %region,
            hits = d.hits.len(),
            strip = %d.strip.map(fmt_rect).unwrap_or_else(|| "none".into()),
            monitor = %d.monitor_id,
            monitor_rect = %fmt_rect(d.monitor),
            scale = d.scale,
            fit = d.fit,
            on_monitor,
            visibility = ?d.visibility,
            app_bar = d.appbar,
            fullscreen_over = d.fullscreen_hwnd != 0,
            affinity,
            exstyle = %format!("{exstyle:#x}"),
            edge = ?geo.edge,
            thickness = geo.thickness,
            taskbar_hidden,
            "dock window diagnostics"
        );
        if !visible || kind == 1 || affinity != 0 || !on_monitor {
            tracing::warn!(
                label = %d.label,
                visible,
                empty_region = kind == 1,
                excluded_from_capture = affinity != 0,
                on_monitor,
                "the dock window may not be visible on screen"
            );
        }
    }
}

pub(super) fn schedule_diagnostics(reason: &'static str, delay: Duration) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        on_main(move || log_diagnostics(reason));
    });
}

/// Main thread. Subclasses a dock window and adds it to the state.
pub(super) fn attach(window: &WebviewWindow) {
    let label = window.label().to_string();
    let handle = match window.hwnd() {
        Ok(h) => h,
        Err(e) => {
            tracing::error!(%label, "no window handle: {e}");
            return;
        }
    };
    let raw = handle.0 as isize;
    {
        let mut s = state();
        match s.docks.iter_mut().find(|d| d.label == label) {
            Some(d) => d.hwnd = raw,
            None => s.docks.push(Dock::new(label.clone(), raw)),
        }
    }
    unsafe {
        if !SetWindowSubclass(handle, Some(subclass_proc), SUBCLASS_ID, 0).as_bool() {
            tracing::warn!(%label, "could not subclass the dock window; display changes will not re-layout");
        }
        apply_tool_window_style(handle);
        // Visible in screenshots, screen sharing and recordings by default; only live glass
        // (services/appearance) excludes the main dock from capture, and only while it runs.
        if let Err(e) = SetWindowDisplayAffinity(handle, WDA_NONE) {
            tracing::debug!(%label, "SetWindowDisplayAffinity(none) failed: {e}");
        }
    }
}

/// Removes a dock from the state (its window is about to be destroyed). Main thread.
pub(super) fn forget(label: &str) {
    let (raw, monitor) = {
        let mut s = state();
        let pos = s.docks.iter().position(|d| d.label == label);
        match pos {
            Some(i) => {
                let d = s.docks.remove(i);
                (if d.appbar { d.hwnd } else { 0 }, Some(d.monitor_id))
            }
            None => (0, None),
        }
    };
    if let Some(monitor) = monitor {
        tracing::info!(%label, %monitor, "dock window dropped from the dock list (its window is closing or gone)");
    }
    if raw != 0 {
        unsafe { appbar::unregister(hwnd_of(raw)) };
    }
}

pub(super) fn mark_closing(label: &str) -> bool {
    let mut s = state();
    match s.docks.iter_mut().find(|d| d.label == label) {
        Some(d) if !d.closing => {
            d.closing = true;
            true
        }
        _ => false,
    }
}

/// (label, closing) of every dock window we know.
pub(super) fn known_docks() -> Vec<(String, bool)> {
    state().docks.iter().map(|d| (d.label.clone(), d.closing)).collect()
}

pub(super) fn current_plan(mons: &[MonitorInfo]) -> Vec<(String, String)> {
    let pm: Vec<PlanMonitor> = mons.iter().map(|m| PlanMonitor { id: m.id.clone(), primary: m.primary }).collect();
    let s = state();
    plan(&pm, s.geo.displays, &s.geo.monitor, &s.follow_monitor)
}

pub fn set_geometry(geo: DockGeometry) {
    let geo = geo.sanitized();
    let (displays_changed, auto_changed) = {
        let mut s = state();
        if s.geo == geo {
            return;
        }
        let displays_changed = s.geo.displays != geo.displays || s.geo.monitor != geo.monitor;
        let auto_changed = s.geo.auto_hide != geo.auto_hide || s.geo.show_on_desktop != geo.show_on_desktop;
        if s.geo.monitor != geo.monitor {
            s.follow_monitor = geo.monitor.clone();
        }
        if s.geo.edge != geo.edge {
            for d in s.docks.iter_mut() {
                d.reserved = None;
            }
        }
        s.geo = geo.clone();
        (displays_changed, auto_changed)
    };
    persist(&geo);
    on_main(apply_all);
    if displays_changed {
        multi::schedule_reconcile();
        ensure_follow_poller();
    }
    if auto_changed {
        for l in labels() {
            update_visibility(&l);
        }
    }
}

pub fn set_overlay(label: &str, height: f64) {
    let h = if height.is_finite() { height.clamp(0.0, 4000.0) } else { 0.0 };
    let (grow, popover_changed) = {
        let mut s = state();
        let d = match s.docks.iter_mut().find(|d| d.label == label) {
            Some(d) => d,
            None => return,
        };
        let was_open = d.overlay > 0.5;
        d.overlay = h;
        let mut grow = false;
        if h > d.sticky + 0.5 {
            d.sticky = h;
            grow = true;
        } else if !d.region_ok && h + 0.5 < d.sticky {
            // Without a working region the transparent overlay would eat clicks: shrink back.
            d.sticky = h;
            grow = true;
        }
        (grow, was_open != (h > 0.5))
    };
    if grow {
        let l = label.to_string();
        on_main(move || apply_window_rect(&l, false));
    }
    if popover_changed {
        update_visibility(label);
        let any = state().docks.iter().any(|d| d.overlay > 0.5);
        on_main(move || watch::set_popover_watch(any));
    }
}

pub fn set_hits(label: &str, rects: Vec<HitRect>, full: bool) {
    {
        let mut s = state();
        let d = match s.docks.iter_mut().find(|d| d.label == label) {
            Some(d) => d,
            None => return,
        };
        d.hits = rects.into_iter().take(64).collect();
        d.hit_full = full;
    }
    let l = label.to_string();
    on_main(move || apply_region(&l));
}

pub fn set_hover(label: &str, inside: bool) {
    {
        let mut s = state();
        match s.docks.iter_mut().find(|d| d.label == label) {
            Some(d) if d.hover != inside => d.hover = inside,
            _ => return,
        }
    }
    update_visibility(label);
}

/// Brings an auto-hidden dock up for a moment (hotkeys, the tray).
pub fn reveal(label: &str) {
    {
        let mut s = state();
        match s.docks.iter_mut().find(|d| d.label == label) {
            Some(d) => d.held_until = Some(Instant::now() + REVEAL_HOLD),
            None => return,
        }
    }
    update_visibility(label);
    let l = label.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(REVEAL_HOLD + Duration::from_millis(100)).await;
        update_visibility(&l);
    });
}

pub fn window_info(label: &str) -> WindowInfo {
    let mons = monitors::all();
    let (info, show) = {
        let mut s = state();
        let count = s.docks.len();
        match s.docks.iter_mut().find(|d| d.label == label) {
            Some(d) => {
                let show = !d.shown && d.label != MAIN_LABEL;
                d.shown = true;
                d.page_ready = true;
                let primary = mons.iter().any(|m| m.id == d.monitor_id && m.primary);
                (
                    WindowInfo {
                        label: d.label.clone(),
                        monitor: d.monitor_id.clone(),
                        primary,
                        visibility: d.visibility,
                        docks: count,
                        fit: d.fit,
                        screen_height: d.screen_height,
                        fit_seq: d.fit_seq,
                    },
                    show,
                )
            }
            None => (
                WindowInfo {
                    label: label.to_string(),
                    monitor: String::new(),
                    primary: true,
                    visibility: Visibility::Shown,
                    docks: count,
                    fit: 1.0,
                    screen_height: 0.0,
                    fit_seq: 0,
                },
                false,
            ),
        }
    };
    if show {
        // A new dock window shows only once its page is ready, so it never flashes white.
        let l = label.to_string();
        on_main(move || show_dock(&l));
    }
    info
}

pub fn monitors_list() -> Vec<MonitorInfo> {
    monitors::all()
}

pub fn snapshot() -> Snapshot {
    let mons = monitors::all();
    let s = state();
    Snapshot {
        geometry: s.geo.clone(),
        docks: s
            .docks
            .iter()
            .map(|d| DockSnapshot {
                label: d.label.clone(),
                hwnd: d.hwnd as i64,
                monitor: d.monitor_id.clone(),
                strip: d.strip,
                window: d.window,
                app_bar: d.appbar,
                scale: d.scale,
                fit: d.fit,
                overlay: d.overlay,
                sticky: d.sticky,
                visibility: d.visibility,
                region_ok: d.region_ok,
            })
            .collect(),
        monitors: mons,
        taskbar_hidden: taskbar::is_hidden(),
    }
}

/// Exit / logoff / fatal panic / crash: give the screen space back and bring the taskbar back.
/// Must not block on the main thread or on STATE.
pub fn cleanup() {
    let bars: Vec<isize> = match STATE.get().map(|m| m.try_lock()) {
        Some(Ok(mut s)) => {
            let mut out = Vec::new();
            for d in s.docks.iter_mut() {
                if d.appbar {
                    out.push(d.hwnd);
                    d.appbar = false;
                }
            }
            out
        }
        _ => Vec::new(),
    };
    for raw in bars {
        unsafe { appbar::unregister(hwnd_of(raw)) };
    }
    let _ = watch::remove_hooks();
    taskbar::restore();
}

/// The dock on the screen under the pointer (hotkeys open there), else "main".
pub(super) fn label_at_cursor() -> String {
    let mut pt = POINT::default();
    if unsafe { GetCursorPos(&mut pt) }.is_err() {
        return MAIN_LABEL.to_string();
    }
    let id = match monitors::at_point(pt.x, pt.y) {
        Some(m) => m.id,
        None => return MAIN_LABEL.to_string(),
    };
    let s = state();
    s.docks
        .iter()
        .find(|d| d.monitor_id == id && !d.closing)
        .map(|d| d.label.clone())
        .unwrap_or_else(|| MAIN_LABEL.to_string())
}

pub(super) fn main_hwnd() -> Option<isize> {
    state().docks.iter().find(|d| d.label == MAIN_LABEL).map(|d| d.hwnd)
}

// ---- layout (main thread) ---------------------------------------------------------------------

/// Assigns monitors, applies the taskbar choice and places every dock. Main thread.
pub(super) fn apply_all() {
    if crate::lifecycle::is_cleaning_up() {
        return;
    }
    let mons = monitors::all();
    let planned = current_plan(&mons);
    {
        let mut s = state();
        for d in s.docks.iter_mut() {
            if let Some((_, id)) = planned.iter().find(|(l, _)| *l == d.label) {
                if let Some(m) = mons.iter().find(|m| m.id == *id) {
                    if !d.monitor_id.is_empty() && d.monitor_id != m.id {
                        tracing::info!(label = %d.label, from = %d.monitor_id, to = %m.id, "dock moves to another monitor (display plan changed)");
                    }
                    d.set_monitor(m);
                }
            }
        }
    }
    apply_taskbar();
    for l in labels() {
        relayout(&l);
    }
}

fn apply_taskbar() {
    let (mode, screens) = {
        let s = state();
        // Device names, not HMONITORs: those change when displays are added, removed or woken.
        let screens: Vec<String> =
            s.docks.iter().filter(|d| !d.closing && !d.monitor_id.is_empty()).map(|d| d.monitor_id.clone()).collect();
        (s.geo.taskbar_mode(), screens)
    };
    taskbar::apply(mode, &screens);
}

/// Recomputes one dock's strip from its monitor, DPI and app bar, then places the window.
fn relayout(label: &str) {
    let (raw, geo, monitor_id, last_reserved, appbar_on, dragging) = {
        let s = state();
        let d = match s.docks.iter().find(|d| d.label == label) {
            Some(d) => d,
            None => return,
        };
        (d.hwnd, s.geo.clone(), d.monitor_id.clone(), d.reserved, d.appbar, s.drag.is_some())
    };
    if dragging || raw == 0 {
        return;
    }
    let h = hwnd_of(raw);
    let mon = match monitors::by_id(&monitor_id) {
        Some(m) => m,
        None if label != MAIN_LABEL && !monitor_id.is_empty() => {
            // An extra dock belongs to its own display. Never move it onto the primary one (it would
            // sit on top of the main dock and look gone); the reconcile closes it if the display is.
            tracing::info!(%label, monitor = %monitor_id, "the dock's monitor is not reported right now; leaving its window where it is");
            return;
        }
        None => match monitors::primary() {
            Some(m) => {
                if !monitor_id.is_empty() {
                    tracing::info!(%label, missing = %monitor_id, primary = %m.id, "the dock's monitor is not reported; placing the dock on the primary monitor");
                }
                m
            }
            None => {
                tracing::warn!("no monitor found for the dock");
                return;
            }
        },
    };
    let scale = mon.scale();
    // Screen fit: the page draws the bar `fit` times its set size, so the strip is too. `scale`
    // stays the pure DPI scale (hit rects and overlay heights are CSS px).
    let screen_height = logical_height(mon.monitor, scale);
    let fit = fit_factor(geo.screen_fit, screen_height, geo.screen_fit_ref, geo.fit_min, geo.fit_max);
    let thickness = ((geo.thickness * fit * scale).round() as i32).clamp(8, mon.monitor.height().max(8));
    let want = geo.wants_app_bar();
    let mut appbar_now = appbar_on;
    if want && !appbar_on {
        if unsafe { appbar::register(h, CALLBACK_MSG.load(Ordering::SeqCst)) } {
            appbar_now = true;
        } else {
            tracing::warn!(%label, "the shell refused the app bar; maximised windows may cover the dock");
        }
    } else if !want && appbar_on {
        unsafe { appbar::unregister(h) };
        appbar_now = false;
    }
    // With our own app bar (or the taskbar out of the way) start from the monitor edge and let
    // the shell move us past other app bars; otherwise sit at the edge of the work area.
    let base = if appbar_now || geo.taskbar_mode() != TaskbarMode::Normal { mon.monitor } else { mon.work };
    let strip = if appbar_now {
        let last = if appbar_on { last_reserved.map(to_win) } else { None };
        from_win(unsafe { appbar::reserve(h, geo.edge, to_win(base), thickness, last) })
    } else {
        edge_strip(base, geo.edge, thickness)
    };
    let (previous, fit_event) = {
        let mut s = state();
        match s.docks.iter_mut().find(|d| d.label == label) {
            Some(d) => {
                let previous = d.strip;
                d.appbar = appbar_now;
                d.set_monitor(&mon);
                d.strip = Some(strip);
                d.reserved = if appbar_now { Some(strip) } else { None };
                let fit_changed = (d.fit - fit).abs() > 1e-6 || (d.screen_height - screen_height).abs() > 0.5;
                d.fit = fit;
                d.screen_height = screen_height;
                let event = if fit_changed {
                    d.fit_seq += 1;
                    Some(FitEvent { label: d.label.clone(), fit, screen_height, seq: d.fit_seq })
                } else {
                    None
                };
                (previous, event)
            }
            None => (None, None),
        }
    };
    if let Some(event) = fit_event {
        tracing::info!(%label, fit, screen_height, "dock screen fit");
        emit("fit", event);
    }
    if previous != Some(strip) {
        tracing::info!(
            %label,
            monitor = %mon.id,
            monitor_rect = %fmt_rect(mon.monitor),
            work = %fmt_rect(mon.work),
            dpi = mon.dpi,
            fit,
            thickness,
            strip = %fmt_rect(strip),
            app_bar = appbar_now,
            "dock strip placed"
        );
    }
    apply_window_rect(label, true);
}

/// Places the window: the strip plus the sticky overlay, grown away from the edge.
fn apply_window_rect(label: &str, force: bool) {
    let (raw, strip, monitor, edge, sticky, scale, current, dragging) = {
        let s = state();
        let d = match s.docks.iter().find(|d| d.label == label) {
            Some(d) => d,
            None => return,
        };
        (d.hwnd, d.strip, d.monitor, s.geo.edge, d.sticky, d.scale, d.window, s.drag.as_deref() == Some(label))
    };
    let strip = match strip {
        Some(r) => r,
        None => return,
    };
    if dragging {
        return;
    }
    let extra = (sticky * if scale > 0.0 { scale } else { 1.0 }).round() as i32;
    let rect = grown_window(strip, monitor, edge, extra);
    if force || rect != current {
        let h = hwnd_of(raw);
        let result = unsafe { SetWindowPos(h, Some(HWND_TOPMOST), rect.left, rect.top, rect.width(), rect.height(), SWP_NOACTIVATE) };
        match result {
            Ok(()) => {
                let mut s = state();
                if let Some(d) = s.docks.iter_mut().find(|d| d.label == label) {
                    d.window = rect;
                }
            }
            Err(e) => tracing::warn!(%label, "SetWindowPos failed: {e}"),
        }
    }
    apply_region(label);
}

/// Limits drawing and clicks to the visible parts. Main thread.
fn apply_region(label: &str) {
    let (raw, wanted, window) = {
        let s = state();
        let d = match s.docks.iter().find(|d| d.label == label) {
            Some(d) => d,
            None => return,
        };
        let dragging = s.drag.as_deref() == Some(label);
        let w = d.window.width();
        let h = d.window.height();
        if w <= 0 || h <= 0 {
            return;
        }
        let wanted: Option<Vec<Rect>> = if dragging || d.hit_full {
            None
        } else {
            match d.visibility {
                Visibility::Suppressed => Some(Vec::new()),
                Visibility::Autohidden => Some(vec![sliver(s.geo.edge, w, h, SLIVER_PX)]),
                Visibility::Shown => {
                    let mut list: Vec<Rect> =
                        d.hits.iter().filter_map(|hit| hit_to_window(hit, s.geo.edge, d.scale, w, h)).collect();
                    if list.is_empty() {
                        if let Some(strip) = d.strip {
                            list.push(strip.offset(-d.window.left, -d.window.top));
                        }
                    }
                    Some(list)
                }
            }
        };
        if d.applied_region.as_ref() == Some(&wanted) {
            return;
        }
        (d.hwnd, wanted, d.window)
    };
    let ok = unsafe { set_region(hwnd_of(raw), wanted.as_deref()) };
    if !ok && !REGION_WARNED.swap(true, Ordering::SeqCst) {
        tracing::warn!("SetWindowRgn failed; the dock window will not let clicks through its empty parts");
    }
    let screen: Vec<Rect> = match &wanted {
        Some(list) => list.iter().map(|r| r.offset(window.left, window.top)).collect(),
        None => vec![window],
    };
    let mut s = state();
    if let Some(d) = s.docks.iter_mut().find(|d| d.label == label) {
        d.applied_region = Some(wanted);
        d.region_ok = ok;
        d.screen_hits = screen;
    }
}

/// None = the whole window. The system owns the region after a successful SetWindowRgn.
unsafe fn set_region(h: HWND, rects: Option<&[Rect]>) -> bool {
    match rects {
        None => unsafe { SetWindowRgn(h, None, true) != 0 },
        Some(list) => unsafe {
            let rgn = CreateRectRgn(0, 0, 0, 0);
            if rgn.is_invalid() {
                return false;
            }
            for r in list {
                let part = CreateRectRgn(r.left, r.top, r.right, r.bottom);
                if !part.is_invalid() {
                    let _ = CombineRgn(Some(rgn), Some(rgn), Some(part), RGN_OR);
                    let _ = DeleteObject(HGDIOBJ::from(part));
                }
            }
            if SetWindowRgn(h, Some(rgn), true) == 0 {
                let _ = DeleteObject(HGDIOBJ::from(rgn));
                false
            } else {
                true
            }
        },
    }
}

fn set_topmost(h: HWND) {
    unsafe {
        let _ = SetWindowPos(h, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

fn show_dock(label: &str) {
    let (raw, vis) = {
        let s = state();
        match s.docks.iter().find(|d| d.label == label) {
            Some(d) => (d.hwnd, d.visibility),
            None => return,
        }
    };
    if raw == 0 || vis == Visibility::Suppressed {
        return;
    }
    sync_toolkit_visible(label, raw);
    unsafe {
        let _ = ShowWindow(hwnd_of(raw), SW_SHOWNOACTIVATE);
    }
    set_topmost(hwnd_of(raw));
}

/// Tells the window toolkit (tao) that a dock window is shown. The extra docks ("dock-...") are
/// created hidden and shown with ShowWindow, which the toolkit never sees: it keeps them marked
/// hidden, and its next style change - `set_focusable` when a text field, a dropdown or keyboard
/// navigation takes the keyboard - then hides the window (SW_HIDE). That made the dock on a
/// second display vanish around its menu and Settings. A no-op once the toolkit knows (always
/// for "main", shown through the toolkit at start). Call with STATE unlocked. Main thread.
fn sync_toolkit_visible(label: &str, raw: isize) {
    let w = match APP.get().and_then(|app| app.get_webview_window(label)) {
        Some(w) => w,
        None => return,
    };
    let h = hwnd_of(raw);
    let before = unsafe { GetForegroundWindow() };
    if let Err(e) = w.show() {
        tracing::warn!(%label, "could not mark the dock window as shown: {e}");
        return;
    }
    // The toolkit shows a window with SW_SHOW, which may activate it: give the foreground back.
    let after = unsafe { GetForegroundWindow() };
    if after == h && before != h && !before.is_invalid() {
        let ok = unsafe { SetForegroundWindow(before) }.as_bool();
        tracing::info!(%label, ok, "the dock window took the foreground when shown; handed it back");
    }
}

/// After `set_focusable`: the toolkit rewrites the window's styles and may show or hide it on
/// its own. Puts the dock back the way GlintBar wants it (hidden only under a full-screen app on
/// its screen, otherwise shown and topmost) and logs when the toolkit had changed that.
/// Main thread.
pub(super) fn after_focus_change(label: &str) {
    let (raw, vis, shown, monitor) = {
        let s = state();
        match s.docks.iter().find(|d| d.label == label && !d.closing) {
            Some(d) => (d.hwnd, d.visibility, d.shown, d.monitor_id.clone()),
            None => return,
        }
    };
    if raw == 0 {
        return;
    }
    let h = hwnd_of(raw);
    let visible = unsafe { IsWindowVisible(h) }.as_bool();
    if vis == Visibility::Suppressed {
        if visible {
            tracing::info!(%label, %monitor, reason = "focus change while a full-screen app covers its screen", "hiding the dock window again");
            unsafe {
                let _ = ShowWindow(h, SW_HIDE);
            }
        }
        return;
    }
    if !shown {
        return;
    }
    if !visible {
        tracing::info!(%label, %monitor, reason = "a focus change hid it", "showing the dock window again");
        sync_toolkit_visible(label, raw);
        unsafe {
            let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
        }
    }
    set_topmost(h);
}

/// Keeps the dock out of Alt+Tab. Re-applied by WM_STYLECHANGING whenever tao rewrites styles.
unsafe fn apply_tool_window_style(h: HWND) {
    unsafe {
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
        let wanted = (ex | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize);
        if wanted != ex {
            SetWindowLongPtrW(h, GWL_EXSTYLE, wanted);
            let _ = SetWindowPos(h, None, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        }
    }
}

// ---- watchdog support (main thread; see watchdog.rs) ---------------------------------------------

/// One dock as the watchdog sees it.
pub(super) struct GuardInfo {
    pub(super) label: String,
    pub(super) hwnd: isize,
    pub(super) monitor_id: String,
    /// The monitor's DPI (what the strip and the input region were computed with).
    pub(super) dpi: u32,
    pub(super) strip: Option<Rect>,
    /// Where GlintBar last put the window.
    pub(super) window: Rect,
    pub(super) visibility: Visibility,
    /// A list of rects was applied as the window region (not "the whole window").
    pub(super) expects_region: bool,
    pub(super) shown: bool,
    pub(super) page_ready: bool,
    pub(super) reloaded: bool,
    pub(super) age: Duration,
}

/// Every dock that is placed and not closing; None while the dock is being dragged.
pub(super) fn guard_targets() -> Option<Vec<GuardInfo>> {
    if DRAG_ACTIVE.load(Ordering::SeqCst) {
        return None;
    }
    let s = state();
    if s.drag.is_some() {
        return None;
    }
    let list = s
        .docks
        .iter()
        .filter(|d| !d.closing && d.hwnd != 0 && d.strip.is_some())
        .map(|d| GuardInfo {
            label: d.label.clone(),
            hwnd: d.hwnd,
            monitor_id: d.monitor_id.clone(),
            dpi: (d.scale * 96.0).round() as u32,
            strip: d.strip,
            window: d.window,
            visibility: d.visibility,
            expects_region: d.region_ok && matches!(d.applied_region, Some(Some(_))),
            shown: d.shown,
            page_ready: d.page_ready,
            reloaded: d.reloaded,
            age: d.created.elapsed(),
        })
        .collect();
    Some(list)
}

fn hwnd_for(label: &str) -> Option<isize> {
    state().docks.iter().find(|d| d.label == label && d.hwnd != 0).map(|d| d.hwnd)
}

/// Shows a dock window that should be on screen (without activating it) and puts it on top.
pub(super) fn guard_show(label: &str) {
    let raw = {
        let mut s = state();
        match s.docks.iter_mut().find(|d| d.label == label && d.hwnd != 0) {
            Some(d) => {
                d.shown = true;
                d.hwnd
            }
            None => return,
        }
    };
    sync_toolkit_visible(label, raw);
    unsafe {
        let _ = ShowWindow(hwnd_of(raw), SW_SHOWNOACTIVATE);
    }
    set_topmost(hwnd_of(raw));
    guard_region(label);
}

/// HWND_TOPMOST again, without activating.
pub(super) fn guard_topmost(label: &str) {
    if let Some(raw) = hwnd_for(label) {
        set_topmost(hwnd_of(raw));
    }
}

/// Puts the window back on its monitor at its strip (and re-applies its region).
pub(super) fn guard_place(label: &str) {
    {
        let mut s = state();
        if let Some(d) = s.docks.iter_mut().find(|d| d.label == label) {
            d.applied_region = None;
        }
    }
    relayout(label);
}

/// Applies the window region again even if GlintBar thinks it is already there.
pub(super) fn guard_region(label: &str) {
    {
        let mut s = state();
        if let Some(d) = s.docks.iter_mut().find(|d| d.label == label) {
            d.applied_region = None;
        }
    }
    apply_region(label);
}

/// The window is gone: drop it (its app bar too) so the next reconcile creates it again.
pub(super) fn guard_forget(label: &str) {
    if label == MAIN_LABEL {
        return;
    }
    forget(label);
    apply_all();
}

/// Reloads a dock page that never reported ready (once per window).
pub(super) fn guard_reload(label: &str) {
    {
        let mut s = state();
        match s.docks.iter_mut().find(|d| d.label == label) {
            Some(d) if !d.reloaded => d.reloaded = true,
            _ => return,
        }
    }
    if let Some(app) = APP.get() {
        if let Some(w) = app.get_webview_window(label) {
            if let Err(e) = w.reload() {
                tracing::warn!(%label, "could not reload the dock page: {e}");
            }
        }
    }
}

// ---- visibility: auto-hide and full screen ------------------------------------------------------

fn inputs_for(s: &State, d: &Dock) -> VisibilityInputs {
    VisibilityInputs {
        fullscreen: d.fullscreen_hwnd != 0,
        auto_hide: s.geo.auto_hide,
        dragging: s.drag.as_deref() == Some(d.label.as_str()),
        hover: d.hover,
        popover: d.overlay > 0.5,
        start_open: s.start_open && (s.start_monitor.is_empty() || s.start_monitor == d.monitor_id),
        desktop_in_front: s.desktop_in_front,
        show_on_desktop: s.geo.show_on_desktop,
        held: d.held_until.map(|t| t > Instant::now()).unwrap_or(false),
    }
}

/// Re-evaluates one dock. Showing is immediate; sliding away waits for HIDE_DELAY.
pub(super) fn update_visibility(label: &str) {
    let (current, desired, generation) = {
        let mut s = state();
        let inputs = match s.docks.iter().find(|d| d.label == label) {
            Some(d) => inputs_for(&s, d),
            None => return,
        };
        let desired = desired_visibility(&inputs);
        match s.docks.iter_mut().find(|d| d.label == label) {
            Some(d) => {
                d.hide_generation += 1;
                (d.visibility, desired, d.hide_generation)
            }
            None => return,
        }
    };
    if current == desired {
        return;
    }
    let l = label.to_string();
    if desired == Visibility::Autohidden && current == Visibility::Shown {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(HIDE_DELAY).await;
            let still = {
                let s = state();
                match s.docks.iter().find(|d| d.label == l) {
                    Some(d) => {
                        d.hide_generation == generation
                            && d.visibility == Visibility::Shown
                            && desired_visibility(&inputs_for(&s, d)) == Visibility::Autohidden
                    }
                    None => false,
                }
            };
            if still {
                on_main(move || apply_visibility(&l, Visibility::Autohidden));
            }
        });
    } else {
        on_main(move || apply_visibility(&l, desired));
    }
}

fn apply_visibility(label: &str, vis: Visibility) {
    let (raw, prev) = {
        let mut s = state();
        match s.docks.iter_mut().find(|d| d.label == label) {
            Some(d) if d.visibility != vis => {
                let prev = d.visibility;
                d.visibility = vis;
                (d.hwnd, prev)
            }
            _ => return,
        }
    };
    let h = hwnd_of(raw);
    let event = VisibilityEvent { label: label.to_string(), state: vis };
    let monitor = state().docks.iter().find(|d| d.label == label).map(|d| d.monitor_id.clone()).unwrap_or_default();
    match vis {
        Visibility::Shown => {
            if prev == Visibility::Suppressed {
                tracing::info!(%label, %monitor, "full-screen app gone: showing the dock");
                sync_toolkit_visible(label, raw);
                unsafe {
                    let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
                }
            }
            set_topmost(h);
            apply_region(label);
            emit("visibility", event.clone());
        }
        Visibility::Autohidden => {
            tracing::info!(%label, %monitor, reason = "auto-hide (pointer away, nothing open)", "dock slides away to its edge sliver");
            if prev == Visibility::Suppressed {
                sync_toolkit_visible(label, raw);
                unsafe {
                    let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
                }
                set_topmost(h);
            }
            emit("visibility", event.clone());
            // Let the UI slide out first, then shrink the clickable area to the sliver.
            let l = label.to_string();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(SLIDE).await;
                on_main(move || apply_region(&l));
            });
        }
        Visibility::Suppressed => {
            let over = state().docks.iter().find(|d| d.label == label).map(|d| d.fullscreen_hwnd).unwrap_or(0);
            tracing::info!(%label, %monitor, over = %watch::describe_window(over), "full-screen app in front: hiding the dock");
            emit("visibility", event.clone());
            unsafe {
                let _ = ShowWindow(h, SW_HIDE);
            }
        }
    }
    if prev == Visibility::Suppressed || vis == Visibility::Suppressed {
        #[derive(Serialize, Clone)]
        struct Fullscreen {
            label: String,
            active: bool,
        }
        emit("fullscreen", Fullscreen { label: label.to_string(), active: vis == Visibility::Suppressed });
    }
}

/// (label, monitor device name, current full-screen window) for each dock, for the watcher.
pub(super) fn dock_screens() -> Vec<(String, String, isize)> {
    state().docks.iter().filter(|d| !d.closing).map(|d| (d.label.clone(), d.monitor_id.clone(), d.fullscreen_hwnd)).collect()
}

/// What the foreground watcher found.
pub(super) fn set_watch_result(start_open: bool, start_monitor: String, desktop: bool, fullscreen: Vec<(String, isize)>) {
    let changed: Vec<String> = {
        let mut s = state();
        let global = s.start_open != start_open || s.start_monitor != start_monitor || s.desktop_in_front != desktop;
        s.start_open = start_open;
        s.start_monitor = start_monitor;
        s.desktop_in_front = desktop;
        let mut out = Vec::new();
        for d in s.docks.iter_mut() {
            let fs = fullscreen.iter().find(|(l, _)| *l == d.label).map(|(_, h)| *h).unwrap_or(0);
            if d.fullscreen_hwnd != fs {
                d.fullscreen_hwnd = fs;
                out.push(d.label.clone());
            } else if global {
                out.push(d.label.clone());
            }
        }
        out
    };
    for l in changed {
        update_visibility(&l);
    }
}

/// A mouse button went down somewhere (low-level hook, main thread). Tells every dock with an
/// open card or menu whose visible area does not contain the point. Never blocks.
pub(super) fn on_global_click(x: i32, y: i32) {
    let labels: Vec<String> = match STATE.get().map(|m| m.try_lock()) {
        Some(Ok(s)) => s
            .docks
            .iter()
            .filter(|d| d.overlay > 0.5 && !d.screen_hits.iter().any(|r| r.contains(x, y)))
            .map(|d| d.label.clone())
            .collect(),
        _ => return,
    };
    if !labels.is_empty() {
        emit_to_labels("outside-click", labels);
    }
}

/// Esc anywhere while a card or menu is open (low-level hook, main thread). Never blocks.
pub(super) fn on_global_escape() {
    let labels: Vec<String> = match STATE.get().map(|m| m.try_lock()) {
        Some(Ok(s)) => s.docks.iter().filter(|d| d.overlay > 0.5).map(|d| d.label.clone()).collect(),
        _ => return,
    };
    if !labels.is_empty() {
        tracing::info!(?labels, "Esc with a popover open and the dock not focused: closing it");
        emit_to_labels("escape", labels);
    }
}

// ---- dragging the dock to another edge or screen -------------------------------------------------

fn primary_button_down() -> bool {
    unsafe {
        let swapped = GetSystemMetrics(SM_SWAPBUTTON) != 0;
        let vk = if swapped { VK_RBUTTON } else { VK_LBUTTON };
        (GetAsyncKeyState(vk.0 as i32) as u16 & 0x8000) != 0
    }
}

/// The UI saw the pointer drag the bar by an empty spot: the window follows the pointer until
/// the button is released, then snaps to the top or bottom of the screen it was released on.
pub fn begin_drag(label: &str) {
    if DRAG_ACTIVE.swap(true, Ordering::SeqCst) {
        return;
    }
    {
        let mut s = state();
        if !s.docks.iter().any(|d| d.label == label) {
            DRAG_ACTIVE.store(false, Ordering::SeqCst);
            return;
        }
        s.drag = Some(label.to_string());
    }
    let l = label.to_string();
    on_main(move || apply_region(&l));
    tauri::async_runtime::spawn(async {
        let started = Instant::now();
        let mut ticker = tokio::time::interval(Duration::from_millis(16));
        loop {
            ticker.tick().await;
            if !DRAG_ACTIVE.load(Ordering::SeqCst) {
                break;
            }
            if started.elapsed() > Duration::from_secs(30) {
                on_main(|| {
                    let mut pt = POINT::default();
                    let _ = unsafe { GetCursorPos(&mut pt) };
                    drag_finish(pt);
                });
                break;
            }
            on_main(drag_step);
        }
    });
}

fn drag_step() {
    if !DRAG_ACTIVE.load(Ordering::SeqCst) {
        return;
    }
    let mut pt = POINT::default();
    if unsafe { GetCursorPos(&mut pt) }.is_err() {
        return;
    }
    if !primary_button_down() {
        drag_finish(pt);
        return;
    }
    let (label, raw, thickness_css, screen_fit, fit_ref, fit_min, fit_max) = {
        let s = state();
        let label = match &s.drag {
            Some(l) => l.clone(),
            None => return,
        };
        match s.docks.iter().find(|d| d.label == label) {
            Some(d) => (label, d.hwnd, s.geo.thickness, s.geo.screen_fit, s.geo.screen_fit_ref, s.geo.fit_min, s.geo.fit_max),
            None => return,
        }
    };
    let mon = match monitors::at_point(pt.x, pt.y) {
        Some(m) => m,
        None => return,
    };
    let fit = fit_factor(screen_fit, logical_height(mon.monitor, mon.scale()), fit_ref, fit_min, fit_max);
    let t = ((thickness_css * fit * mon.scale()).round() as i32).clamp(8, mon.monitor.height().max(8));
    let top = (pt.y - t / 2).clamp(mon.monitor.top, mon.monitor.bottom - t);
    let rect = Rect::new(mon.monitor.left, top, mon.monitor.right, top + t);
    let ok = unsafe {
        SetWindowPos(hwnd_of(raw), Some(HWND_TOPMOST), rect.left, rect.top, rect.width(), rect.height(), SWP_NOACTIVATE)
    }
    .is_ok();
    if ok {
        let mut s = state();
        if let Some(d) = s.docks.iter_mut().find(|d| d.label == label) {
            d.window = rect;
        }
    }
}

fn drag_finish(pt: POINT) {
    if !DRAG_ACTIVE.swap(false, Ordering::SeqCst) {
        return;
    }
    let mon = monitors::at_point(pt.x, pt.y);
    let (geo, label) = {
        let mut s = state();
        let label = s.drag.take();
        if let Some(m) = &mon {
            s.geo.edge = edge_for_point(m.monitor, pt.y);
            if s.geo.displays != Displays::All {
                s.geo.monitor = m.id.clone();
                s.follow_monitor = m.id.clone();
            }
        }
        for d in s.docks.iter_mut() {
            d.reserved = None;
            d.applied_region = None;
        }
        (s.geo.clone(), label)
    };
    tracing::info!(edge = ?geo.edge, monitor = %geo.monitor, "dock moved");
    persist(&geo);
    emit("placement", PlacementEvent { edge: geo.edge, monitor: geo.monitor.clone(), at: now_ms() });
    apply_all();
    if let Some(l) = label {
        update_visibility(&l);
    }
}

// ---- Displays = Follow -------------------------------------------------------------------------

/// Polls the pointer (4x a second, only in Follow mode): resting at the dock edge of another
/// screen for ~0.6 s moves the dock there.
fn ensure_follow_poller() {
    if state().geo.displays != Displays::Follow {
        return;
    }
    if FOLLOW_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async {
        let mut ticker = tokio::time::interval(Duration::from_millis(300));
        let mut dwell = 0u32;
        let mut target = String::new();
        loop {
            ticker.tick().await;
            let (follow, edge, current) = {
                let s = state();
                let current = s.docks.iter().find(|d| d.label == MAIN_LABEL).map(|d| d.monitor_id.clone()).unwrap_or_default();
                (s.geo.displays == Displays::Follow, s.geo.edge, current)
            };
            if !follow {
                break;
            }
            if DRAG_ACTIVE.load(Ordering::SeqCst) {
                continue;
            }
            let mut pt = POINT::default();
            if unsafe { GetCursorPos(&mut pt) }.is_err() {
                continue;
            }
            let mon = match monitors::at_point(pt.x, pt.y) {
                Some(m) => m,
                None => continue,
            };
            let at_edge = match edge {
                Edge::Bottom => pt.y >= mon.monitor.bottom - 3,
                Edge::Top => pt.y <= mon.monitor.top + 2,
            };
            if mon.id == current || !at_edge {
                dwell = 0;
                continue;
            }
            if mon.id != target {
                target = mon.id.clone();
                dwell = 0;
            }
            dwell += 1;
            if dwell >= 2 {
                dwell = 0;
                let geo = {
                    let mut s = state();
                    s.follow_monitor = mon.id.clone();
                    s.geo.monitor = mon.id.clone();
                    s.geo.clone()
                };
                tracing::info!(from = %current, to = %mon.id, reason = "pointer rested at the dock edge of that screen", "dock follows the pointer");
                persist(&geo);
                emit("placement", PlacementEvent { edge: geo.edge, monitor: geo.monitor.clone(), at: now_ms() });
                on_main(apply_all);
            }
        }
        FOLLOW_RUNNING.store(false, Ordering::SeqCst);
    });
}

// ---- window procedure ------------------------------------------------------------------------

fn is_app_bar(hwnd: HWND) -> bool {
    let raw = hwnd.0 as isize;
    state().docks.iter().any(|d| d.hwnd == raw && d.appbar)
}

/// Must not block: it runs inside the message loop.
unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    let callback = CALLBACK_MSG.load(Ordering::Relaxed);
    if callback != 0 && msg == callback {
        match wparam.0 as u32 {
            ABN_POSCHANGED | ABN_STATECHANGE => schedule_relayout(),
            ABN_FULLSCREENAPP => watch::schedule_check(),
            _ => {}
        }
        return LRESULT(0);
    }
    let created = TASKBAR_CREATED_MSG.load(Ordering::Relaxed);
    if created != 0 && msg == created {
        // Explorer restarted: our app bar registrations and the hidden taskbar are gone.
        schedule_rebuild("explorer-restart", true);
        return unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) };
    }
    match msg {
        WM_STYLECHANGING => {
            if wparam.0 as i32 == GWL_EXSTYLE.0 && lparam.0 != 0 {
                let style = unsafe { &mut *(lparam.0 as *mut STYLESTRUCT) };
                style.styleNew = (style.styleNew | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0;
            }
        }
        WM_WINDOWPOSCHANGED => {
            if is_app_bar(hwnd) {
                unsafe { appbar::notify_window_pos_changed(hwnd) };
            }
        }
        WM_ACTIVATE => {
            if is_app_bar(hwnd) {
                unsafe { appbar::notify_activate(hwnd) };
            }
        }
        WM_DISPLAYCHANGE | WM_DPICHANGED => {
            let result = unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) };
            if !DRAG_ACTIVE.load(Ordering::Relaxed) {
                schedule_relayout();
            }
            if msg == WM_DISPLAYCHANGE {
                multi::schedule_reconcile();
            }
            // Once the re-layout and any new dock window have settled, verify every dock.
            super::watchdog::schedule("display-change", Duration::from_millis(2500));
            return result;
        }
        WM_SETTINGCHANGE => {
            if wparam.0 as u32 == SPI_SETWORKAREA.0 {
                schedule_relayout();
            }
        }
        WM_POWERBROADCAST => {
            let event = wparam.0 as u32;
            if event == PBT_APMRESUMEAUTOMATIC || event == PBT_APMRESUMESUSPEND {
                schedule_rebuild("resume", false);
            }
        }
        WM_HOTKEY => {
            hotkeys::on_hotkey(wparam.0 as i32);
            return LRESULT(0);
        }
        WM_ENDSESSION => {
            if wparam.0 != 0 {
                crate::lifecycle::run_cleanup("end-session");
            }
        }
        WM_NCDESTROY => unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
        },
        _ => {}
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}
