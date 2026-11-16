//! Top-level windows the way the taskbar sees them (alt-tab rules), and acting on them.

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::Mutex;

use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_TERMINATE,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_LWIN,
    VK_MENU, VK_X,
};
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, EnumWindows, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsHungAppWindow, IsIconic, IsWindow, IsWindowVisible, PostMessageW,
    SetForegroundWindow, ShowWindowAsync, GWL_EXSTYLE, GW_OWNER, SW_MINIMIZE, SW_RESTORE, WM_CLOSE, WS_EX_APPWINDOW,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use super::model::WindowInfo;
use super::pins::{aumid_name, program_name};
use super::util::{com_init, prop_string, wide_to_string, PKEY_APP_USER_MODEL_ID};
use crate::error::{SvcError, SvcResult};

/// Shell windows that are never app buttons.
const SKIP_CLASSES: &[&str] = &[
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "Windows.UI.Core.CoreWindow",
    "ApplicationManager_ImmersiveShellWindow",
    "Internet Explorer_Hidden",
    "XamlExplorerHostIslandWindow",
    "TopLevelWindowForOverflowXamlIsland",
];

/// What doesn't change for a window while it lives: its process, program and app id.
#[derive(Clone)]
struct Ident {
    pid: u32,
    exe: Option<String>,
    aumid: Option<String>,
    app_name: String,
}

static IDENTS: Mutex<Option<HashMap<isize, Ident>>> = Mutex::new(None);
static NAMES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

pub fn to_hwnd(raw: i64) -> HWND {
    HWND(raw as isize as *mut c_void)
}

pub fn process_exe(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len: u32 = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len as *mut u32);
        let _ = CloseHandle(process);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]).to_lowercase())
    }
}

fn process_aumid(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 512];
        let mut len: u32 = buf.len() as u32;
        let status = GetApplicationUserModelId(process, &mut len as *mut u32, Some(PWSTR(buf.as_mut_ptr())));
        let _ = CloseHandle(process);
        if status == ERROR_SUCCESS {
            Some(wide_to_string(&buf)).filter(|s| !s.is_empty())
        } else {
            None
        }
    }
}

fn window_prop_aumid(hwnd: HWND) -> Option<String> {
    unsafe {
        let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd).ok()?;
        prop_string(&store, &PKEY_APP_USER_MODEL_ID)
    }
}

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

fn window_pid(hwnd: HWND) -> u32 {
    let mut pid: u32 = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
    }
    pid
}

/// A Store app's frame (ApplicationFrameHost) hosts the app's CoreWindow from another process.
fn hosted_pid(frame: HWND, frame_pid: u32) -> Option<u32> {
    struct Search {
        frame_pid: u32,
        found: u32,
    }
    unsafe extern "system" fn each(child: HWND, lparam: LPARAM) -> BOOL {
        let search = unsafe { &mut *(lparam.0 as *mut Search) };
        let pid = window_pid(child);
        if pid != 0 && pid != search.frame_pid {
            search.found = pid;
            return BOOL(0);
        }
        BOOL(1)
    }
    let mut search = Search { frame_pid, found: 0 };
    unsafe {
        let _ = EnumChildWindows(Some(frame), Some(each), LPARAM(&mut search as *mut Search as isize));
    }
    if search.found != 0 {
        Some(search.found)
    } else {
        None
    }
}

fn cached_name(key: &str, compute: impl FnOnce() -> String) -> String {
    {
        let names = NAMES.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(n) = names.as_ref().and_then(|m| m.get(key)) {
            return n.clone();
        }
    }
    let name = compute();
    let mut names = NAMES.lock().unwrap_or_else(|p| p.into_inner());
    names.get_or_insert_with(HashMap::new).insert(key.to_string(), name.clone());
    name
}

fn identify(hwnd: HWND, pid: u32, class: &str) -> Ident {
    let mut real_pid = pid;
    let mut exe = process_exe(pid);
    let mut aumid = window_prop_aumid(hwnd);
    if class == "ApplicationFrameWindow" {
        if let Some(inner) = hosted_pid(hwnd, pid) {
            real_pid = inner;
            exe = process_exe(inner).or(exe);
            if aumid.is_none() {
                aumid = process_aumid(inner);
            }
        }
    }
    if aumid.is_none() {
        aumid = process_aumid(real_pid);
    }
    let app_name = match (&aumid, &exe) {
        (Some(id), _) => cached_name(&format!("id:{id}"), || {
            aumid_name(id).unwrap_or_else(|| exe.as_deref().map(program_name).unwrap_or_else(|| id.clone()))
        }),
        (None, Some(path)) => cached_name(&format!("exe:{path}"), || program_name(path)),
        (None, None) => String::new(),
    };
    Ident { pid: real_pid, exe, aumid, app_name }
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked: u32 = 0;
    let ok = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut c_void,
            std::mem::size_of::<u32>() as u32,
        )
    };
    ok.is_ok() && cloaked != 0
}

/// True when the window would get a taskbar button.
fn shows_on_taskbar(hwnd: HWND, own_pid: u32) -> Option<u32> {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
            return None;
        }
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let app_window = ex & WS_EX_APPWINDOW.0 != 0;
        if !app_window && (ex & WS_EX_TOOLWINDOW.0 != 0 || ex & WS_EX_NOACTIVATE.0 != 0) {
            return None;
        }
        let owned = GetWindow(hwnd, GW_OWNER).map(|o| !o.is_invalid()).unwrap_or(false);
        if owned && !app_window {
            return None;
        }
        let pid = window_pid(hwnd);
        if pid == 0 || pid == own_pid || is_cloaked(hwnd) {
            return None;
        }
        Some(pid)
    }
}

/// Every window that would get a taskbar button, front-most first.
pub fn list_windows() -> Vec<WindowInfo> {
    com_init();
    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let list = unsafe { &mut *(lparam.0 as *mut Vec<isize>) };
        list.push(hwnd.0 as isize);
        BOOL(1)
    }
    let mut handles: Vec<isize> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut handles as *mut Vec<isize> as isize));
    }
    let own_pid = std::process::id();
    let foreground = unsafe { GetForegroundWindow() }.0 as isize;
    let mut idents = IDENTS.lock().unwrap_or_else(|p| p.into_inner());
    let map = idents.get_or_insert_with(HashMap::new);
    let mut out: Vec<WindowInfo> = Vec::new();
    let mut alive: Vec<isize> = Vec::new();
    for raw in handles {
        let hwnd = HWND(raw as *mut c_void);
        let Some(pid) = shows_on_taskbar(hwnd, own_pid) else {
            continue;
        };
        let class = class_name(hwnd);
        if SKIP_CLASSES.iter().any(|c| *c == class) {
            continue;
        }
        alive.push(raw);
        let is_frame = class == "ApplicationFrameWindow";
        let cached: Option<Ident> = map
            .get(&raw)
            .filter(|i| if is_frame { i.aumid.is_some() } else { i.pid == pid })
            .cloned();
        let ident = match cached {
            Some(i) => i,
            None => {
                let i = identify(hwnd, pid, &class);
                map.insert(raw, i.clone());
                i
            }
        };
        let mut title_buf = [0u16; 512];
        let len = unsafe { GetWindowTextW(hwnd, &mut title_buf) };
        let title = if len > 0 { String::from_utf16_lossy(&title_buf[..len as usize]) } else { String::new() };
        let app_name = if ident.app_name.is_empty() { title.clone() } else { ident.app_name.clone() };
        out.push(WindowInfo {
            hwnd: raw as i64,
            pid: ident.pid,
            title,
            exe: ident.exe.clone(),
            aumid: ident.aumid.clone(),
            app_name,
            minimized: unsafe { IsIconic(hwnd) }.as_bool(),
            foreground: raw == foreground,
            flashing: super::hook::is_flashing(raw),
            hung: unsafe { IsHungAppWindow(hwnd) }.as_bool(),
        });
    }
    map.retain(|k, _| alive.contains(k));
    out
}

fn key_input(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Presses keys together (down in order, up in reverse). The shell ignores a Windows key whose
/// press and release arrive in the same instant, so they go out a moment apart.
pub fn press(keys: &[VIRTUAL_KEY]) {
    let downs: Vec<INPUT> = keys.iter().map(|k| key_input(*k, false)).collect();
    let ups: Vec<INPUT> = keys.iter().rev().map(|k| key_input(*k, true)).collect();
    unsafe {
        SendInput(&downs, std::mem::size_of::<INPUT>() as i32);
        std::thread::sleep(std::time::Duration::from_millis(30));
        SendInput(&ups, std::mem::size_of::<INPUT>() as i32);
    }
}

pub fn open_start() {
    press(&[VK_LWIN]);
}

/// Win+X: Windows' own quick menu (Shut down, Task Manager, ...).
pub fn open_quick_menu() {
    press(&[VK_LWIN, VK_X]);
}

fn check(hwnd: HWND) -> SvcResult<()> {
    if unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        Ok(())
    } else {
        Err(SvcError::NotFound("the window is no longer open".into()))
    }
}

/// Brings a window to the front, restoring it if minimized. Uses the async calls so a hung
/// app can't hang the dock.
pub fn focus(raw: i64) -> SvcResult<()> {
    let hwnd = to_hwnd(raw);
    check(hwnd)?;
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindowAsync(hwnd, SW_RESTORE);
        }
        if !SetForegroundWindow(hwnd).as_bool() {
            // Only the app that got the last input may change the foreground; a tap of Alt
            // counts as that input.
            press(&[VK_MENU]);
            let _ = SetForegroundWindow(hwnd);
        }
    }
    Ok(())
}

pub fn minimize(raw: i64) -> SvcResult<()> {
    let hwnd = to_hwnd(raw);
    check(hwnd)?;
    unsafe {
        let _ = ShowWindowAsync(hwnd, SW_MINIMIZE);
    }
    Ok(())
}

/// A taskbar click: minimize the window when it is in front, else bring it forward.
/// Returns true when it was minimized.
pub fn toggle(raw: i64) -> SvcResult<bool> {
    let hwnd = to_hwnd(raw);
    check(hwnd)?;
    let front = unsafe { GetForegroundWindow() } == hwnd && !unsafe { IsIconic(hwnd) }.as_bool();
    if front {
        minimize(raw)?;
        Ok(true)
    } else {
        focus(raw)?;
        Ok(false)
    }
}

/// Asks a window to close, as its own close button would.
pub fn close(raw: i64) -> SvcResult<()> {
    let hwnd = to_hwnd(raw);
    check(hwnd)?;
    unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) }.map_err(SvcError::from)
}

/// Ends a process that stopped answering (the taskbar's "End task").
pub fn end_task(pid: u32) -> SvcResult<()> {
    if pid < 8 || pid == std::process::id() {
        return Err(SvcError::Denied("GlintBar does not end system processes or itself".into()));
    }
    unsafe {
        let process = OpenProcess(PROCESS_TERMINATE, false, pid)
            .map_err(|_| SvcError::Denied("Windows refused to end that app".into()))?;
        let result = TerminateProcess(process, 1);
        let _ = CloseHandle(process);
        result.map_err(|_| SvcError::Denied("Windows refused to end that app".into()))
    }
}
