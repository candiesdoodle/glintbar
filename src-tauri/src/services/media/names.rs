//! Friendly names for media apps and audio processes ("msedge.exe" -> "Microsoft Edge").

/// Known ids/executables. Keys are lower-case, without ".exe".
const KNOWN: &[(&str, &str)] = &[
    ("spotify", "Spotify"),
    ("chrome", "Google Chrome"),
    ("msedge", "Microsoft Edge"),
    ("msedgewebview2", "Microsoft Edge"),
    ("firefox", "Firefox"),
    ("308046b0af4a39cb", "Firefox"),
    ("6f193ccc56814779", "Firefox Nightly"),
    ("brave", "Brave"),
    ("opera", "Opera"),
    ("vivaldi", "Vivaldi"),
    ("vlc", "VLC"),
    ("discord", "Discord"),
    ("teams", "Microsoft Teams"),
    ("ms-teams", "Microsoft Teams"),
    ("zoom", "Zoom"),
    ("slack", "Slack"),
    ("telegram", "Telegram"),
    ("whatsapp", "WhatsApp"),
    ("itunes", "iTunes"),
    ("applemusic", "Apple Music"),
    ("tidal", "TIDAL"),
    ("deezer", "Deezer"),
    ("foobar2000", "foobar2000"),
    ("musicbee", "MusicBee"),
    ("aimp", "AIMP"),
    ("mpc-hc64", "MPC-HC"),
    ("mpc-be64", "MPC-BE"),
    ("potplayermini64", "PotPlayer"),
    ("steam", "Steam"),
    ("steamwebhelper", "Steam"),
    ("obs64", "OBS Studio"),
    ("zunemusic", "Media Player"),
    ("microsoft.media.player", "Media Player"),
    ("wmplayer", "Windows Media Player"),
];

fn known(key: &str) -> Option<&'static str> {
    let k = key.to_ascii_lowercase();
    KNOWN.iter().find(|(id, _)| *id == k).map(|(_, name)| *name)
}

/// A name for a media session's AppUserModelID when Windows has none to offer, e.g.
/// "Spotify.exe" -> "Spotify", "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic" -> "Media Player".
pub fn app_name_from_id(id: &str) -> String {
    let id = id.trim();
    if id.is_empty() {
        return "Media".to_string();
    }
    let stem = strip_exe(file_part(id));
    if let Some(n) = known(stem) {
        return n.to_string();
    }
    // Packaged apps: "Publisher.Name_hash!AppId"
    if let Some((package, app)) = id.split_once('!') {
        let family = package.split('_').next().unwrap_or(package);
        let short = family.rsplit('.').next().unwrap_or(family);
        if let Some(n) = known(short).or_else(|| known(app)) {
            return n.to_string();
        }
        let pick = if app.eq_ignore_ascii_case("app") { short } else { app.rsplit('.').next().unwrap_or(app) };
        return capitalise(pick);
    }
    capitalise(stem)
}

/// A name for a process from its full image path: "C:\\...\\Discord.exe" -> "Discord".
pub fn process_name(path: &str) -> String {
    let stem = strip_exe(file_part(path));
    match known(stem) {
        Some(n) => n.to_string(),
        None => capitalise(stem),
    }
}

/// "C:\\a\\b.exe" -> "b.exe"
pub fn file_part(path: &str) -> &str {
    path.rsplit(&['\\', '/'][..]).next().unwrap_or(path)
}

fn strip_exe(name: &str) -> &str {
    if name.len() > 4 && name.is_char_boundary(name.len() - 4) && name[name.len() - 4..].eq_ignore_ascii_case(".exe") {
        &name[..name.len() - 4]
    } else {
        name
    }
}

fn capitalise(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// "Speakers (Realtek(R) Audio)" -> ("Speakers", "Realtek(R) Audio").
pub fn split_device_name(name: &str) -> (String, String) {
    let name = name.trim();
    match name.find(" (") {
        Some(i) if name.ends_with(')') => (name[..i].trim().to_string(), name[i + 2..name.len() - 1].trim().to_string()),
        _ => (name.to_string(), String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_for_ids() {
        assert_eq!(app_name_from_id("Spotify.exe"), "Spotify");
        assert_eq!(app_name_from_id("308046B0AF4A39CB"), "Firefox");
        assert_eq!(app_name_from_id("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"), "Media Player");
        assert_eq!(app_name_from_id("Contoso.Player_abc!App"), "Player");
        assert_eq!(process_name("C:\\Program Files\\Discord\\Discord.exe"), "Discord");
    }

    #[test]
    fn device_names() {
        assert_eq!(split_device_name("Speakers (Realtek(R) Audio)"), ("Speakers".to_string(), "Realtek(R) Audio".to_string()));
        assert_eq!(split_device_name("LG HDR 4K"), ("LG HDR 4K".to_string(), String::new()));
    }
}
