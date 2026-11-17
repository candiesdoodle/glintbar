//! Watches the rest of the desktop, event-driven (WinEvent hooks, no polling):
//! - the foreground window: full-screen apps (each dock hides only for its own screen), the
//!   Start menu (brings an auto-hidden dock up with it), the desktop ("show on desktop");
//! - the Windows taskbar showing itself again while it should be hidden;
//! - while a card or menu is open: clicks outside the dock and Esc anywhere (low-level hooks,
//!   installed only for as long as something is open).

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Mutex, Once};
use std::time::Duration;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetAncestor, GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, IsIconic,
    IsWindow, IsWindowVisible, IsZoomed, SetWindowsHookExW, UnhookWindowsHookEx, CHILDID_SELF, EVENT_OBJECT_LOCATIONCHANGE,
    EVENT_OBJECT_SHOW, EVENT_SYSTEM_FOREGROUND, GWL_STYLE, HHOOK, KBDLLHOOKSTRUCT, MSLLHOOKSTRUCT, OBJID_WINDOW, WH_KEYBOARD_LL,
    WH_MOUSE_LL, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_KEYDOWN, WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_RBUTTONDOWN,
    WS_CAPTION, GA_ROOTOWNER,
};

use super::model::Rect;
use super::{focus, monitors, taskbar, window};

static INSTALL: Once = Once::new();
static CHECK_PENDING: AtomicBool = AtomicBool::new(false);
static REHIDE_PENDING: AtomicBool = AtomicBool::new(false);
static MOUSE_HOOK: AtomicIsize = AtomicIsize::new(0);
static KEY_HOOK: AtomicIsize = AtomicIsize::new(0);
/// The foreground window at the last check (the watchdog runs when it changes).
static LAST_FRONT: AtomicIsize = AtomicIsize::new(0);
/// Full-screen windows currently hiding a dock (their moves matter even when not in front).
static WATCHED: Mutex<Vec<isize>> = Mutex::new(Vec::new());

/// Screenshot and screen-snip tools: while one is in front nothing changes, so the dock stays
/// in the picture.
const SCREENSHOT_TOOLS: [&str; 11] = [
    "screenclippinghost.exe",
    "snippingtool.exe",
    "screensketch.exe",
    "sharex.exe",
    "greenshot.exe",
    "lightshot.exe",
    "flameshot.exe",
    "snagit32.exe",
    "snagiteditor.exe",
    "picpick.exe",
    "gamebar.exe",
];

const START_HOSTS: [&str; 4] = ["startmenuexperiencehost.exe", "searchhost.exe", "searchapp.exe", "searchui.exe"];

/// Main thread, once.
pub fn install() {
    INSTALL.call_once(|| {
        let flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
        for event in [EVENT_SYSTEM_FOREGROUND, EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_SHOW] {
            let hook = unsafe { SetWinEventHook(event, event, None, Some(on_win_event), 0, 0, flags) };
            if hook.is_invalid() {
                tracing::warn!(event, "could not watch the desktop; full-screen apps may not hide the dock");
            }
        }
    });
    schedule_check();
}

unsafe extern "system" fn on_win_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _thread: u32,
    _time: u32,
) {
    match event {
        EVENT_SYSTEM_FOREGROUND => schedule_check(),
        EVENT_OBJECT_LOCATIONCHANGE => {
            // Fires for every window and caret; only the front window and watched ones matter.
            if id_object != OBJID_WINDOW.0 || id_child != CHILDID_SELF as i32 {
                return;
            }
            let front = unsafe { GetForegroundWindow() };
            if hwnd == front || is_watched(hwnd.0 as isize) {
                schedule_check();
            }
        }
        EVENT_OBJECT_SHOW => {
            if id_object == OBJID_WINDOW.0 && taskbar::is_hidden_bar(hwnd.0 as isize) {
                schedule_rehide();
            }
        }
        _ => {}
    }
}

fn is_watched(raw: isize) -> bool {
    match WATCHED.try_lock() {
        Ok(list) => list.contains(&raw),
        Err(_) => false,
    }
}

/// Coalesces bursts (a window being dragged) into one check 150 ms later.
pub fn schedule_check() {
    if CHECK_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async {
        tokio::time::sleep(Duration::from_millis(150)).await;
        window::on_main(check_now);
    });
}

fn schedule_rehide() {
    if REHIDE_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async {
        tokio::time::sleep(Duration::from_millis(250)).await;
        REHIDE_PENDING.store(false, Ordering::SeqCst);
        window::on_main(taskbar::reapply);
    });
}

struct Front {
    class: String,
    exe: String,
    own: bool,
}

impl Front {
    fn is_desktop(&self) -> bool {
        self.class == "Progman" || self.class == "WorkerW"
    }
    fn is_shell(&self) -> bool {
        self.class == "Shell_TrayWnd" || self.class == "Shell_SecondaryTrayWnd"
    }
    fn is_start(&self) -> bool {
        self.class == "Windows.UI.Core.CoreWindow" && START_HOSTS.contains(&self.exe.as_str())
    }
    fn is_screenshot_tool(&self) -> bool {
        SCREENSHOT_TOOLS.contains(&self.exe.as_str())
    }
}

pub(super) fn class_of(hwnd: HWND) -> String {
    let mut buf = [0u16; 128];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

/// Lower-case file name of the process that owns `pid` ("" when it cannot be read).
fn exe_of(pid: u32) -> String {
    if pid == 0 {
        return String::new();
    }
    unsafe {
        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) => h,
            Err(_) => return String::new(),
        };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(handle);
        if !ok {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())]);
        path.rsplit(['\\', '/']).next().unwrap_or("").to_ascii_lowercase()
    }
}

fn pid_of(hwnd: HWND) -> u32 {
    let mut pid: u32 = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
    }
    pid
}

/// A window of GlintBar's own process, or one owned by a GlintBar window: the dropdowns, menus
/// and file dialogs of a dock page belong to WebView2's processes but are owned by the dock
/// window. None of them is ever a full-screen app, and none of them may hide or cover a dock.
pub(super) fn is_ours(hwnd: HWND) -> bool {
    if hwnd.is_invalid() {
        return false;
    }
    let me = std::process::id();
    if pid_of(hwnd) == me {
        return true;
    }
    let root = unsafe { GetAncestor(hwnd, GA_ROOTOWNER) };
    !root.is_invalid() && root != hwnd && pid_of(root) == me
}

fn describe(hwnd: HWND) -> Front {
    if hwnd.is_invalid() {
        return Front { class: String::new(), exe: String::new(), own: false };
    }
    let pid = pid_of(hwnd);
    let own = pid == std::process::id() || is_ours(hwnd);
    Front { class: class_of(hwnd), exe: if own { String::new() } else { exe_of(pid) }, own }
}

/// "class=..., exe=..." of a window, for logs (never its title).
pub(super) fn describe_window(raw: isize) -> String {
    if raw == 0 {
        return "none".to_string();
    }
    let hwnd = HWND(raw as *mut core::ffi::c_void);
    let mut pid: u32 = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
    }
    format!("class={}, exe={}", class_of(hwnd), exe_of(pid))
}

pub(super) fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked: u32 = 0;
    let result = unsafe {
        DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut core::ffi::c_void, std::mem::size_of::<u32>() as u32)
    };
    result.is_ok() && cloaked != 0
}

fn window_rect(hwnd: HWND) -> Option<Rect> {
    let mut r = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut r) }.ok()?;
    Some(Rect::new(r.left, r.top, r.right, r.bottom))
}

fn quns_full_screen() -> bool {
    match unsafe { SHQueryUserNotificationState() } {
        Ok(s) => s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE,
        Err(_) => false,
    }
}

/// Only the strong signals: a Direct3D exclusive full-screen app or presentation mode.
fn quns_exclusive() -> bool {
    match unsafe { SHQueryUserNotificationState() } {
        Ok(s) => s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE,
        Err(_) => false,
    }
}

/// Covers its whole monitor, is not an ordinary maximised window, and either has no title bar
/// (games, videos, F11) or Windows itself reports a full-screen app. Returns the device name of
/// that monitor (stable across display changes, unlike its HMONITOR).
fn covers_its_monitor(hwnd: HWND) -> Option<String> {
    unsafe {
        if hwnd.is_invalid() || !IsWindow(Some(hwnd)).as_bool() || !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return None;
        }
    }
    if is_cloaked(hwnd) {
        return None;
    }
    let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32;
    let has_caption = style & WS_CAPTION.0 == WS_CAPTION.0;
    let zoomed = unsafe { IsZoomed(hwnd) }.as_bool();
    if has_caption && zoomed {
        return None;
    }
    let mon = monitors::for_window(hwnd)?;
    let rect = window_rect(hwnd)?;
    if !rect.covers(&mon.monitor) {
        return None;
    }
    if zoomed {
        // A maximised window without a title bar (many Electron and media apps) fills the whole
        // screen whenever nothing reserves space there (auto-hide on, no taskbar on that screen).
        // That is not full screen unless Windows reports an exclusive full-screen app.
        return if quns_exclusive() { Some(mon.id) } else { None };
    }
    if !has_caption || quns_full_screen() {
        Some(mon.id)
    } else {
        None
    }
}

fn check_now() {
    CHECK_PENDING.store(false, Ordering::SeqCst);
    let front = unsafe { GetForegroundWindow() };
    let info = describe(front);
    // Clicking the dock itself (or a dropdown, menu or dialog of a dock page) or taking a
    // screenshot changes nothing: none of our own windows is ever treated as full screen.
    if info.own || info.is_screenshot_tool() {
        return;
    }
    let raw_front = front.0 as isize;
    if LAST_FRONT.swap(raw_front, Ordering::SeqCst) != raw_front {
        // Another window came to the front: check that every dock is still shown and on top.
        super::watchdog::schedule("foreground", Duration::from_millis(400));
    }
    let start_open = info.is_start();
    let start_monitor = if start_open { monitors::id_for_window(front) } else { String::new() };
    let desktop = front.is_invalid() || info.is_desktop();
    let front_full: Option<String> =
        if info.is_desktop() || info.is_shell() || start_open { None } else { covers_its_monitor(front) };

    let mut result: Vec<(String, isize)> = Vec::new();
    let mut watched: Vec<isize> = Vec::new();
    // Each dock hides only for a full-screen window on its own monitor (matched by device name).
    for (label, monitor_id, current) in window::dock_screens() {
        let fs = if !monitor_id.is_empty() && front_full.as_deref() == Some(monitor_id.as_str()) {
            front.0 as isize
        } else if !monitor_id.is_empty()
            && current != 0
            && covers_its_monitor(HWND(current as *mut core::ffi::c_void)).as_deref() == Some(monitor_id.as_str())
        {
            // Still covering its screen while another screen has focus: keep the dock away.
            current
        } else {
            0
        };
        if fs != 0 && !watched.contains(&fs) {
            watched.push(fs);
        }
        result.push((label, fs));
    }
    if let Ok(mut list) = WATCHED.lock() {
        *list = watched;
    }
    window::set_watch_result(start_open, start_monitor, desktop, result);
}

// ---- clicks outside / Esc while a card or menu is open -------------------------------------------

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && lparam.0 != 0 {
        let msg = wparam.0 as u32;
        if msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN {
            let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
            window::on_global_click(info.pt.x, info.pt.y);
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

unsafe extern "system" fn key_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && lparam.0 != 0 && wparam.0 as u32 == WM_KEYDOWN {
        let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        // While the dock itself is in front its page gets the key directly (no double close).
        if info.vkCode == 0x1B && !focus::foreground_is_own() {
            window::on_global_escape();
        }
    }
    // Never swallow the key: the app in front gets its Esc too.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// Main thread. Installs the low-level hooks while any dock has a card or menu open.
pub fn set_popover_watch(on: bool) {
    if on {
        let module: Option<HINSTANCE> = unsafe { GetModuleHandleW(PCWSTR::null()) }.ok().map(HINSTANCE::from);
        let had = MOUSE_HOOK.load(Ordering::SeqCst) != 0 && KEY_HOOK.load(Ordering::SeqCst) != 0;
        if MOUSE_HOOK.load(Ordering::SeqCst) == 0 {
            match unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0) } {
                Ok(h) => MOUSE_HOOK.store(h.0 as isize, Ordering::SeqCst),
                Err(e) => tracing::warn!("no mouse hook: clicks in other apps will not close popovers: {e}"),
            }
        }
        if KEY_HOOK.load(Ordering::SeqCst) == 0 {
            match unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(key_proc), module, 0) } {
                Ok(h) => KEY_HOOK.store(h.0 as isize, Ordering::SeqCst),
                Err(e) => tracing::warn!("no keyboard hook: Esc will not close an unfocused popover: {e}"),
            }
        }
        if !had {
            tracing::info!(
                mouse = MOUSE_HOOK.load(Ordering::SeqCst) != 0,
                keyboard = KEY_HOOK.load(Ordering::SeqCst) != 0,
                "popover open: watching clicks and Esc"
            );
        }
    } else if remove_hooks() {
        tracing::info!("popovers closed: click and Esc hooks removed");
    }
}

/// Removes both low-level hooks (true if one was installed). No logging: exit cleanup calls it.
pub fn remove_hooks() -> bool {
    let mut removed = false;
    for slot in [&MOUSE_HOOK, &KEY_HOOK] {
        let raw = slot.swap(0, Ordering::SeqCst);
        if raw != 0 {
            removed = true;
            unsafe {
                let _ = UnhookWindowsHookEx(HHOOK(raw as *mut core::ffi::c_void));
            }
        }
    }
    removed
}
