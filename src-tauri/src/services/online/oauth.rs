//! OAuth 2.0 for installed apps: authorization code + PKCE (S256) + a one-shot listener on
//! 127.0.0.1. The user brings their own OAuth client (Google requires it), stored as secrets.
//!
//! Secrets used (all in Credential Manager):
//!   `<clientIdKey>`, optional `<clientSecretKey>`  the user's OAuth client
//!   `<tokenPrefix>.access`, `<tokenPrefix>.refresh` written here
//! Nothing secret is logged or returned to the UI.

use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{SvcError, SvcResult};
use crate::registry::run_blocking;
use crate::services::core::http::{self, FetchArgs};
use crate::services::core::{launch, secrets};

const DEFAULT_WAIT_SECS: u64 = 180;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInArgs {
    pub auth_url: String,
    pub token_url: String,
    pub client_id_key: String,
    #[serde(default)]
    pub client_secret_key: Option<String>,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub token_prefix: String,
    /// 0 = any free port (Google desktop clients accept any loopback port).
    #[serde(default)]
    pub port: u16,
    /// Redirect path, default "/".
    #[serde(default)]
    pub path: Option<String>,
    /// Extra authorize-URL parameters (access_type, prompt, ...).
    #[serde(default)]
    pub extra: HashMap<String, String>,
    /// Send the client credentials as HTTP Basic auth to the token endpoint (X confidential clients).
    #[serde(default)]
    pub basic_auth: bool,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    /// Shown in messages, e.g. "Gmail".
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshArgs {
    pub token_url: String,
    pub client_id_key: String,
    #[serde(default)]
    pub client_secret_key: Option<String>,
    pub token_prefix: String,
    #[serde(default)]
    pub basic_auth: bool,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfo {
    /// Unix ms when the access token stops working (0 = unknown).
    pub expires_at: i64,
    pub scope: Option<String>,
}

fn now_ms() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        Err(_) => 0,
    }
}

fn random_b64(len: usize) -> SvcResult<String> {
    let mut buf = vec![0u8; len];
    getrandom::fill(&mut buf).map_err(|e| SvcError::Internal(format!("random: {e}")))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&buf))
}

fn challenge_for(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest.as_slice())
}

/// application/x-www-form-urlencoded / RFC 3986 encoding of one component.
fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        let keep = b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~';
        if keep {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

fn dec(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'+' {
            out.push(b' ');
            i += 1;
        } else if b == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            match u8::from_str_radix(hex, 16) {
                Ok(v) => {
                    out.push(v);
                    i += 3;
                }
                Err(_) => {
                    out.push(b);
                    i += 1;
                }
            }
        } else {
            out.push(b);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn form(pairs: &[(&str, &str)]) -> String {
    pairs.iter().map(|(k, v)| format!("{}={}", enc(k), enc(v))).collect::<Vec<String>>().join("&")
}

fn read_secret(key: &str) -> SvcResult<String> {
    match secrets::read(key)? {
        Some(v) if !v.trim().is_empty() => Ok(v.trim().to_string()),
        _ => Err(SvcError::MissingSecret(key.to_string())),
    }
}

fn read_optional(key: &Option<String>) -> SvcResult<Option<String>> {
    match key {
        Some(k) if !k.is_empty() => Ok(secrets::read(k)?.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())),
        _ => Ok(None),
    }
}

struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

const PAGE_OK: &str = "<!doctype html><meta charset=utf-8><title>Signed in</title><body style=\"font:16px system-ui;background:#111326;color:#eef0ff;display:grid;place-items:center;height:90vh\"><div><h2>Sign-in complete.</h2><p>This tab is no longer needed; return to the dock.</p></div>";
const PAGE_FAIL: &str = "<!doctype html><meta charset=utf-8><title>Not signed in</title><body style=\"font:16px system-ui;background:#111326;color:#eef0ff;display:grid;place-items:center;height:90vh\"><div><h2>The sign-in did not finish.</h2><p>Close this tab, then start again from the dock.</p></div>";

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
}

/// Reads one request; returns the request target ("/path?query") or None.
fn read_target(stream: &mut TcpStream) -> Option<String> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf: Vec<u8> = Vec::with_capacity(2048);
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 16 * 1024 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let text = String::from_utf8_lossy(&buf).into_owned();
    let first = text.lines().next()?.to_string();
    let mut parts = first.split_whitespace();
    let method = parts.next()?;
    if method != "GET" {
        return None;
    }
    parts.next().map(|t| t.to_string())
}

/// Blocks until the browser comes back to the loopback listener (or the time runs out).
fn wait_for_callback(listener: TcpListener, path: String, expected_state: String, wait: Duration) -> SvcResult<Callback> {
    listener.set_nonblocking(true).map_err(SvcError::from)?;
    let deadline = Instant::now() + wait;
    loop {
        if Instant::now() >= deadline {
            return Err(SvcError::Timeout("no sign-in reply arrived in time".into()));
        }
        match listener.accept() {
            Ok((mut stream, _addr)) => {
                let target = match read_target(&mut stream) {
                    Some(t) => t,
                    None => {
                        respond(&mut stream, "400 Bad Request", PAGE_FAIL);
                        continue;
                    }
                };
                let (req_path, query) = match target.split_once('?') {
                    Some((p, q)) => (p.to_string(), q.to_string()),
                    None => (target.clone(), String::new()),
                };
                if req_path != path {
                    respond(&mut stream, "404 Not Found", "");
                    continue;
                }
                let mut cb = Callback { code: None, state: None, error: None };
                for pair in query.split('&') {
                    let (k, v) = match pair.split_once('=') {
                        Some((k, v)) => (k, v),
                        None => (pair, ""),
                    };
                    match k {
                        "code" => cb.code = Some(dec(v)),
                        "state" => cb.state = Some(dec(v)),
                        "error" => cb.error = Some(dec(v)),
                        _ => {}
                    }
                }
                if cb.code.is_none() && cb.error.is_none() {
                    respond(&mut stream, "404 Not Found", "");
                    continue;
                }
                // Anything without our state is not the browser coming back from this sign-in
                // (another page poking the port): ignore it and keep waiting.
                if cb.state.as_deref() != Some(expected_state.as_str()) {
                    respond(&mut stream, "400 Bad Request", PAGE_FAIL);
                    continue;
                }
                let page = if cb.code.is_some() { PAGE_OK } else { PAGE_FAIL };
                respond(&mut stream, "200 OK", page);
                return Ok(cb);
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
            Err(e) => return Err(SvcError::Io(format!("callback listener failed: {e}"))),
        }
    }
}

struct Client {
    id: String,
    secret: Option<String>,
}

fn load_client(id_key: &str, secret_key: &Option<String>) -> SvcResult<Client> {
    let id = read_secret(id_key)?;
    let secret = read_optional(secret_key)?;
    Ok(Client { id, secret })
}

/// POSTs a token request; returns the parsed JSON or a readable error.
async fn token_request(token_url: &str, client: &Client, basic_auth: bool, mut pairs: Vec<(String, String)>, name: &str) -> SvcResult<Value> {
    let mut headers: HashMap<String, String> = HashMap::new();
    headers.insert("Content-Type".into(), "application/x-www-form-urlencoded".into());
    headers.insert("Accept".into(), "application/json".into());
    if basic_auth {
        let raw = format!("{}:{}", client.id, client.secret.clone().unwrap_or_default());
        let b64 = base64::engine::general_purpose::STANDARD.encode(raw.as_bytes());
        headers.insert("Authorization".into(), format!("Basic {b64}"));
        pairs.push(("client_id".into(), client.id.clone()));
    } else {
        pairs.push(("client_id".into(), client.id.clone()));
        if let Some(s) = &client.secret {
            pairs.push(("client_secret".into(), s.clone()));
        }
    }
    let refs: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    let args = FetchArgs {
        url: token_url.to_string(),
        method: Some("POST".into()),
        headers,
        body: Some(form(&refs)),
        body_base64: None,
        timeout_ms: Some(20_000),
        response_type: None,
        max_bytes: Some(256 * 1024),
    };
    let res = http::fetch(args).await?;
    let json: Value = serde_json::from_str(&res.body).unwrap_or(Value::Null);
    if !res.ok {
        let code = json.get("error").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let desc = json
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if code == "invalid_grant" {
            return Err(SvcError::Denied(format!("signed_out: {name} ended this sign-in - sign in again")));
        }
        if code == "invalid_client" || code == "unauthorized_client" {
            return Err(SvcError::Denied(format!("bad_client: {name} refused this client ID and secret")));
        }
        let detail = if desc.is_empty() { code } else { desc };
        return Err(SvcError::Http(format!("{name} replied with {}: {detail}", res.status)));
    }
    Ok(json)
}

fn store_tokens(prefix: &str, json: &Value) -> SvcResult<TokenInfo> {
    let access = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| SvcError::Http("no access token came back from the sign-in".into()))?
        .to_string();
    secrets::write(&format!("{prefix}.access"), &access)?;
    if let Some(refresh) = json.get("refresh_token").and_then(|v| v.as_str()) {
        if !refresh.is_empty() {
            secrets::write(&format!("{prefix}.refresh"), refresh)?;
        }
    }
    let expires_in = json.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(0);
    let expires_at = if expires_in > 0 { now_ms() + expires_in * 1000 } else { 0 };
    let scope = json.get("scope").and_then(|v| v.as_str()).map(|s| s.to_string());
    Ok(TokenInfo { expires_at, scope })
}

pub async fn sign_in(a: SignInArgs) -> SvcResult<TokenInfo> {
    let name = a.name.clone().unwrap_or_else(|| "The service".into());
    if !a.auth_url.starts_with("https://") || !a.token_url.starts_with("https://") {
        return Err(SvcError::bad_args("OAuth endpoints need an https address"));
    }
    let id_key = a.client_id_key.clone();
    let secret_key = a.client_secret_key.clone();
    let client = run_blocking(move || load_client(&id_key, &secret_key)).await?;

    let verifier = random_b64(48)?;
    let challenge = challenge_for(&verifier);
    let state = random_b64(18)?;
    let path = match &a.path {
        Some(p) if p.starts_with('/') => p.clone(),
        _ => "/".to_string(),
    };

    let listener = TcpListener::bind(("127.0.0.1", a.port))
        .map_err(|e| SvcError::Io(format!("local port {} is unavailable: {e}", a.port)))?;
    let port = listener.local_addr().map_err(SvcError::from)?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}{path}");

    let scope = a.scopes.join(" ");
    let mut params: Vec<(String, String)> = vec![
        ("response_type".into(), "code".into()),
        ("client_id".into(), client.id.clone()),
        ("redirect_uri".into(), redirect_uri.clone()),
        ("scope".into(), scope),
        ("state".into(), state.clone()),
        ("code_challenge".into(), challenge),
        ("code_challenge_method".into(), "S256".into()),
    ];
    for (k, v) in &a.extra {
        params.push((k.clone(), v.clone()));
    }
    let refs: Vec<(&str, &str)> = params.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    let sep = if a.auth_url.contains('?') { "&" } else { "?" };
    let url = format!("{}{}{}", a.auth_url, sep, form(&refs));
    run_blocking(move || launch::open_target(&url)).await?;

    let wait = Duration::from_secs(a.timeout_secs.unwrap_or(DEFAULT_WAIT_SECS).clamp(30, 600));
    let wait_path = path.clone();
    let wait_state = state.clone();
    let cb = run_blocking(move || wait_for_callback(listener, wait_path, wait_state, wait)).await?;
    if let Some(err) = cb.error {
        if err == "access_denied" {
            return Err(SvcError::Denied(format!("access_denied: the {name} sign-in was cancelled in the browser")));
        }
        return Err(SvcError::Denied(format!("{name} returned an error during sign-in: {err}")));
    }
    if cb.state.as_deref() != Some(state.as_str()) {
        return Err(SvcError::Denied("the sign-in reply did not belong to this request; start again".into()));
    }
    let code = cb.code.unwrap_or_default();
    let pairs: Vec<(String, String)> = vec![
        ("grant_type".into(), "authorization_code".into()),
        ("code".into(), code),
        ("redirect_uri".into(), redirect_uri),
        ("code_verifier".into(), verifier),
    ];
    let json = token_request(&a.token_url, &client, a.basic_auth, pairs, &name).await?;
    let prefix = a.token_prefix.clone();
    run_blocking(move || store_tokens(&prefix, &json)).await
}

pub async fn refresh(a: RefreshArgs) -> SvcResult<TokenInfo> {
    let name = a.name.clone().unwrap_or_else(|| "The service".into());
    let id_key = a.client_id_key.clone();
    let secret_key = a.client_secret_key.clone();
    let refresh_key = format!("{}.refresh", a.token_prefix);
    let (client, refresh_token) = run_blocking(move || {
        let c = load_client(&id_key, &secret_key)?;
        let r = read_secret(&refresh_key)?;
        Ok((c, r))
    })
    .await?;
    let pairs: Vec<(String, String)> = vec![
        ("grant_type".into(), "refresh_token".into()),
        ("refresh_token".into(), refresh_token),
    ];
    let json = token_request(&a.token_url, &client, a.basic_auth, pairs, &name).await?;
    let prefix = a.token_prefix.clone();
    run_blocking(move || store_tokens(&prefix, &json)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc7636_example() {
        assert_eq!(challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn encodes_and_decodes() {
        assert_eq!(enc("a b/c"), "a%20b%2Fc");
        assert_eq!(dec("4%2F0Ab_x+y"), "4/0Ab_x y");
    }
}
