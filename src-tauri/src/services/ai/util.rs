//! Safe local-file helpers for the AI slice: size-capped reads, tolerant JSON, time parsing,
//! JWT payload decoding (never verified, never logged), and atomic cache writes.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::Engine;
use serde_json::Value;

use crate::error::{SvcError, SvcResult};

/// Credential/config files are tiny; anything bigger is not what we expect.
pub const MAX_SMALL_FILE: u64 = 1024 * 1024;

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn home() -> Option<PathBuf> {
    crate::paths::user_profile()
}

/// A directory from an environment variable, if it is set and non-empty.
pub fn env_dir(name: &str) -> Option<PathBuf> {
    match std::env::var_os(name) {
        Some(v) if !v.is_empty() => Some(PathBuf::from(v)),
        _ => None,
    }
}

pub fn mtime_ms(meta: &std::fs::Metadata) -> Option<i64> {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64)
}

/// Reads at most `max` bytes from the start of a file as (lossy) UTF-8.
pub fn read_capped(path: &Path, max: u64) -> SvcResult<String> {
    let file = std::fs::File::open(path)?;
    let mut buf = Vec::new();
    file.take(max).read_to_end(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Reads a small JSON file. A missing file is `Ok(None)`; broken JSON is an error.
pub fn read_json(path: &Path) -> SvcResult<Option<Value>> {
    if !path.is_file() {
        return Ok(None);
    }
    let text = read_capped(path, MAX_SMALL_FILE)?;
    match serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) {
        Ok(v) => Ok(Some(v)),
        Err(_) => Err(SvcError::Io(format!("{} could not be parsed as JSON", file_name(path)))),
    }
}

/// The last `max` bytes of a file, starting at a line boundary when it had to cut.
pub fn read_tail(path: &Path, max: u64) -> SvcResult<String> {
    let mut file = std::fs::File::open(path)?;
    let size = file.metadata()?.len();
    let start = size.saturating_sub(max);
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity((size - start) as usize);
    file.take(max).read_to_end(&mut buf)?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    if start > 0 {
        if let Some(pos) = text.find('\n') {
            return Ok(text[pos + 1..].to_string());
        }
    }
    Ok(text)
}

pub fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Unix ms from a JSON number (seconds or ms) or an RFC 3339 / ISO string.
pub fn time_ms(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => {
            let f = n.as_f64()?;
            if !f.is_finite() || f <= 0.0 {
                return None;
            }
            // Anything below ~2286-11-20 in seconds is a seconds value.
            if f < 10_000_000_000.0 {
                Some((f * 1000.0) as i64)
            } else {
                Some(f as i64)
            }
        }
        Value::String(s) => parse_time_str(s),
        _ => None,
    }
}

pub fn parse_time_str(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(d) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(d.timestamp_millis());
    }
    // "2026-11-04T16:38:11" without a zone: treat as UTC.
    if let Ok(n) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f") {
        return Some(n.and_utc().timestamp_millis());
    }
    if let Ok(n) = s.parse::<f64>() {
        return time_ms(&serde_json::json!(n));
    }
    None
}

pub fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

pub fn str_of(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        _ => None,
    }
}

/// The claims of a JWT, decoded but not verified. Only used to read plan names and dates.
pub fn jwt_claims(token: &str) -> Option<Value> {
    let part = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(part.trim_end_matches('=')).ok()?;
    serde_json::from_slice::<Value>(&bytes).ok()
}

/// "pro_plus" -> "Pro Plus", "max" -> "Max".
pub fn title_case(s: &str) -> String {
    s.split(|c: char| c == '_' || c == '-' || c == ' ')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase(),
                None => String::new(),
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

/// Writes through a temp file + rename so a crash never leaves half a cache behind.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
    }
    std::fs::rename(&tmp, path)
}

/// Where this slice keeps its own caches (never tokens): %APPDATA%\\GlintBar\\ai
pub fn cache_dir() -> PathBuf {
    crate::paths::data_dir().join("ai")
}

/// Stable 64-bit FNV-1a, for compact de-duplication keys in persisted caches.
pub fn fnv64(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

/// Maps an HTTP status from a vendor to the error the UI understands.
pub fn http_status_error(vendor: &str, status: u16) -> SvcError {
    match status {
        429 => SvcError::Http(format!("{vendor} refused: too many requests for now")),
        s if s >= 500 => SvcError::Http(format!("{vendor} had a server error ({s})")),
        s => SvcError::Http(format!("{vendor} replied with status {s}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_times() {
        assert_eq!(time_ms(&serde_json::json!(1793048821)), Some(1_793_048_821_000));
        assert_eq!(time_ms(&serde_json::json!(1793048821000_i64)), Some(1_793_048_821_000));
        assert_eq!(parse_time_str("2026-11-04T16:38:11+00:00"), Some(1_793_810_291_000));
        assert_eq!(parse_time_str("2026-11-04T16:38:11Z"), Some(1_793_810_291_000));
        assert_eq!(parse_time_str(""), None);
        assert_eq!(time_ms(&Value::Null), None);
    }

    #[test]
    fn decodes_jwt_payload() {
        // header.payload.signature with payload {"a":1}
        let token = "eyJhbGciOiJub25lIn0.eyJhIjoxfQ.x";
        assert_eq!(jwt_claims(token), Some(serde_json::json!({"a": 1})));
        assert_eq!(jwt_claims("nope"), None);
    }

    #[test]
    fn title_cases() {
        assert_eq!(title_case("pro_plus"), "Pro Plus");
        assert_eq!(title_case("MAX"), "Max");
    }

    #[test]
    fn fnv_is_stable() {
        assert_eq!(fnv64(""), 0xcbf2_9ce4_8422_2325);
        assert_ne!(fnv64("a"), fnv64("b"));
    }
}
