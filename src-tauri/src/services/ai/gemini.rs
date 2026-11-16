//! Gemini: the daily Pro and Flash quota, asked the way the Gemini CLI asks for /stats.
//!
//! Reads the Google sign-in the Gemini CLI saved (~/.gemini/oauth_creds.json) fresh on every call;
//! the file is never changed and the token is never stored. An expired token is reported - the
//! CLI renews it itself the next time it runs. Antigravity's own quota panel talks to a server
//! inside the running app with no public interface, so it is detected but not read (yet).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::model::{limit, AiLimit, ToolReading, DAY_MS};
use super::util;
use crate::error::{SvcError, SvcResult};
use crate::registry::run_blocking;
use crate::services::core::http::{fetch, FetchArgs, FetchResult};

const TOOL: &str = "gemini";
const BASE: &str = "https://cloudcode-pa.googleapis.com/v1internal";
const PROJECT_TTL: Duration = Duration::from_secs(6 * 3600);

const EXPIRED: &str = "The Gemini CLI login is out of date. Open a terminal and start gemini, which renews it; GlintBar uses it on the next refresh.";

fn gemini_dir() -> Option<PathBuf> {
    util::home().map(|h| h.join(".gemini"))
}

fn antigravity_present() -> bool {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(h) = util::home() {
        candidates.push(h.join(".gemini").join("antigravity-cli"));
        candidates.push(h.join(".gemini").join("antigravity"));
        candidates.push(h.join(".antigravity"));
    }
    if let Some(local) = util::env_dir("LOCALAPPDATA") {
        candidates.push(local.join("Programs").join("Antigravity"));
    }
    candidates.iter().any(|p| p.exists())
}

struct Creds {
    token: String,
    expires_at: Option<i64>,
}

/// (project, tier name) from loadCodeAssist.
pub fn parse_load(v: &Value) -> (Option<String>, Option<String>) {
    let project = match &v["cloudaicompanionProject"] {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Object(o) => o.get("id").and_then(|x| x.as_str()).map(|s| s.to_string()),
        _ => None,
    };
    let tier = util::str_of(&v["paidTier"]["name"]).or_else(|| util::str_of(&v["currentTier"]["name"]));
    (project, tier)
}

/// The quota buckets -> one Pro and one Flash limit (the model closest to its limit in each
/// family; Flash Lite is the fallback and is left out). Also returns the chosen model ids.
pub fn parse_quota(v: &Value) -> (Vec<AiLimit>, Vec<(String, String)>) {
    // family index -> (remaining fraction, reset, model id)
    let mut best: [Option<(f64, Option<i64>, String)>; 2] = [None, None];
    if let Some(buckets) = v["buckets"].as_array() {
        for b in buckets {
            let model = b["modelId"].as_str().unwrap_or("").to_lowercase();
            if model.contains("lite") {
                continue;
            }
            let family = if model.contains("pro") {
                0
            } else if model.contains("flash") {
                1
            } else {
                continue;
            };
            let remaining = match util::num(&b["remainingFraction"]) {
                Some(r) => r.clamp(0.0, 1.0),
                None => continue,
            };
            let reset = util::time_ms(&b["resetTime"]);
            let better = match &best[family] {
                Some((r, _, _)) => remaining < *r,
                None => true,
            };
            if better {
                best[family] = Some((remaining, reset, b["modelId"].as_str().unwrap_or("").to_string()));
            }
        }
    }
    let mut limits = Vec::new();
    let mut models = Vec::new();
    let names: [(&str, &str); 2] = [("daily_pro", "Pro"), ("daily_flash", "Flash")];
    for (i, slot) in best.iter().enumerate() {
        if let Some((remaining, reset, model)) = slot {
            limits.push(limit(TOOL, names[i].0, names[i].1, (1.0 - remaining) * 100.0, *reset, Some(DAY_MS)));
            models.push((format!("{} model", names[i].1), model.clone()));
        }
    }
    (limits, models)
}

fn post(url: &str, token: &str, body: String) -> FetchArgs {
    let mut headers: HashMap<String, String> = HashMap::new();
    headers.insert("Authorization".to_string(), format!("Bearer {token}"));
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    headers.insert("Accept".to_string(), "application/json".to_string());
    FetchArgs {
        url: url.to_string(),
        method: Some("POST".to_string()),
        headers,
        body: Some(body),
        body_base64: None,
        timeout_ms: Some(15_000),
        response_type: None,
        max_bytes: Some(512 * 1024),
    }
}

fn json_body(resp: &FetchResult) -> SvcResult<Value> {
    serde_json::from_str::<Value>(&resp.body)
        .map_err(|_| SvcError::Http("Google's reply wasn't in the expected format".to_string()))
}

/// (when, project, tier), so the quota call does not need loadCodeAssist every time.
static PROJECT: Mutex<Option<(Instant, Option<String>, Option<String>)>> = Mutex::new(None);

/// Sync helpers so no lock guard ever lives inside the async handler.
fn cached_project() -> Option<(Option<String>, Option<String>)> {
    let guard = PROJECT.lock().unwrap_or_else(|p| p.into_inner());
    match guard.as_ref() {
        Some((at, project, tier)) if at.elapsed() < PROJECT_TTL => Some((project.clone(), tier.clone())),
        _ => None,
    }
}

fn remember_project(project: Option<String>, tier: Option<String>) {
    let mut guard = PROJECT.lock().unwrap_or_else(|p| p.into_inner());
    *guard = Some((Instant::now(), project, tier));
}

fn expired_reading(antigravity: bool) -> ToolReading {
    let mut r = ToolReading::new(TOOL, "expired", Some(EXPIRED));
    if antigravity {
        r.detail("Antigravity", "Installed - other apps can't see its quota yet");
    }
    r
}

pub async fn usage() -> SvcResult<ToolReading> {
    let antigravity = antigravity_present();
    let dir = gemini_dir();
    let creds = run_blocking(move || {
        let dir = match dir {
            Some(d) if d.is_dir() => d,
            _ => return Ok(None),
        };
        let v = match util::read_json(&dir.join("oauth_creds.json")) {
            Ok(Some(v)) => v,
            _ => return Ok(Some(None)),
        };
        Ok(Some(
            util::str_of(&v["access_token"]).map(|token| Creds { token, expires_at: util::time_ms(&v["expiry_date"]) }),
        ))
    })
    .await?;
    let creds = match creds {
        None if !antigravity => {
            return Ok(ToolReading::new(
                TOOL,
                "not_installed",
                Some("The Gemini CLI wasn't found on this PC. Install it, start gemini and pick Login with Google."),
            ))
        }
        None | Some(None) if antigravity => {
            let mut r = ToolReading::new(
                TOOL,
                "unavailable",
                Some("Antigravity is installed, but other apps can't see its quota yet. For Pro and Flash numbers, log the Gemini CLI in with a Google account."),
            );
            r.detail("Antigravity", "Found");
            return Ok(r);
        }
        None | Some(None) => {
            return Ok(ToolReading::new(
                TOOL,
                "signed_out",
                Some("The Gemini CLI has no Google login. Start gemini, pick Login with Google, then click Check again."),
            ))
        }
        Some(Some(c)) => c,
    };
    let now = util::now_ms();
    if creds.expires_at.map(|e| e <= now).unwrap_or(false) {
        return Ok(expired_reading(antigravity));
    }

    let (project, tier) = match cached_project() {
        Some(c) => c,
        None => {
            let mut body = serde_json::json!({
                "metadata": {"ideType": "IDE_UNSPECIFIED", "platform": "PLATFORM_UNSPECIFIED", "pluginType": "GEMINI"}
            });
            if let Ok(p) = std::env::var("GOOGLE_CLOUD_PROJECT") {
                if !p.trim().is_empty() {
                    body["cloudaicompanionProject"] = Value::String(p.trim().to_string());
                    body["metadata"]["duetProject"] = Value::String(p.trim().to_string());
                }
            }
            let resp = fetch(post(&format!("{BASE}:loadCodeAssist"), &creds.token, body.to_string())).await?;
            if resp.status == 401 || resp.status == 403 {
                return Ok(expired_reading(antigravity));
            }
            if !resp.ok {
                return Err(util::http_status_error("Google", resp.status));
            }
            let parsed = parse_load(&json_body(&resp)?);
            remember_project(parsed.0.clone(), parsed.1.clone());
            parsed
        }
    };

    let mut r = ToolReading::new(TOOL, "ok", None);
    r.plan = tier;
    r.source = "live".to_string();
    r.as_of = Some(now);
    let project = match project {
        Some(p) => p,
        None => {
            r.message = Some("Google returned no quota for this login.".to_string());
            return Ok(r);
        }
    };
    let body = serde_json::json!({ "project": project }).to_string();
    let resp = fetch(post(&format!("{BASE}:retrieveUserQuota"), &creds.token, body)).await?;
    if resp.status == 401 || resp.status == 403 {
        return Ok(expired_reading(antigravity));
    }
    if !resp.ok {
        return Err(util::http_status_error("Google", resp.status));
    }
    let (limits, models) = parse_quota(&json_body(&resp)?);
    if limits.is_empty() {
        r.message = Some("Google returned no Pro or Flash quota for this login.".to_string());
    }
    r.limits = limits;
    for (label, model) in models {
        r.detail(&label, &model);
    }
    Ok(r.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn picks_the_tightest_pro_and_flash() {
        let v = json!({"buckets": [
            {"modelId": "gemini-2.5-pro", "tokenType": "REQUESTS", "remainingFraction": 0.8, "resetTime": "2026-11-17T00:00:00Z"},
            {"modelId": "gemini-3-pro-preview", "remainingFraction": 0.25, "resetTime": "2026-11-17T00:00:00Z"},
            {"modelId": "gemini-2.5-flash", "remainingFraction": 0.9},
            {"modelId": "gemini-2.5-flash-lite", "remainingFraction": 0.0},
            {"modelId": "something-else", "remainingFraction": 0.1}
        ]});
        let (limits, models) = parse_quota(&v);
        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].label, "Pro");
        assert_eq!(limits[0].used_pct, 75.0);
        assert!(limits[0].resets_at.is_some());
        assert_eq!(limits[1].label, "Flash");
        assert_eq!(limits[1].used_pct, 10.0);
        assert_eq!(models[0].1, "gemini-3-pro-preview");
        assert!(parse_quota(&json!({})).0.is_empty());
    }

    #[test]
    fn reads_project_and_tier() {
        let (p, t) = parse_load(
            &json!({"cloudaicompanionProject": "proj-1", "currentTier": {"id": "free-tier", "name": "Gemini Code Assist for individuals"}}),
        );
        assert_eq!(p.as_deref(), Some("proj-1"));
        assert_eq!(t.as_deref(), Some("Gemini Code Assist for individuals"));
        let (p, _) = parse_load(&json!({"cloudaicompanionProject": {"id": "proj-2"}}));
        assert_eq!(p.as_deref(), Some("proj-2"));
        assert_eq!(parse_load(&json!({})), (None, None));
    }
}
