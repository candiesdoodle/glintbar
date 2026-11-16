//! Token counts from Claude Code's own history (~/.claude/projects/**/*.jsonl).
//!
//! Read incrementally: each file's read offset is remembered, so a refresh reads only the bytes
//! appended since the last one (a partial last line waits for the next refresh). One reply is
//! written as several lines - its thinking, its text, each tool call - all with the same message
//! id; it is counted once. Totals are kept in 5-minute buckets for the last 8 days and saved to
//! %APPDATA%\\GlintBar\\ai\\claude-history.json (offsets, buckets and hashed message ids only).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::model::DAY_MS;
use super::util;
use crate::error::SvcResult;

const HORIZON_MS: i64 = 8 * DAY_MS;
const WEEK_MS: i64 = 7 * DAY_MS;
const BUCKET_MS: i64 = 5 * 60 * 1000;
/// Bytes read per refresh across all files; a big first scan finishes over a few refreshes.
const SCAN_BUDGET: u64 = 48 * 1024 * 1024;
const FILE_CHUNK: u64 = 16 * 1024 * 1024;
const MAX_FILES: usize = 20_000;
const SAVE_EVERY: Duration = Duration::from_secs(300);
const RECENT_FOR: Duration = Duration::from_secs(3600);
const INDEX_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Default, Clone, Copy, Debug, PartialEq)]
pub struct Tok {
    #[serde(default)]
    pub i: u64,
    #[serde(default)]
    pub o: u64,
    #[serde(default)]
    pub cw: u64,
    #[serde(default)]
    pub cr: u64,
}

impl Tok {
    /// Tokens that count towards "how much was used": input, output and cache writes.
    /// Cache reads are reported separately - they dwarf everything else.
    pub fn total(&self) -> u64 {
        self.i + self.o + self.cw
    }
    fn add(&mut self, b: &Tok) {
        self.i += b.i;
        self.o += b.o;
        self.cw += b.cw;
        self.cr += b.cr;
    }
    fn over(&self, old: &Tok) -> Tok {
        Tok {
            i: self.i.saturating_sub(old.i),
            o: self.o.saturating_sub(old.o),
            cw: self.cw.saturating_sub(old.cw),
            cr: self.cr.saturating_sub(old.cr),
        }
    }
    fn max(&self, b: &Tok) -> Tok {
        Tok { i: self.i.max(b.i), o: self.o.max(b.o), cw: self.cw.max(b.cw), cr: self.cr.max(b.cr) }
    }
    fn is_zero(&self) -> bool {
        self.i == 0 && self.o == 0 && self.cw == 0 && self.cr == 0
    }
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
struct FileMark {
    offset: u64,
    mtime: i64,
}

#[derive(Serialize, Deserialize, Default)]
struct Index {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    files: HashMap<String, FileMark>,
    /// fnv64(message id + request id) -> message time (ms)
    #[serde(default)]
    seen: HashMap<u64, i64>,
    /// bucket start (ms) -> model -> tokens
    #[serde(default)]
    buckets: BTreeMap<i64, HashMap<String, Tok>>,
}

struct Recent {
    bucket: i64,
    model: String,
    tok: Tok,
    at: Instant,
}

pub struct State {
    index: Index,
    recent: HashMap<u64, Recent>,
    dirty: bool,
    saved_at: Option<Instant>,
}

impl State {
    pub fn new() -> State {
        State {
            index: Index { version: INDEX_VERSION, ..Index::default() },
            recent: HashMap::new(),
            dirty: false,
            saved_at: None,
        }
    }
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn lock() -> MutexGuard<'static, Option<State>> {
    STATE.lock().unwrap_or_else(|p| p.into_inner())
}

fn index_path() -> PathBuf {
    util::cache_dir().join("claude-history.json")
}

fn load() -> State {
    let mut st = State::new();
    if let Ok(text) = util::read_capped(&index_path(), 64 * 1024 * 1024) {
        if let Ok(idx) = serde_json::from_str::<Index>(&text) {
            if idx.version == INDEX_VERSION {
                st.index = idx;
            }
        }
    }
    st
}

fn save(st: &mut State) {
    if !st.dirty {
        return;
    }
    match serde_json::to_vec(&st.index) {
        Ok(bytes) => {
            if let Err(e) = util::write_atomic(&index_path(), &bytes) {
                tracing::warn!("could not save the Claude history index: {e}");
                return;
            }
            st.dirty = false;
            st.saved_at = Some(Instant::now());
        }
        Err(e) => tracing::warn!("could not encode the Claude history index: {e}"),
    }
}

/// Called on exit: keep what was counted so the next start reads only new bytes.
pub fn save_now() {
    let mut guard = lock();
    if let Some(st) = guard.as_mut() {
        save(st);
    }
}

// ---- parsing (pure) ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    message: Option<RawMsg>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawMsg {
    id: Option<String>,
    model: Option<String>,
    usage: Option<RawUsage>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
}

#[derive(Debug, PartialEq)]
pub struct Entry {
    pub key: u64,
    pub at: i64,
    pub model: String,
    pub tok: Tok,
}

/// One history line -> one assistant usage record, or None for anything else (or broken JSON).
pub fn parse_line(line: &str) -> Option<Entry> {
    if !line.contains("\"assistant\"") || !line.contains("\"usage\"") {
        return None;
    }
    let raw: RawLine = serde_json::from_str(line.trim()).ok()?;
    if raw.kind.as_deref() != Some("assistant") {
        return None;
    }
    let msg = raw.message?;
    let model = msg.model.unwrap_or_default();
    if model.is_empty() || model.starts_with('<') {
        return None; // "<synthetic>" placeholders carry no real usage
    }
    let id = msg.id?;
    let u = msg.usage?;
    let tok = Tok {
        i: u.input_tokens.unwrap_or(0),
        o: u.output_tokens.unwrap_or(0),
        cw: u.cache_creation_input_tokens.unwrap_or(0),
        cr: u.cache_read_input_tokens.unwrap_or(0),
    };
    if tok.is_zero() {
        return None;
    }
    let at = util::parse_time_str(raw.timestamp.as_deref()?)?;
    let key = util::fnv64(&format!("{}|{}", id, raw.request_id.unwrap_or_default()));
    Some(Entry { key, at, model, tok })
}

/// Adds an entry once per message. A later line of the same message only adds what grew.
pub fn apply(st: &mut State, e: Entry) -> bool {
    let mut grown: Option<(i64, String, Tok)> = None;
    let mut known = false;
    if let Some(r) = st.recent.get_mut(&e.key) {
        known = true;
        let d = e.tok.over(&r.tok);
        if !d.is_zero() {
            r.tok = r.tok.max(&e.tok);
            grown = Some((r.bucket, r.model.clone(), d));
        }
    }
    if let Some((bucket, model, d)) = grown {
        st.index.buckets.entry(bucket).or_default().entry(model).or_default().add(&d);
        st.dirty = true;
        return true;
    }
    if known || st.index.seen.contains_key(&e.key) {
        return false;
    }
    let bucket = e.at - e.at.rem_euclid(BUCKET_MS);
    st.index.seen.insert(e.key, e.at);
    st.index.buckets.entry(bucket).or_default().entry(e.model.clone()).or_default().add(&e.tok);
    st.recent.insert(e.key, Recent { bucket, model: e.model, tok: e.tok, at: Instant::now() });
    st.dirty = true;
    true
}

/// Feeds complete lines of `text` into the state; returns true when anything was counted.
pub fn ingest(st: &mut State, text: &str, now: i64) -> bool {
    let mut changed = false;
    for line in text.split('\n') {
        if let Some(e) = parse_line(line) {
            if e.at >= now - HORIZON_MS && apply(st, e) {
                changed = true;
            }
        }
    }
    changed
}

// ---- scanning ---------------------------------------------------------------------------------

fn collect_files(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth > 5 || out.len() >= MAX_FILES {
        return;
    }
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_dir() {
            collect_files(&path, depth + 1, out);
        } else if ft.is_file() && path.extension().map(|x| x == "jsonl").unwrap_or(false) {
            out.push(path);
        }
        if out.len() >= MAX_FILES {
            return;
        }
    }
}

/// Reads what is new in one file. Returns the file's mtime.
fn scan_file(st: &mut State, path: &Path, budget: &mut u64, now: i64) -> Option<i64> {
    let meta = std::fs::metadata(path).ok()?;
    let size = meta.len();
    let mtime = util::mtime_ms(&meta).unwrap_or(0);
    let key = path.to_string_lossy().into_owned();
    let mut offset = match st.index.files.get(&key) {
        Some(m) if size >= m.offset => m.offset,
        Some(_) => 0, // shorter than before: rewritten, start over
        None => {
            if mtime < now - HORIZON_MS {
                // Too old to matter; only follow what gets appended from now on.
                st.index.files.insert(key, FileMark { offset: size, mtime });
                st.dirty = true;
                return Some(mtime);
            }
            0
        }
    };
    if offset >= size || *budget == 0 {
        return Some(mtime);
    }
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return Some(mtime),
    };
    let start = offset;
    while offset < size && *budget > 0 {
        let want = (size - offset).min(FILE_CHUNK).min(*budget);
        if file.seek(SeekFrom::Start(offset)).is_err() {
            break;
        }
        let mut buf: Vec<u8> = Vec::with_capacity(want as usize);
        if file.by_ref().take(want).read_to_end(&mut buf).is_err() || buf.is_empty() {
            break;
        }
        *budget = budget.saturating_sub(buf.len() as u64);
        let consumed = match buf.iter().rposition(|b| *b == b'\n') {
            Some(pos) => pos + 1,
            // A full chunk without a newline is not a history line: skip it.
            None if buf.len() as u64 >= FILE_CHUNK => buf.len(),
            // The last line is still being written: wait for the next refresh.
            None => 0,
        };
        if consumed == 0 {
            break;
        }
        let text = String::from_utf8_lossy(&buf[..consumed]);
        ingest(st, &text, now);
        offset += consumed as u64;
    }
    if offset != start {
        st.index.files.insert(key, FileMark { offset, mtime });
        st.dirty = true;
    }
    Some(mtime)
}

fn prune(st: &mut State, now: i64, live_files: &HashSet<String>) {
    let cutoff = now - HORIZON_MS;
    let keep = st.index.buckets.split_off(&cutoff);
    if !st.index.buckets.is_empty() {
        st.dirty = true;
    }
    st.index.buckets = keep;
    let before = st.index.seen.len();
    st.index.seen.retain(|_, at| *at >= cutoff);
    let files_before = st.index.files.len();
    st.index.files.retain(|k, _| live_files.contains(k));
    if st.index.seen.len() != before || st.index.files.len() != files_before {
        st.dirty = true;
    }
    st.recent.retain(|_, r| r.at.elapsed() < RECENT_FOR);
}

// ---- result -----------------------------------------------------------------------------------

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenTotals {
    pub input: u64,
    pub output: u64,
    pub cache_write: u64,
    pub cache_read: u64,
    /// input + output + cache writes
    pub total: u64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelTokens {
    pub model: String,
    pub tokens: u64,
    pub output: u64,
}

/// Result of `ai.claude_local`.
#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeLocal {
    /// Claude Code's history folder exists on this PC.
    pub found: bool,
    /// Newest change to any history file (unix ms).
    pub last_activity: Option<i64>,
    /// More history is left to read (the first scan of a big history takes a few refreshes).
    pub pending: bool,
    /// [bucket start ms, tokens] for every non-empty 5-minute bucket of the last 8 days.
    pub series: Vec<(i64, u64)>,
    /// The last 7 days by model, most used first.
    pub models: Vec<ModelTokens>,
    pub week: TokenTotals,
    pub scanned_at: i64,
}

pub fn summarize(st: &State, now: i64) -> (Vec<(i64, u64)>, Vec<ModelTokens>, TokenTotals) {
    let mut series = Vec::new();
    let mut by_model: HashMap<String, (u64, u64)> = HashMap::new();
    let mut week = TokenTotals::default();
    for (bucket, models) in st.index.buckets.iter() {
        let mut sum = 0u64;
        for (model, t) in models.iter() {
            sum += t.total();
            if *bucket >= now - WEEK_MS {
                let e = by_model.entry(model.clone()).or_insert((0, 0));
                e.0 += t.total();
                e.1 += t.o;
                week.input += t.i;
                week.output += t.o;
                week.cache_write += t.cw;
                week.cache_read += t.cr;
            }
        }
        if sum > 0 {
            series.push((*bucket, sum));
        }
    }
    week.total = week.input + week.output + week.cache_write;
    let mut models: Vec<ModelTokens> =
        by_model.into_iter().map(|(model, (tokens, output))| ModelTokens { model, tokens, output }).collect();
    models.sort_by(|a, b| b.tokens.cmp(&a.tokens).then_with(|| a.model.cmp(&b.model)));
    (series, models, week)
}

pub fn read() -> SvcResult<ClaudeLocal> {
    let now = util::now_ms();
    let roots: Vec<PathBuf> =
        super::claude::config_dirs().into_iter().map(|d| d.join("projects")).filter(|p| p.is_dir()).collect();
    let mut guard = lock();
    if guard.is_none() {
        *guard = Some(load());
    }
    let st = match guard.as_mut() {
        Some(s) => s,
        None => return Ok(ClaudeLocal::default()),
    };
    let mut files: Vec<PathBuf> = Vec::new();
    for root in roots.iter() {
        collect_files(root, 0, &mut files);
    }
    let mut budget = SCAN_BUDGET;
    let mut last_activity: Option<i64> = None;
    let mut live: HashSet<String> = HashSet::new();
    for f in files.iter() {
        live.insert(f.to_string_lossy().into_owned());
        if let Some(m) = scan_file(st, f, &mut budget, now) {
            last_activity = Some(last_activity.map_or(m, |a| a.max(m)));
        }
    }
    let pending = budget == 0;
    if !pending {
        prune(st, now, &live);
    }
    let due = st.saved_at.map(|t| t.elapsed() >= SAVE_EVERY).unwrap_or(true);
    if st.dirty && due {
        save(st);
    }
    let (series, models, week) = summarize(st, now);
    Ok(ClaudeLocal { found: !roots.is_empty(), last_activity, pending, series, models, week, scanned_at: now })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A timestamp an hour before `now`, so the tests never depend on the build machine's date.
    fn ts(now: i64) -> String {
        chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now - 3_600_000).unwrap().to_rfc3339()
    }

    fn line_at(now: i64, id: &str, req: &str, block: &str, out: u64) -> String {
        let at = ts(now);
        format!(
            r#"{{"type":"assistant","timestamp":"{at}","requestId":"{req}","message":{{"id":"{id}","model":"claude-opus-4-5","content":[{{"type":"{block}"}}],"usage":{{"input_tokens":2,"cache_creation_input_tokens":100,"cache_read_input_tokens":5000,"output_tokens":{out}}}}}}}"#
        )
    }

    #[test]
    fn parses_an_assistant_line() {
        let now = util::now_ms();
        let e = parse_line(&line_at(now, "msg_1", "req_1", "text", 50)).unwrap();
        assert_eq!(e.model, "claude-opus-4-5");
        assert_eq!(e.tok, Tok { i: 2, o: 50, cw: 100, cr: 5000 });
        assert_eq!(e.tok.total(), 152);
        assert!(parse_line(r#"{"type":"user","message":{"content":"hi"}}"#).is_none());
        assert!(parse_line(r#"{"type":"assistant","usage": {"#).is_none()); // partial line
        assert!(parse_line(r#"{"type":"assistant","timestamp":"2026-11-16T10:00:00Z","message":{"id":"x","model":"<synthetic>","usage":{"output_tokens":5}}}"#).is_none());
    }

    #[test]
    fn counts_each_message_once_not_per_content_block() {
        let now = util::now_ms();
        let mut st = State::new();
        let text = [
            line_at(now, "msg_1", "req_1", "thinking", 50),
            line_at(now, "msg_1", "req_1", "text", 50),
            line_at(now, "msg_1", "req_1", "tool_use", 50),
            line_at(now, "msg_2", "req_2", "text", 10),
            String::new(),
        ]
        .join("\n");
        assert!(ingest(&mut st, &text, now));
        let (_, models, week) = summarize(&st, now);
        assert_eq!(week.output, 60);
        assert_eq!(week.input, 4);
        assert_eq!(week.cache_read, 10_000);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].tokens, 152 + 112);
        // Reading the same lines again (e.g. a resumed session copying history) adds nothing.
        assert!(!ingest(&mut st, &text, now));
    }

    #[test]
    fn a_growing_message_adds_only_the_difference() {
        let now = util::now_ms();
        let mut st = State::new();
        ingest(&mut st, &line_at(now, "msg_1", "req_1", "text", 10), now);
        ingest(&mut st, &line_at(now, "msg_1", "req_1", "tool_use", 40), now);
        let (_, _, week) = summarize(&st, now);
        assert_eq!(week.output, 40);
    }

    #[test]
    fn ignores_history_older_than_the_horizon() {
        let now = util::now_ms();
        let mut st = State::new();
        let old = line_at(now - 9 * DAY_MS, "msg_1", "req_1", "text", 10);
        assert!(!ingest(&mut st, &old, now));
    }

    #[test]
    fn reads_only_new_bytes_and_waits_for_partial_lines() {
        let dir = std::env::temp_dir().join(format!("glintbar-ai-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("s.jsonl");
        let now = util::now_ms();
        let first = line_at(now, "msg_1", "req_1", "text", 10);
        let second = line_at(now, "msg_2", "req_2", "text", 20);
        std::fs::write(&path, format!("{first}\n{}", &second[..20])).unwrap();
        let mut st = State::new();
        let mut budget = SCAN_BUDGET;
        scan_file(&mut st, &path, &mut budget, now);
        assert_eq!(summarize(&st, now).2.output, 10);
        std::fs::write(&path, format!("{first}\n{second}\n")).unwrap();
        scan_file(&mut st, &path, &mut budget, now);
        assert_eq!(summarize(&st, now).2.output, 30);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
