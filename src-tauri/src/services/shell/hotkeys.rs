//! Global hotkeys as a generic service: the UI asks for `{id, keys: "Alt+T"}` pairs and gets
//! `svc://shell/hotkey {id, label, at}` when one is pressed (label = the dock on the screen
//! under the pointer). Registered on the main dock window (RegisterHotKey), main thread only.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_NOREPEAT};

use super::model::parse_accelerator;
use super::window;

const BASE_ID: i32 = 0x4700;
const MAX_HOTKEYS: usize = 32;

/// (registered id, UI id)
static REGISTERED: Mutex<Vec<(i32, String)>> = Mutex::new(Vec::new());

#[derive(Deserialize, Clone)]
pub struct HotkeyDef {
    pub id: String,
    pub keys: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyResult {
    id: String,
    keys: String,
    ok: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HotkeyEvent {
    id: String,
    label: String,
    at: u64,
}

/// Replaces every registered hotkey with `defs`. Main thread.
pub fn apply(defs: Vec<HotkeyDef>) -> Vec<HotkeyResult> {
    let owner = match window::main_hwnd() {
        Some(raw) => HWND(raw as *mut core::ffi::c_void),
        None => {
            return defs
                .into_iter()
                .map(|d| HotkeyResult { id: d.id, keys: d.keys, ok: false, error: Some("the dock window has not loaded yet".into()) })
                .collect()
        }
    };
    let old: Vec<(i32, String)> = match REGISTERED.lock() {
        Ok(mut list) => std::mem::take(&mut *list),
        Err(_) => Vec::new(),
    };
    for (id, _) in &old {
        unsafe {
            let _ = UnregisterHotKey(Some(owner), *id);
        }
    }
    let mut registered: Vec<(i32, String)> = Vec::new();
    let mut results: Vec<HotkeyResult> = Vec::new();
    for (i, def) in defs.into_iter().take(MAX_HOTKEYS).enumerate() {
        let id = BASE_ID + i as i32;
        match parse_accelerator(&def.keys) {
            None => results.push(HotkeyResult {
                id: def.id,
                keys: def.keys,
                ok: false,
                error: Some("Combine Alt, Ctrl, Shift or Win with a letter, a digit or an F-key.".into()),
            }),
            Some((mods, vk)) => {
                let flags = HOT_KEY_MODIFIERS(mods | MOD_NOREPEAT.0);
                match unsafe { RegisterHotKey(Some(owner), id, flags, vk) } {
                    Ok(()) => {
                        registered.push((id, def.id.clone()));
                        results.push(HotkeyResult { id: def.id, keys: def.keys, ok: true, error: None });
                    }
                    Err(e) => {
                        tracing::info!(keys = %def.keys, "hotkey not available: {e}");
                        results.push(HotkeyResult {
                            id: def.id,
                            keys: def.keys,
                            ok: false,
                            error: Some("This key combination is taken by another app.".into()),
                        });
                    }
                }
            }
        }
    }
    if let Ok(mut list) = REGISTERED.lock() {
        *list = registered;
    }
    results
}

/// WM_HOTKEY (window procedure, main thread): must not block.
pub fn on_hotkey(id: i32) {
    let name = match REGISTERED.try_lock() {
        Ok(list) => list.iter().find(|(i, _)| *i == id).map(|(_, n)| n.clone()),
        Err(_) => None,
    };
    let name = match name {
        Some(n) => n,
        None => return,
    };
    tauri::async_runtime::spawn(async move {
        let label = window::label_at_cursor();
        window::reveal(&label);
        window::emit("hotkey", HotkeyEvent { id: name, label, at: window::now_ms() });
    });
}
