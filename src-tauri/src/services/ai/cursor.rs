//! Cursor (preview): the plan and sign-in, read from the Cursor app's own state database
//! (%APPDATA%\\Cursor\\User\\globalStorage\\state.vscdb), read-only. Cursor has no public way for
//! another app to read its usage, so the numbers stay a labelled sample until it does.

use std::path::PathBuf;
use std::time::Duration;

use super::model::ToolReading;
use super::util;
use crate::error::{SvcError, SvcResult};

const TOOL: &str = "cursor";

fn state_db() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(a) = util::env_dir("APPDATA") {
        candidates.push(a.join("Cursor").join("User").join("globalStorage").join("state.vscdb"));
    }
    if let Some(h) = util::home() {
        candidates.push(h.join(".config").join("Cursor").join("User").join("globalStorage").join("state.vscdb"));
        candidates.push(
            h.join("Library")
                .join("Application Support")
                .join("Cursor")
                .join("User")
                .join("globalStorage")
                .join("state.vscdb"),
        );
    }
    candidates.into_iter().find(|p| p.is_file())
}

pub struct CursorState {
    pub signed_in: bool,
    pub membership: Option<String>,
    pub subscription: Option<String>,
}

/// Values in Cursor's ItemTable are sometimes JSON-quoted strings.
pub fn clean_value(raw: &str) -> Option<String> {
    let t = raw.trim().trim_matches('"').trim();
    if t.is_empty() || t == "null" {
        None
    } else {
        Some(t.to_string())
    }
}

pub fn plan_label(membership: &str) -> String {
    match membership.to_lowercase().as_str() {
        "free" => "Hobby".to_string(),
        "free_trial" => "Pro trial".to_string(),
        "pro" => "Pro".to_string(),
        "pro_plus" | "pro+" => "Pro+".to_string(),
        "ultra" => "Ultra".to_string(),
        "business" | "team" | "teams" => "Teams".to_string(),
        "enterprise" => "Enterprise".to_string(),
        other => util::title_case(other),
    }
}

fn read_state(path: &PathBuf) -> SvcResult<CursorState> {
    use rusqlite::{Connection, OpenFlags};
    let err = |e: rusqlite::Error| SvcError::Io(format!("Cursor state database error: {e}"));
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(err)?;
    let _ = conn.busy_timeout(Duration::from_millis(1500));
    // The token itself is never read: only whether one is there.
    let mut stmt = conn
        .prepare(
            "SELECT key, CASE WHEN key = 'cursorAuth/accessToken' THEN CAST(length(value) AS TEXT) ELSE CAST(value AS TEXT) END \
             FROM ItemTable WHERE key IN ('cursorAuth/accessToken', 'cursorAuth/stripeMembershipType', 'cursorAuth/stripeSubscriptionStatus')",
        )
        .map_err(err)?;
    let rows =
        stmt.query_map((), |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))).map_err(err)?;
    let mut state = CursorState { signed_in: false, membership: None, subscription: None };
    for row in rows {
        let (key, value) = match row {
            Ok(r) => r,
            Err(_) => continue,
        };
        let value = value.and_then(|v| clean_value(&v));
        match key.as_str() {
            "cursorAuth/accessToken" => {
                state.signed_in = value.and_then(|v| v.parse::<u64>().ok()).map(|n| n > 10).unwrap_or(false)
            }
            "cursorAuth/stripeMembershipType" => state.membership = value,
            "cursorAuth/stripeSubscriptionStatus" => state.subscription = value,
            _ => {}
        }
    }
    Ok(state)
}

pub fn usage() -> SvcResult<ToolReading> {
    let path = match state_db() {
        Some(p) => p,
        None => {
            return Ok(ToolReading::new(
                TOOL,
                "not_installed",
                Some("Cursor wasn't found on this PC, or it hasn't been started yet. Start Cursor, log in, then click Check again."),
            ))
        }
    };
    let state = match read_state(&path) {
        Ok(s) => s,
        Err(e) => {
            tracing::debug!("cursor state: {e}");
            return Ok(ToolReading::new(
                TOOL,
                "unavailable",
                Some("GlintBar couldn't read Cursor's login just now. Wait a moment and retry."),
            ));
        }
    };
    if !state.signed_in {
        return Ok(ToolReading::new(
            TOOL,
            "signed_out",
            Some("Cursor has no login yet. Log in from the Cursor app, then click Check again."),
        ));
    }
    let mut r = ToolReading::new(
        TOOL,
        "preview",
        Some("Logged in. Cursor keeps usage figures private from other apps for now, so this tile shows a sample."),
    );
    r.plan = state.membership.as_deref().map(plan_label);
    if let Some(s) = state.subscription.as_deref() {
        r.detail("Subscription", &util::title_case(s));
    }
    r.source = "local".to_string();
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_values_and_names_plans() {
        assert_eq!(clean_value("\"pro\""), Some("pro".to_string()));
        assert_eq!(clean_value(" null "), None);
        assert_eq!(plan_label("pro_plus"), "Pro+");
        assert_eq!(plan_label("free"), "Hobby");
    }
}
