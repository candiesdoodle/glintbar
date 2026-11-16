//! Jump lists for an app's right-click menu:
//! - tasks: the app's own entries ("New window", "Quit"), read best-effort from the custom
//!   destination files in Recent\\CustomDestinations (serialized shell links) and matched to the
//!   app by program path or app id;
//! - recent: the files Windows keeps for the app (IApplicationDocumentLists);
//! - pinned: File Explorer's Quick access folders.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use windows::core::{Interface, HSTRING};
use windows::Win32::System::Com::{CoCreateInstance, IPersistStream, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Shell::Common::IObjectArray;
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{
    ApplicationDocumentLists, IApplicationDocumentLists, IShellItem, IShellLinkW, SHCreateMemStream,
    SHLoadIndirectString, ShellLink, ADLT_RECENT, SIGDN_FILESYSPATH, SIGDN_NORMALDISPLAY,
};

use super::model::{JumpItem, JumpList};
use super::util::{com_init, item_name, prop_string, shell_children, wide_to_string, PKEY_APP_USER_MODEL_ID, PKEY_TITLE};

const EXPLORER_ID: &str = "Microsoft.Windows.Explorer";
const QUICK_ACCESS: &str = "shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}";
/// CLSID_ShellLink as stored on disk (little-endian GUID).
const SHELL_LINK_CLSID: [u8; 16] = [0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46];

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct JumpArgs {
    pub aumid: Option<String>,
    pub exe: Option<String>,
    pub limit: Option<usize>,
}

fn resolve_indirect(text: &str) -> String {
    if !text.starts_with('@') {
        return text.to_string();
    }
    let mut buf = [0u16; 512];
    let ok = unsafe { SHLoadIndirectString(&HSTRING::from(text), &mut buf, None) };
    if ok.is_ok() {
        let s = wide_to_string(&buf);
        if !s.is_empty() {
            return s;
        }
    }
    String::new()
}

struct LinkInfo {
    path: String,
    args: Option<String>,
    title: String,
    aumid: Option<String>,
}

fn link_from_stream(bytes: &[u8]) -> Option<LinkInfo> {
    unsafe {
        let stream = SHCreateMemStream(Some(bytes))?;
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let persist: IPersistStream = link.cast().ok()?;
        persist.Load(&stream).ok()?;
        let mut pbuf = [0u16; 1024];
        let path = link.GetPath(&mut pbuf, std::ptr::null_mut(), 0).ok().map(|_| wide_to_string(&pbuf)).unwrap_or_default();
        let mut abuf = [0u16; 2048];
        let args = link.GetArguments(&mut abuf).ok().map(|_| wide_to_string(&abuf)).filter(|a| !a.trim().is_empty());
        let store: Option<IPropertyStore> = link.cast().ok();
        let title = store.as_ref().and_then(|s| prop_string(s, &PKEY_TITLE)).unwrap_or_default();
        let aumid = store.as_ref().and_then(|s| prop_string(s, &PKEY_APP_USER_MODEL_ID));
        let title = if title.is_empty() {
            let mut dbuf = [0u16; 512];
            link.GetDescription(&mut dbuf).ok().map(|_| wide_to_string(&dbuf)).unwrap_or_default()
        } else {
            title
        };
        let title = resolve_indirect(title.trim());
        if title.is_empty() || path.is_empty() {
            return None;
        }
        Some(LinkInfo { path, args, title, aumid })
    }
}

fn links_in(file: &Path) -> Vec<LinkInfo> {
    let Ok(bytes) = std::fs::read(file) else {
        return Vec::new();
    };
    if bytes.len() > 2 * 1024 * 1024 {
        return Vec::new();
    }
    let mut out: Vec<LinkInfo> = Vec::new();
    let mut i = 0usize;
    while i + 16 < bytes.len() && out.len() < 40 {
        if bytes[i..i + 16] == SHELL_LINK_CLSID {
            if let Some(link) = link_from_stream(&bytes[i + 16..]) {
                out.push(link);
            }
            i += 16;
        } else {
            i += 1;
        }
    }
    out
}

fn same_path(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

fn custom_tasks(exe: Option<&str>, aumid: Option<&str>, limit: usize) -> Vec<JumpItem> {
    let Some(appdata) = std::env::var_os("APPDATA") else {
        return Vec::new();
    };
    let dir = PathBuf::from(appdata).join(r"Microsoft\Windows\Recent\CustomDestinations");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<JumpItem> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let is_custom =
            path.file_name().map(|n| n.to_string_lossy().to_lowercase().ends_with(".customdestinations-ms")).unwrap_or(false);
        if !is_custom {
            continue;
        }
        let links = links_in(&path);
        let belongs = links.iter().any(|l| {
            exe.map(|e| same_path(&l.path, e)).unwrap_or(false)
                || match (aumid, l.aumid.as_deref()) {
                    (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
                    _ => false,
                }
        });
        if !belongs {
            continue;
        }
        for l in links {
            if out.len() >= limit {
                break;
            }
            if out.iter().any(|x| x.title == l.title) {
                continue;
            }
            out.push(JumpItem { title: l.title, icon: l.path.clone(), target: l.path, args: l.args });
        }
        if !out.is_empty() {
            break;
        }
    }
    out
}

fn recent_docs(app_id: &str, limit: usize) -> Vec<JumpItem> {
    let mut out: Vec<JumpItem> = Vec::new();
    unsafe {
        let Ok(lists) = CoCreateInstance::<_, IApplicationDocumentLists>(&ApplicationDocumentLists, None, CLSCTX_INPROC_SERVER)
        else {
            return out;
        };
        if lists.SetAppID(&HSTRING::from(app_id)).is_err() {
            return out;
        }
        let Ok(array) = lists.GetList::<IObjectArray>(ADLT_RECENT, limit as u32) else {
            return out;
        };
        let count = array.GetCount().unwrap_or(0).min(limit as u32);
        for i in 0..count {
            if let Ok(item) = array.GetAt::<IShellItem>(i) {
                let title = item_name(&item, SIGDN_NORMALDISPLAY).unwrap_or_default();
                if let Some(path) = item_name(&item, SIGDN_FILESYSPATH) {
                    if !title.is_empty() {
                        out.push(JumpItem { title, icon: format!("thumb:{path}"), target: path, args: None });
                    }
                }
            } else if let Ok(link) = array.GetAt::<IShellLinkW>(i) {
                let mut pbuf = [0u16; 1024];
                if link.GetPath(&mut pbuf, std::ptr::null_mut(), 0).is_ok() {
                    let path = wide_to_string(&pbuf);
                    if !path.is_empty() {
                        let title = Path::new(&path)
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .unwrap_or_else(|| path.clone());
                        out.push(JumpItem { title, icon: path.clone(), target: path, args: None });
                    }
                }
            }
        }
    }
    out
}

fn quick_access(limit: usize) -> Vec<JumpItem> {
    shell_children(QUICK_ACCESS, limit)
        .into_iter()
        .filter_map(|c| {
            let path = c.path?;
            Some(JumpItem { title: c.name, icon: path.clone(), target: path, args: None })
        })
        .collect()
}

pub fn jump_list(a: JumpArgs) -> JumpList {
    com_init();
    let limit = a.limit.unwrap_or(8).clamp(1, 20);
    let aumid = a.aumid.clone().filter(|s| !s.is_empty());
    let exe = a.exe.clone().filter(|s| !s.is_empty()).map(|s| s.to_lowercase());
    let is_explorer = aumid.as_deref().map(|x| x.eq_ignore_ascii_case(EXPLORER_ID)).unwrap_or(false)
        || exe.as_deref().map(|e| e.ends_with("\\explorer.exe")).unwrap_or(false);
    let mut list = JumpList::default();
    if is_explorer {
        list.pinned = quick_access(limit + 4);
        return list;
    }
    let app_id = match (&aumid, &exe) {
        (Some(id), _) => id.clone(),
        (None, Some(path)) => super::installed::implicit_app_id(path),
        (None, None) => return list,
    };
    list.tasks = custom_tasks(exe.as_deref(), aumid.as_deref(), limit);
    list.recent = recent_docs(&app_id, limit);
    list
}
