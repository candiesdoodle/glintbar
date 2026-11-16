//! Desktop helpers: show/hide desktop icons (Explorer's own "Show desktop icons" command) and
//! Show Desktop (Win+D).

use windows::core::{w, BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, FindWindowExW, FindWindowW, IsWindowVisible, PostMessageW, WM_COMMAND};

use crate::error::{SvcError, SvcResult};

/// Explorer's command id for View > Show desktop icons.
const TOGGLE_ICONS: usize = 0x7402;

unsafe extern "system" fn find_view(hwnd: HWND, data: LPARAM) -> BOOL {
    if let Ok(view) = unsafe { FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), PCWSTR::null()) } {
        unsafe { *(data.0 as *mut Option<HWND>) = Some(view) };
        return BOOL(0);
    }
    BOOL(1)
}

/// The desktop's list view host (under Progman, or a WorkerW once a slideshow ran).
fn desktop_view() -> Option<HWND> {
    unsafe {
        if let Ok(progman) = FindWindowW(w!("Progman"), PCWSTR::null()) {
            if let Ok(view) = FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), PCWSTR::null()) {
                return Some(view);
            }
        }
        let mut found: Option<HWND> = None;
        let _ = EnumWindows(Some(find_view), LPARAM(&mut found as *mut Option<HWND> as isize));
        found
    }
}

pub fn icons_visible() -> Option<bool> {
    let view = desktop_view()?;
    unsafe {
        let list = FindWindowExW(Some(view), None, w!("SysListView32"), PCWSTR::null()).ok()?;
        Some(IsWindowVisible(list).as_bool())
    }
}

pub fn toggle_icons() -> SvcResult<()> {
    let view = desktop_view().ok_or_else(|| SvcError::NotFound("Explorer's desktop window is missing (it may be restarting)".into()))?;
    unsafe { PostMessageW(Some(view), WM_COMMAND, WPARAM(TOGGLE_ICONS), LPARAM(0))? };
    Ok(())
}

pub fn show_desktop() -> SvcResult<()> {
    super::util::win_plus('D')
}
