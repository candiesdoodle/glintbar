//! Claude: the session (5-hour) and weekly limits, read with the sign-in Claude Code saved on this
//! PC (~/.claude/.credentials.json). The file is only read, fresh on every call; the token is kept
//! in memory for the one request and never logged or stored. An expired sign-in is reported as
//! such (Claude Code renews it itself the next time it runs) - GlintBar never refreshes it, because a
//! refresh would rotate the token behind Claude Code's back.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::model::{limit, AiLimit, Billing, ToolReading, DAY_MS, HOUR_MS};
use super::util;
use crate::error::{SvcError, SvcResult};
use crate::registry::run_blocking;
use crate::services::core::http::{fetch, FetchArgs};

const TOOL: &str = "claude";
const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const PROFILE_URL: &str = "https://api.anthropic.com/api/oauth/profile";
const OAUTH_BETA: &str = "oauth-2025-04-20";
const PROFILE_TTL: Duration = Duration::from_secs(6 * 3600);

const EXPIRED: &str =
    "The Claude Code login is out of date. Start Claude Code once to renew it; GlintBar uses the new one on its next refresh.";
const SIGNED_OUT: &str = "No Claude Code login found. Start claude from a terminal, log in, then use Check again.";
const NOT_INSTALLED: &str =
    "Claude Code wasn't found on this PC. Install it, log in through claude, then use Check again.";

/// Claude Code's config folders: CLAUDE_CONFIG_DIR (comma-separated) or ~/.claude and ~/.config/claude.
pub fn config_dirs() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Ok(v) = std::env::var("CLAUDE_CONFIG_DIR") {
        for part in v.split(',') {
            let p = part.trim();
            if !p.is_empty() {
                out.push(PathBuf::from(p));
            }
        }
    }
    if let Some(h) = util::home() {
        out.push(h.join(".claude"));
        out.push(h.join(".config").join("claude"));
    }
    out.dedup();
    out
}

/// The sign-in, held only for one request. Deliberately no Debug/Serialize.
struct Creds {
    token: String,
    expires_at: Option<i64>,
    plan: Option<String>,
}

enum CredState {
    Missing { installed: bool },
    Unreadable,
    Found(Creds),
}

fn read_creds() -> CredState {
    let mut installed = false;
    for dir in config_dirs() {
        if dir.is_dir() {
            installed = true;
        }
        match util::read_json(&dir.join(".credentials.json")) {
            Ok(Some(v)) => {
                let o = &v["claudeAiOauth"];
                if let Some(token) = util::str_of(&o["accessToken"]) {
                    return CredState::Found(Creds {
                        token,
                        expires_at: util::time_ms(&o["expiresAt"]),
                        plan: plan_name(o["subscriptionType"].as_str(), o["rateLimitTier"].as_str()),
                    });
                }
            }
            Ok(None) => {}
            Err(_) => return CredState::Unreadable,
        }
    }
    CredState::Missing { installed }
}

/// "max" + "default_claude_max_20x" -> "Max 20x"; "pro" -> "Pro".
pub fn plan_name(subscription: Option<&str>, tier: Option<&str>) -> Option<String> {
    let sub = subscription.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty())?;
    let sub = sub.trim_start_matches("claude_").to_string();
    let tier = tier.unwrap_or("").to_lowercase();
    if sub == "max" {
        if tier.contains("20x") {
            return Some("Max 20x".to_string());
        }
        if tier.contains("5x") {
            return Some("Max 5x".to_string());
        }
    }
    Some(util::title_case(&sub))
}

/// Parses the usage answer: the windows that are present, and whether extra usage is on.
pub fn parse_usage(v: &Value) -> (Vec<AiLimit>, Option<bool>) {
    let windows: [(&str, &str, &str, i64, bool); 4] = [
        ("five_hour", "session", "Session", 5 * HOUR_MS, true),
        ("seven_day", "weekly", "Week", 7 * DAY_MS, true),
        ("seven_day_opus", "weekly_opus", "Opus week", 7 * DAY_MS, false),
        ("seven_day_sonnet", "weekly_sonnet", "Sonnet week", 7 * DAY_MS, false),
    ];
    let mut out = Vec::new();
    if !v.is_object() {
        return (out, None);
    }
    for (key, window, label, ms, always) in windows.iter() {
        let w = &v[*key];
        let resets = util::time_ms(&w["resets_at"]);
        match util::num(&w["utilization"]) {
            Some(u) => {
                // Model-specific weeks only matter once they have been used.
                if *always || u > 0.0 || resets.is_some() {
                    out.push(limit(TOOL, window, label, u, resets, Some(*ms)));
                }
            }
            None => {
                if *always && (w.is_null() || w.is_object()) && v.get(*key).is_some() {
                    // Present but not started: nothing used in this window yet.
                    out.push(limit(TOOL, window, label, 0.0, None, Some(*ms)));
                }
            }
        }
    }
    let extra = &v["extra_usage"];
    let enabled = extra["is_enabled"].as_bool();
    if enabled == Some(true) {
        if let Some(u) = util::num(&extra["utilization"]) {
            out.push(limit(TOOL, "extra", "Extra usage", u, None, None));
        }
    }
    (out, enabled)
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Profile {
    pub subscribed_at: Option<i64>,
    pub extra_usage: Option<bool>,
}

pub fn parse_profile(v: &Value) -> Profile {
    let org = &v["organization"];
    Profile {
        subscribed_at: util::time_ms(&org["subscription_created_at"]),
        extra_usage: org["has_extra_usage_enabled"].as_bool(),
    }
}

/// Monthly charge dates worked out from the day the plan started: (last, next), both unix ms.
pub fn charge_dates(subscribed_at: i64, now: i64) -> Option<(i64, i64)> {
    use chrono::{DateTime, Months, Utc};
    if subscribed_at > now {
        return None;
    }
    let start = DateTime::<Utc>::from_timestamp_millis(subscribed_at)?;
    let mut last = start;
    for n in 1..=1200u32 {
        let next = start.checked_add_months(Months::new(n))?;
        if next.timestamp_millis() > now {
            return Some((last.timestamp_millis(), next.timestamp_millis()));
        }
        last = next;
    }
    None
}

fn get_args(url: &str, token: &str) -> FetchArgs {
    let mut headers: HashMap<String, String> = HashMap::new();
    headers.insert("Authorization".to_string(), format!("Bearer {token}"));
    headers.insert("anthropic-beta".to_string(), OAUTH_BETA.to_string());
    headers.insert("Accept".to_string(), "application/json".to_string());
    FetchArgs {
        url: url.to_string(),
        method: Some("GET".to_string()),
        headers,
        body: None,
        body_base64: None,
        timeout_ms: Some(15_000),
        response_type: None,
        max_bytes: Some(512 * 1024),
    }
}

static PROFILE: Mutex<Option<(Instant, Profile)>> = Mutex::new(None);

/// Sync helpers so no lock guard ever lives inside the async handler.
fn cached_profile() -> Option<Profile> {
    let guard = PROFILE.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        Some((at, p)) if at.elapsed() < PROFILE_TTL => Some(p.clone()),
        _ => None,
    }
}

fn remember_profile(p: &Profile) {
    let mut guard = PROFILE.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some((Instant::now(), p.clone()));
}

/// Best effort, cached for hours: the plan's start date (for charge dates) and extra usage.
async fn profile(token: &str) -> Option<Profile> {
    if let Some(p) = cached_profile() {
        return Some(p);
    }
    let resp = fetch(get_args(PROFILE_URL, token)).await.ok()?;
    if !resp.ok {
        return None;
    }
    let v: Value = serde_json::from_str(&resp.body).ok()?;
    let p = parse_profile(&v);
    remember_profile(&p);
    Some(p)
}

pub async fn usage() -> SvcResult<ToolReading> {
    let state = run_blocking(|| Ok(read_creds())).await?;
    let creds = match state {
        CredState::Missing { installed: true } => return Ok(ToolReading::new(TOOL, "signed_out", Some(SIGNED_OUT))),
        CredState::Missing { installed: false } => {
            return Ok(ToolReading::new(TOOL, "not_installed", Some(NOT_INSTALLED)))
        }
        CredState::Unreadable => {
            return Ok(ToolReading::new(
                TOOL,
                "signed_out",
                Some("GlintBar couldn't open the Claude Code login file. Log in again through claude."),
            ))
        }
        CredState::Found(c) => c,
    };
    let now = util::now_ms();
    if creds.expires_at.map(|e| e <= now).unwrap_or(false) {
        let mut r = ToolReading::new(TOOL, "expired", Some(EXPIRED));
        r.plan = creds.plan;
        return Ok(r);
    }
    let resp = fetch(get_args(USAGE_URL, &creds.token)).await?;
    if resp.status == 401 || resp.status == 403 {
        let mut r = ToolReading::new(TOOL, "expired", Some(EXPIRED));
        r.plan = creds.plan;
        return Ok(r);
    }
    if !resp.ok {
        return Err(util::http_status_error("Claude", resp.status));
    }
    let v: Value =
        serde_json::from_str(&resp.body).map_err(|_| SvcError::Http("Claude's reply wasn't in the expected format".to_string()))?;
    let (limits, extra) = parse_usage(&v);
    if limits.is_empty() {
        return Err(SvcError::Http("Claude's reply had no limits in it".to_string()));
    }
    let mut r = ToolReading::new(TOOL, "ok", None);
    r.limits = limits;
    r.plan = creds.plan.clone();
    r.source = "live".to_string();
    r.as_of = Some(now);

    let prof = profile(&creds.token).await;
    let mut billing =
        Billing { extra_usage: extra.or(prof.as_ref().and_then(|p| p.extra_usage)), ..Billing::default() };
    if let Some(at) = prof.as_ref().and_then(|p| p.subscribed_at) {
        if let Some((last, next)) = charge_dates(at, now) {
            billing.last_charge = Some(last);
            billing.next_charge = Some(next);
            billing.estimated = true;
        }
    }
    if billing != Billing::default() {
        r.billing = Some(billing);
    }
    Ok(r.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn names_plans() {
        assert_eq!(plan_name(Some("max"), Some("default_claude_max_20x")), Some("Max 20x".to_string()));
        assert_eq!(plan_name(Some("max"), Some("default_claude_max_5x")), Some("Max 5x".to_string()));
        assert_eq!(plan_name(Some("pro"), None), Some("Pro".to_string()));
        assert_eq!(plan_name(Some(""), None), None);
        assert_eq!(plan_name(None, None), None);
    }

    #[test]
    fn parses_usage_windows() {
        let v = json!({
            "five_hour": {"utilization": 37.0, "resets_at": "2026-11-16T15:00:00+00:00"},
            "seven_day": {"utilization": 12.5, "resets_at": "2026-11-20T09:00:00Z"},
            "seven_day_opus": {"utilization": 0.0, "resets_at": null},
            "seven_day_sonnet": null,
            "extra_usage": {"is_enabled": true, "utilization": 4.0}
        });
        let (limits, extra) = parse_usage(&v);
        assert_eq!(extra, Some(true));
        let windows: Vec<&str> = limits.iter().map(|l| l.window.as_str()).collect();
        assert_eq!(windows, vec!["session", "weekly", "extra"]);
        assert_eq!(limits[0].used_pct, 37.0);
        assert_eq!(limits[0].window_ms, Some(5 * HOUR_MS));
        assert!(limits[0].resets_at.is_some());
    }

    #[test]
    fn unstarted_session_is_zero() {
        let v = json!({"five_hour": null, "seven_day": {"utilization": 3, "resets_at": null}});
        let (limits, extra) = parse_usage(&v);
        assert_eq!(extra, None);
        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].used_pct, 0.0);
        assert_eq!(limits[0].resets_at, None);
        assert_eq!(parse_usage(&json!("nope")).0.len(), 0);
    }

    #[test]
    fn works_out_charge_dates() {
        let start = util::parse_time_str("2026-01-31T10:00:00Z").unwrap();
        let now = util::parse_time_str("2026-11-16T10:00:00Z").unwrap();
        let (last, next) = charge_dates(start, now).unwrap();
        assert_eq!(last, util::parse_time_str("2026-10-31T10:00:00Z").unwrap());
        assert_eq!(next, util::parse_time_str("2026-11-30T10:00:00Z").unwrap());
        assert_eq!(charge_dates(now + 1, now), None);
    }

    #[test]
    fn parses_profile() {
        let p = parse_profile(
            &json!({"organization": {"subscription_created_at": "2026-01-31T10:00:00Z", "has_extra_usage_enabled": false}}),
        );
        assert_eq!(p.extra_usage, Some(false));
        assert!(p.subscribed_at.is_some());
        assert_eq!(parse_profile(&json!({})), Profile::default());
    }
}
