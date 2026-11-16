//! The Windows taskbar's pins (shortcut files + Store app ids from the Taskband list),
//! shortcut resolution, and turning dropped paths into dock entries.

use std::ffi::c_void;
use std::path::{Path, PathBuf};

use windows::core::{w, Interface, HSTRING};
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ};
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_BINARY};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, SIGDN_NORMALDISPLAY};

use super::model::{app_id, parse_taskband, AppEntry, PinRef};
use super::util::{com_init, item_name, prop_string, shell_item, wide_to_string, PKEY_APP_USER_MODEL_ID};

const TASKBAND_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Taskband";

fn pinned_folder() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(PathBuf::from(appdata).join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"))
}

fn taskband_blob() -> Vec<u8> {
    let key = HSTRING::from(TASKBAND_KEY);
    let mut len: u32 = 0;
    unsafe {
        let first = RegGetValueW(
            HKEY_CURRENT_USER,
            &key,
            w!("Favorites"),
            RRF_RT_REG_BINARY,
            None,
            None,
            Some(&mut len as *mut u32),
        );
        if first != ERROR_SUCCESS || len == 0 || len > 4 * 1024 * 1024 {
            return Vec::new();
        }
        let mut blob: Vec<u8> = vec![0u8; len as usize];
        let second = RegGetValueW(
            HKEY_CURRENT_USER,
            &key,
            w!("Favorites"),
            RRF_RT_REG_BINARY,
            None,
            Some(blob.as_mut_ptr() as *mut c_void),
            Some(&mut len as *mut u32),
        );
        if second != ERROR_SUCCESS {
            return Vec::new();
        }
        blob.truncate(len as usize);
        blob
    }
}

/// What a .lnk points at.
pub struct Shortcut {
    pub target: Option<String>,
    pub args: Option<String>,
    pub aumid: Option<String>,
    pub description: Option<String>,
}

pub fn read_shortcut(path: &str) -> Option<Shortcut> {
    com_init();
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let file: IPersistFile = link.cast().ok()?;
        file.Load(&HSTRING::from(path), STGM_READ).ok()?;
        let mut buf = [0u16; 1024];
        let target = link
            .GetPath(&mut buf, std::ptr::null_mut(), 0)
            .ok()
            .map(|_| wide_to_string(&buf))
            .filter(|t| !t.trim().is_empty());
        let mut abuf = [0u16; 2048];
        let args = link.GetArguments(&mut abuf).ok().map(|_| wide_to_string(&abuf)).filter(|a| !a.trim().is_empty());
        let mut dbuf = [0u16; 1024];
        let description =
            link.GetDescription(&mut dbuf).ok().map(|_| wide_to_string(&dbuf)).filter(|d| !d.trim().is_empty());
        let aumid = link.cast::<IPropertyStore>().ok().and_then(|store| prop_string(&store, &PKEY_APP_USER_MODEL_ID));
        Some(Shortcut { target, args, aumid, description })
    }
}

/// A Store or Start-menu app's name by its app id, or None when it isn't installed.
pub fn aumid_name(aumid: &str) -> Option<String> {
    com_init();
    let item = shell_item(&format!("shell:AppsFolder\\{aumid}"))?;
    item_name(&item, SIGDN_NORMALDISPLAY)
}

/// A program's description from its version resource ("Google Chrome"), else its file name.
pub fn program_name(exe: &str) -> String {
    let fallback = || Path::new(exe).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| exe.to_string());
    let path = HSTRING::from(exe);
    let description: Option<String> = unsafe {
        let size = GetFileVersionInfoSizeW(&path, None);
        if size == 0 || size > 16 * 1024 * 1024 {
            return fallback();
        }
        let mut block: Vec<u8> = vec![0u8; size as usize];
        if GetFileVersionInfoW(&path, None, size, block.as_mut_ptr() as *mut c_void).is_err() {
            return fallback();
        }
        let mut ptr: *mut c_void = std::ptr::null_mut();
        let mut len: u32 = 0;
        let lang = if VerQueryValueW(
            block.as_ptr() as *const c_void,
            w!("\\VarFileInfo\\Translation"),
            &mut ptr as *mut *mut c_void,
            &mut len as *mut u32,
        )
        .as_bool()
            && len >= 4
            && !ptr.is_null()
        {
            let pair = std::slice::from_raw_parts(ptr as *const u16, 2);
            format!("{:04x}{:04x}", pair[0], pair[1])
        } else {
            "040904b0".to_string()
        };
        let query = HSTRING::from(format!("\\StringFileInfo\\{lang}\\FileDescription"));
        let mut text_ptr: *mut c_void = std::ptr::null_mut();
        let mut text_len: u32 = 0;
        if VerQueryValueW(
            block.as_ptr() as *const c_void,
            &query,
            &mut text_ptr as *mut *mut c_void,
            &mut text_len as *mut u32,
        )
        .as_bool()
            && text_len > 0
            && !text_ptr.is_null()
        {
            let text = std::slice::from_raw_parts(text_ptr as *const u16, text_len as usize);
            Some(wide_to_string(text).trim().to_string())
        } else {
            None
        }
    };
    description.filter(|d| !d.is_empty() && d.len() < 80).unwrap_or_else(fallback)
}

fn stem(path: &str) -> String {
    Path::new(path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string())
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| path.to_string())
}

fn lower_ext(path: &str) -> String {
    Path::new(path).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// A dock entry for a shortcut file.
pub fn entry_for_shortcut(path: &str) -> AppEntry {
    let info = read_shortcut(path);
    let (target, args, aumid) = match &info {
        Some(s) => (s.target.clone(), s.args.clone(), s.aumid.clone()),
        None => (None, None, None),
    };
    let exe = target.as_ref().filter(|t| t.to_lowercase().ends_with(".exe")).map(|t| t.to_lowercase());
    let kind = match &target {
        Some(t) if Path::new(t).is_dir() => "folder",
        Some(t) if exe.is_none() && aumid.is_none() && Path::new(t).is_file() => "file",
        _ => "app",
    };
    AppEntry {
        id: app_id(aumid.as_deref(), exe.as_deref(), target.as_deref().unwrap_or(path)),
        name: stem(path),
        kind: kind.to_string(),
        target: path.to_string(),
        args,
        aumid,
        exe,
        icon: path.to_string(),
    }
}

/// A dock entry for any dropped path: shortcut, program, internet shortcut, folder or file.
pub fn entry_for_path(path: &str) -> Option<AppEntry> {
    let p = Path::new(path);
    if !p.exists() {
        return None;
    }
    if p.is_dir() {
        return Some(AppEntry {
            id: app_id(None, None, path),
            name: file_name(path),
            kind: "folder".into(),
            target: path.to_string(),
            args: None,
            aumid: None,
            exe: None,
            icon: path.to_string(),
        });
    }
    let ext = lower_ext(path);
    Some(match ext.as_str() {
        "lnk" => entry_for_shortcut(path),
        "exe" => {
            let exe = path.to_lowercase();
            AppEntry {
                id: app_id(None, Some(&exe), path),
                name: program_name(path),
                kind: "app".into(),
                target: path.to_string(),
                args: None,
                aumid: None,
                exe: Some(exe),
                icon: path.to_string(),
            }
        }
        // Internet shortcuts, Steam games ("steam://rungameid/...") among them.
        "url" => AppEntry {
            id: app_id(None, None, path),
            name: stem(path),
            kind: "app".into(),
            target: path.to_string(),
            args: None,
            aumid: None,
            exe: None,
            icon: path.to_string(),
        },
        _ => AppEntry {
            id: app_id(None, None, path),
            name: file_name(path),
            kind: "file".into(),
            target: path.to_string(),
            args: None,
            aumid: None,
            exe: None,
            icon: format!("thumb:{path}"),
        },
    })
}

pub fn resolve_paths(paths: &[String]) -> Vec<AppEntry> {
    paths.iter().take(64).filter_map(|p| entry_for_path(p.trim())).collect()
}

/// An entry for an installed app id (Store apps, Start-menu apps with an id).
pub fn entry_for_aumid(aumid: &str) -> Option<AppEntry> {
    let name = aumid_name(aumid)?;
    Some(AppEntry {
        id: app_id(Some(aumid), None, aumid),
        name,
        kind: "app".into(),
        target: format!("shell:AppsFolder\\{aumid}"),
        args: None,
        aumid: Some(aumid.to_string()),
        exe: None,
        icon: format!("aumid:{aumid}"),
    })
}

/// The Windows taskbar's pinned apps, in the taskbar's order.
pub fn taskbar_pins() -> Vec<AppEntry> {
    com_init();
    let Some(folder) = pinned_folder() else {
        return Vec::new();
    };
    let shortcuts: Vec<String> = std::fs::read_dir(&folder)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.to_lowercase().ends_with(".lnk"))
                .collect()
        })
        .unwrap_or_default();
    let mut out: Vec<AppEntry> = Vec::new();
    for pin in parse_taskband(&taskband_blob(), &shortcuts) {
        let entry = match pin {
            PinRef::Shortcut(name) => Some(entry_for_shortcut(&folder.join(&name).to_string_lossy())),
            PinRef::AppId(id) => entry_for_aumid(&id),
        };
        if let Some(e) = entry {
            if !out.iter().any(|x| x.id == e.id) {
                out.push(e);
            }
        }
    }
    out
}
