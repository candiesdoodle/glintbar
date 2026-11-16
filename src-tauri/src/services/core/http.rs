//! Generic HTTP for widgets that read online accounts.
//!
//! `http.fetch {url, method?, headers?, body?, bodyBase64?, timeoutMs?, responseType?: "text"|"base64", maxBytes?}`
//! -> `{status, ok, url, headers, body}`. Non-2xx responses are returned, not raised; network
//! failures raise `offline` / `timeout`. `{{secret:<key>}}` in url, header values and body is
//! replaced with the stored secret (raises `missing_secret` when it is not set).
//! Uses the Windows certificate store (native-tls), so corporate TLS inspection works.

use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::error::{SvcError, SvcResult};
use crate::registry::{run_blocking, Registrar};
use crate::services::core::secrets;

const DEFAULT_TIMEOUT_MS: u64 = 20_000;
const MAX_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_MAX_BYTES: u64 = 8 * 1024 * 1024;
const HARD_MAX_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchArgs {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub body_base64: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub response_type: Option<String>,
    #[serde(default)]
    pub max_bytes: Option<u64>,
}

#[derive(Serialize)]
pub struct FetchResult {
    pub status: u16,
    pub ok: bool,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

fn client() -> SvcResult<&'static reqwest::Client> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 10 {
            return attempt.error("the server redirected too many times");
        }
        let scheme = attempt.url().scheme().to_string();
        if scheme == "http" || scheme == "https" {
            attempt.follow()
        } else {
            // Never follow a redirect to file:// or any other non-web scheme.
            attempt.stop()
        }
    });
    let built = reqwest::Client::builder()
        .user_agent(concat!("GlintBar/", env!("CARGO_PKG_VERSION")))
        .redirect(policy)
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| SvcError::Internal(format!("http client: {e}")))?;
    Ok(CLIENT.get_or_init(|| built))
}

/// Replaces every `{{secret:<key>}}` in `text`. Blocking.
fn fill_secrets(text: &str) -> SvcResult<String> {
    const OPEN: &str = "{{secret:";
    if !text.contains(OPEN) {
        return Ok(text.to_string());
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(OPEN) {
        out.push_str(&rest[..start]);
        let after = &rest[start + OPEN.len()..];
        let end = after.find("}}").ok_or_else(|| SvcError::bad_args("unclosed {{secret:...}}"))?;
        let key = &after[..end];
        match secrets::read(key)? {
            Some(value) => out.push_str(&value),
            None => return Err(SvcError::MissingSecret(key.to_string())),
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

struct Prepared {
    url: String,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
}

fn prepare(args: &FetchArgs) -> SvcResult<Prepared> {
    let url = fill_secrets(args.url.trim())?;
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err(SvcError::bad_args("URLs must start with http:// or https://"));
    }
    let mut headers = Vec::with_capacity(args.headers.len());
    for (k, v) in &args.headers {
        headers.push((k.clone(), fill_secrets(v)?));
    }
    let body = match (&args.body, &args.body_base64) {
        (Some(text), _) => Some(fill_secrets(text)?.into_bytes()),
        (None, Some(b64)) => Some(
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| SvcError::bad_args(format!("bodyBase64: {e}")))?,
        ),
        (None, None) => None,
    };
    Ok(Prepared { url, headers, body })
}

fn map_reqwest(e: reqwest::Error) -> SvcError {
    // Drop the URL: it can carry a key or a secret calendar address.
    let e = e.without_url();
    if e.is_timeout() {
        SvcError::Timeout("no response from the server in time".into())
    } else if e.is_connect() {
        SvcError::Offline(format!("connection failed: {e}"))
    } else if e.is_redirect() {
        SvcError::Http(format!("redirect refused: {e}"))
    } else {
        SvcError::Http(e.to_string())
    }
}

pub async fn fetch(args: FetchArgs) -> SvcResult<FetchResult> {
    let method_name = args.method.clone().unwrap_or_else(|| "GET".into()).to_ascii_uppercase();
    let method = reqwest::Method::from_bytes(method_name.as_bytes())
        .map_err(|_| SvcError::bad_args(format!("unknown method {method_name}")))?;
    let timeout = Duration::from_millis(args.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(1, MAX_TIMEOUT_MS));
    let max_bytes = args.max_bytes.unwrap_or(DEFAULT_MAX_BYTES).min(HARD_MAX_BYTES);
    let as_base64 = args.response_type.as_deref() == Some("base64");

    // Secret lookups hit Credential Manager, so prepare off the async pool.
    let prepared = run_blocking(move || prepare(&args)).await?;

    let mut req = client()?.request(method, &prepared.url).timeout(timeout);
    for (k, v) in &prepared.headers {
        req = req.header(k.as_str(), v.as_str());
    }
    if let Some(body) = prepared.body {
        req = req.body(body);
    }
    let mut resp = req.send().await.map_err(map_reqwest)?;

    let status = resp.status();
    let final_url = resp.url().to_string();
    let mut headers = BTreeMap::new();
    for (name, value) in resp.headers().iter() {
        headers.insert(name.as_str().to_string(), value.to_str().unwrap_or("").to_string());
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(map_reqwest)? {
        if bytes.len() as u64 + chunk.len() as u64 > max_bytes {
            return Err(SvcError::Http(format!("the response exceeds {max_bytes} bytes")));
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = if as_base64 {
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    Ok(FetchResult { status: status.as_u16(), ok: status.is_success(), url: final_url, headers, body })
}

pub fn register(reg: &mut Registrar) {
    reg.add("http", "fetch", |_app: AppHandle, a: FetchArgs| fetch(a));
}
