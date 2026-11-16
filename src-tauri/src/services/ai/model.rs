//! The shared shape every AI tool reading takes (mirrored in src/widgets/ai/shared/types.ts).

use serde::Serialize;

/// One limit window: "how much of it is used, and when it starts over".
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiLimit {
    pub tool: String,
    /// "session" (5-hour), "weekly", "weekly_opus", "weekly_sonnet", "daily_pro", "daily_flash", "monthly", ...
    pub window: String,
    /// Short label for the tile, e.g. "Session", "Week", "Pro".
    pub label: String,
    /// 0-100
    pub used_pct: f64,
    /// Unix ms; None when the window has not started (nothing used yet).
    pub resets_at: Option<i64>,
    /// Length of the window in ms, when known (for the usage-over-window chart).
    pub window_ms: Option<i64>,
    pub plan: Option<String>,
    pub billing: Option<Billing>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Billing {
    /// Unix ms
    pub last_charge: Option<i64>,
    /// Unix ms
    pub next_charge: Option<i64>,
    /// True when the dates are worked out (e.g. from the subscription start), not reported.
    pub estimated: bool,
    pub extra_usage: Option<bool>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub label: String,
    pub value: String,
}

/// What a tool's `*_usage` method returns. Problems the user can fix (signed out, expired) are
/// a `status`, not an error; network trouble is an error so the UI keeps the last reading.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolReading {
    pub tool: String,
    /// ok | expired | signed_out | not_installed | unavailable | preview
    pub status: String,
    /// Plain-language explanation for anything but "ok".
    pub message: Option<String>,
    pub limits: Vec<AiLimit>,
    pub plan: Option<String>,
    pub billing: Option<Billing>,
    /// live | local | none
    pub source: String,
    /// Unix ms the numbers describe (a local snapshot can be older than fetched_at).
    pub as_of: Option<i64>,
    pub fetched_at: i64,
    pub details: Vec<Detail>,
}

impl ToolReading {
    pub fn new(tool: &str, status: &str, message: Option<&str>) -> ToolReading {
        ToolReading {
            tool: tool.to_string(),
            status: status.to_string(),
            message: message.map(|m| m.to_string()),
            limits: Vec::new(),
            plan: None,
            billing: None,
            source: "none".to_string(),
            as_of: None,
            fetched_at: crate::services::ai::util::now_ms(),
            details: Vec::new(),
        }
    }

    pub fn detail(&mut self, label: &str, value: &str) {
        self.details.push(Detail { label: label.to_string(), value: value.to_string() });
    }

    /// Copies plan and billing onto every limit (the shared AiLimit model carries them).
    pub fn finish(mut self) -> ToolReading {
        for l in self.limits.iter_mut() {
            if l.plan.is_none() {
                l.plan = self.plan.clone();
            }
            if l.billing.is_none() {
                l.billing = self.billing.clone();
            }
        }
        self
    }
}

pub fn limit(
    tool: &str,
    window: &str,
    label: &str,
    used_pct: f64,
    resets_at: Option<i64>,
    window_ms: Option<i64>,
) -> AiLimit {
    let pct = if used_pct.is_finite() { used_pct.clamp(0.0, 100.0) } else { 0.0 };
    AiLimit {
        tool: tool.to_string(),
        window: window.to_string(),
        label: label.to_string(),
        used_pct: (pct * 10.0).round() / 10.0,
        resets_at,
        window_ms,
        plan: None,
        billing: None,
    }
}

pub const HOUR_MS: i64 = 3_600_000;
pub const DAY_MS: i64 = 24 * HOUR_MS;
