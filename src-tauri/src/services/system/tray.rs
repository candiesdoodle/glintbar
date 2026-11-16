//! Notification-area icons, read from the taskbar's own toolbar windows (Explorer keeps each
//! icon's owner window, id and callback message in the toolbar button data). Clicks are
//! forwarded as the taskbar would send them.
//!
//! This works where the classic toolbar exists: Windows 10 and Windows 11 before the XAML
//! tray (22H2). There `list` reports `supported: false` and the UI offers Windows' own
//! overflow flyout instead.

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
use windows::Win32::System::Diagnostics::Debug::ReadProcessMemory;
use windows::Win32::System::Memory::{VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, PAGE_READWRITE};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_ACCESS_RIGHTS, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_OPERATION, PROCESS_VM_READ,
};
use windows::Win32::UI::Controls::{TBBUTTON, TBSTATE_HIDDEN, TB_BUTTONCOUNT, TB_GETBUTTON, TB_GETBUTTONTEXTW};
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, FindWindowExW, FindWindowW, GetWindowThreadProcessId, IsWindow, PostMessageW,
    SendMessageTimeoutW, HICON, SMTO_ABORTIFHUNG, WM_CONTEXTMENU, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP,
    WM_RBUTTONDOWN, WM_RBUTTONUP,
};

use crate::error::{SvcError, SvcResult};

/// Explorer's per-button data (undocumented but stable since Windows XP).
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct TrayData {
    hwnd: isize,
    uid: u32,
    callback: u32,
    reserved: [u32; 2],
    hicon: isize,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrayIcon {
    /// "<hwnd>:<uid>"
    pub key: String,
    pub hwnd: i64,
    pub uid: u32,
    pub callback: u32,
    pub tooltip: String,
    /// PNG data URL.
    pub icon: Option<String>,
    /// In the overflow ("hidden icons") area rather than next to the clock.
    pub overflow: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrayList {
    pub supported: bool,
    pub reason: Option<String>,
    pub icons: Vec<TrayIcon>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickArgs {
    pub hwnd: i64,
    pub uid: u32,
    pub callback: u32,
    /// "left", "right" or "double"
    pub button: String,
}

/// hicon value -> data URL (icons rarely change; the handle changes when they do).
static ICONS: Mutex<Option<HashMap<isize, Option<String>>>> = Mutex::new(None);

fn icon_for(hicon: isize) -> Option<String> {
    {
        let g = ICONS.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(found) = g.as_ref().and_then(|m| m.get(&hicon)) {
            return found.clone();
        }
    }
    let url = super::icon::to_data_url(HICON(hicon as *mut c_void));
    let mut g = ICONS.lock().unwrap_or_else(|p| p.into_inner());
    let map = g.get_or_insert_with(HashMap::new);
    if map.len() > 200 {
        map.clear();
    }
    map.insert(hicon, url.clone());
    url
}

fn toolbars() -> Vec<(HWND, bool)> {
    let mut out = Vec::new();
    unsafe {
        if let Ok(tray) = FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()) {
            if let Ok(notify) = FindWindowExW(Some(tray), None, w!("TrayNotifyWnd"), PCWSTR::null()) {
                if let Ok(pager) = FindWindowExW(Some(notify), None, w!("SysPager"), PCWSTR::null()) {
                    if let Ok(tb) = FindWindowExW(Some(pager), None, w!("ToolbarWindow32"), PCWSTR::null()) {
                        out.push((tb, false));
                    }
                }
            }
        }
        if let Ok(overflow) = FindWindowW(w!("NotifyIconOverflowWindow"), PCWSTR::null()) {
            if let Ok(tb) = FindWindowExW(Some(overflow), None, w!("ToolbarWindow32"), PCWSTR::null()) {
                out.push((tb, true));
            }
        }
    }
    out
}

fn send(tb: HWND, msg: u32, wparam: usize, lparam: isize) -> Option<usize> {
    let mut result: usize = 0;
    let ok = unsafe {
        SendMessageTimeoutW(tb, msg, WPARAM(wparam), LPARAM(lparam), SMTO_ABORTIFHUNG, 500, Some(&mut result as *mut usize))
    };
    if ok.0 == 0 {
        None
    } else {
        Some(result)
    }
}

fn read_toolbar(tb: HWND, overflow: bool, out: &mut Vec<TrayIcon>) -> SvcResult<()> {
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(tb, Some(&mut pid as *mut u32)) };
    if pid == 0 {
        return Ok(());
    }
    let access = PROCESS_ACCESS_RIGHTS(PROCESS_VM_OPERATION.0 | PROCESS_VM_READ.0 | PROCESS_QUERY_LIMITED_INFORMATION.0);
    let process = unsafe { OpenProcess(access, false, pid) }.map_err(|_| SvcError::Denied("taskbar access was refused".into()))?;
    let count = send(tb, TB_BUTTONCOUNT, 0, 0).unwrap_or(0).min(256);
    let remote = unsafe { VirtualAllocEx(process, None, 4096, MEM_COMMIT, PAGE_READWRITE) };
    if remote.is_null() {
        unsafe {
            let _ = CloseHandle(process);
        }
        return Err(SvcError::Denied("taskbar access was refused".into()));
    }
    for i in 0..count {
        if send(tb, TB_GETBUTTON, i, remote as isize).unwrap_or(0) == 0 {
            continue;
        }
        let mut button = TBBUTTON::default();
        let read = unsafe {
            ReadProcessMemory(process, remote, &mut button as *mut TBBUTTON as *mut c_void, std::mem::size_of::<TBBUTTON>(), None)
        };
        if read.is_err() || (button.fsState as u32 & TBSTATE_HIDDEN) != 0 || button.dwData == 0 {
            continue;
        }
        let mut data = TrayData::default();
        let read = unsafe {
            ReadProcessMemory(
                process,
                button.dwData as *const c_void,
                &mut data as *mut TrayData as *mut c_void,
                std::mem::size_of::<TrayData>(),
                None,
            )
        };
        if read.is_err() || data.hwnd == 0 {
            continue;
        }
        let mut tooltip = String::new();
        // Ask for the length first (lParam 0): the toolbar writes the whole text with no size
        // limit, so only let it write into our 4 KB remote page when the text fits.
        let probe = send(tb, TB_GETBUTTONTEXTW, button.idCommand as usize, 0).unwrap_or(usize::MAX);
        let fits = probe != usize::MAX && probe > 0 && probe < 2000;
        let fetched = if fits { send(tb, TB_GETBUTTONTEXTW, button.idCommand as usize, remote as isize) } else { None };
        if let Some(len) = fetched {
            // -1 (no text) arrives as usize::MAX.
            let len = if len == usize::MAX { 0 } else { len.min(probe) };
            if len > 0 {
                let mut text = vec![0u16; len];
                let ok = unsafe {
                    ReadProcessMemory(process, remote, text.as_mut_ptr() as *mut c_void, len * 2, None)
                };
                if ok.is_ok() {
                    tooltip = super::util::from_wide(&text).trim().to_string();
                }
            }
        }
        out.push(TrayIcon {
            key: format!("{}:{}", data.hwnd, data.uid),
            hwnd: data.hwnd as i64,
            uid: data.uid,
            callback: data.callback,
            tooltip,
            icon: icon_for(data.hicon),
            overflow,
        });
    }
    unsafe {
        let _ = VirtualFreeEx(process, remote, 0, MEM_RELEASE);
        let _ = CloseHandle(process);
    }
    Ok(())
}

pub fn list() -> SvcResult<TrayList> {
    if cfg!(target_pointer_width = "32") {
        return Ok(TrayList { supported: false, reason: Some("A 32-bit GlintBar cannot read icons from the 64-bit taskbar.".into()), icons: Vec::new() });
    }
    // Windows 11 22H2 and later draw the tray in XAML; whatever classic toolbar is left there is
    // not the real tray. Never read Explorer's memory on those builds.
    let build = super::util::windows_build();
    if build >= 22621 {
        return Ok(TrayList {
            supported: false,
            reason: Some("Tray icons can't be listed on this Windows version because it draws them itself.".into()),
            icons: Vec::new(),
        });
    }
    let bars = toolbars();
    let mut icons = Vec::new();
    for (tb, overflow) in &bars {
        let _ = read_toolbar(*tb, *overflow, &mut icons);
    }
    if icons.is_empty() && bars.is_empty() {
        return Ok(TrayList {
            supported: false,
            reason: Some("Tray icons can't be listed on this Windows version because it draws them itself.".into()),
            icons,
        });
    }
    Ok(TrayList { supported: true, reason: None, icons })
}

pub fn click(args: ClickArgs) -> SvcResult<()> {
    // Tray callbacks are private messages (WM_USER and up). Refusing system messages keeps this
    // from being used to post WM_CLOSE / WM_QUIT etc. to arbitrary windows.
    if args.callback < 0x0400 {
        return Err(SvcError::bad_args("not a tray icon message"));
    }
    let hwnd = HWND(args.hwnd as isize as *mut c_void);
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return Err(SvcError::NotFound("that app has closed".into()));
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
        // Lets the app bring its menu or window to the front.
        let _ = AllowSetForegroundWindow(pid);
    }
    // Classic (version 0) notification format: wParam = icon id, lParam = mouse message.
    let post = |msg: u32| unsafe { PostMessageW(Some(hwnd), args.callback, WPARAM(args.uid as usize), LPARAM(msg as isize)) };
    match args.button.as_str() {
        "left" => {
            post(WM_LBUTTONDOWN)?;
            post(WM_LBUTTONUP)?;
        }
        "right" => {
            post(WM_RBUTTONDOWN)?;
            post(WM_RBUTTONUP)?;
            post(WM_CONTEXTMENU)?;
        }
        "double" => {
            post(WM_LBUTTONDOWN)?;
            post(WM_LBUTTONUP)?;
            post(WM_LBUTTONDBLCLK)?;
            post(WM_LBUTTONUP)?;
        }
        _ => return Err(SvcError::bad_args("button must be left, right or double")),
    }
    Ok(())
}

/// The fallback where icons can't be listed: Windows' own "Show hidden icons" flyout (Win+B
/// focuses the notification area; Enter opens the overflow chevron).
pub fn open_overflow() -> SvcResult<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::VK_RETURN;
    super::util::win_plus('B')?;
    std::thread::sleep(std::time::Duration::from_millis(120));
    super::util::send_combo(&[VK_RETURN])
}
