//! Appearance: live glass (screen capture behind the dock), the wallpaper fallback, and the
//! Windows light/dark mode and accent colour.
//!
//! IPC (`appearance.*`):
//! - `glass_attach {channel}`   hands Rust a `Channel` (created in JS) that receives glass frames
//! - `glass_config {rect, margin, maxFps, scale, source, quality}`  where the bar is (client CSS px)
//! - `glass_ack {seq}`          the UI finished drawing frame `seq` (flow control)
//! - `glass_state`              the current tier, for Settings
//! - `system_theme`             {appsLight, systemLight, accent, transparency}
//! - `wallpaper_info`           {path, placement, background}
//! - `export_settings {json}`   writes Downloads\GlintBar settings <date>.json, returns {path, folder}
//!
//! Topics: `appearance/glass` (subscribing starts the capture loop; payload = status),
//! `appearance/system` (light/dark + accent, polled every 3 s while subscribed).

mod backup;
mod glass;
mod system;
#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod wallpaper;

use tauri::AppHandle;

use crate::registry::Registrar;

/// Makes the live-glass loop re-check its rules at once (used by smoke.capture_override).
pub fn wake_glass() {
    glass::wake();
}

pub fn register(reg: &mut Registrar) {
    glass::register(reg);
    system::register(reg);
    reg.add_blocking("appearance", "export_settings", |_app: AppHandle, a: backup::ExportArgs| backup::export(a));
}
