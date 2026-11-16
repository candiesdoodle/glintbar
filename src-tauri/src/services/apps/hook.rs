//! The live `apps/windows` topic: a thread with WinEvent hooks (create, destroy, show, hide,
//! title, cloak, minimize, foreground) and a shell hook (flashing) that re-lists windows a
//! moment after something changed and emits only when the list differs. Runs only while the
//! UI is subscribed.

use std::cell::Cell;
use std::collections::HashSet;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::AppHandle;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DeregisterShellHookWindow, DestroyWindow, DispatchMessageW, GetMessageW,
    KillTimer, PostThreadMessageW, RegisterClassW, RegisterShellHookWindow, RegisterWindowMessageW, SetTimer,
    TranslateMessage, EVENT_OBJECT_CLOAKED, EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE, EVENT_OBJECT_NAMECHANGE,
    EVENT_OBJECT_UNCLOAKED, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZESTART, MSG,
    OBJID_WINDOW, WINDOW_EX_STYLE, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_QUIT, WM_TIMER, WNDCLASSW,
    WS_EX_TOOLWINDOW, WS_POPUP,
};

use super::model::WindowInfo;
use crate::{events, subscriptions};

const TOPIC_KEY: &str = "apps/windows";
const DEBOUNCE_MS: u32 = 120;
const HSHELL_WINDOWCREATED: usize = 1;
const HSHELL_WINDOWDESTROYED: usize = 2;
const HSHELL_WINDOWACTIVATED: usize = 4;
const HSHELL_REDRAW: usize = 6;
const HSHELL_RUDEAPPACTIVATED: usize = 0x8004;
const HSHELL_FLASH: usize = 0x8006;

static THREAD_ID: AtomicU32 = AtomicU32::new(0);
static SHELL_MSG: AtomicU32 = AtomicU32::new(0);
static FLASHING: Mutex<Option<HashSet<isize>>> = Mutex::new(None);

thread_local! {
    /// The pending refresh timer on the hook thread (0 = none).
    static TIMER: Cell<usize> = const { Cell::new(0) };
}

pub fn is_flashing(hwnd: isize) -> bool {
    FLASHING.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|s| s.contains(&hwnd)).unwrap_or(false)
}

fn set_flashing(hwnd: isize, on: bool) {
    let mut guard = FLASHING.lock().unwrap_or_else(|p| p.into_inner());
    let set = guard.get_or_insert_with(HashSet::new);
    if on {
        set.insert(hwnd);
    } else {
        set.remove(&hwnd);
    }
}

/// Asks for a refresh shortly (coalesces bursts of events). Hook thread only.
fn schedule(ms: u32) {
    TIMER.with(|t| {
        if t.get() == 0 {
            let id = unsafe { SetTimer(None, 0, ms, None) };
            t.set(id);
        }
    });
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
    if id_object != OBJID_WINDOW.0 || id_child != 0 {
        return;
    }
    if event == EVENT_SYSTEM_FOREGROUND {
        set_flashing(hwnd.0 as isize, false);
    }
    schedule(DEBOUNCE_MS);
}

unsafe extern "system" fn shell_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let shell = SHELL_MSG.load(Ordering::SeqCst);
    if shell != 0 && msg == shell {
        let target = lparam.0;
        match wparam.0 {
            HSHELL_FLASH => set_flashing(target, true),
            HSHELL_WINDOWACTIVATED | HSHELL_RUDEAPPACTIVATED | HSHELL_WINDOWDESTROYED => set_flashing(target, false),
            HSHELL_WINDOWCREATED | HSHELL_REDRAW => {}
            _ => return LRESULT(0),
        }
        schedule(40);
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn create_shell_window() -> Option<HWND> {
    unsafe {
        let instance = GetModuleHandleW(None).ok()?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(shell_proc),
            hInstance: instance.into(),
            lpszClassName: w!("GlintBarAppsShellHook"),
            ..Default::default()
        };
        // Fails harmlessly when the class is already registered by an earlier session.
        RegisterClassW(&class);
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE(WS_EX_TOOLWINDOW.0),
            w!("GlintBarAppsShellHook"),
            w!("GlintBar shell hook"),
            WS_POPUP,
            0,
            0,
            0,
            0,
            None,
            None,
            Some(instance.into()),
            None,
        )
        .ok()?;
        SHELL_MSG.store(RegisterWindowMessageW(w!("SHELLHOOK")), Ordering::SeqCst);
        if !RegisterShellHookWindow(hwnd).as_bool() {
            tracing::warn!("apps: could not listen for flashing windows");
        }
        Some(hwnd)
    }
}

fn publish(app: &AppHandle, last: &mut Option<Vec<WindowInfo>>) {
    let list = super::wnd::list_windows();
    if last.as_ref() != Some(&list) {
        events::emit(app, "apps", "windows", &list);
        *last = Some(list);
    }
}

fn run(app: AppHandle, generation: u64) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let me = GetCurrentThreadId();
        THREAD_ID.store(me, Ordering::SeqCst);
        let ranges: [(u32, u32); 5] = [
            (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
            (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
            (EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE),
            (EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE),
            (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED),
        ];
        let mut hooks: Vec<HWINEVENTHOOK> = Vec::new();
        for (min, max) in ranges {
            let hook = SetWinEventHook(
                min,
                max,
                None,
                Some(on_win_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            );
            if !hook.is_invalid() {
                hooks.push(hook);
            }
        }
        let shell = create_shell_window();
        let mut last: Option<Vec<WindowInfo>> = None;
        publish(&app, &mut last);

        let mut msg = MSG::default();
        loop {
            if !subscriptions::is_current(TOPIC_KEY, generation) {
                break;
            }
            let got = GetMessageW(&mut msg, None, 0, 0).0;
            if got <= 0 || msg.message == WM_QUIT {
                break;
            }
            if msg.message == WM_TIMER && msg.hwnd.is_invalid() {
                let pending = TIMER.with(|t| t.get());
                if pending != 0 && msg.wParam.0 == pending {
                    let _ = KillTimer(None, pending);
                    TIMER.with(|t| t.set(0));
                    if !subscriptions::is_current(TOPIC_KEY, generation) {
                        break;
                    }
                    publish(&app, &mut last);
                }
                continue;
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let pending = TIMER.with(|t| t.get());
        if pending != 0 {
            let _ = KillTimer(None, pending);
            TIMER.with(|t| t.set(0));
        }
        for hook in hooks {
            let _ = UnhookWinEvent(hook);
        }
        if let Some(h) = shell {
            let _ = DeregisterShellHookWindow(h);
            let _ = DestroyWindow(h);
        }
        let _ = THREAD_ID.compare_exchange(me, 0, Ordering::SeqCst, Ordering::SeqCst);
    }
    tracing::debug!("apps: window watcher stopped");
}

/// First subscriber: start watching windows.
pub fn start(app: AppHandle, generation: u64) {
    stop();
    let spawned = std::thread::Builder::new().name("glintbar-apps-windows".into()).spawn(move || run(app, generation));
    if let Err(e) = spawned {
        tracing::warn!("apps: could not start the window watcher: {e}");
    }
}

/// Last subscriber gone, or the app is closing.
pub fn stop() {
    let id = THREAD_ID.load(Ordering::SeqCst);
    if id != 0 {
        unsafe {
            let _ = PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}
