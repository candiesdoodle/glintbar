//! Types shared by the apps service (serde camelCase, mirrored in src/widgets/apps/types.ts),
//! plus the pure parsing helpers that don't need Win32 (unit-tested on any platform).

use serde::Serialize;

/// Something that can sit on the dock or be launched: an app, a folder, a file or a link.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    /// Stable identity used to match windows: "aumid:<id>", "exe:<path>" or "path:<path>" (lowercase).
    pub id: String,
    pub name: String,
    /// "app", "folder", "file" or "url".
    pub kind: String,
    /// What opening it runs: a shortcut, program, folder, file or "shell:AppsFolder\\<id>".
    pub target: String,
    pub args: Option<String>,
    pub aumid: Option<String>,
    /// Lowercase program path, when known.
    pub exe: Option<String>,
    /// Icon source for `apps.icon`.
    pub icon: String,
}

/// One window that would get a taskbar button.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub hwnd: i64,
    pub pid: u32,
    pub title: String,
    pub exe: Option<String>,
    pub aumid: Option<String>,
    pub app_name: String,
    pub minimized: bool,
    pub foreground: bool,
    pub flashing: bool,
    pub hung: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JumpItem {
    pub title: String,
    pub target: String,
    pub args: Option<String>,
    /// Icon source for `apps.icon` (empty = use the app's own icon).
    pub icon: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct JumpList {
    /// The app's own tasks ("New window", "Quit").
    pub tasks: Vec<JumpItem>,
    /// Pinned folders (File Explorer's Quick access).
    pub pinned: Vec<JumpItem>,
    /// Files the app opened last.
    pub recent: Vec<JumpItem>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecycleInfo {
    pub count: i64,
    pub bytes: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// "C:\\"
    pub root: String,
    pub letter: String,
    pub label: String,
    pub fs: String,
    /// "fixed", "removable", "network", "cdrom" or "other".
    pub kind: String,
    pub total: u64,
    pub free: u64,
    pub system: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderSize {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    /// The walk stopped early (too many files): the size is at least this much.
    pub approx: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: i64,
    pub icon: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    pub name: String,
    /// What opening it opens.
    pub target: String,
    /// "file", "folder" or "app".
    pub kind: String,
    /// Unix ms of the last use.
    pub at: i64,
    pub icon: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub files: Vec<RecentItem>,
    pub apps: Vec<RecentItem>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    /// Saved file, if saving was asked for.
    pub path: Option<String>,
    pub width: u32,
    pub height: u32,
    pub copied: bool,
    /// A small JPEG data URL of the shot.
    pub thumb: Option<String>,
}

/// The identity used to match windows to pins.
pub fn app_id(aumid: Option<&str>, exe: Option<&str>, target: &str) -> String {
    if let Some(a) = aumid.filter(|a| !a.is_empty()) {
        return format!("aumid:{}", a.to_lowercase());
    }
    if let Some(e) = exe.filter(|e| !e.is_empty()) {
        return format!("exe:{}", e.to_lowercase());
    }
    format!("path:{}", target.to_lowercase())
}

/// A pin found in the taskbar's own list.
#[derive(Debug, Clone, PartialEq)]
pub enum PinRef {
    /// A shortcut file name in the pinned folder ("Google Chrome.lnk").
    Shortcut(String),
    /// A Store app's id ("Microsoft.WindowsTerminal_8wekyb3d8bbwe!App").
    AppId(String),
}

/// Printable UTF-16LE strings in a binary blob, at both byte alignments, with their byte offset.
pub fn utf16_runs(blob: &[u8], min_len: usize) -> Vec<(usize, String)> {
    let mut out: Vec<(usize, String)> = Vec::new();
    for align in 0..2usize {
        let mut start: usize = 0;
        let mut cur: Vec<u16> = Vec::new();
        let mut i = align;
        while i + 1 < blob.len() {
            let u = u16::from_le_bytes([blob[i], blob[i + 1]]);
            let printable = u >= 0x20 && u != 0xFFFF && u != 0xFFFE && !(0xD800..=0xDFFF).contains(&u);
            if printable {
                if cur.is_empty() {
                    start = i;
                }
                cur.push(u);
            } else {
                if cur.len() >= min_len {
                    out.push((start, String::from_utf16_lossy(&cur)));
                }
                cur.clear();
            }
            i += 2;
        }
        if cur.len() >= min_len {
            out.push((start, String::from_utf16_lossy(&cur)));
        }
    }
    out.sort_by_key(|(offset, _)| *offset);
    out
}

fn id_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-'
}

/// Store app ids ("Name_publisherid!App") inside a piece of text.
pub fn find_aumids(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out: Vec<String> = Vec::new();
    for (i, &c) in chars.iter().enumerate() {
        if c != '!' {
            continue;
        }
        let mut left = i;
        while left > 0 && id_char(chars[left - 1]) {
            left -= 1;
        }
        let mut right = i + 1;
        while right < chars.len() && id_char(chars[right]) {
            right += 1;
        }
        if left == i || right == i + 1 {
            continue;
        }
        let family: String = chars[left..i].iter().collect();
        // A package family name ends with "_" and a 13-character publisher id.
        let publisher_ok = match family.rfind('_') {
            Some(u) => {
                let p = &family[u + 1..];
                u > 0 && p.len() == 13 && p.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            }
            None => false,
        };
        if !publisher_ok {
            continue;
        }
        let app: String = chars[i + 1..right].iter().collect();
        let id = format!("{family}!{app}");
        if !out.contains(&id) {
            out.push(id);
        }
    }
    out
}

/// The taskbar's pins in its own order: shortcut files and Store app ids as they appear in the
/// Taskband "Favorites" blob; shortcuts the blob doesn't mention go at the end.
pub fn parse_taskband(blob: &[u8], shortcuts: &[String]) -> Vec<PinRef> {
    let runs = utf16_runs(blob, 4);
    let mut found: Vec<(usize, PinRef)> = Vec::new();
    for name in shortcuts {
        let lower = name.to_lowercase();
        if let Some((offset, _)) = runs.iter().find(|(_, text)| text.to_lowercase().contains(&lower)) {
            found.push((*offset, PinRef::Shortcut(name.clone())));
        }
    }
    for (offset, text) in &runs {
        for id in find_aumids(text) {
            let dup = found.iter().any(|(_, p)| matches!(p, PinRef::AppId(x) if x.eq_ignore_ascii_case(&id)));
            if !dup {
                found.push((*offset, PinRef::AppId(id)));
            }
        }
    }
    found.sort_by_key(|(offset, _)| *offset);
    let mut out: Vec<PinRef> = found.into_iter().map(|(_, p)| p).collect();
    let mut rest: Vec<String> = shortcuts
        .iter()
        .filter(|s| !out.iter().any(|p| matches!(p, PinRef::Shortcut(x) if x == *s)))
        .cloned()
        .collect();
    rest.sort();
    out.extend(rest.into_iter().map(PinRef::Shortcut));
    out
}

/// ROT13, used by the UserAssist registry names.
pub fn rot13(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='z' => (((c as u8 - b'a') + 13) % 26 + b'a') as char,
            'A'..='Z' => (((c as u8 - b'A') + 13) % 26 + b'A') as char,
            _ => c,
        })
        .collect()
}

/// FILETIME (100 ns since 1601) to Unix ms.
pub fn filetime_to_unix_ms(ft: u64) -> i64 {
    (ft / 10_000) as i64 - 11_644_473_600_000
}

/// "{GUID}\\rest" -> ("GUID", "rest") for known-folder relative paths.
pub fn split_known_folder(s: &str) -> Option<(String, String)> {
    if !s.starts_with('{') {
        return None;
    }
    let end = s.find('}')?;
    let guid = s[1..end].to_string();
    if guid.len() != 36 {
        return None;
    }
    let rest = s[end + 1..].trim_start_matches('\\').to_string();
    Some((guid, rest))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(s: &str) -> Vec<u8> {
        s.encode_utf16().flat_map(|u| u.to_le_bytes()).collect()
    }

    #[test]
    fn finds_store_ids() {
        let ids = find_aumids("xx Microsoft.WindowsTerminal_8wekyb3d8bbwe!App yy");
        assert_eq!(ids, vec!["Microsoft.WindowsTerminal_8wekyb3d8bbwe!App".to_string()]);
        assert!(find_aumids("Hello!World").is_empty());
        assert!(find_aumids("Name_tooshort!App").is_empty());
    }

    #[test]
    fn taskband_order() {
        let mut blob = vec![0u8, 1, 2, 3];
        blob.extend(utf16("Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"));
        blob.extend([0u8, 0, 9]);
        blob.extend(utf16("Google Chrome.lnk"));
        blob.extend([0u8, 0]);
        let pins = parse_taskband(&blob, &["Google Chrome.lnk".into(), "File Explorer.lnk".into()]);
        assert_eq!(
            pins,
            vec![
                PinRef::AppId("Microsoft.WindowsTerminal_8wekyb3d8bbwe!App".into()),
                PinRef::Shortcut("Google Chrome.lnk".into()),
                PinRef::Shortcut("File Explorer.lnk".into()),
            ]
        );
    }

    #[test]
    fn rot13_and_known_folders() {
        assert_eq!(rot13("Zvpebfbsg"), "Microsoft");
        let (g, rest) = split_known_folder("{6D809377-6AF0-444B-8957-A3773F02200E}\\Mozilla Firefox\\firefox.exe").unwrap();
        assert_eq!(g, "6D809377-6AF0-444B-8957-A3773F02200E");
        assert_eq!(rest, "Mozilla Firefox\\firefox.exe");
        assert_eq!(app_id(Some("A!B"), None, "x"), "aumid:a!b");
        assert_eq!(app_id(None, Some("C:\\X.exe"), "x"), "exe:c:\\x.exe");
    }
}
