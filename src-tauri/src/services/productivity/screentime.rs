//! Screen Time: which app is in front while you are at the PC, sampled every 5 s.
//!
//! - Off by default: it counts only while a Screen Time or Day Timeline tile is on the dock
//!   (store key "dock"), or the user switched "Count all the time" on in the card
//!   ({"always": true}), and never while paused. Otherwise the sampling thread only sleeps.
//! - Counts only while there was keyboard/mouse input in the last 5 minutes, or the window in
//!   front is fullscreen (a film). A locked PC, the desktop, Start, the taskbar and Alt+Tab
//!   never count; a gap longer than 15 s between samples (sleep) is not counted.
//! - Websites are opt-in (store key "productivity.screentime" {"sites": true}). Only a site's
//!   short name is kept ("YouTube"), never the page title or address, never private windows.
//! - One compact JSON file per day in %APPDATA%\GlintBar\screentime\YYYY-MM-DD.json, kept 90 days:
//!   { "v":1, "apps":[{"key":"chrome.exe","name":"Google Chrome"}], "seg":[[startSec,secs,appIdx]], "sites":{"YouTube":300} }

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use chrono::{Days, Local, NaiveDate, Timelike};
use serde::{Deserialize, Serialize};

use crate::error::{SvcError, SvcResult};
use crate::paths;
use crate::services::core::store;

const SAMPLE_EVERY: Duration = Duration::from_secs(5);
const IDLE_AFTER_MS: u64 = 5 * 60 * 1000;
/// A longer gap between two samples (sleep, a hung PC) is not counted.
const MAX_STEP_SECS: u64 = 15;
const KEEP_DAYS: u64 = 90;
const SAVE_EVERY: Duration = Duration::from_secs(60);
/// Two pieces of the same app this close together become one segment.
const MERGE_GAP_SECS: u32 = 12;
const OPTIONS_KEY: &str = "productivity.screentime";
const OTHER_SITES: &str = "Other sites";

// ---- data -----------------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct AppEntry {
    pub key: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct DayFile {
    #[serde(default)]
    pub v: u32,
    #[serde(default)]
    pub apps: Vec<AppEntry>,
    /// [start second of the day, seconds, index into apps]
    #[serde(default)]
    pub seg: Vec<[u32; 3]>,
    #[serde(default)]
    pub sites: BTreeMap<String, u32>,
}

impl DayFile {
    fn app_index(&mut self, key: &str, name: &str) -> u32 {
        if let Some(i) = self.apps.iter().position(|a| a.key == key) {
            return i as u32;
        }
        self.apps.push(AppEntry { key: key.to_string(), name: name.to_string() });
        (self.apps.len() - 1) as u32
    }

    /// Adds secs ending at end_sec (second of the day) to the app.
    pub fn add(&mut self, end_sec: u32, secs: u32, key: &str, name: &str) {
        if secs == 0 {
            return;
        }
        let idx = self.app_index(key, name);
        let start = end_sec.saturating_sub(secs);
        if let Some(last) = self.seg.last_mut() {
            let last_end = last[0].saturating_add(last[1]);
            if last[2] == idx && start <= last_end.saturating_add(MERGE_GAP_SECS) && end_sec >= last_end {
                last[1] = end_sec - last[0];
                return;
            }
            if start < last_end {
                // Never overlap the previous segment.
                let s = last_end.min(end_sec);
                if end_sec > s {
                    self.seg.push([s, end_sec - s, idx]);
                }
                return;
            }
        }
        self.seg.push([start, secs, idx]);
    }
}

#[derive(Deserialize, Default, Clone)]
#[serde(default)]
struct Options {
    sites: bool,
    paused: bool,
    /// Count even when no Screen Time / Day Timeline tile is on the dock.
    always: bool,
}

/// Widgets whose tiles need the tracker.
const TRACKED_BY: &[&str] = &["productivity.screentime", "productivity.timeline"];

/// True when a Screen Time or Day Timeline tile is on the dock.
fn on_dock() -> bool {
    let Some(dock) = store::get_value("dock") else { return false };
    let Some(list) = dock.get("instances").and_then(|v| v.as_array()) else { return false };
    list.iter().any(|i| match i.get("widgetId").and_then(|w| w.as_str()) {
        Some(id) => TRACKED_BY.contains(&id),
        None => false,
    })
}

/// Whether the tracker counts right now (the thread is running and the user wants it).
fn wanted(opts: &Options) -> bool {
    !opts.paused && (opts.always || on_dock())
}

fn options() -> Options {
    store::get_value(OPTIONS_KEY).and_then(|v| serde_json::from_value::<Options>(v).ok()).unwrap_or_default()
}

// ---- results (mirrored in src/widgets/productivity/screentime/types.ts) ----------------------

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppTime {
    pub key: String,
    pub name: String,
    pub secs: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SiteTime {
    pub name: String,
    pub secs: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start: u32,
    pub secs: u32,
    pub app: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DaySummary {
    pub date: String,
    pub total_secs: u32,
    /// Seconds in each hour of the day (24).
    pub hours: Vec<u32>,
    /// Most used first.
    pub apps: Vec<AppTime>,
    pub sites: Vec<SiteTime>,
    pub longest_focus_secs: u32,
    pub longest_focus_app: Option<String>,
    pub switches: u32,
    /// Second of the day the first counted use began.
    pub first_active: Option<u32>,
    pub last_active: Option<u32>,
    pub segments: Option<Vec<Segment>>,
    pub tracking: bool,
    pub sites_on: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DayTotal {
    pub date: String,
    pub total_secs: u32,
    pub apps: Vec<AppTime>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub tracking: bool,
    pub sites_on: bool,
    pub paused: bool,
    pub days_kept: u32,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DayArgs {
    /// "YYYY-MM-DD"; today when missing.
    pub date: Option<String>,
    pub segments: bool,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DaysArgs {
    /// How many days up to today (1-90), oldest first.
    pub days: u32,
}

pub fn summarize(date: &str, day: &DayFile, with_segments: bool, tracking: bool, sites_on: bool) -> DaySummary {
    let mut hours = vec![0u32; 24];
    let mut per_app: HashMap<u32, u32> = HashMap::new();
    let mut longest: (u32, Option<u32>) = (0, None);
    let mut switches = 0u32;
    let mut prev: Option<u32> = None;
    for s in &day.seg {
        let (start, secs, idx) = (s[0], s[1], s[2]);
        *per_app.entry(idx).or_insert(0) += secs;
        if secs > longest.0 {
            longest = (secs, Some(idx));
        }
        if let Some(p) = prev {
            if p != idx {
                switches += 1;
            }
        }
        prev = Some(idx);
        // Spread over the hours it covers.
        let mut t = start;
        // saturating: day files come from disk and may be damaged.
        let end = start.saturating_add(secs).min(86_400);
        while t < end {
            let h = (t / 3600) as usize;
            let hour_end = ((h as u32) + 1) * 3600;
            let piece = hour_end.min(end) - t;
            if h < 24 {
                hours[h] += piece;
            }
            t += piece;
        }
    }
    let name_of = |idx: u32| day.apps.get(idx as usize).map(|a| a.name.clone()).unwrap_or_default();
    let key_of = |idx: u32| day.apps.get(idx as usize).map(|a| a.key.clone()).unwrap_or_default();
    let mut apps: Vec<AppTime> = per_app.iter().map(|(idx, secs)| AppTime { key: key_of(*idx), name: name_of(*idx), secs: *secs }).collect();
    apps.sort_by(|a, b| b.secs.cmp(&a.secs).then(a.name.cmp(&b.name)));
    let mut sites: Vec<SiteTime> = if sites_on { day.sites.iter().map(|(n, s)| SiteTime { name: n.clone(), secs: *s }).collect() } else { Vec::new() };
    sites.sort_by(|a, b| b.secs.cmp(&a.secs));
    let segments = if with_segments {
        Some(day.seg.iter().map(|s| Segment { start: s[0], secs: s[1], app: key_of(s[2]) }).collect())
    } else {
        None
    };
    DaySummary {
        date: date.to_string(),
        total_secs: hours.iter().sum(),
        hours,
        apps,
        sites,
        longest_focus_secs: longest.0,
        longest_focus_app: longest.1.map(name_of),
        switches,
        first_active: day.seg.first().map(|s| s[0]),
        last_active: day.seg.last().map(|s| s[0].saturating_add(s[1])),
        segments,
        tracking,
        sites_on,
    }
}

// ---- state ------------------------------------------------------------------------------------

struct State {
    date: String,
    day: DayFile,
    dirty: bool,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);
static STARTED: AtomicBool = AtomicBool::new(false);
static TRACKING: AtomicBool = AtomicBool::new(false);
static NAMES: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn lock() -> MutexGuard<'static, Option<State>> {
    STATE.lock().unwrap_or_else(|p| p.into_inner())
}

fn dir() -> PathBuf {
    let d = paths::data_dir().join("screentime");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn today() -> String {
    Local::now().date_naive().format("%Y-%m-%d").to_string()
}

fn valid_date(s: &str) -> bool {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

fn file_for(date: &str) -> PathBuf {
    dir().join(format!("{date}.json"))
}

fn load(date: &str) -> DayFile {
    match std::fs::read(file_for(date)) {
        Ok(bytes) => serde_json::from_slice::<DayFile>(&bytes).unwrap_or_default(),
        Err(_) => DayFile::default(),
    }
}

fn save(date: &str, day: &DayFile) -> std::io::Result<()> {
    let path = file_for(date);
    let tmp = path.with_extension("json.tmp");
    let mut out = day.clone();
    out.v = 1;
    let text = serde_json::to_vec(&out).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, &path)
}

fn prune() {
    let Some(cutoff) = Local::now().date_naive().checked_sub_days(Days::new(KEEP_DAYS)) else { return };
    let Ok(entries) = std::fs::read_dir(dir()) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(stem) = name.strip_suffix(".json") else { continue };
        if let Ok(d) = NaiveDate::parse_from_str(stem, "%Y-%m-%d") {
            if d < cutoff {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

/// Writes today's file if it changed. Quick; called on exit too.
pub fn flush() {
    let mut guard = lock();
    if let Some(st) = guard.as_mut() {
        if st.dirty {
            match save(&st.date, &st.day) {
                Ok(()) => st.dirty = false,
                Err(e) => tracing::warn!("screen time: could not save: {e}"),
            }
        }
    }
}

fn record(secs: u32, key: &str, name: &str, site: Option<String>) {
    let now = Local::now();
    let date = now.date_naive().format("%Y-%m-%d").to_string();
    let end = now.num_seconds_from_midnight();
    let mut guard = lock();
    let rolled = match guard.as_ref() {
        Some(st) => st.date != date,
        None => true,
    };
    if rolled {
        if let Some(old) = guard.as_ref() {
            if old.dirty {
                let _ = save(&old.date, &old.day);
            }
        }
        *guard = Some(State { day: load(&date), date: date.clone(), dirty: false });
        drop(guard);
        prune();
        guard = lock();
    }
    if let Some(st) = guard.as_mut() {
        // Time that would reach back before midnight is cut at 00:00.
        let secs = secs.min(end.max(1));
        st.day.add(end, secs, key, name);
        if let Some(site) = site {
            *st.day.sites.entry(site).or_insert(0) += secs;
        }
        st.dirty = true;
    }
}

/// Starts the sampling thread (once).
pub fn start() {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    #[cfg(windows)]
    {
        TRACKING.store(true, Ordering::SeqCst);
        let spawned = std::thread::Builder::new().name("screen-time".into()).spawn(|| {
            prune();
            let mut last = Instant::now();
            let mut last_save = Instant::now();
            loop {
                std::thread::sleep(SAMPLE_EVERY);
                let step = last.elapsed().as_secs();
                last = Instant::now();
                if step <= MAX_STEP_SECS {
                    let opts = options();
                    if wanted(&opts) {
                        if let Some(fg) = win::foreground() {
                            let active = win::idle_ms() < IDLE_AFTER_MS || fg.fullscreen;
                            if active {
                                let site = if opts.sites && is_browser(&fg.key) { site_from_title(&fg.title) } else { None };
                                let name = display_name(&fg.key, &fg.path);
                                record(step as u32, &fg.key, &name, site);
                            }
                        }
                    }
                }
                if last_save.elapsed() >= SAVE_EVERY {
                    last_save = Instant::now();
                    flush();
                }
            }
        });
        if let Err(e) = spawned {
            TRACKING.store(false, Ordering::SeqCst);
            tracing::warn!("screen time: could not start: {e}");
        }
    }
}

fn display_name(key: &str, path: &str) -> String {
    let cache = NAMES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(n) = cache.lock().unwrap_or_else(|p| p.into_inner()).get(key) {
        return n.clone();
    }
    let name = friendly_name(key, path);
    cache.lock().unwrap_or_else(|p| p.into_inner()).insert(key.to_string(), name.clone());
    name
}

fn friendly_name(key: &str, path: &str) -> String {
    match key {
        "explorer.exe" => return "File Explorer".into(),
        "applicationframehost.exe" => return "Windows app".into(),
        "windowsterminal.exe" => return "Terminal".into(),
        _ => {}
    }
    #[cfg(windows)]
    {
        if let Some(d) = win::file_description(path) {
            let d = d.trim().to_string();
            if !d.is_empty() && d.chars().count() <= 60 {
                return d;
            }
        }
    }
    let _ = path;
    let stem = key.strip_suffix(".exe").unwrap_or(key);
    let mut chars = stem.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => key.to_string(),
    }
}

// ---- websites -----------------------------------------------------------------------------------

const BROWSERS: &[&str] = &[
    "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe", "arc.exe", "zen.exe",
    "librewolf.exe", "waterfox.exe", "chromium.exe", "floorp.exe", "thorium.exe", "browser.exe", "iexplore.exe",
];

pub fn is_browser(key: &str) -> bool {
    BROWSERS.contains(&key)
}

const BROWSER_WORDS: &[&str] = &[
    "google chrome", "chrome", "microsoft edge", "edge", "mozilla firefox", "firefox", "brave", "opera", "vivaldi", "arc",
    "zen browser", "librewolf", "waterfox", "chromium", "floorp", "thorium", "yandex browser",
];

/// (needle, name): matched against each " - " part of the title, last part first.
const KNOWN_SITES: &[(&str, &str)] = &[
    ("youtube", "YouTube"), ("github", "GitHub"), ("gitlab", "GitLab"), ("gmail", "Gmail"), ("google docs", "Google Docs"),
    ("google sheets", "Google Sheets"), ("google slides", "Google Slides"), ("google drive", "Google Drive"),
    ("google calendar", "Google Calendar"), ("google search", "Google Search"), ("google maps", "Google Maps"),
    ("stack overflow", "Stack Overflow"), ("reddit", "Reddit"), ("wikipedia", "Wikipedia"), ("chatgpt", "ChatGPT"),
    ("claude", "Claude"), ("gemini", "Gemini"), ("perplexity", "Perplexity"), ("notion", "Notion"), ("figma", "Figma"),
    ("linear", "Linear"), ("slack", "Slack"), ("discord", "Discord"), ("netflix", "Netflix"), ("twitch", "Twitch"),
    ("linkedin", "LinkedIn"), ("facebook", "Facebook"), ("instagram", "Instagram"), ("amazon", "Amazon"),
    ("outlook", "Outlook"), ("whatsapp", "WhatsApp"), ("telegram", "Telegram"), ("spotify", "Spotify"), ("jira", "Jira"),
    ("confluence", "Confluence"), ("medium", "Medium"), ("hacker news", "Hacker News"), ("twitter", "X"), ("/ x", "X"),
    ("stripe", "Stripe"), ("vercel", "Vercel"), ("trello", "Trello"), ("asana", "Asana"), ("dropbox", "Dropbox"),
    ("prime video", "Prime Video"), ("disney+", "Disney+"), ("tiktok", "TikTok"), ("pinterest", "Pinterest"),
];

/// "Inbox (3) - me@example.com - Gmail - Google Chrome" -> Some("Gmail"). None for private windows
/// and for titles without a site name. The page title itself is never returned.
pub fn site_from_title(title: &str) -> Option<String> {
    let clean: String = title.chars().filter(|c| *c != '\u{200b}' && *c != '\u{200e}').collect();
    let lower = clean.to_lowercase();
    if lower.contains("inprivate") || lower.contains("incognito") || lower.contains("private browsing") || lower.contains("private window") {
        return None;
    }
    let mut parts: Vec<String> = lower
        .split(|c: char| c == '\u{2014}' || c == '\u{2013}' || c == '|')
        .flat_map(|p| p.split(" - ").map(|s| s.trim().to_string()).collect::<Vec<String>>())
        .filter(|p| !p.is_empty())
        .collect();
    // Drop the browser's own name (and an Edge profile name before it).
    while let Some(last) = parts.last() {
        if BROWSER_WORDS.iter().any(|w| last.as_str() == *w || last.ends_with(&format!(" {w}"))) {
            parts.pop();
            if parts.len() > 1 && parts.last().map(|p| p.starts_with("profile") || p == "personal" || p == "work").unwrap_or(false) {
                parts.pop();
            }
        } else {
            break;
        }
    }
    if parts.is_empty() {
        return None;
    }
    let first = parts[0].as_str();
    if first == "new tab" || first == "start page" || first == "new private tab" || first.starts_with("about:") {
        return None;
    }
    for part in parts.iter().rev() {
        for (needle, name) in KNOWN_SITES {
            let needle: &str = needle;
            if part.as_str() == needle || part.ends_with(&format!(" {needle}")) || part.starts_with(&format!("{needle} ")) || (needle.len() > 5 && part.contains(needle)) {
                return Some((*name).to_string());
            }
        }
    }
    // Unknown: the last part is usually the site's own name ("Page - Site"), when it is short.
    if parts.len() >= 2 {
        let orig_parts: Vec<String> = clean
            .split(|c: char| c == '\u{2014}' || c == '\u{2013}' || c == '|')
            .flat_map(|p| p.split(" - ").map(|s| s.trim().to_string()).collect::<Vec<String>>())
            .filter(|p| !p.is_empty())
            .collect();
        if let Some(cand) = orig_parts.get(parts.len() - 1) {
            let words = cand.split_whitespace().count();
            let len = cand.chars().count();
            if (2..=32).contains(&len) && words <= 3 && !cand.contains('@') && !cand.chars().any(|c| c.is_ascii_digit() && len > 12) {
                return Some(cand.clone());
            }
        }
    }
    Some(OTHER_SITES.to_string())
}

// ---- API --------------------------------------------------------------------------------------

pub fn day(args: DayArgs) -> SvcResult<DaySummary> {
    let today = today();
    let date = args.date.unwrap_or_else(|| today.clone());
    if !valid_date(&date) {
        return Err(SvcError::bad_args("expected a date like YYYY-MM-DD"));
    }
    let opts = options();
    let tracking = TRACKING.load(Ordering::SeqCst) && wanted(&opts);
    let live = {
        let guard = lock();
        guard.as_ref().filter(|st| st.date == date).map(|st| st.day.clone())
    };
    let data = live.unwrap_or_else(|| load(&date));
    Ok(summarize(&date, &data, args.segments, tracking, opts.sites))
}

pub fn days(args: DaysArgs) -> SvcResult<Vec<DayTotal>> {
    let n = args.days.clamp(1, KEEP_DAYS as u32);
    let today = Local::now().date_naive();
    let mut out = Vec::with_capacity(n as usize);
    for back in (0..n).rev() {
        let Some(d) = today.checked_sub_days(Days::new(back as u64)) else { continue };
        let date = d.format("%Y-%m-%d").to_string();
        let s = day(DayArgs { date: Some(date.clone()), segments: false })?;
        let mut apps = s.apps;
        apps.truncate(12);
        out.push(DayTotal { date, total_secs: s.total_secs, apps });
    }
    Ok(out)
}

pub fn status() -> Status {
    let opts = options();
    let days_kept = std::fs::read_dir(dir()).map(|it| it.flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".json")).count() as u32).unwrap_or(0);
    let tracking = TRACKING.load(Ordering::SeqCst) && wanted(&opts);
    Status { tracking, sites_on: opts.sites, paused: opts.paused, days_kept }
}

/// Turning websites off forgets every site, in every stored day.
pub fn forget_sites() -> SvcResult<()> {
    {
        let mut guard = lock();
        if let Some(st) = guard.as_mut() {
            if !st.day.sites.is_empty() {
                st.day.sites.clear();
                st.dirty = true;
            }
        }
    }
    flush();
    let entries = std::fs::read_dir(dir())?;
    for e in entries.flatten() {
        let path = e.path();
        if path.extension().map(|x| x == "json").unwrap_or(false) {
            let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            if !valid_date(&stem) {
                continue;
            }
            let mut d = load(&stem);
            if !d.sites.is_empty() {
                d.sites.clear();
                save(&stem, &d)?;
            }
        }
    }
    Ok(())
}

// ---- Win32 ------------------------------------------------------------------------------------

#[cfg(windows)]
mod win {
    use std::ffi::c_void;

    use windows::core::{w, HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND, RECT};
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowExW, GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };

    pub struct Foreground {
        /// Lower-case exe file name.
        pub key: String,
        pub path: String,
        pub title: String,
        pub fullscreen: bool,
    }

    /// Classes of shell surfaces that never count.
    const SHELL_CLASSES: &[&str] = &[
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "MultitaskingViewFrame", "XamlExplorerHostIslandWindow",
        "ForegroundStaging", "TaskSwitcherWnd", "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland",
    ];

    /// Processes that are Windows chrome, not apps.
    const SHELL_EXES: &[&str] = &[
        "lockapp.exe", "startmenuexperiencehost.exe", "searchhost.exe", "searchapp.exe", "shellexperiencehost.exe",
        "searchui.exe", "logonui.exe", "screenclippinghost.exe", "textinputhost.exe", "shellhost.exe",
    ];

    /// Milliseconds since the last keyboard or mouse input.
    pub fn idle_ms() -> u64 {
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        unsafe {
            if !GetLastInputInfo(&mut info).as_bool() {
                return 0;
            }
            u64::from(GetTickCount().wrapping_sub(info.dwTime))
        }
    }

    fn class_name(hwnd: HWND) -> String {
        let mut buf = [0u16; 128];
        let n = unsafe { GetClassNameW(hwnd, &mut buf) };
        if n <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..(n as usize).min(buf.len())])
    }

    fn window_title(hwnd: HWND) -> String {
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; (len as usize).min(1024) + 1];
        let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if n <= 0 {
            return String::new();
        }
        // UTF-16 to String; lone surrogates (cut emoji) become U+FFFD instead of failing.
        String::from_utf16_lossy(&buf[..(n as usize).min(buf.len())])
    }

    fn pid_of(hwnd: HWND) -> u32 {
        let mut pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
        }
        pid
    }

    fn process_path(pid: u32) -> Option<String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = vec![0u16; 1024];
            let mut size: u32 = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut size).is_ok();
            let _ = CloseHandle(handle);
            if !ok || size == 0 {
                return None;
            }
            Some(String::from_utf16_lossy(&buf[..(size as usize).min(buf.len())]))
        }
    }

    fn is_fullscreen(hwnd: HWND) -> bool {
        unsafe {
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_err() {
                return false;
            }
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if !GetMonitorInfoW(monitor, &mut mi).as_bool() {
                return false;
            }
            let m = mi.rcMonitor;
            rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
        }
    }

    /// The app in front, or None for the desktop, the shell, the lock screen and GlintBar itself.
    pub fn foreground() -> Option<Foreground> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_invalid() {
            return None;
        }
        let class = class_name(hwnd);
        if SHELL_CLASSES.contains(&class.as_str()) {
            return None;
        }
        let mut pid = pid_of(hwnd);
        if pid == 0 || pid == std::process::id() {
            return None;
        }
        let mut path = process_path(pid)?;
        let mut key = file_key(&path);
        // Store apps run inside ApplicationFrameHost: find the real app's window.
        if key == "applicationframehost.exe" {
            if let Ok(child) = unsafe { FindWindowExW(Some(hwnd), None, w!("Windows.UI.Core.CoreWindow"), PCWSTR::null()) } {
                let child_pid = pid_of(child);
                if child_pid != 0 && child_pid != pid {
                    if let Some(p) = process_path(child_pid) {
                        pid = child_pid;
                        key = file_key(&p);
                        path = p;
                    }
                }
            }
        }
        let _ = pid;
        if SHELL_EXES.contains(&key.as_str()) {
            return None;
        }
        Some(Foreground { title: window_title(hwnd), fullscreen: is_fullscreen(hwnd), key, path })
    }

    fn file_key(path: &str) -> String {
        path.rsplit(|c: char| c == '\\' || c == '/').next().unwrap_or(path).to_lowercase()
    }

    /// The FileDescription from the exe's version resource ("Google Chrome").
    pub fn file_description(path: &str) -> Option<String> {
        let file = HSTRING::from(path);
        unsafe {
            let size = GetFileVersionInfoSizeW(&file, None);
            if size == 0 || size > 8 * 1024 * 1024 {
                return None;
            }
            let mut block: Vec<u8> = vec![0u8; size as usize];
            GetFileVersionInfoW(&file, None, size, block.as_mut_ptr() as *mut c_void).ok()?;
            let mut ptr: *mut c_void = std::ptr::null_mut();
            let mut len: u32 = 0;
            let mut langs: Vec<String> = Vec::new();
            if VerQueryValueW(block.as_ptr() as *const c_void, w!("\\VarFileInfo\\Translation"), &mut ptr as *mut *mut c_void, &mut len as *mut u32).as_bool()
                && len >= 4
                && !ptr.is_null()
            {
                let pair = std::slice::from_raw_parts(ptr as *const u16, 2);
                langs.push(format!("{:04x}{:04x}", pair[0], pair[1]));
            }
            langs.push("040904b0".to_string());
            langs.push("040904e4".to_string());
            for lang in langs {
                let query = HSTRING::from(format!("\\StringFileInfo\\{lang}\\FileDescription"));
                let mut text: *mut c_void = std::ptr::null_mut();
                let mut text_len: u32 = 0;
                if VerQueryValueW(block.as_ptr() as *const c_void, &query, &mut text as *mut *mut c_void, &mut text_len as *mut u32).as_bool()
                    && text_len > 0
                    && !text.is_null()
                {
                    let wide = std::slice::from_raw_parts(text as *const u16, text_len as usize);
                    let end = wide.iter().position(|c| *c == 0).unwrap_or(wide.len());
                    let s = String::from_utf16_lossy(&wide[..end]).trim().to_string();
                    if !s.is_empty() {
                        return Some(s);
                    }
                }
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_merge_and_never_overlap() {
        let mut d = DayFile::default();
        d.add(3605, 5, "code.exe", "Visual Studio Code");
        d.add(3610, 5, "code.exe", "Visual Studio Code");
        d.add(3615, 5, "chrome.exe", "Google Chrome");
        d.add(3620, 5, "code.exe", "Visual Studio Code");
        assert_eq!(d.seg, vec![[3600, 10, 0], [3610, 5, 1], [3615, 5, 0]]);
        let s = summarize("2026-11-16", &d, true, true, false);
        assert_eq!(s.total_secs, 20);
        assert_eq!(s.hours[1], 20);
        assert_eq!(s.switches, 2);
        assert_eq!(s.apps[0].name, "Visual Studio Code");
        assert_eq!(s.longest_focus_secs, 10);
    }

    #[test]
    fn hours_split_at_the_boundary() {
        let mut d = DayFile::default();
        d.add(7230, 60, "a.exe", "A");
        let s = summarize("x", &d, false, true, false);
        assert_eq!(s.hours[1], 30);
        assert_eq!(s.hours[2], 30);
    }

    #[test]
    fn sites_from_titles() {
        assert_eq!(site_from_title("Inbox (3) - me@example.com - Gmail - Google Chrome").as_deref(), Some("Gmail"));
        assert_eq!(site_from_title("Never Gonna Give You Up - YouTube \u{2014} Mozilla Firefox").as_deref(), Some("YouTube"));
        assert_eq!(site_from_title("Пример страницы - Википедия - Personal - Microsoft\u{200b} Edge").as_deref(), Some("Википедия"));
        assert_eq!(site_from_title("Some page - Example Site - Google Chrome").as_deref(), Some("Example Site"));
        assert_eq!(site_from_title("New Tab - Google Chrome"), None);
        assert_eq!(site_from_title("Secret - InPrivate - Microsoft Edge"), None);
        assert_eq!(site_from_title("Just a page title \u{1F600} - Google Chrome").as_deref(), Some(OTHER_SITES));
    }
}
