//! Recycle Bin, recently opened files, drives and what takes their space.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeInformationW,
};
use windows::Win32::UI::Shell::{
    SHEmptyRecycleBinW, SHFileOperationW, SHQueryRecycleBinW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI,
    FOF_SILENT, FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads, FOLDERID_Music, FOLDERID_Pictures,
    FOLDERID_Videos, FO_DELETE, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND, SHFILEOPSTRUCTW,
    SHQUERYRBINFO,
};

use super::model::{Drive, FolderEntry, FolderSize, Recent, RecentItem, RecycleInfo};
use super::pins::read_shortcut;
use super::util::{com_init, double_null_list, known_folder, wide_to_string};
use crate::error::{SvcError, SvcResult};

const DRIVE_REMOVABLE: u32 = 2;
const DRIVE_FIXED: u32 = 3;
const DRIVE_REMOTE: u32 = 4;
const DRIVE_CDROM: u32 = 5;

// ---- Recycle Bin ------------------------------------------------------------------------------

pub fn recycle_info() -> SvcResult<RecycleInfo> {
    let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
    unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info as *mut SHQUERYRBINFO) }?;
    Ok(RecycleInfo { count: info.i64NumItems.max(0), bytes: info.i64Size.max(0) })
}

pub fn recycle_empty() -> SvcResult<RecycleInfo> {
    let before = recycle_info()?;
    if before.count > 0 {
        let flags = SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND;
        let result = unsafe { SHEmptyRecycleBinW(None, PCWSTR::null(), flags) };
        if let Err(e) = result {
            // Emptying can report an error when another app emptied it first.
            if recycle_info().map(|r| r.count).unwrap_or(1) > 0 {
                return Err(SvcError::Io(format!("emptying the Recycle Bin failed: {e}")));
            }
        }
    }
    recycle_info()
}

/// Moves files and folders to the Recycle Bin (undoable, no prompts).
pub fn recycle_files(paths: &[String]) -> SvcResult<RecycleInfo> {
    let list: Vec<String> = paths
        .iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty() && Path::new(p).is_absolute() && Path::new(p).exists())
        .filter(|p| p.len() > 3) // never a drive root
        .take(500)
        .collect();
    if list.is_empty() {
        return Err(SvcError::bad_args("no files were given to recycle"));
    }
    let from = double_null_list(&list);
    let mut op = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: PCWSTR(from.as_ptr()),
        fFlags: (FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_SILENT.0 | FOF_NOERRORUI.0) as u16,
        ..Default::default()
    };
    let code = unsafe { SHFileOperationW(&mut op as *mut SHFILEOPSTRUCTW) };
    if code != 0 {
        return Err(SvcError::Io(format!("Windows refused to recycle the files (code {code})")));
    }
    recycle_info()
}

// ---- Recently opened ----------------------------------------------------------------------------

fn modified_ms(path: &Path) -> i64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn recent_files(limit: usize) -> Vec<RecentItem> {
    com_init();
    let Some(appdata) = std::env::var_os("APPDATA") else {
        return Vec::new();
    };
    let dir = PathBuf::from(appdata).join(r"Microsoft\Windows\Recent");
    let mut links: Vec<(i64, PathBuf)> = match std::fs::read_dir(&dir) {
        Ok(entries) => entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().map(|x| x.eq_ignore_ascii_case("lnk")).unwrap_or(false))
            .map(|p| (modified_ms(&p), p))
            .collect(),
        Err(_) => return Vec::new(),
    };
    links.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out: Vec<RecentItem> = Vec::new();
    for (at, link) in links.into_iter().take(limit * 3 + 10) {
        if out.len() >= limit {
            break;
        }
        let Some(target) = read_shortcut(&link.to_string_lossy()).and_then(|s| s.target) else {
            continue;
        };
        let tp = Path::new(&target);
        if !tp.exists() || out.iter().any(|r| r.target.eq_ignore_ascii_case(&target)) {
            continue;
        }
        let is_dir = tp.is_dir();
        let name = tp
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| target.clone());
        out.push(RecentItem {
            name,
            icon: if is_dir { target.clone() } else { format!("thumb:{target}") },
            target,
            kind: if is_dir { "folder".into() } else { "file".into() },
            at,
        });
    }
    out
}

pub fn recent(limit: usize) -> Recent {
    let limit = limit.clamp(1, 50);
    Recent { files: recent_files(limit), apps: super::installed::recent_apps(limit) }
}

// ---- Folder stacks ------------------------------------------------------------------------------

/// A folder's contents for a dock stack: folders first, then newest first.
pub fn list_folder(path: &str, limit: usize) -> SvcResult<Vec<FolderEntry>> {
    let dir = PathBuf::from(crate::services::core::fs::expand(path));
    let mut out: Vec<FolderEntry> = Vec::new();
    for entry in std::fs::read_dir(&dir)?.flatten() {
        if out.len() >= 2000 {
            break;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let lower = name.to_lowercase();
        if lower == "desktop.ini" || lower == "thumbs.db" || name.starts_with('~') {
            continue;
        }
        let meta = entry.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let p = entry.path().to_string_lossy().into_owned();
        out.push(FolderEntry {
            icon: if is_dir { p.clone() } else { format!("thumb:{p}") },
            name,
            path: p,
            is_dir,
            size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            modified,
        });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(b.modified.cmp(&a.modified)));
    out.truncate(limit.clamp(1, 500));
    Ok(out)
}

// ---- Drives -------------------------------------------------------------------------------------

pub fn drives() -> Vec<Drive> {
    let mut buf = [0u16; 512];
    let len = unsafe { GetLogicalDriveStringsW(Some(&mut buf[..])) } as usize;
    if len == 0 || len > buf.len() {
        return Vec::new();
    }
    let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_uppercase();
    let mut out: Vec<Drive> = Vec::new();
    for root in buf[..len].split(|c| *c == 0).filter(|s| !s.is_empty()) {
        let root = String::from_utf16_lossy(root);
        let h = HSTRING::from(root.as_str());
        let kind_code = unsafe { GetDriveTypeW(&h) };
        if kind_code <= 1 {
            continue;
        }
        let mut avail: u64 = 0;
        let mut total: u64 = 0;
        let mut free_all: u64 = 0;
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                &h,
                Some(&mut avail as *mut u64),
                Some(&mut total as *mut u64),
                Some(&mut free_all as *mut u64),
            )
        };
        if ok.is_err() || total == 0 {
            continue;
        }
        let mut label = [0u16; 261];
        let mut fs = [0u16; 64];
        let _ = unsafe { GetVolumeInformationW(&h, Some(&mut label[..]), None, None, None, Some(&mut fs[..])) };
        let kind = match kind_code {
            DRIVE_FIXED => "fixed",
            DRIVE_REMOVABLE => "removable",
            DRIVE_REMOTE => "network",
            DRIVE_CDROM => "cdrom",
            _ => "other",
        };
        let letter = root.trim_end_matches('\\').trim_end_matches(':').to_string();
        out.push(Drive {
            system: root.to_uppercase().starts_with(&system),
            root: root.clone(),
            letter,
            label: wide_to_string(&label),
            fs: wide_to_string(&fs),
            kind: kind.into(),
            total,
            free: avail,
        });
    }
    out
}

// ---- What takes the space ----------------------------------------------------------------------

static SIZES: Mutex<Option<HashMap<String, (Instant, Vec<FolderSize>)>>> = Mutex::new(None);

/// Adds up a folder tree, giving up after `budget` entries or the deadline.
fn tree_size(root: &Path, budget: &mut usize, deadline: Instant) -> (u64, bool) {
    let mut total: u64 = 0;
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if *budget == 0 || Instant::now() > deadline {
                return (total, true);
            }
            *budget -= 1;
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let ft = meta.file_type();
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len();
            }
        }
    }
    (total, false)
}

/// Sizes of the user folders on `root`'s drive (cached for ten minutes).
pub fn folder_sizes(root: &str) -> Vec<FolderSize> {
    let drive = root.trim().chars().next().map(|c| c.to_ascii_uppercase()).unwrap_or('C');
    let key = drive.to_string();
    {
        let cache = SIZES.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((at, list)) = cache.as_ref().and_then(|m| m.get(&key)) {
            if at.elapsed() < Duration::from_secs(600) {
                return list.clone();
            }
        }
    }
    let folders = [
        ("Desktop", FOLDERID_Desktop),
        ("Documents", FOLDERID_Documents),
        ("Downloads", FOLDERID_Downloads),
        ("Pictures", FOLDERID_Pictures),
        ("Videos", FOLDERID_Videos),
        ("Music", FOLDERID_Music),
    ];
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut budget: usize = 400_000;
    let mut out: Vec<FolderSize> = Vec::new();
    for (name, id) in folders {
        let Some(path) = known_folder(&id) else {
            continue;
        };
        if path.chars().next().map(|c| c.to_ascii_uppercase()) != Some(drive) {
            continue;
        }
        let (bytes, approx) = tree_size(Path::new(&path), &mut budget, deadline);
        out.push(FolderSize { name: name.into(), path, bytes, approx });
    }
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    SIZES.lock().unwrap_or_else(|p| p.into_inner()).get_or_insert_with(HashMap::new).insert(key, (Instant::now(), out.clone()));
    out
}
