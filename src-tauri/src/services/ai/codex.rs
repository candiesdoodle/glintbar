//! ChatGPT: the Codex 5-hour and weekly windows.
//!
//! Local first: every Codex session writes rate-limit snapshots into its rollout files
//! (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl), so the newest snapshot is read from disk. Only
//! when that is older than 20 minutes does GlintBar ask ChatGPT the same question the Codex CLI asks
//! for /status, with the access token Codex saved in ~/.codex/auth.json (read fresh, never stored).
//! The plan and its billing dates come from the claims of Codex's own id token.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::model::{limit, AiLimit, Billing, ToolReading, DAY_MS};
use super::util;
use crate::error::SvcResult;
use crate::registry::run_blocking;
use crate::services::core::http::{fetch, FetchArgs};

const TOOL: &str = "chatgpt";
const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const FRESH_MS: i64 = 20 * 60 * 1000;
const TAIL_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ROLLOUTS: usize = 12;

pub fn codex_home() -> Option<PathBuf> {
    util::env_dir("CODEX_HOME").or_else(|| util::home().map(|h| h.join(".codex")))
}

pub fn plan_label(raw: &str) -> String {
    match raw.trim().to_lowercase().as_str() {
        "plus" => "Plus".to_string(),
        "pro" => "Pro".to_string(),
        "team" => "Team".to_string(),
        "business" => "Business".to_string(),
        "enterprise" => "Enterprise".to_string(),
        "edu" | "education" => "Edu".to_string(),
        "free" => "Free".to_string(),
        other => util::title_case(other),
    }
}

/// What auth.json tells us. The access token stays in memory for one request only.
pub struct Auth {
    pub plan: Option<String>,
    pub billing: Option<Billing>,
    pub access_token: Option<String>,
    pub access_exp: Option<i64>,
    pub account_id: Option<String>,
    pub api_key_only: bool,
}

pub fn parse_auth(v: &Value, now: i64) -> Auth {
    let tokens = &v["tokens"];
    let id_claims = util::str_of(&tokens["id_token"]).and_then(|t| util::jwt_claims(&t));
    let access_token = util::str_of(&tokens["access_token"]);
    let access_exp = access_token.as_deref().and_then(util::jwt_claims).and_then(|c| util::time_ms(&c["exp"]));
    let mut plan = None;
    let mut billing = None;
    let mut account_id = util::str_of(&tokens["account_id"]);
    if let Some(c) = id_claims.as_ref() {
        let a = &c["https://api.openai.com/auth"];
        plan = util::str_of(&a["chatgpt_plan_type"]).map(|p| plan_label(&p));
        if account_id.is_none() {
            account_id = util::str_of(&a["chatgpt_account_id"]);
        }
        let start = util::time_ms(&a["chatgpt_subscription_active_start"]);
        let until = util::time_ms(&a["chatgpt_subscription_active_until"]);
        let paid = plan.as_deref().map(|p| p != "Free").unwrap_or(false);
        let current = until.map(|u| u > now - DAY_MS).unwrap_or(false);
        if paid && current {
            billing = Some(Billing { last_charge: start, next_charge: until, estimated: false, extra_usage: None });
        }
    }
    let has_key = util::str_of(&v["OPENAI_API_KEY"]).is_some();
    Auth { plan, billing, access_exp, account_id, api_key_only: access_token.is_none() && has_key, access_token }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Window {
    pub used_pct: f64,
    pub minutes: Option<i64>,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    /// When the snapshot was taken (unix ms).
    pub at: Option<i64>,
    pub plan: Option<String>,
    pub windows: Vec<Window>,
}

fn window_from(w: &Value, base: Option<i64>, minutes_key: &str, seconds_key: &str) -> Option<Window> {
    let used_pct = util::num(&w["used_percent"])?;
    let minutes =
        util::num(&w[minutes_key]).map(|m| m as i64).or_else(|| util::num(&w[seconds_key]).map(|s| (s as i64) / 60));
    let resets_at = util::time_ms(&w["resets_at"]).or_else(|| util::time_ms(&w["reset_at"])).or_else(|| {
        let secs = util::num(&w["resets_in_seconds"]).or_else(|| util::num(&w["reset_after_seconds"]))?;
        Some(base? + (secs * 1000.0) as i64)
    });
    Some(Window { used_pct, minutes, resets_at })
}

/// A rate_limits object from a rollout line.
pub fn parse_rate_obj(rl: &Value, at: Option<i64>) -> Snapshot {
    let mut windows = Vec::new();
    for key in ["primary", "secondary"].iter() {
        if let Some(w) = window_from(&rl[*key], at, "window_minutes", "window_seconds") {
            windows.push(w);
        }
    }
    Snapshot { at, plan: util::str_of(&rl["plan_type"]).map(|p| plan_label(&p)), windows }
}

/// The rate-limit snapshot in one rollout line, if it has one.
pub fn parse_rate_line(line: &str) -> Option<Snapshot> {
    if !line.contains("rate_limits") {
        return None;
    }
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let at = util::time_ms(&v["timestamp"]);
    let candidates: [&Value; 4] = [
        &v["payload"]["rate_limits"],
        &v["payload"]["info"]["rate_limits"],
        &v["rate_limits"],
        &v["msg"]["rate_limits"],
    ];
    for rl in candidates.iter() {
        if rl.is_object() {
            let s = parse_rate_obj(rl, at);
            if !s.windows.is_empty() {
                return Some(s);
            }
        }
    }
    None
}

/// The answer of ChatGPT's usage endpoint (what Codex's /status shows).
pub fn parse_live(v: &Value, now: i64) -> Snapshot {
    let rl = &v["rate_limit"];
    let mut windows = Vec::new();
    for key in ["primary_window", "secondary_window"].iter() {
        if let Some(w) = window_from(&rl[*key], Some(now), "window_minutes", "limit_window_seconds") {
            windows.push(w);
        }
    }
    Snapshot { at: Some(now), plan: util::str_of(&v["plan_type"]).map(|p| plan_label(&p)), windows }
}

/// Snapshot windows -> the shared limit model. A window whose reset time has passed has started
/// over, so it reads 0 % until Codex is used again.
pub fn to_limits(s: &Snapshot, now: i64) -> Vec<AiLimit> {
    let mut out = Vec::new();
    for (i, w) in s.windows.iter().enumerate() {
        let minutes = w.minutes.unwrap_or(if i == 0 { 300 } else { 10_080 });
        let (window, label) = if minutes <= 24 * 60 {
            (
                "session".to_string(),
                if minutes == 300 { "5-hour".to_string() } else { format!("{}h", (minutes + 30) / 60) },
            )
        } else if minutes >= 6 * 24 * 60 {
            ("weekly".to_string(), "Week".to_string())
        } else {
            (format!("window_{minutes}"), format!("{}d", (minutes + 720) / 1440))
        };
        let window_ms = Some(minutes * 60_000);
        match w.resets_at {
            Some(r) if r <= now => out.push(limit(TOOL, &window, &label, 0.0, None, window_ms)),
            other => out.push(limit(TOOL, &window, &label, w.used_pct, other, window_ms)),
        }
    }
    out
}

fn sorted_children(dir: &Path, dirs: bool) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .flatten()
            .map(|e| e.path())
            .filter(
                |p| if dirs { p.is_dir() } else { p.is_file() && p.extension().map(|x| x == "jsonl").unwrap_or(false) },
            )
            .collect(),
        Err(_) => Vec::new(),
    };
    out.sort();
    out.reverse();
    out
}

/// The newest rollout files, newest first (sessions/YYYY/MM/DD, plus loose files of old versions).
fn newest_rollouts(home: &Path) -> Vec<PathBuf> {
    let sessions = home.join("sessions");
    let mut out: Vec<PathBuf> = Vec::new();
    'outer: for year in sorted_children(&sessions, true) {
        for month in sorted_children(&year, true) {
            for day in sorted_children(&month, true) {
                let mut files: Vec<(i64, PathBuf)> = sorted_children(&day, false)
                    .into_iter()
                    .map(|p| (std::fs::metadata(&p).ok().and_then(|m| util::mtime_ms(&m)).unwrap_or(0), p))
                    .collect();
                files.sort_by(|a, b| b.0.cmp(&a.0));
                for (_, f) in files {
                    out.push(f);
                    if out.len() >= MAX_ROLLOUTS {
                        break 'outer;
                    }
                }
            }
        }
    }
    if out.len() < MAX_ROLLOUTS {
        for f in sorted_children(&sessions, false).into_iter().take(MAX_ROLLOUTS - out.len()) {
            out.push(f);
        }
    }
    out
}

fn latest_snapshot(home: &Path) -> Option<Snapshot> {
    for path in newest_rollouts(home) {
        let text = match util::read_tail(&path, TAIL_BYTES) {
            Ok(t) => t,
            Err(_) => continue,
        };
        for line in text.lines().rev() {
            if let Some(s) = parse_rate_line(line) {
                return Some(s);
            }
        }
    }
    None
}

struct Local {
    installed: bool,
    auth: Option<Auth>,
    snapshot: Option<Snapshot>,
}

fn read_local(now: i64) -> Local {
    let home = match codex_home() {
        Some(h) if h.is_dir() => h,
        _ => return Local { installed: false, auth: None, snapshot: None },
    };
    let auth = match util::read_json(&home.join("auth.json")) {
        Ok(Some(v)) => Some(parse_auth(&v, now)),
        _ => None,
    };
    Local { installed: true, auth, snapshot: latest_snapshot(&home) }
}

async fn live(auth: &Auth, now: i64) -> Option<Snapshot> {
    let token = auth.access_token.as_ref()?;
    if auth.access_exp.map(|e| e <= now + 60_000).unwrap_or(false) {
        return None; // Codex renews it itself the next time it runs
    }
    let mut headers: HashMap<String, String> = HashMap::new();
    headers.insert("Authorization".to_string(), format!("Bearer {token}"));
    headers.insert("Accept".to_string(), "application/json".to_string());
    if let Some(id) = auth.account_id.as_ref() {
        headers.insert("ChatGPT-Account-Id".to_string(), id.clone());
    }
    let args = FetchArgs {
        url: USAGE_URL.to_string(),
        method: Some("GET".to_string()),
        headers,
        body: None,
        body_base64: None,
        timeout_ms: Some(15_000),
        response_type: None,
        max_bytes: Some(512 * 1024),
    };
    let resp = fetch(args).await.ok()?;
    if !resp.ok {
        return None;
    }
    let v: Value = serde_json::from_str(&resp.body).ok()?;
    let s = parse_live(&v, now);
    if s.windows.is_empty() {
        None
    } else {
        Some(s)
    }
}

pub async fn usage() -> SvcResult<ToolReading> {
    let now = util::now_ms();
    let local = run_blocking(move || Ok(read_local(now))).await?;
    if !local.installed {
        return Ok(ToolReading::new(
            TOOL,
            "not_installed",
            Some("The Codex CLI wasn't found on this PC. Add it with npm install -g @openai/codex, then type codex login and use your ChatGPT account."),
        ));
    }
    let auth = match local.auth {
        Some(a) => a,
        None => {
            return Ok(ToolReading::new(
                TOOL,
                "signed_out",
                Some("Codex has no login yet. Type codex login, pick Sign in with ChatGPT, then click Check again."),
            ))
        }
    };
    if auth.api_key_only {
        return Ok(ToolReading::new(
            TOOL,
            "signed_out",
            Some("Codex is using an API key, and API keys carry no plan limits. Type codex login and pick Sign in with ChatGPT instead."),
        ));
    }
    let mut snapshot = local.snapshot;
    let mut source = "local";
    let fresh = snapshot.as_ref().and_then(|s| s.at).map(|at| now - at < FRESH_MS).unwrap_or(false);
    if !fresh {
        if let Some(s) = live(&auth, now).await {
            snapshot = Some(s);
            source = "live";
        }
    }
    let mut r = ToolReading::new(TOOL, "ok", None);
    r.billing = auth.billing.clone();
    r.plan = auth.plan.clone();
    match snapshot {
        Some(s) => {
            r.limits = to_limits(&s, now);
            if s.plan.is_some() {
                r.plan = s.plan.clone();
            }
            r.as_of = s.at;
            r.source = source.to_string();
        }
        None => {
            let expired = auth.access_exp.map(|e| e <= now).unwrap_or(false);
            if expired {
                r.status = "expired".to_string();
                r.message = Some("The Codex login is out of date. Type codex login once more, then click Check again.".to_string());
            } else {
                r.message =
                    Some("No Codex limits on record yet. They show up after you next use Codex.".to_string());
            }
        }
    }
    Ok(r.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const LINE: &str = r#"{"timestamp":"2026-10-26T17:13:37.308Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":3}},"rate_limits":{"limit_id":"codex","primary":{"used_percent":2,"window_minutes":300,"resets_at":1793048821},"secondary":{"used_percent":40.5,"window_minutes":10080,"resets_at":1793635621},"plan_type":"plus"}}}"#;

    #[test]
    fn reads_a_rollout_snapshot() {
        let s = parse_rate_line(LINE).unwrap();
        assert_eq!(s.windows.len(), 2);
        assert_eq!(s.windows[0], Window { used_pct: 2.0, minutes: Some(300), resets_at: Some(1_793_048_821_000) });
        assert_eq!(s.plan.as_deref(), Some("Plus"));
        let now = 1_793_040_000_000;
        let limits = to_limits(&s, now);
        assert_eq!(limits[0].window, "session");
        assert_eq!(limits[0].label, "5-hour");
        assert_eq!(limits[1].window, "weekly");
        assert_eq!(limits[1].used_pct, 40.5);
        assert!(parse_rate_line(r#"{"type":"event_msg","payload":{"rate_limits":null}}"#).is_none());
        assert!(parse_rate_line("{broken rate_limits").is_none());
    }

    #[test]
    fn a_passed_reset_reads_zero() {
        let s = parse_rate_line(LINE).unwrap();
        let limits = to_limits(&s, 1_793_100_000_000);
        assert_eq!(limits[0].used_pct, 0.0);
        assert_eq!(limits[0].resets_at, None);
        assert_eq!(limits[1].used_pct, 40.5);
    }

    #[test]
    fn older_snapshots_use_relative_resets() {
        let line = r#"{"timestamp":"2026-10-26T17:00:00Z","payload":{"rate_limits":{"primary":{"used_percent":10,"window_minutes":300,"resets_in_seconds":600}}}}"#;
        let s = parse_rate_line(line).unwrap();
        let at = util::parse_time_str("2026-10-26T17:00:00Z").unwrap();
        assert_eq!(s.windows[0].resets_at, Some(at + 600_000));
    }

    #[test]
    fn reads_the_live_answer() {
        let v = json!({"plan_type": "pro", "rate_limit": {"primary_window": {"used_percent": 12, "limit_window_seconds": 18000, "reset_after_seconds": 3600}, "secondary_window": {"used_percent": 30, "limit_window_seconds": 604800, "reset_at": 1793635621}}});
        let s = parse_live(&v, 1_000_000);
        assert_eq!(s.windows[0].minutes, Some(300));
        assert_eq!(s.windows[0].resets_at, Some(1_000_000 + 3_600_000));
        assert_eq!(s.windows[1].minutes, Some(10_080));
        assert_eq!(s.plan.as_deref(), Some("Pro"));
    }

    #[test]
    fn reads_plan_and_billing_from_the_id_token() {
        // payload: {"https://api.openai.com/auth":{"chatgpt_plan_type":"plus","chatgpt_subscription_active_start":"2026-10-04T00:00:00Z","chatgpt_subscription_active_until":"2026-12-04T00:00:00Z","chatgpt_account_id":"acc"}}
        let payload = r#"{"https://api.openai.com/auth":{"chatgpt_plan_type":"plus","chatgpt_subscription_active_start":"2026-10-04T00:00:00Z","chatgpt_subscription_active_until":"2026-12-04T00:00:00Z","chatgpt_account_id":"acc"}}"#;
        use base64::Engine;
        let enc = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.as_bytes());
        let token = format!("e30.{enc}.sig");
        let v = json!({"tokens": {"id_token": token, "access_token": "not-a-jwt"}});
        let now = util::parse_time_str("2026-11-16T00:00:00Z").unwrap();
        let a = parse_auth(&v, now);
        assert_eq!(a.plan.as_deref(), Some("Plus"));
        assert_eq!(a.account_id.as_deref(), Some("acc"));
        let b = a.billing.unwrap();
        assert_eq!(b.next_charge, util::parse_time_str("2026-12-04T00:00:00Z"));
        assert!(!a.api_key_only);
        let k = parse_auth(&json!({"OPENAI_API_KEY": "sk-x"}), now);
        assert!(k.api_key_only);
    }
}
