//! Installed apps (everything in Start: shell:AppsFolder, which covers Start-menu shortcuts,
//! Store apps and Office) and the apps you started last (UserAssist).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use windows::core::{HSTRING, PWSTR};
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{RegCloseKey, RegEnumValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ};

use super::model::{app_id, filetime_to_unix_ms, rot13, AppEntry, RecentItem};
use super::pins::program_name;
use super::util::{com_init, expand_known_folder_path, item_prop, shell_children, PKEY_LINK_TARGET_PARSING_PATH};

const CACHE_FOR: Duration = Duration::from_secs(300);

static CACHE: Mutex<Option<(Instant, Vec<AppEntry>)>> = Mutex::new(None);

fn looks_like_path(s: &str) -> bool {
    s.contains('\\') || s.contains(':')
}

fn enumerate() -> Vec<AppEntry> {
    com_init();
    let mut out: Vec<AppEntry> = Vec::new();
    for child in shell_children("shell:AppsFolder", 3000) {
        let parsing = child.parsing.clone();
        let lower_name = child.name.to_lowercase();
        if parsing.starts_with("http") || lower_name.starts_with("uninstall") {
            continue;
        }
        let known = expand_known_folder_path(&parsing);
        let target_path = item_prop(&child.item, &PKEY_LINK_TARGET_PARSING_PATH);
        let exe = known
            .clone()
            .or(target_path)
            .or_else(|| if looks_like_path(&parsing) { Some(parsing.clone()) } else { None })
            .filter(|p| p.to_lowercase().ends_with(".exe"))
            .map(|p| p.to_lowercase());
        // Path-like parsing names ("{known folder}\\app.exe") are implicit ids, not real app ids.
        let aumid = if parsing.starts_with('{') || looks_like_path(&parsing) { None } else { Some(parsing.clone()) };
        let target = format!("shell:AppsFolder\\{parsing}");
        out.push(AppEntry {
            id: app_id(aumid.as_deref(), exe.as_deref(), &target),
            name: child.name,
            kind: "app".into(),
            target,
            args: None,
            aumid,
            exe,
            icon: format!("aumid:{parsing}"),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out.dedup_by(|a, b| a.id == b.id);
    out
}

/// Every app in Start, sorted by name. Cached for five minutes.
pub fn installed(refresh: bool) -> Vec<AppEntry> {
    {
        let cache = CACHE.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((at, list)) = cache.as_ref() {
            if !refresh && at.elapsed() < CACHE_FOR {
                return list.clone();
            }
        }
    }
    let list = enumerate();
    *CACHE.lock().unwrap_or_else(|p| p.into_inner()) = Some((Instant::now(), list.clone()));
    list
}

/// The installed entry for a program path or app id, if any.
pub fn find(aumid: Option<&str>, exe: Option<&str>) -> Option<AppEntry> {
    let list = installed(false);
    if let Some(a) = aumid {
        if let Some(e) = list.iter().find(|e| e.aumid.as_deref().map(|x| x.eq_ignore_ascii_case(a)).unwrap_or(false)) {
            return Some(e.clone());
        }
    }
    if let Some(x) = exe {
        if let Some(e) = list.iter().find(|e| e.exe.as_deref().map(|y| y.eq_ignore_ascii_case(x)).unwrap_or(false)) {
            return Some(e.clone());
        }
    }
    None
}

/// The id Windows uses for an app without its own: the program's Start entry name
/// ("{known folder}\\...\\app.exe"), else the program path.
pub fn implicit_app_id(exe: &str) -> String {
    let list = installed(false);
    for e in &list {
        if e.aumid.is_none() && e.exe.as_deref().map(|x| x.eq_ignore_ascii_case(exe)).unwrap_or(false) {
            if let Some(rest) = e.target.strip_prefix("shell:AppsFolder\\") {
                return rest.to_string();
            }
        }
    }
    exe.to_string()
}

const USER_ASSIST: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist\{CEBFF5CD-ACE2-4F4F-9178-9926F41749EA}\Count";

/// Apps started from Start, the taskbar or Explorer, most recent first (UserAssist).
pub fn recent_apps(limit: usize) -> Vec<RecentItem> {
    let mut raw: Vec<(String, i64)> = Vec::new();
    unsafe {
        let mut key = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(USER_ASSIST), Some(0), KEY_READ, &mut key as *mut HKEY)
            != ERROR_SUCCESS
        {
            return Vec::new();
        }
        let mut index: u32 = 0;
        loop {
            let mut name = [0u16; 1024];
            let mut name_len: u32 = name.len() as u32;
            let mut data = [0u8; 256];
            let mut data_len: u32 = data.len() as u32;
            let status = RegEnumValueW(
                key,
                index,
                Some(PWSTR(name.as_mut_ptr())),
                &mut name_len as *mut u32,
                None,
                None,
                Some(data.as_mut_ptr()),
                Some(&mut data_len as *mut u32),
            );
            index += 1;
            if status != ERROR_SUCCESS {
                // ERROR_MORE_DATA: an oversized value; anything else ends the list.
                if status.0 == 234 && index < 10_000 {
                    continue;
                }
                break;
            }
            if data_len < 68 {
                continue;
            }
            let ft = u64::from_le_bytes([data[60], data[61], data[62], data[63], data[64], data[65], data[66], data[67]]);
            if ft == 0 {
                continue;
            }
            let decoded = rot13(&String::from_utf16_lossy(&name[..name_len as usize]));
            if decoded.starts_with("UEME_") {
                continue;
            }
            raw.push((decoded, filetime_to_unix_ms(ft)));
        }
        let _ = RegCloseKey(key);
    }
    raw.sort_by(|a, b| b.1.cmp(&a.1));
    let mut out: Vec<RecentItem> = Vec::new();
    let mut seen: HashMap<String, bool> = HashMap::new();
    for (name, at) in raw {
        if out.len() >= limit {
            break;
        }
        let entry: Option<AppEntry> = if name.starts_with('{') {
            expand_known_folder_path(&name).and_then(|path| {
                let lower = path.to_lowercase();
                if !lower.ends_with(".exe") || !std::path::Path::new(&path).exists() {
                    return None;
                }
                find(None, Some(lower.as_str())).or_else(|| {
                    Some(AppEntry {
                        id: app_id(None, Some(&lower), &path),
                        name: program_name(&path),
                        kind: "app".into(),
                        target: path.clone(),
                        args: None,
                        aumid: None,
                        exe: Some(lower.clone()),
                        icon: path.clone(),
                    })
                })
            })
        } else if name.contains('\\') {
            None
        } else {
            find(Some(name.as_str()), None)
        };
        let Some(e) = entry else {
            continue;
        };
        let lower = e.name.to_lowercase();
        if lower.contains("glintbar") || seen.contains_key(&e.id) {
            continue;
        }
        seen.insert(e.id.clone(), true);
        out.push(RecentItem { name: e.name, target: e.target, kind: "app".into(), at, icon: e.icon });
    }
    out
}
