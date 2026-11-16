//! Live glass: the dock refracts what is behind it.
//!
//! Frames: the UI creates a Tauri `Channel` and hands it over with `glass_attach`. Every frame is
//! ONE binary channel message = a 40-byte header + a JPEG of the strip behind the bar (plus a
//! margin, so the edge refraction can sample a little outside the bar). Why this transport:
//! - Raw channel messages skip JSON and base64; large ones are fetched by the webview over Tauri's
//!   IPC protocol straight into an ArrayBuffer. A custom URI scheme would need lib.rs (shared).
//! - The strip is captured at about half CSS resolution: the glass bends and frosts it, so finer
//!   detail is invisible. A ~960x50 px JPEG is ~15-30 KB vs ~190 KB of raw RGBA, i.e. ~8x less
//!   to copy at up to 60 fps; encoding takes ~1 ms and the webview decodes it off its main thread
//!   (createImageBitmap). Raw RGBA would save the encode but move far more bytes per frame.
//! - Flow control: at most one frame in flight; the UI acks (`glass_ack`) after drawing it.
//!
//! Rate: full rate (maxFps) while the strip changes. When a cheap hash of the downsampled strip
//! has not changed for 1 s, it rests: one tiny probe every 200 ms, after 10 s every 500 ms, and
//! nothing is encoded or sent. Paused completely (one check per second, no capture) while the
//! dock is hidden, a fullscreen game/video/presentation is in front, battery saver is on, or the
//! session is locked. Unsubscribing from `appearance/glass` ends the thread.
//!
//! Tiers: "capture" (needs WDA_EXCLUDEFROMCAPTURE, Windows 10 2004+, so the dock never captures
//! itself) -> "wallpaper" (the desktop picture cropped to the dock) -> "plain" (no frames; the
//! UI shows CSS translucency).
//!
//! Header (little endian): 0 magic "GLS1" u32 | 4 seq u32 | 8 width u16 | 10 height u16 |
//! 12..28 captured area in client CSS px (left, top, right, bottom: f32) | 28 mean luma f32 (0-1) |
//! 32 tier u32 (1 capture, 2 wallpaper) | 36 reserved u32 | 40.. JPEG.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, JavaScriptChannelId, Response};
use tauri::{AppHandle, Manager};

use crate::error::{SvcError, SvcResult};
use crate::events;
use crate::registry::{NoArgs, Registrar};
use crate::subscriptions;

const TOPIC_KEY: &str = "appearance/glass";
const MAGIC: u32 = 0x3153_4c47; // "GLS1" as little-endian bytes
pub const HEADER_LEN: usize = 40;
pub const TIER_CAPTURE: u32 = 1;
pub const TIER_WALLPAPER: u32 = 2;

/// A rectangle in client CSS px.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CssRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// Capture the screen; fall back to the wallpaper when that is impossible.
    #[default]
    Auto,
    /// Always use the wallpaper (no screen capture; the dock stays visible in screenshots).
    Wallpaper,
}

/// What the UI sends with `glass_config`.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GlassConfig {
    /// The bar, in client CSS px.
    pub rect: CssRect,
    /// Extra CSS px captured around the bar.
    pub margin: f64,
    pub max_fps: u32,
    /// Output px per CSS px.
    pub scale: f64,
    pub source: Source,
    /// JPEG quality.
    pub quality: u8,
    /// The calling dock window. Live glass runs for "main" only; other windows are ignored.
    pub label: Option<String>,
}

impl Default for GlassConfig {
    fn default() -> Self {
        GlassConfig {
            rect: CssRect::default(),
            margin: 16.0,
            max_fps: 30,
            scale: 0.5,
            source: Source::Auto,
            quality: 72,
            label: None,
        }
    }
}

fn finite_or(v: f64, fallback: f64) -> f64 {
    if v.is_finite() {
        v
    } else {
        fallback
    }
}

fn sanitize(mut c: GlassConfig) -> GlassConfig {
    c.rect.x = finite_or(c.rect.x, 0.0);
    c.rect.y = finite_or(c.rect.y, 0.0);
    c.rect.width = finite_or(c.rect.width, 0.0).clamp(0.0, 16384.0);
    c.rect.height = finite_or(c.rect.height, 0.0).clamp(0.0, 2048.0);
    c.margin = finite_or(c.margin, 16.0).clamp(0.0, 64.0);
    c.max_fps = c.max_fps.clamp(5, 60);
    c.scale = finite_or(c.scale, 0.5).clamp(0.2, 1.0);
    c.quality = c.quality.clamp(30, 95);
    c
}

/// What the capture loop knows about itself, for `glass_state` (Settings, the smoke driver).
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlassDiag {
    /// Frames sent to the UI since the app started.
    pub frames_sent: u64,
    /// Frames the channel refused (the webview went away).
    pub send_errors: u64,
    /// The dock is excluded from capture right now (capture tier).
    pub excluded: bool,
    /// The capture tier is possible: Windows 10 2004+, not blocked by a test environment, and
    /// SetWindowDisplayAffinity has not failed.
    pub can_exclude: bool,
    /// GLINTBAR_SMOKE / GLINTBAR_NO_CAPTURE_EXCLUDE forbid the exclusion (and no smoke override is open).
    pub blocked_by_env: bool,
    /// Windows build number (0 unknown).
    pub os_build: u32,
    /// GetWindowDisplayAffinity of the main window after the last change: 0 none, 17 excluded,
    /// -1 unknown.
    pub affinity: i64,
    /// The last exclusion error (SetWindowDisplayAffinity, with HRESULT and GetLastError).
    pub last_error: Option<String>,
    /// Screen area behind the bar in physical px (left, top, right, bottom) and the frame size.
    pub capture_rect: Option<[i32; 4]>,
    pub output: Option<[i32; 2]>,
}

/// `glass_state`: the status plus the loop's diagnostics.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct GlassStateOut {
    #[serde(flatten)]
    status: GlassStatus,
    #[serde(flatten)]
    diag: GlassDiag,
}

/// Payload of the `appearance/glass` topic.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GlassStatus {
    /// "starting" | "capture" | "wallpaper" | "plain" | "paused"
    pub tier: String,
    /// "hidden", "fullscreen", "battery-saver", "locked", "no-exclusion", "test-mode" (smoke /
    /// GLINTBAR_NO_CAPTURE_EXCLUDE), "no-wallpaper", ...
    pub reason: Option<String>,
    /// Nothing behind the dock changed for a while: only probing.
    pub resting: bool,
}

#[derive(Deserialize)]
struct AttachArgs {
    channel: JavaScriptChannelId,
    #[serde(default)]
    label: Option<String>,
}

/// Frames go to the main dock window only (its webview owns the channel and its HWND is the one
/// excluded from capture); calls from extra dock windows must not take the glass over.
fn from_other_window(label: &Option<String>) -> bool {
    match label {
        Some(l) => l != crate::services::shell::MAIN_WINDOW,
        None => false,
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct AckArgs {
    seq: u32,
}

struct Shared {
    config: Option<GlassConfig>,
    channel: Option<Channel<Response>>,
    /// Last sequence number sent / acknowledged by the UI.
    sent: u32,
    acked: u32,
    last_send: Option<Instant>,
    /// Something changed (config, channel, stop): wake the loop and send a fresh frame.
    dirty: bool,
    status: Option<GlassStatus>,
    diag: GlassDiag,
}

static SHARED: OnceLock<(Mutex<Shared>, Condvar)> = OnceLock::new();
/// Generation of the newest capture thread; an older thread that is still winding down must not
/// undo the newer one's capture exclusion.
static NEWEST: AtomicU64 = AtomicU64::new(0);

fn shared() -> &'static (Mutex<Shared>, Condvar) {
    SHARED.get_or_init(|| {
        (
            Mutex::new(Shared {
                config: None,
                channel: None,
                sent: 0,
                acked: 0,
                last_send: None,
                dirty: true,
                status: None,
                diag: GlassDiag { affinity: -1, ..GlassDiag::default() },
            }),
            Condvar::new(),
        )
    })
}

fn lock() -> MutexGuard<'static, Shared> {
    shared().0.lock().unwrap_or_else(|p| p.into_inner())
}

fn poke() {
    lock().dirty = true;
    shared().1.notify_all();
}

/// Wakes the capture loop so it re-checks its rules now (the smoke driver's capture override).
pub fn wake() {
    poke();
}

#[cfg(windows)]
fn record_exclusion(excluded: bool, affinity: i64, error: Option<String>) {
    let mut s = lock();
    s.diag.excluded = excluded;
    s.diag.affinity = affinity;
    if error.is_some() {
        s.diag.last_error = error;
    }
}

/// Sleeps for `d`, or less when something becomes dirty (config change, new channel, stop).
fn nap(d: Duration) {
    let deadline = Instant::now() + d;
    let (m, cv) = shared();
    let mut guard = m.lock().unwrap_or_else(|p| p.into_inner());
    loop {
        if guard.dirty {
            return;
        }
        let now = Instant::now();
        if now >= deadline {
            return;
        }
        guard = match cv.wait_timeout(guard, deadline - now) {
            Ok((g, _)) => g,
            Err(p) => p.into_inner().0,
        };
    }
}

fn set_status(app: &AppHandle, tier: &str, reason: Option<&str>, resting: bool) {
    let next = GlassStatus { tier: tier.to_string(), reason: reason.map(|r| r.to_string()), resting };
    let (prev, frames) = {
        let mut s = lock();
        if s.status.as_ref() == Some(&next) {
            return;
        }
        let prev = s.status.replace(next.clone());
        (prev, s.diag.frames_sent)
    };
    let same_tier = prev.as_ref().map(|p| p.tier == next.tier && p.reason == next.reason).unwrap_or(false);
    if same_tier && !crate::services::core::smoke::enabled() {
        // Rest <-> active only: can flip every second or two while something moves behind the dock.
        tracing::debug!(tier, resting, frames_sent = frames, "live glass {}", if resting { "resting" } else { "active" });
    } else {
        tracing::info!(
            tier,
            reason = reason.unwrap_or("-"),
            resting,
            frames_sent = frames,
            "live glass status{}",
            if same_tier { if resting { ": resting, nothing behind the dock changes" } else { ": active, the area behind the dock changes" } } else { "" }
        );
    }
    events::emit(app, "appearance", "glass", &next);
}

pub fn register(reg: &mut Registrar) {
    reg.add("appearance", "glass_attach", |app: AppHandle, a: AttachArgs| async move {
        if from_other_window(&a.label) {
            return Err(SvcError::unsupported("live glass is only available in the main dock window"));
        }
        let window = app
            .get_webview_window(crate::services::shell::MAIN_WINDOW)
            .ok_or_else(|| SvcError::NotFound("main window".into()))?;
        let webview_ref: &tauri::Webview = window.as_ref();
        let channel: Channel<Response> = a.channel.channel_on(webview_ref.clone());
        {
            let mut s = lock();
            s.channel = Some(channel);
            s.acked = s.sent;
            s.last_send = None;
        }
        poke();
        Ok(())
    });
    reg.add("appearance", "glass_config", |_app: AppHandle, c: GlassConfig| async move {
        if from_other_window(&c.label) {
            return Ok(());
        }
        let c = sanitize(c);
        let changed = {
            let mut s = lock();
            if s.config.as_ref() == Some(&c) {
                false
            } else {
                s.config = Some(c);
                true
            }
        };
        if changed {
            poke();
        }
        Ok(())
    });
    reg.add("appearance", "glass_ack", |_app: AppHandle, a: AckArgs| async move {
        lock().acked = a.seq;
        Ok(())
    });
    reg.add("appearance", "glass_state", |_app: AppHandle, _: NoArgs| async move {
        let out: Option<GlassStateOut> = {
            let s = lock();
            s.status.clone().map(|status| GlassStateOut { status, diag: s.diag.clone() })
        };
        Ok(out)
    });
    #[cfg(windows)]
    {
        reg.add_blocking("appearance", "wallpaper_info", |_app: AppHandle, _: NoArgs| -> SvcResult<super::wallpaper::WallpaperInfo> {
            Ok(super::wallpaper::info())
        });
    }
    reg.on_topic(
        "appearance",
        "glass",
        |app: AppHandle, generation: u64| {
            NEWEST.store(generation, Ordering::SeqCst);
            let spawned = std::thread::Builder::new().name("glintbar-glass".into()).spawn(move || {
                let for_panic = app.clone();
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || run(app, generation)));
                if result.is_err() {
                    // Never leave the dock invisible to screenshots because the loop died.
                    tracing::error!("the glass thread stopped after a panic");
                    #[cfg(windows)]
                    {
                        if let Some(raw) = main_hwnd_raw(&for_panic) {
                            let _ = set_exclusion(&for_panic, raw, false);
                        }
                    }
                    set_status(&for_panic, "plain", Some("failed"), false);
                }
            });
            if let Err(e) = spawned {
                tracing::warn!("could not start the glass thread: {e}");
            }
        },
        |_app: AppHandle| poke(),
    );
}

fn send_frame(channel: &Channel<Response>, bytes: Vec<u8>) {
    let result = channel.send(Response::new(bytes));
    let mut s = lock();
    match result {
        Ok(()) => s.diag.frames_sent += 1,
        Err(e) => {
            s.diag.send_errors += 1;
            if s.diag.send_errors == 1 {
                tracing::warn!("live glass: a frame was not delivered to the UI: {e}");
            }
        }
    }
}

/// Header + JPEG. `rgb` is width*height*3 bytes.
fn encode_frame(rgb: &[u8], width: u32, height: u32, quality: u8, css: [f32; 4], luma: f32, tier: u32, seq: u32) -> Option<Vec<u8>> {
    if rgb.len() != (width as usize) * (height as usize) * 3 {
        return None;
    }
    let mut out: Vec<u8> = Vec::with_capacity(HEADER_LEN + rgb.len() / 6);
    out.extend_from_slice(&MAGIC.to_le_bytes());
    out.extend_from_slice(&seq.to_le_bytes());
    out.extend_from_slice(&(width.min(u16::MAX as u32) as u16).to_le_bytes());
    out.extend_from_slice(&(height.min(u16::MAX as u32) as u16).to_le_bytes());
    for v in css {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&luma.to_le_bytes());
    out.extend_from_slice(&tier.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    {
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
        if let Err(e) = encoder.encode(rgb, width, height, image::ExtendedColorType::Rgb8) {
            tracing::debug!("glass jpeg failed: {e}");
            return None;
        }
    }
    Some(out)
}

/// Mean luma 0-1 of an RGB buffer (sampled), so the UI can pick dark or light text on clear glass.
fn mean_luma(rgb: &[u8]) -> f32 {
    let mut sum: u64 = 0;
    let mut n: u64 = 0;
    for p in rgb.chunks_exact(3).step_by(7) {
        sum += (p[0] as u64 * 54 + p[1] as u64 * 183 + p[2] as u64 * 19) >> 8;
        n += 1;
    }
    if n == 0 {
        0.5
    } else {
        (sum as f32 / n as f32) / 255.0
    }
}

/// Takes a sequence number if the UI has drawn the previous frame (or it is overdue).
fn next_seq() -> Option<u32> {
    let mut s = lock();
    let overdue = s.last_send.map(|t| t.elapsed() > Duration::from_millis(500)).unwrap_or(true);
    if s.sent != s.acked && !overdue {
        return None;
    }
    s.sent = s.sent.wrapping_add(1);
    s.last_send = Some(Instant::now());
    Some(s.sent)
}

#[cfg(windows)]
fn main_hwnd_raw(app: &AppHandle) -> Option<isize> {
    let window = app.get_webview_window(crate::services::shell::MAIN_WINDOW)?;
    let h = window.hwnd().ok()?;
    Some(h.0 as isize)
}

/// SetWindowDisplayAffinity on the window's own (main) thread; waits for the result, which is the
/// affinity read back afterwards (17 = excluded from capture, 0 = none).
#[cfg(windows)]
fn set_exclusion(app: &AppHandle, raw: isize, on: bool) -> Result<u32, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<u32, String>>();
    let posted = app.run_on_main_thread(move || {
        let r = super::capture::set_exclude_from_capture(raw, on);
        let _ = tx.send(r);
    });
    if let Err(e) = posted {
        return Err(format!("could not reach the main thread: {e}"));
    }
    match rx.recv_timeout(Duration::from_secs(2)) {
        Ok(r) => r,
        Err(_) => Err("the main thread did not answer within 2 s".to_string()),
    }
}

#[cfg(windows)]
fn hash_pixels(px: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for chunk in px.chunks_exact(8) {
        let mut word = [0u8; 8];
        word.copy_from_slice(chunk);
        h = (h ^ u64::from_le_bytes(word)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    // Never 0: 0 means "send the next frame whatever it is".
    h | 1
}

#[cfg(windows)]
fn bgra_to_rgb(px: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(px.len() / 4 * 3);
    for p in px.chunks_exact(4) {
        out.push(p[2]);
        out.push(p[1]);
        out.push(p[0]);
    }
    out
}

#[cfg(windows)]
fn run(app: AppHandle, generation: u64) {
    use super::capture::{self, Capturer};
    use super::wallpaper::WallpaperCache;

    set_status(&app, "starting", None, false);
    let raw = match main_hwnd_raw(&app) {
        Some(r) => r,
        None => {
            tracing::info!("live glass: no main window, plain glass");
            set_status(&app, "plain", Some("no-window"), false);
            return;
        }
    };
    let hwnd = capture::hwnd_from_raw(raw);
    let os_build = capture::os_build();
    let os_ok = capture::os_supports_exclusion();
    // Re-read every pause check: the smoke driver's capture override can lift it at any time.
    let mut env_blocked = capture::exclusion_blocked_by_env();
    let mut exclusion_failed = false;
    tracing::info!(
        os_build,
        os_supports_exclusion = os_ok,
        blocked_by_env = env_blocked,
        smoke_override = crate::services::core::smoke::capture_exclusion_allowed(),
        hwnd = raw as i64,
        "live glass started"
    );
    {
        let mut s = lock();
        s.diag.os_build = os_build;
        s.diag.blocked_by_env = env_blocked;
        s.diag.can_exclude = os_ok && !env_blocked;
        s.diag.excluded = false;
        s.diag.affinity = capture::display_affinity(hwnd);
    }
    let verbose = crate::services::core::smoke::enabled();
    let rate_window = if verbose { Duration::from_secs(5) } else { Duration::from_secs(60) };
    let mut excluded = false;
    let mut cap: Option<Capturer> = None;
    let mut walls = WallpaperCache::default();
    let mut last_hash: u64 = 0;
    let mut still_since: Option<Instant> = None;
    let mut last_check: Option<Instant> = None;
    let mut pause: Option<&'static str> = None;
    let mut was_locked = false;
    let mut logged_area: Option<(i32, i32, i32, i32, i32, i32)> = None;
    let mut window_start = Instant::now();
    let mut window_frames: u32 = 0;
    let mut window_probes: u32 = 0;

    loop {
        if !subscriptions::is_current(TOPIC_KEY, generation) {
            break;
        }
        if window_start.elapsed() >= rate_window {
            if window_frames > 0 {
                let secs = window_start.elapsed().as_secs_f64();
                tracing::info!(
                    frames = window_frames,
                    probes = window_probes,
                    seconds = secs.round() as u64,
                    "live glass: {:.1} frames/s sent",
                    window_frames as f64 / secs.max(0.001)
                );
            }
            window_start = Instant::now();
            window_frames = 0;
            window_probes = 0;
        }
        let (cfg, channel, dirty) = {
            let mut s = lock();
            let d = s.dirty;
            s.dirty = false;
            (s.config.clone(), s.channel.clone(), d)
        };
        let (cfg, channel) = match (cfg, channel) {
            (Some(c), Some(ch)) if c.rect.width >= 1.0 && c.rect.height >= 1.0 => (c, ch),
            _ => {
                nap(Duration::from_millis(250));
                continue;
            }
        };
        if dirty {
            last_hash = 0;
            still_since = None;
        }

        // Pause checks, at most twice a second.
        if dirty || last_check.map(|t| t.elapsed() >= Duration::from_millis(500)).unwrap_or(true) {
            last_check = Some(Instant::now());
            let blocked = capture::exclusion_blocked_by_env();
            if blocked != env_blocked {
                env_blocked = blocked;
                // A new chance: a failure under the old rules says nothing about the new ones.
                exclusion_failed = false;
                tracing::info!(blocked_by_env = blocked, "live glass: capture exclusion is now {}", if blocked { "blocked (test environment)" } else { "allowed" });
                let mut s = lock();
                s.diag.blocked_by_env = blocked;
            }
            let locked = capture::session_locked();
            if was_locked && !locked {
                // Back from the lock screen: the desktop (and maybe the wallpaper) is new.
                last_hash = 0;
                walls.invalidate();
            }
            was_locked = locked;
            pause = if locked {
                Some("locked")
            } else if !capture::window_visible(hwnd) {
                Some("hidden")
            } else if capture::fullscreen_app_running() {
                Some("fullscreen")
            } else if capture::battery_saver_on() {
                Some("battery-saver")
            } else {
                None
            };
        }
        if let Some(reason) = pause {
            cap = None;
            set_status(&app, "paused", Some(reason), false);
            nap(Duration::from_millis(1000));
            continue;
        }

        let can_exclude = os_ok && !env_blocked && !exclusion_failed;
        let want_capture = cfg.source == Source::Auto && can_exclude;
        if want_capture && !excluded {
            match set_exclusion(&app, raw, true) {
                Ok(a) if a == capture::AFFINITY_EXCLUDE => {
                    excluded = true;
                    tracing::info!(affinity = a, "live glass: tier capture (the dock is left out of screen captures)");
                    record_exclusion(true, a as i64, None);
                }
                Ok(a) => {
                    exclusion_failed = true;
                    let msg = format!("SetWindowDisplayAffinity succeeded but the affinity reads back as {a}, not 17");
                    tracing::warn!("live glass: {msg}; falling back to the wallpaper");
                    let back = set_exclusion(&app, raw, false).unwrap_or(0);
                    record_exclusion(false, back as i64, Some(msg));
                }
                Err(e) => {
                    exclusion_failed = true;
                    tracing::warn!("live glass: could not leave the dock out of captures ({e}); falling back to the wallpaper");
                    record_exclusion(false, capture::display_affinity(hwnd), Some(e));
                }
            }
        } else if !want_capture && excluded {
            let why = if cfg.source == Source::Wallpaper {
                "live glass switched off"
            } else if env_blocked {
                "capture exclusion blocked again"
            } else {
                "capture exclusion unavailable"
            };
            let r = set_exclusion(&app, raw, false);
            excluded = false;
            cap = None;
            match r {
                Ok(a) => {
                    tracing::info!(affinity = a, "live glass: left the capture tier ({why}); the dock shows in captures again");
                    record_exclusion(false, a as i64, None);
                }
                Err(e) => {
                    tracing::warn!("live glass: left the capture tier ({why}) but clearing the affinity failed: {e}");
                    record_exclusion(false, capture::display_affinity(hwnd), Some(e));
                }
            }
        }
        {
            let mut s = lock();
            s.diag.can_exclude = can_exclude;
        }

        let geo = match capture::geometry(hwnd, &cfg) {
            Some(g) => g,
            None => {
                nap(Duration::from_millis(500));
                continue;
            }
        };
        let area = (geo.src.left, geo.src.top, geo.src.right, geo.src.bottom, geo.out_w, geo.out_h);
        if logged_area != Some(area) {
            logged_area = Some(area);
            tracing::info!(
                "live glass: area behind the bar {},{},{},{} (physical px, scale {:.2}) -> {}x{} frames, css {:.0},{:.0},{:.0},{:.0}",
                area.0, area.1, area.2, area.3, geo.scale, area.4, area.5, geo.css[0], geo.css[1], geo.css[2], geo.css[3]
            );
            let mut s = lock();
            s.diag.capture_rect = Some([area.0, area.1, area.2, area.3]);
            s.diag.output = Some([area.4, area.5]);
        }
        let active = Duration::from_millis((1000 / cfg.max_fps.max(1)) as u64);

        if excluded {
            let resize = cap.as_ref().map(|c| c.width != geo.out_w || c.height != geo.out_h).unwrap_or(true);
            if resize {
                cap = Capturer::new(geo.out_w, geo.out_h);
                last_hash = 0;
            }
            let grabbed = match cap.as_mut() {
                Some(c) => c.grab(geo.src),
                None => false,
            };
            window_probes += 1;
            if !grabbed {
                cap = None;
                set_status(&app, "plain", Some("capture-failed"), false);
                nap(Duration::from_millis(1000));
                continue;
            }
            let (hash, rgb) = match cap.as_ref() {
                Some(c) => {
                    let px = c.pixels();
                    let h = hash_pixels(px);
                    if h == last_hash {
                        (h, None)
                    } else {
                        (h, Some(bgra_to_rgb(px)))
                    }
                }
                None => (0, None),
            };
            match rgb {
                Some(rgb) => {
                    let seq = match next_seq() {
                        Some(s) => s,
                        None => {
                            // The UI is still drawing the last frame; try again shortly.
                            nap(Duration::from_millis(8));
                            continue;
                        }
                    };
                    let luma = mean_luma(&rgb);
                    if let Some(bytes) =
                        encode_frame(&rgb, geo.out_w as u32, geo.out_h as u32, cfg.quality, geo.css, luma, TIER_CAPTURE, seq)
                    {
                        send_frame(&channel, bytes);
                        window_frames += 1;
                    }
                    last_hash = hash;
                    still_since = None;
                    set_status(&app, "capture", None, false);
                    nap(active);
                }
                None => {
                    let since = *still_since.get_or_insert_with(Instant::now);
                    let idle = since.elapsed();
                    let resting = idle >= Duration::from_secs(1);
                    let wait = if !resting {
                        active
                    } else if idle < Duration::from_secs(10) {
                        Duration::from_millis(200)
                    } else {
                        Duration::from_millis(500)
                    };
                    set_status(&app, "capture", None, resting);
                    nap(wait);
                }
            }
        } else {
            let reason = if cfg.source == Source::Wallpaper {
                None
            } else if !os_ok {
                Some("no-exclusion")
            } else if env_blocked {
                Some("test-mode")
            } else {
                // SetWindowDisplayAffinity failed: same words for the user; diag.last_error has why.
                Some("no-exclusion")
            };
            match walls.strip(&geo, cfg.scale) {
                Some((rgb, changed)) => {
                    if changed || last_hash == 0 {
                        match next_seq() {
                            Some(seq) => {
                                let luma = mean_luma(&rgb);
                                if let Some(bytes) = encode_frame(
                                    &rgb,
                                    geo.out_w as u32,
                                    geo.out_h as u32,
                                    cfg.quality,
                                    geo.css,
                                    luma,
                                    TIER_WALLPAPER,
                                    seq,
                                ) {
                                    send_frame(&channel, bytes);
                                    window_frames += 1;
                                }
                                last_hash = 1;
                            }
                            None => {
                                nap(Duration::from_millis(30));
                                continue;
                            }
                        }
                    }
                    set_status(&app, "wallpaper", reason, true);
                }
                None => set_status(&app, "plain", Some("no-wallpaper"), false),
            }
            // The wallpaper rarely changes: look again every 2 s (or at once on a config change).
            nap(Duration::from_millis(2000));
        }
    }

    drop(cap);
    if excluded && NEWEST.load(Ordering::SeqCst) == generation {
        match set_exclusion(&app, raw, false) {
            Ok(a) => record_exclusion(false, a as i64, None),
            Err(e) => {
                tracing::warn!("live glass: clearing the affinity at stop failed: {e}");
                record_exclusion(false, -1, Some(e));
            }
        }
    }
    if NEWEST.load(Ordering::SeqCst) == generation {
        lock().status = None;
        // Forget the last status so the next subscriber doesn't start from a stale one.
        subscriptions::remember(TOPIC_KEY, serde_json::Value::Null);
    }
    tracing::info!(excluded_at_stop = excluded, "live glass stopped");
}

#[cfg(not(windows))]
fn run(app: AppHandle, _generation: u64) {
    set_status(&app, "plain", Some("unsupported"), false);
}
