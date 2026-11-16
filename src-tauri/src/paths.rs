use std::path::PathBuf;

/// %APPDATA%\\GlintBar (created on first use). Falls back to ~/.config/GlintBar off Windows.
pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("GlintBar");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// %APPDATA%\\GlintBar\\logs
pub fn logs_dir() -> PathBuf {
    let dir = data_dir().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// %USERPROFILE% (or $HOME).
pub fn user_profile() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}
