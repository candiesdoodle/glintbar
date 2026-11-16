//! OpenCode: tokens for the current session and the week, and the top model, from OpenCode's own
//! history on this PC - read offline, read-only. Current OpenCode keeps it in a SQLite database
//! (~/.local/share/opencode/opencode.db); older versions wrote one JSON file per message
//! (storage/message/<session>/<message>.json). Both are understood.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use super::model::{DAY_MS, HOUR_MS};
use super::util;
use crate::error::{SvcError, SvcResult};

const WEEK_MS: i64 = 7 * DAY_MS;
const MAX_ROWS: i64 = 100_000;
const MAX_FILES: usize = 20_000;

pub fn data_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(x) = util::env_dir("XDG_DATA_HOME") {
        out.push(x.join("opencode"));
    }
    if let Some(h) = util::home() {
        out.push(h.join(".local").join("share").join("opencode"));
    }
    if let Some(l) = util::env_dir("LOCALAPPDATA") {
        out.push(l.join("opencode"));
    }
    if let Some(a) = util::env_dir("APPDATA") {
        out.push(a.join("opencode"));
    }
    out
}

#[derive(Serialize, Default, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OcTok {
    pub input: u64,
    pub output: u64,
    pub reasoning: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

impl OcTok {
    /// input + output + reasoning (cache reads and writes are shown on their own).
    pub fn total(&self) -> u64 {
        self.input + self.output + self.reasoning
    }
    fn add(&mut self, b: &OcTok) {
        self.input += b.input;
        self.output += b.output;
        self.reasoning += b.reasoning;
        self.cache_read += b.cache_read;
        self.cache_write += b.cache_write;
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct OcMsg {
    pub session: String,
    pub parent: Option<String>,
    pub title: Option<String>,
    pub at: i64,
    pub model: String,
    pub tok: OcTok,
    pub cost: f64,
}

fn u(v: &Value) -> u64 {
    util::num(v).map(|n| if n > 0.0 { n as u64 } else { 0 }).unwrap_or(0)
}

/// One message's JSON -> (model, tokens, cost, created) for assistant messages.
pub fn parse_message(data: &str) -> Option<(String, OcTok, f64, Option<i64>)> {
    let v: Value = serde_json::from_str(data).ok()?;
    if v["role"].as_str() != Some("assistant") {
        return None;
    }
    let t = &v["tokens"];
    let tok = OcTok {
        input: u(&t["input"]),
        output: u(&t["output"]),
        reasoning: u(&t["reasoning"]),
        cache_read: u(&t["cache"]["read"]),
        cache_write: u(&t["cache"]["write"]),
    };
    let model = util::str_of(&v["modelID"]).unwrap_or_else(|| "unknown".to_string());
    let cost = util::num(&v["cost"]).filter(|c| c.is_finite() && *c > 0.0).unwrap_or(0.0);
    Some((model, tok, cost, util::time_ms(&v["time"]["created"])))
}

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub tokens: OcTok,
    pub total: u64,
    pub cost: f64,
    pub messages: u32,
}

impl Totals {
    fn add(&mut self, m: &OcMsg) {
        self.tokens.add(&m.tok);
        self.total = self.tokens.total();
        self.cost += m.cost;
        self.messages += 1;
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsage {
    pub id: String,
    pub title: Option<String>,
    pub usage: Totals,
    pub model: Option<String>,
    pub started: i64,
    pub updated: i64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub total: u64,
    pub cost: f64,
}

/// Result of `ai.opencode_usage`.
#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeUsage {
    /// ok | not_installed | unavailable
    pub status: String,
    pub message: Option<String>,
    pub session: Option<SessionUsage>,
    pub week: Totals,
    pub models: Vec<ModelUsage>,
    /// [hour start ms, tokens] for every non-empty hour of the last 7 days.
    pub series: Vec<(i64, u64)>,
    pub last_activity: Option<i64>,
    pub fetched_at: i64,
}

fn most_used(by_model: HashMap<String, (u64, f64)>) -> Vec<ModelUsage> {
    let mut models: Vec<ModelUsage> =
        by_model.into_iter().map(|(model, (total, cost))| ModelUsage { model, total, cost }).collect();
    models.sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.model.cmp(&b.model)));
    models
}

/// The pure part: messages of the last week -> session, week, models, hourly series.
pub fn aggregate(msgs: &[OcMsg], now: i64) -> OpenCodeUsage {
    let mut out = OpenCodeUsage { status: "ok".to_string(), fetched_at: now, ..OpenCodeUsage::default() };
    let mut by_model: HashMap<String, (u64, f64)> = HashMap::new();
    let mut hours: HashMap<i64, u64> = HashMap::new();
    // A sub-agent's session rolls up into the session that started it.
    let root_of = |m: &OcMsg| m.parent.clone().unwrap_or_else(|| m.session.clone());
    let mut latest: Option<(i64, String)> = None;
    let mut titles: HashMap<String, String> = HashMap::new();
    for m in msgs.iter() {
        if m.at < now - WEEK_MS {
            continue;
        }
        out.week.add(m);
        let e = by_model.entry(m.model.clone()).or_insert((0, 0.0));
        e.0 += m.tok.total();
        e.1 += m.cost;
        if m.tok.total() > 0 {
            *hours.entry(m.at - m.at.rem_euclid(HOUR_MS)).or_insert(0) += m.tok.total();
        }
        if m.parent.is_none() {
            if let Some(t) = m.title.as_ref() {
                titles.insert(m.session.clone(), t.clone());
            }
        }
        let root = root_of(m);
        if latest.as_ref().map(|(at, _)| m.at >= *at).unwrap_or(true) {
            latest = Some((m.at, root));
        }
        out.last_activity = Some(out.last_activity.map_or(m.at, |a| a.max(m.at)));
    }
    if let Some((_, root)) = latest {
        let mut usage = Totals::default();
        let mut session_models: HashMap<String, (u64, f64)> = HashMap::new();
        let mut started = i64::MAX;
        let mut updated = 0i64;
        for m in msgs.iter().filter(|m| root_of(*m) == root) {
            usage.add(m);
            let e = session_models.entry(m.model.clone()).or_insert((0, 0.0));
            e.0 += m.tok.total();
            e.1 += m.cost;
            started = started.min(m.at);
            updated = updated.max(m.at);
        }
        let model = most_used(session_models).into_iter().next().map(|m| m.model);
        out.session =
            Some(SessionUsage { title: titles.get(&root).cloned(), id: root, usage, model, started, updated });
    }
    out.models = most_used(by_model);
    let mut series: Vec<(i64, u64)> = hours.into_iter().collect();
    series.sort();
    out.series = series;
    out
}

fn db_err(e: rusqlite::Error) -> SvcError {
    SvcError::Io(format!("OpenCode history database error: {e}"))
}

fn read_db(path: &Path, since: i64) -> SvcResult<Vec<OcMsg>> {
    use rusqlite::{Connection, OpenFlags};
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(db_err)?;
    let _ = conn.busy_timeout(Duration::from_millis(1500));
    let mut stmt = conn
        .prepare(
            "SELECT m.session_id, m.time_created, m.data, s.parent_id, s.title \
             FROM message m LEFT JOIN session s ON s.id = m.session_id \
             WHERE m.time_created >= ?1 ORDER BY m.time_created DESC LIMIT ?2",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([since, MAX_ROWS], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        let (session, created, data, parent, title) = match row {
            Ok(r) => r,
            Err(_) => continue,
        };
        if let Some((model, tok, cost, at)) = parse_message(&data) {
            out.push(OcMsg { session, parent, title, at: at.unwrap_or(created), model, tok, cost });
        }
    }
    Ok(out)
}

/// Older OpenCode: storage/message/<session>/<message>.json (and storage/session/*/<id>.json).
fn read_files(dir: &Path, since: i64) -> Vec<OcMsg> {
    let mut out = Vec::new();
    let mut parents: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
    if let Ok(projects) = std::fs::read_dir(dir.join("session")) {
        for p in projects.flatten() {
            if let Ok(files) = std::fs::read_dir(p.path()) {
                for f in files.flatten() {
                    if let Ok(Some(v)) = util::read_json(&f.path()) {
                        if let Some(id) = util::str_of(&v["id"]) {
                            parents.insert(id, (util::str_of(&v["parentID"]), util::str_of(&v["title"])));
                        }
                    }
                }
            }
        }
    }
    let sessions = match std::fs::read_dir(dir.join("message")) {
        Ok(rd) => rd,
        Err(_) => return out,
    };
    let mut count = 0usize;
    for s in sessions.flatten() {
        let recent = s.metadata().ok().and_then(|m| util::mtime_ms(&m)).map(|t| t >= since).unwrap_or(false);
        if !recent {
            continue;
        }
        let session = s.file_name().to_string_lossy().into_owned();
        let (parent, title) = parents.get(&session).cloned().unwrap_or((None, None));
        let files = match std::fs::read_dir(s.path()) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for f in files.flatten() {
            count += 1;
            if count > MAX_FILES {
                return out;
            }
            let text = match util::read_capped(&f.path(), 256 * 1024) {
                Ok(t) => t,
                Err(_) => continue,
            };
            if let Some((model, tok, cost, at)) = parse_message(&text) {
                let at = at.unwrap_or(0);
                if at >= since {
                    out.push(OcMsg {
                        session: session.clone(),
                        parent: parent.clone(),
                        title: title.clone(),
                        at,
                        model,
                        tok,
                        cost,
                    });
                }
            }
        }
    }
    out
}

pub fn usage() -> SvcResult<OpenCodeUsage> {
    let now = util::now_ms();
    let since = now - WEEK_MS;
    let dir = match data_dirs().into_iter().find(|d| d.join("opencode.db").is_file() || d.join("storage").is_dir()) {
        Some(d) => d,
        None => {
            return Ok(OpenCodeUsage {
                status: "not_installed".to_string(),
                message: Some(
                    "OpenCode hasn't left any history on this PC yet. Start opencode once, then click Check again.".to_string(),
                ),
                fetched_at: now,
                ..OpenCodeUsage::default()
            })
        }
    };
    let db = dir.join("opencode.db");
    let msgs = if db.is_file() {
        match read_db(&db, since) {
            Ok(m) => m,
            Err(e) => {
                tracing::debug!("opencode db: {e}");
                return Ok(OpenCodeUsage {
                    status: "unavailable".to_string(),
                    message: Some(
                        "GlintBar can't read the history format used by this OpenCode version yet.".to_string(),
                    ),
                    fetched_at: now,
                    ..OpenCodeUsage::default()
                });
            }
        }
    } else {
        read_files(&dir.join("storage"), since)
    };
    let mut out = aggregate(&msgs, now);
    if msgs.is_empty() {
        out.message = Some("No OpenCode use over the past 7 days.".to_string());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(session: &str, parent: Option<&str>, at: i64, model: &str, out: u64) -> OcMsg {
        OcMsg {
            session: session.to_string(),
            parent: parent.map(|p| p.to_string()),
            title: Some(format!("title {session}")),
            at,
            model: model.to_string(),
            tok: OcTok { input: 100, output: out, reasoning: 0, cache_read: 1000, cache_write: 0 },
            cost: 0.01,
        }
    }

    #[test]
    fn parses_assistant_messages_only() {
        let a = r#"{"role":"assistant","modelID":"claude-sonnet-4-5","cost":0.02,"tokens":{"input":10,"output":5,"reasoning":1,"cache":{"read":100,"write":2}},"time":{"created":1789913828543}}"#;
        let (model, tok, cost, at) = parse_message(a).unwrap();
        assert_eq!(model, "claude-sonnet-4-5");
        assert_eq!(tok.total(), 16);
        assert_eq!(tok.cache_write, 2);
        assert_eq!(cost, 0.02);
        assert_eq!(at, Some(1_789_913_828_543));
        assert!(parse_message(r#"{"role":"user"}"#).is_none());
        assert!(parse_message("{nope").is_none());
    }

    #[test]
    fn rolls_sub_agents_into_the_current_session() {
        let now = 10 * DAY_MS;
        let msgs = vec![
            msg("old", None, now - 8 * DAY_MS, "a", 1000),
            msg("s1", None, now - 3 * HOUR_MS, "a", 10),
            msg("s2", None, now - 2 * HOUR_MS, "b", 20),
            msg("s2-child", Some("s2"), now - HOUR_MS, "c", 500),
        ];
        let u = aggregate(&msgs, now);
        let s = u.session.unwrap();
        assert_eq!(s.id, "s2");
        assert_eq!(s.title.as_deref(), Some("title s2"));
        assert_eq!(s.usage.messages, 2);
        assert_eq!(s.usage.total, 120 + 600);
        assert_eq!(s.model.as_deref(), Some("c"));
        assert_eq!(u.week.messages, 3);
        assert_eq!(u.models[0].model, "c");
        assert_eq!(u.series.len(), 3);
        assert_eq!(u.last_activity, Some(now - HOUR_MS));
    }

    #[test]
    fn an_empty_week_has_no_session() {
        let u = aggregate(&[], 1000);
        assert!(u.session.is_none());
        assert_eq!(u.week.total, 0);
    }
}
