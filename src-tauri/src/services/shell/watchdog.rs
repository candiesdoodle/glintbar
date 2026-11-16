//! Dock watchdog. Every few seconds, and shortly after the foreground window or the displays
//! change, it checks each dock window that should be on screen: the window exists, is shown, is
//! not minimised, is topmost and not pushed under another topmost window, sits where GlintBar put it
//! on a monitor that still exists, and its window region (what it draws and takes clicks in)
//! covers the bar. When something is off it logs ONE info line saying what (label, monitor,
//! expected vs actual rect, visibility, region, window and monitor DPI, the window above the dock,
//! the window in front and its rect) and repairs it. It also notices a display that should have a
//! dock window but has none, and a page that never reported ready.
//!
//! It never fights intentional hiding: a dock hidden under a full-screen app on its own monitor,
//! a drag in progress, a window still closing or still loading are left alone; an auto-hidden
//! dock only needs its edge sliver. Main thread only; a check is a handful of cheap Win32 reads.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, Once};
use std::time::Duration;

use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::GetWindowRgnBox;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindow,
    IsWindowVisible, GWL_EXSTYLE, GW_HWNDPREV, WS_EX_TOPMOST,
};

use super::model::{Rect, Visibility, MAIN_LABEL};
use super::monitors::{self, MonitorInfo};
use super::{multi, watch, window};

const PERIOD: Duration = Duration::from_secs(4);
/// A new dock window shows itself once its page is ready; after this it is shown anyway.
const SHOW_GRACE: Duration = Duration::from_secs(8);
/// ...and after this its page is reloaded once.
const RELOAD_AFTER: Duration = Duration::from_secs(25);
/// A problem that stays is logged again every this many checks (about once a minute).
const LOG_EVERY: u32 = 15;

/// Windows that may sit above the dock without it being a problem: menus, tooltips and the
/// shell's own surfaces (Start, search, flyouts, task view), which live in higher bands anyway.
const IGNORED_CLASSES: [&str; 14] = [
    "#32768",
    "tooltips_class32",
    "SysShadow",
    "Xaml_WindowedPopupClass",
    "Windows.UI.Core.CoreWindow",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "NotifyIconOverflowWindow",
    "TopLevelWindowForOverflowXamlIsland",
    "XamlExplorerHostIslandWindow",
    "MultitaskingViewFrame",
    "ForegroundStaging",
    "TaskListThumbnailWnd",
    "Progman",
];

static STARTED: Once = Once::new();
static PENDING: AtomicBool = AtomicBool::new(false);
static MISSING_CHECKS: AtomicU32 = AtomicU32::new(0);
/// Per dock: (label, last problem logged, how often it repeated since).
static LAST: Mutex<Vec<(String, String, u32)>> = Mutex::new(Vec::new());
/// Per dock: (label, the topmost window we already put the dock back above once).
static PUSHED: Mutex<Vec<(String, isize)>> = Mutex::new(Vec::new());

/// Starts the periodic check (once, from window::init).
pub fn start() {
    STARTED.call_once(|| {
        tauri::async_runtime::spawn(async {
            loop {
                tokio::time::sleep(PERIOD).await;
                if crate::lifecycle::is_cleaning_up() {
                    break;
                }
                window::on_main(|| check("timer"));
            }
        });
    });
}

/// One extra check after `delay` (foreground or display changes). Coalesced.
pub fn schedule(reason: &'static str, delay: Duration) {
    if PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        PENDING.store(false, Ordering::SeqCst);
        window::on_main(move || check(reason));
    });
}

fn hwnd_of(raw: isize) -> HWND {
    HWND(raw as *mut core::ffi::c_void)
}

/// What Windows says about a dock window right now.
struct Facts {
    exists: bool,
    visible: bool,
    iconic: bool,
    topmost: bool,
    rect: Option<Rect>,
    /// GetWindowRgnBox: 0 no region (the whole window), 1 empty, 2/3 a region with `region_box`.
    region_kind: i32,
    region_box: Rect,
    dpi: u32,
}

fn read_facts(h: HWND) -> Facts {
    let exists = unsafe { IsWindow(Some(h)) }.as_bool();
    if !exists {
        return Facts {
            exists: false,
            visible: false,
            iconic: false,
            topmost: false,
            rect: None,
            region_kind: 0,
            region_box: Rect::default(),
            dpi: 0,
        };
    }
    let visible = unsafe { IsWindowVisible(h) }.as_bool();
    let iconic = unsafe { IsIconic(h) }.as_bool();
    let ex = unsafe { GetWindowLongPtrW(h, GWL_EXSTYLE) } as u32;
    let topmost = ex & WS_EX_TOPMOST.0 != 0;
    let mut wr = RECT::default();
    let rect = match unsafe { GetWindowRect(h, &mut wr as *mut RECT) } {
        Ok(()) => Some(Rect::new(wr.left, wr.top, wr.right, wr.bottom)),
        Err(_) => None,
    };
    let mut rb = RECT::default();
    let region_kind = unsafe { GetWindowRgnBox(h, &mut rb as *mut RECT) }.0;
    let dpi = unsafe { GetDpiForWindow(h) };
    Facts {
        exists,
        visible,
        iconic,
        topmost,
        rect,
        region_kind,
        region_box: Rect::new(rb.left, rb.top, rb.right, rb.bottom),
        dpi,
    }
}

fn region_text(f: &Facts) -> String {
    match f.region_kind {
        0 => "none (whole window)".to_string(),
        1 => "EMPTY".to_string(),
        _ => window::fmt_rect(f.region_box),
    }
}

fn rect_text(raw: isize) -> String {
    if raw == 0 {
        return "none".to_string();
    }
    let mut r = RECT::default();
    match unsafe { GetWindowRect(hwnd_of(raw), &mut r as *mut RECT) } {
        Ok(()) => window::fmt_rect(Rect::new(r.left, r.top, r.right, r.bottom)),
        Err(_) => "unknown".to_string(),
    }
}

/// Width and height of the intersection (0 when they do not meet).
fn overlap(a: &Rect, b: &Rect) -> (i32, i32) {
    let w = a.right.min(b.right) - a.left.max(b.left);
    let h = a.bottom.min(b.bottom) - a.top.max(b.top);
    (w.max(0), h.max(0))
}

fn is_own(h: HWND) -> bool {
    let mut pid: u32 = 0;
    unsafe {
        GetWindowThreadProcessId(h, Some(&mut pid as *mut u32));
    }
    pid == std::process::id()
}

/// The first visible window of another app above `h` in Z order that covers part of `strip`.
fn window_above(h: HWND, strip: &Rect) -> Option<isize> {
    let mut cur = h;
    for _ in 0..64 {
        cur = match unsafe { GetWindow(cur, GW_HWNDPREV) } {
            Ok(x) if !x.is_invalid() => x,
            _ => return None,
        };
        if !unsafe { IsWindowVisible(cur) }.as_bool() || is_own(cur) || watch::is_cloaked(cur) {
            continue;
        }
        let mut r = RECT::default();
        if unsafe { GetWindowRect(cur, &mut r as *mut RECT) }.is_err() {
            continue;
        }
        let rect = Rect::new(r.left, r.top, r.right, r.bottom);
        let (ow, oh) = overlap(&rect, strip);
        if ow < 16 || oh < 4 {
            continue;
        }
        let class = watch::class_of(cur);
        if IGNORED_CLASSES.iter().any(|c| *c == class.as_str()) {
            continue;
        }
        return Some(cur.0 as isize);
    }
    None
}

/// True when `problem` should be logged for `label` now: new, changed, or every LOG_EVERY checks.
fn should_log(label: &str, problem: &str) -> bool {
    let mut list = LAST.lock().unwrap_or_else(|p| p.into_inner());
    match list.iter_mut().find(|e| e.0 == label) {
        Some(e) => {
            if e.1 == problem {
                e.2 += 1;
                e.2 % LOG_EVERY == 0
            } else {
                e.1 = problem.to_string();
                e.2 = 0;
                true
            }
        }
        None => {
            list.push((label.to_string(), problem.to_string(), 0));
            true
        }
    }
}

fn clear(label: &str) {
    let mut list = LAST.lock().unwrap_or_else(|p| p.into_inner());
    list.retain(|e| e.0 != label);
}

/// True if the dock was already put back above `cover` once (then it is left alone: that
/// window keeps raising itself, and fighting it would only flicker).
fn pushed_before(label: &str, cover: isize) -> bool {
    let mut list = PUSHED.lock().unwrap_or_else(|p| p.into_inner());
    match list.iter_mut().find(|e| e.0 == label) {
        Some(e) => {
            if e.1 == cover {
                true
            } else {
                e.1 = cover;
                false
            }
        }
        None => {
            list.push((label.to_string(), cover));
            false
        }
    }
}

fn check(reason: &'static str) {
    if crate::lifecycle::is_cleaning_up() {
        return;
    }
    let docks = match window::guard_targets() {
        Some(d) => d,
        None => return,
    };
    let mons = monitors::all();
    check_plan(&mons);
    let front = unsafe { GetForegroundWindow() };
    let mut suppressed = false;
    for d in &docks {
        if d.visibility == Visibility::Suppressed {
            // Hidden on purpose: a full-screen app covers this dock's own monitor.
            suppressed = true;
            clear(&d.label);
            continue;
        }
        check_dock(reason, d, &mons, front);
    }
    if suppressed {
        // The full-screen window may have closed or moved while another screen had the focus
        // (no foreground change then): look again so that dock comes back.
        watch::schedule_check();
    }
}

/// Every display the plan gives a dock must have a dock window.
fn check_plan(mons: &[MonitorInfo]) {
    let planned = window::current_plan(mons);
    let known = window::known_docks();
    let missing: Vec<String> = planned
        .iter()
        .filter(|(label, _)| !known.iter().any(|(k, _)| k == label))
        .map(|(label, monitor)| format!("{label} on {monitor}"))
        .collect();
    if missing.is_empty() {
        MISSING_CHECKS.store(0, Ordering::SeqCst);
        clear("*plan");
        return;
    }
    // A window being created is not known yet: act on the second check in a row.
    if MISSING_CHECKS.fetch_add(1, Ordering::SeqCst) < 1 {
        return;
    }
    MISSING_CHECKS.store(0, Ordering::SeqCst);
    let text = missing.join(", ");
    if should_log("*plan", &text) {
        tracing::info!(missing = %text, monitors = mons.len(), "dock watchdog: a display has no dock window; creating it again");
    }
    multi::schedule_reconcile();
}

fn check_dock(reason: &'static str, d: &window::GuardInfo, mons: &[MonitorInfo], front: HWND) {
    let h = hwnd_of(d.hwnd);
    let f = read_facts(h);
    let mut problems: Vec<String> = Vec::new();
    let mut show = false;
    let mut topmost = false;
    let mut place = false;
    let mut region = false;
    let mut reload = false;
    let mut reconcile = false;
    let mut above: isize = 0;
    if !f.exists {
        problems.push("window destroyed".to_string());
        reconcile = true;
    } else {
        if !d.page_ready {
            if d.age < SHOW_GRACE {
                return;
            }
            problems.push("its page never reported ready".to_string());
            if !d.shown {
                show = true;
            }
            if d.age >= RELOAD_AFTER && !d.reloaded && d.label != MAIN_LABEL {
                reload = true;
            }
        }
        if d.shown && !f.visible {
            problems.push("hidden".to_string());
            show = true;
        }
        if f.iconic {
            problems.push("minimized".to_string());
            show = true;
        }
        if !f.topmost {
            problems.push("not topmost".to_string());
            topmost = true;
        }
        if let Some(actual) = f.rect {
            if actual != d.window {
                problems.push("moved or resized".to_string());
                place = true;
            }
        }
        if !d.monitor_id.is_empty() && !mons.iter().any(|m| m.id == d.monitor_id) {
            problems.push("its monitor is gone".to_string());
            place = true;
            reconcile = true;
        }
        if let Some(strip) = d.strip {
            let local = strip.offset(-d.window.left, -d.window.top);
            match f.region_kind {
                1 => {
                    problems.push("empty window region".to_string());
                    region = true;
                }
                0 => {
                    if d.expects_region {
                        problems.push("window region lost".to_string());
                        region = true;
                    }
                }
                _ => {
                    let (ow, oh) = overlap(&f.region_box, &local);
                    if ow == 0 || oh == 0 {
                        problems.push("window region misses the bar".to_string());
                        region = true;
                    }
                }
            }
            if f.topmost && f.visible {
                if let Some(cover) = window_above(h, &strip) {
                    if !pushed_before(&d.label, cover) {
                        problems.push("under another topmost window".to_string());
                        topmost = true;
                        above = cover;
                    }
                }
            }
        }
        if f.dpi != 0 && d.dpi != 0 && f.dpi != d.dpi {
            problems.push(format!("window DPI {} but monitor DPI {}", f.dpi, d.dpi));
        }
    }
    if problems.is_empty() {
        clear(&d.label);
        return;
    }
    let text = problems.join(", ");
    if should_log(&d.label, &text) {
        let front_raw = front.0 as isize;
        tracing::info!(
            reason,
            label = %d.label,
            monitor = %d.monitor_id,
            problem = %text,
            expected = %window::fmt_rect(d.window),
            actual = %f.rect.map(window::fmt_rect).unwrap_or_else(|| "unknown".to_string()),
            visible = f.visible,
            visibility = ?d.visibility,
            region = %region_text(&f),
            window_dpi = f.dpi,
            monitor_dpi = d.dpi,
            above = %window_text(above),
            front = %window_text(front_raw),
            front_rect = %rect_text(front_raw),
            "dock watchdog: repairing the dock window"
        );
    }
    if !f.exists {
        if d.label == MAIN_LABEL {
            return;
        }
        window::guard_forget(&d.label);
    }
    if reconcile {
        multi::schedule_reconcile();
    }
    if !f.exists {
        return;
    }
    // Placing uses SetWindowPos(HWND_TOPMOST) and re-applies the region; showing also does both.
    if place {
        window::guard_place(&d.label);
    }
    if show {
        window::guard_show(&d.label);
    }
    if topmost && !place && !show {
        window::guard_topmost(&d.label);
    }
    if region && !place && !show {
        window::guard_region(&d.label);
    }
    if reload {
        window::guard_reload(&d.label);
    }
}

fn window_text(raw: isize) -> String {
    if raw == 0 {
        return "none".to_string();
    }
    watch::describe_window(raw)
}
