//! Now playing through the Windows media sessions (GlobalSystemMediaTransportControls).
//!
//! While `media/now_playing` has subscribers, one thread listens to the session manager and to
//! every session's media, playback and timeline events, and emits a snapshot when something
//! changed. Nothing polls: the UI moves the progress bar on its own between timeline updates.
//! Cover art is decoded, shrunk and re-encoded as PNG once per track.

use serde::{Deserialize, Serialize};
#[cfg(not(windows))]
use tauri::AppHandle;

#[cfg(not(windows))]
use crate::error::{SvcError, SvcResult};

pub const TOPIC_KEY: &str = "media/now_playing";

/// Payload of `svc://media/now_playing` and result of `media.now_playing_get`.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    /// False when no app reports a media session.
    pub active: bool,
    /// The session's AppUserModelID ("Spotify.exe", "MSEdge", ...).
    pub app_id: String,
    pub app_name: String,
    /// The app's logo as a PNG data URL, when Windows has one (Store apps).
    pub app_icon: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Cover art as a PNG data URL (at most 240 px).
    pub cover: Option<String>,
    /// The cover's dominant colour, "#rrggbb".
    pub accent: Option<String>,
    /// "playing" | "paused" | "stopped" | "changing" | "closed"
    pub status: String,
    pub position_ms: Option<i64>,
    pub duration_ms: Option<i64>,
    /// Unix ms at which `position_ms` was true.
    pub updated_at: i64,
    pub rate: f64,
    pub can_play_pause: bool,
    pub can_next: bool,
    pub can_previous: bool,
    pub can_seek: bool,
    /// The other sessions, so the card can switch between players.
    pub others: Vec<OtherPlayer>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OtherPlayer {
    pub app_id: String,
    pub app_name: String,
    pub title: String,
    pub playing: bool,
}

/// Args of `media.control`.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ControlArgs {
    /// "play_pause" | "play" | "pause" | "next" | "previous" | "seek" | "select"
    pub action: String,
    #[serde(default)]
    pub position_ms: Option<i64>,
    /// Target a specific session; "select" makes it the one on screen.
    #[serde(default)]
    pub app_id: Option<String>,
}

/// Picks the session to show from `(app id, playing)`: what is on screen if it still plays,
/// then Windows' current session if it plays, then anything playing, then what was on screen
/// (paused, so it can be resumed), then Windows' current, then the first.
pub fn choose(sessions: &[(String, bool)], shown: Option<&str>, current: Option<&str>) -> Option<usize> {
    if sessions.is_empty() {
        return None;
    }
    let find = |id: Option<&str>, playing: bool| -> Option<usize> {
        let id = id?;
        sessions.iter().position(|(s, p)| s == id && (!playing || *p))
    };
    find(shown, true)
        .or_else(|| find(current, true))
        .or_else(|| sessions.iter().position(|(_, p)| *p))
        .or_else(|| find(shown, false))
        .or_else(|| find(current, false))
        .or(Some(0))
}

/// Windows FILETIME ticks (100 ns since 1601) to Unix ms.
pub fn filetime_to_unix_ms(ticks: i64) -> Option<i64> {
    const EPOCH_DIFF: i64 = 116_444_736_000_000_000;
    if ticks <= EPOCH_DIFF {
        return None;
    }
    Some((ticks - EPOCH_DIFF) / 10_000)
}

/// "#rrggbb" for the most colourful mid-bright tone of an image, or None for a grey one.
pub fn accent_of(img: &image::DynamicImage) -> Option<String> {
    let small = img.thumbnail(24, 24).to_rgb8();
    let (mut r, mut g, mut b, mut weight) = (0f64, 0f64, 0f64, 0f64);
    for px in small.pixels() {
        let [pr, pg, pb] = px.0;
        let (fr, fg, fb) = (pr as f64 / 255.0, pg as f64 / 255.0, pb as f64 / 255.0);
        let max = fr.max(fg).max(fb);
        let min = fr.min(fg).min(fb);
        let sat = if max > 0.0 { (max - min) / max } else { 0.0 };
        // Favour saturated, mid-bright pixels; ignore near-black and near-white.
        if !(0.18..=0.97).contains(&max) {
            continue;
        }
        let w = sat * sat + 0.02;
        r += fr * w;
        g += fg * w;
        b += fb * w;
        weight += w;
    }
    if weight < 0.5 {
        return None;
    }
    let (mut r, mut g, mut b) = (r / weight, g / weight, b / weight);
    // Lift dark results so the colour reads as an accent.
    let max = r.max(g).max(b);
    if max > 0.0 && max < 0.55 {
        let k = 0.55 / max;
        r *= k;
        g *= k;
        b *= k;
    }
    let to = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    Some(format!("#{:02x}{:02x}{:02x}", to(r), to(g), to(b)))
}

/// Decodes any image, shrinks it to `max` px and returns (PNG data URL, accent colour).
pub fn encode_png(bytes: &[u8], max: u32) -> Option<(String, Option<String>)> {
    use base64::Engine;
    let img = image::load_from_memory(bytes).ok()?;
    let img = if img.width() > max || img.height() > max { img.thumbnail(max, max) } else { img };
    let rgba = image::DynamicImage::ImageRgba8(img.to_rgba8());
    let mut out = std::io::Cursor::new(Vec::new());
    rgba.write_to(&mut out, image::ImageFormat::Png).ok()?;
    let url = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner()));
    Some((url, accent_of(&rgba)))
}

#[cfg(windows)]
pub use imp::{control, snapshot, start};

#[cfg(windows)]
mod imp {
    use std::collections::HashMap;
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::sync::{Mutex, MutexGuard, OnceLock};
    use std::time::Duration;

    use tauri::AppHandle;
    use windows::core::HSTRING;
    use windows::ApplicationModel::AppInfo;
    use windows::Foundation::{Size, TypedEventHandler};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::{DataReader, IRandomAccessStreamWithContentType};

    use super::{choose, encode_png, filetime_to_unix_ms, ControlArgs, NowPlaying, OtherPlayer, TOPIC_KEY};
    use crate::error::{SvcError, SvcResult};
    use crate::services::media::{com, names};
    use crate::{events, subscriptions};

    const COVER_PX: u32 = 240;
    const ICON_PX: u32 = 64;
    const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

    enum Msg {
        /// Sessions came or went, or one started/stopped playing: pick again and re-watch.
        Rebind,
        /// Something about a session changed: emit a fresh snapshot.
        Refresh,
    }

    #[derive(Clone)]
    struct AppMeta {
        name: String,
        icon: Option<String>,
    }

    struct CoverCache {
        key: String,
        cover: Option<String>,
        accent: Option<String>,
    }

    static MANAGER: OnceLock<Manager> = OnceLock::new();
    /// App id of the session on screen.
    static SHOWN: Mutex<Option<String>> = Mutex::new(None);
    static COVER: Mutex<Option<CoverCache>> = Mutex::new(None);
    static APPS: OnceLock<Mutex<HashMap<String, AppMeta>>> = OnceLock::new();
    /// Wakes the running topic thread (after "select").
    static NUDGE: Mutex<Option<Sender<Msg>>> = Mutex::new(None);
    /// A player the user picked in the card, with the apps that were playing at that moment.
    /// It stays on screen until it goes away or some other app starts playing.
    static PINNED: Mutex<Option<(String, Vec<String>)>> = Mutex::new(None);

    fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
        m.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn manager() -> SvcResult<Manager> {
        if let Some(m) = MANAGER.get() {
            return Ok(m.clone());
        }
        let m = Manager::RequestAsync()?.join()?;
        let _ = MANAGER.set(m.clone());
        Ok(m)
    }

    fn sessions(mgr: &Manager) -> Vec<Session> {
        let mut out = Vec::new();
        if let Ok(view) = mgr.GetSessions() {
            let n = view.Size().unwrap_or(0);
            for i in 0..n {
                if let Ok(s) = view.GetAt(i) {
                    out.push(s);
                }
            }
        }
        out
    }

    fn app_id(s: &Session) -> String {
        s.SourceAppUserModelId().map(|h| h.to_string_lossy()).unwrap_or_default()
    }

    fn is_playing(s: &Session) -> bool {
        s.GetPlaybackInfo().and_then(|p| p.PlaybackStatus()).map(|st| st == Status::Playing).unwrap_or(false)
    }

    fn text(r: windows::core::Result<HSTRING>) -> String {
        r.map(|h| h.to_string_lossy()).unwrap_or_default().trim().to_string()
    }

    fn read_stream(stream: &IRandomAccessStreamWithContentType) -> SvcResult<Vec<u8>> {
        let size = stream.Size()?;
        if size == 0 || size > MAX_IMAGE_BYTES {
            return Err(SvcError::NotFound("no image".to_string()));
        }
        let reader = DataReader::CreateDataReader(stream)?;
        let loaded = reader.LoadAsync(size as u32)?.join()?;
        let mut buf = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut buf)?;
        Ok(buf)
    }

    fn app_meta(id: &str) -> AppMeta {
        let cache = APPS.get_or_init(|| Mutex::new(HashMap::new()));
        if let Some(m) = lock(cache).get(id) {
            return m.clone();
        }
        let mut meta = AppMeta { name: names::app_name_from_id(id), icon: None };
        // Store apps (and some desktop apps) are known to Windows by their AppUserModelID.
        if let Ok(info) = AppInfo::GetFromAppUserModelId(&HSTRING::from(id)) {
            if let Ok(display) = info.DisplayInfo() {
                let name = text(display.DisplayName());
                if !name.is_empty() {
                    meta.name = name;
                }
                let logo = display
                    .GetLogo(Size { Width: ICON_PX as f32, Height: ICON_PX as f32 })
                    .and_then(|r| r.OpenReadAsync())
                    .and_then(|op| op.join());
                if let Ok(stream) = logo {
                    if let Ok(bytes) = read_stream(&stream) {
                        meta.icon = encode_png(&bytes, ICON_PX).map(|(url, _)| url);
                    }
                }
            }
        }
        lock(cache).insert(id.to_string(), meta.clone());
        meta
    }

    /// Cover art for a track, read once per track. Misses are not cached: some apps publish
    /// the picture a moment after the title.
    fn cover_for(key: &str, props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> (Option<String>, Option<String>) {
        if let Some(c) = lock(&COVER).as_ref() {
            if c.key == key {
                return (c.cover.clone(), c.accent.clone());
            }
        }
        let bytes = props
            .Thumbnail()
            .and_then(|r| r.OpenReadAsync())
            .and_then(|op| op.join())
            .map_err(SvcError::from)
            .and_then(|stream| read_stream(&stream));
        match bytes.ok().and_then(|b| encode_png(&b, COVER_PX)) {
            Some((cover, accent)) => {
                *lock(&COVER) = Some(CoverCache { key: key.to_string(), cover: Some(cover.clone()), accent: accent.clone() });
                (Some(cover), accent)
            }
            None => (None, None),
        }
    }

    fn read(s: &Session) -> SvcResult<NowPlaying> {
        let id = app_id(s);
        let meta = app_meta(&id);
        // Some apps publish playback state before (or without) track details.
        let props = s.TryGetMediaPropertiesAsync().and_then(|op| op.join()).ok();
        let (title, artist, album) = match &props {
            Some(p) => (text(p.Title()), text(p.Artist()), text(p.AlbumTitle())),
            None => (String::new(), String::new(), String::new()),
        };
        let artist = if artist.is_empty() {
            props.as_ref().map(|p| text(p.AlbumArtist())).unwrap_or_default()
        } else {
            artist
        };
        let (cover, accent) = match &props {
            Some(p) if !title.is_empty() => cover_for(&format!("{id}\u{1f}{title}\u{1f}{artist}\u{1f}{album}"), p),
            _ => (None, None),
        };

        let playback = s.GetPlaybackInfo()?;
        let st = playback.PlaybackStatus().unwrap_or(Status::Closed);
        let status = if st == Status::Playing {
            "playing"
        } else if st == Status::Paused {
            "paused"
        } else if st == Status::Stopped {
            "stopped"
        } else if st == Status::Changing || st == Status::Opened {
            "changing"
        } else {
            "closed"
        };
        let rate = playback.PlaybackRate().and_then(|r| r.Value()).ok().filter(|r| *r > 0.0).unwrap_or(1.0);
        let (mut can_play_pause, mut can_next, mut can_previous, mut can_seek) = (false, false, false, false);
        if let Ok(c) = playback.Controls() {
            can_play_pause = c.IsPlayPauseToggleEnabled().unwrap_or(false) || c.IsPlayEnabled().unwrap_or(false) || c.IsPauseEnabled().unwrap_or(false);
            can_next = c.IsNextEnabled().unwrap_or(false);
            can_previous = c.IsPreviousEnabled().unwrap_or(false);
            can_seek = c.IsPlaybackPositionEnabled().unwrap_or(false);
        }

        let now = chrono::Utc::now().timestamp_millis();
        let (mut position_ms, mut duration_ms, mut updated_at) = (None, None, now);
        if let Ok(tl) = s.GetTimelineProperties() {
            let start = tl.StartTime().map(|t| t.Duration).unwrap_or(0);
            let end = tl.EndTime().map(|t| t.Duration).unwrap_or(0);
            let pos = tl.Position().map(|t| t.Duration).unwrap_or(0);
            let dur = (end - start) / 10_000;
            if dur > 0 {
                duration_ms = Some(dur);
                position_ms = Some(((pos - start) / 10_000).clamp(0, dur));
                if let Some(t) = tl.LastUpdatedTime().ok().and_then(|d| filetime_to_unix_ms(d.UniversalTime)) {
                    updated_at = t.min(now);
                }
            }
        }

        Ok(NowPlaying {
            active: true,
            app_id: id,
            app_name: meta.name,
            app_icon: meta.icon,
            title,
            artist,
            album,
            cover,
            accent,
            status: status.to_string(),
            position_ms,
            duration_ms,
            updated_at,
            rate,
            can_play_pause,
            can_next,
            can_previous,
            can_seek: can_seek && duration_ms.is_some(),
            others: Vec::new(),
        })
    }

    pub fn snapshot() -> SvcResult<NowPlaying> {
        com::init_thread();
        let mgr = manager()?;
        let list = sessions(&mgr);
        let infos: Vec<(String, bool)> = list.iter().map(|s| (app_id(s), is_playing(s))).collect();
        let current = mgr.GetCurrentSession().ok().map(|s| app_id(&s));
        let shown = lock(&SHOWN).clone();
        let pinned_idx = {
            let mut pin = lock(&PINNED);
            let mut found: Option<usize> = None;
            if let Some((id, playing_then)) = pin.as_ref() {
                let newly_playing = infos.iter().any(|(sid, p)| *p && sid != id && !playing_then.contains(sid));
                if !newly_playing {
                    found = infos.iter().position(|(sid, _)| sid == id);
                }
            }
            if found.is_none() {
                *pin = None;
            }
            found
        };
        let Some(idx) = pinned_idx.or_else(|| choose(&infos, shown.as_deref(), current.as_deref())) else {
            return Ok(NowPlaying { status: "closed".to_string(), rate: 1.0, ..NowPlaying::default() });
        };
        *lock(&SHOWN) = Some(infos[idx].0.clone());
        let mut np = read(&list[idx])?;
        for (i, s) in list.iter().enumerate() {
            if i == idx || infos[i].0 == infos[idx].0 {
                continue;
            }
            let title = s.TryGetMediaPropertiesAsync().and_then(|op| op.join()).map(|p| text(p.Title())).unwrap_or_default();
            np.others.push(OtherPlayer { app_id: infos[i].0.clone(), app_name: app_meta(&infos[i].0).name, title, playing: infos[i].1 });
        }
        Ok(np)
    }

    fn find(mgr: &Manager, id: Option<&str>) -> Option<Session> {
        let list = sessions(mgr);
        if let Some(id) = id {
            if let Some(s) = list.iter().find(|s| app_id(s) == id) {
                return Some(s.clone());
            }
        }
        mgr.GetCurrentSession().ok().or_else(|| list.into_iter().next())
    }

    pub fn control(a: ControlArgs) -> SvcResult<bool> {
        com::init_thread();
        let mgr = manager()?;
        if a.action == "select" {
            let id = a.app_id.clone().ok_or_else(|| SvcError::bad_args("appId is missing"))?;
            let playing: Vec<String> = sessions(&mgr).iter().filter(|s| is_playing(s)).map(|s| app_id(s)).collect();
            *lock(&PINNED) = Some((id.clone(), playing));
            *lock(&SHOWN) = Some(id);
            if let Some(tx) = lock(&NUDGE).as_ref() {
                let _ = tx.send(Msg::Refresh);
            }
            return Ok(true);
        }
        let target = a.app_id.clone().or_else(|| lock(&SHOWN).clone());
        let session = find(&mgr, target.as_deref()).ok_or_else(|| SvcError::NotFound("no media session is active".to_string()))?;
        let op = match a.action.as_str() {
            "play_pause" => session.TryTogglePlayPauseAsync()?,
            "play" => session.TryPlayAsync()?,
            "pause" => session.TryPauseAsync()?,
            "next" => session.TrySkipNextAsync()?,
            "previous" => session.TrySkipPreviousAsync()?,
            "seek" => {
                let ms = a.position_ms.ok_or_else(|| SvcError::bad_args("positionMs is missing"))?;
                let start = session.GetTimelineProperties().and_then(|t| t.StartTime()).map(|t| t.Duration).unwrap_or(0);
                session.TryChangePlaybackPositionAsync(start + ms.max(0) * 10_000)?
            }
            other => return Err(SvcError::bad_args(format!("unknown action {other}"))),
        };
        Ok(op.join()?)
    }

    struct Watch {
        session: Session,
        tokens: [i64; 3],
    }

    fn watch_all(mgr: &Manager, tx: &Sender<Msg>, out: &mut Vec<Watch>) {
        for session in sessions(mgr) {
            let (a, b, c) = (tx.clone(), tx.clone(), tx.clone());
            let t1 = session.MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| {
                let _ = a.send(Msg::Refresh);
                Ok(())
            }));
            let t2 = session.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| {
                let _ = b.send(Msg::Rebind);
                Ok(())
            }));
            let t3 = session.TimelinePropertiesChanged(&TypedEventHandler::new(move |_, _| {
                let _ = c.send(Msg::Refresh);
                Ok(())
            }));
            match (t1, t2, t3) {
                (Ok(t1), Ok(t2), Ok(t3)) => out.push(Watch { session, tokens: [t1, t2, t3] }),
                (t1, t2, t3) => {
                    if let Ok(t) = t1 {
                        let _ = session.RemoveMediaPropertiesChanged(t);
                    }
                    if let Ok(t) = t2 {
                        let _ = session.RemovePlaybackInfoChanged(t);
                    }
                    if let Ok(t) = t3 {
                        let _ = session.RemoveTimelinePropertiesChanged(t);
                    }
                }
            }
        }
    }

    fn unwatch(list: &mut Vec<Watch>) {
        for w in list.drain(..) {
            let _ = w.session.RemoveMediaPropertiesChanged(w.tokens[0]);
            let _ = w.session.RemovePlaybackInfoChanged(w.tokens[1]);
            let _ = w.session.RemoveTimelinePropertiesChanged(w.tokens[2]);
        }
    }

    fn emit_if_changed(app: &AppHandle, last: &mut Option<NowPlaying>) {
        let np = match snapshot() {
            Ok(np) => np,
            Err(e) => {
                tracing::debug!("could not read the media session: {e}");
                NowPlaying { status: "closed".to_string(), rate: 1.0, ..NowPlaying::default() }
            }
        };
        if last.as_ref() != Some(&np) {
            events::emit(app, "media", "now_playing", &np);
            *last = Some(np);
        }
    }

    fn run(app: &AppHandle, generation: u64) -> SvcResult<()> {
        let mgr = manager()?;
        let (tx, rx) = channel::<Msg>();
        *lock(&NUDGE) = Some(tx.clone());
        let (a, b) = (tx.clone(), tx.clone());
        let t_current = mgr.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
            let _ = a.send(Msg::Rebind);
            Ok(())
        }))?;
        let t_sessions = mgr.SessionsChanged(&TypedEventHandler::new(move |_, _| {
            let _ = b.send(Msg::Rebind);
            Ok(())
        }))?;
        let mut watched: Vec<Watch> = Vec::new();
        watch_all(&mgr, &tx, &mut watched);
        let mut last: Option<NowPlaying> = None;
        emit_if_changed(app, &mut last);

        loop {
            match rx.recv_timeout(Duration::from_millis(800)) {
                Ok(first) => {
                    // Apps fire several events per change: take them as one.
                    std::thread::sleep(Duration::from_millis(80));
                    let mut rebind = matches!(first, Msg::Rebind);
                    while let Ok(m) = rx.try_recv() {
                        if matches!(m, Msg::Rebind) {
                            rebind = true;
                        }
                    }
                    if !subscriptions::is_current(TOPIC_KEY, generation) {
                        break;
                    }
                    if rebind {
                        unwatch(&mut watched);
                        watch_all(&mgr, &tx, &mut watched);
                    }
                    emit_if_changed(app, &mut last);
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !subscriptions::is_current(TOPIC_KEY, generation) {
                        break;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        unwatch(&mut watched);
        let _ = mgr.RemoveCurrentSessionChanged(t_current);
        let _ = mgr.RemoveSessionsChanged(t_sessions);
        Ok(())
    }

    pub fn start(app: AppHandle, generation: u64) {
        let spawned = std::thread::Builder::new().name("media-sessions".into()).spawn(move || {
            com::init_thread();
            if let Err(e) = run(&app, generation) {
                tracing::warn!("now playing is unavailable: {e}");
                let np = NowPlaying { status: "closed".to_string(), rate: 1.0, ..NowPlaying::default() };
                events::emit(&app, "media", "now_playing", &np);
            }
            tracing::debug!("media session watcher stopped");
        });
        if let Err(e) = spawned {
            tracing::warn!("could not start the media session watcher: {e}");
        }
    }
}

#[cfg(not(windows))]
pub fn start(_app: AppHandle, _generation: u64) {}

#[cfg(not(windows))]
pub fn snapshot() -> SvcResult<NowPlaying> {
    Err(SvcError::unsupported("media controls need Windows"))
}

#[cfg(not(windows))]
pub fn control(_a: ControlArgs) -> SvcResult<bool> {
    Err(SvcError::unsupported("media controls need Windows"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(list: &[(&str, bool)]) -> Vec<(String, bool)> {
        list.iter().map(|(id, p)| (id.to_string(), *p)).collect()
    }

    #[test]
    fn keeps_what_is_shown_while_it_plays() {
        assert_eq!(choose(&s(&[("a", true), ("b", true)]), Some("b"), Some("a")), Some(1));
    }

    #[test]
    fn moves_to_something_playing() {
        assert_eq!(choose(&s(&[("a", false), ("b", true)]), Some("a"), Some("a")), Some(1));
    }

    #[test]
    fn stays_on_a_paused_session() {
        assert_eq!(choose(&s(&[("a", false), ("b", false)]), Some("b"), Some("a")), Some(1));
        assert_eq!(choose(&s(&[]), None, None), None);
    }

    #[test]
    fn filetime() {
        assert_eq!(filetime_to_unix_ms(116_444_736_000_000_000 + 10_000), Some(1));
        assert_eq!(filetime_to_unix_ms(0), None);
    }
}
