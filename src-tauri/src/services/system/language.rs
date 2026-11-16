//! Keyboard layouts: the one active in the window in front, the installed list, and switching
//! (WM_INPUTLANGCHANGEREQUEST to the foreground window, as the taskbar's switcher does).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::Globalization::{
    GetLocaleInfoEx, LCIDToLocaleName, LOCALE_SISO3166CTRYNAME, LOCALE_SISO639LANGNAME2, LOCALE_SLOCALIZEDDISPLAYNAME,
};
use windows::Win32::System::Registry::HKEY_LOCAL_MACHINE;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyboardLayout, GetKeyboardLayoutList, HKL};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId, PostMessageW, WM_INPUTLANGCHANGEREQUEST};

use crate::error::{SvcError, SvcResult};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    /// The HKL as hex, e.g. "04090409".
    pub id: String,
    /// "ENG"
    pub short: String,
    /// "US"
    pub region: String,
    /// "English (United States)"
    pub language: String,
    /// "US" / "United Kingdom" / "Dvorak" (the keyboard layout's own name)
    pub layout: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LanguageState {
    pub current: Option<Layout>,
    pub layouts: Vec<Layout>,
}

#[derive(Deserialize)]
pub struct SetArgs {
    pub id: String,
}

static NAMES: Mutex<Option<HashMap<usize, Layout>>> = Mutex::new(None);

fn locale_info(name: &[u16], what: u32) -> String {
    let mut buf = [0u16; 128];
    let len = unsafe { GetLocaleInfoEx(PCWSTR(name.as_ptr()), what, Some(&mut buf[..])) };
    if len <= 0 {
        return String::new();
    }
    super::util::from_wide(&buf)
}

/// The keyboard layout's display name from the registry, when the HKL names a standard one.
fn layout_text(hkl: usize) -> Option<String> {
    let device = ((hkl >> 16) & 0xFFFF) as u32;
    if device & 0xF000 == 0xF000 {
        // A variant layout id; its name needs a registry scan. The language name is enough.
        return None;
    }
    let klid = format!("{device:08X}");
    let key = format!(r"SYSTEM\CurrentControlSet\Control\Keyboard Layouts\{klid}");
    crate::win::reg_string(HKEY_LOCAL_MACHINE, &key, "Layout Text")
}

fn describe(hkl: usize) -> Layout {
    {
        let g = NAMES.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(found) = g.as_ref().and_then(|m| m.get(&hkl)) {
            return found.clone();
        }
    }
    let lang_id = (hkl & 0xFFFF) as u32;
    let mut name = [0u16; 85];
    let len = unsafe { LCIDToLocaleName(lang_id, Some(&mut name[..]), 0) };
    let layout = if len > 0 {
        let short = locale_info(&name, LOCALE_SISO639LANGNAME2).to_uppercase();
        Layout {
            id: format!("{hkl:08X}"),
            short: if short.is_empty() { format!("{lang_id:04X}") } else { short },
            region: locale_info(&name, LOCALE_SISO3166CTRYNAME).to_uppercase(),
            language: locale_info(&name, LOCALE_SLOCALIZEDDISPLAYNAME),
            layout: layout_text(hkl).unwrap_or_default(),
        }
    } else {
        Layout {
            id: format!("{hkl:08X}"),
            short: format!("{lang_id:04X}"),
            region: String::new(),
            language: format!("Language {lang_id:04X}"),
            layout: layout_text(hkl).unwrap_or_default(),
        }
    };
    let mut g = NAMES.lock().unwrap_or_else(|p| p.into_inner());
    g.get_or_insert_with(HashMap::new).insert(hkl, layout.clone());
    layout
}

fn installed() -> Vec<usize> {
    unsafe {
        let n = GetKeyboardLayoutList(None);
        if n <= 0 {
            return Vec::new();
        }
        let mut list = vec![HKL(std::ptr::null_mut()); n as usize];
        let got = GetKeyboardLayoutList(Some(list.as_mut_slice()));
        list.truncate(got.max(0) as usize);
        list.iter().map(|h| h.0 as usize).collect()
    }
}

fn current_hkl() -> usize {
    unsafe {
        let fg = GetForegroundWindow();
        let thread = GetWindowThreadProcessId(fg, None);
        GetKeyboardLayout(thread).0 as usize
    }
}

pub fn state() -> SvcResult<LanguageState> {
    let list = installed();
    let current = current_hkl();
    let layouts: Vec<Layout> = list.iter().map(|h| describe(*h)).collect();
    let current = if current != 0 { Some(describe(current)) } else { None };
    Ok(LanguageState { current, layouts })
}

fn activate(hkl: usize) -> SvcResult<()> {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() {
            return Err(SvcError::NotFound("there is no active window to apply the layout to".into()));
        }
        PostMessageW(Some(fg), WM_INPUTLANGCHANGEREQUEST, WPARAM(0), LPARAM(hkl as isize))?;
    }
    Ok(())
}

pub fn set(args: SetArgs) -> SvcResult<LanguageState> {
    let wanted = usize::from_str_radix(args.id.trim(), 16).map_err(|_| SvcError::bad_args("bad layout id"))?;
    if !installed().contains(&wanted) {
        return Err(SvcError::NotFound("Windows doesn't have that layout installed".into()));
    }
    activate(wanted)?;
    std::thread::sleep(std::time::Duration::from_millis(60));
    state()
}

/// Switches to the layout after the current one.
pub fn next() -> SvcResult<LanguageState> {
    let list = installed();
    if list.len() < 2 {
        return state();
    }
    let current = current_hkl();
    let i = list.iter().position(|h| *h == current).map(|i| (i + 1) % list.len()).unwrap_or(0);
    activate(list[i])?;
    std::thread::sleep(std::time::Duration::from_millis(60));
    state()
}
