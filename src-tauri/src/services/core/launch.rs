//! `shell.open` (ShellExecuteW: URLs, files, folders, apps, ms-settings: links) and
//! `shell.run` (a command line through cmd.exe, optionally waiting for its output).
//! The window-model half of the `shell` service lives in services/shell.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::error::{SvcError, SvcResult};
use crate::registry::Registrar;
use crate::services::core::fs::expand;

#[derive(Deserialize)]
pub struct OpenArgs {
    pub target: String,
    #[serde(default)]
    pub args: Option<String>,
    /// "open" (default), "runas", "explore", "properties", ...
    #[serde(default)]
    pub verb: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

fn looks_like_url(s: &str) -> bool {
    match s.find(':') {
        // "C:\\..." is a drive letter, not a scheme.
        Some(i) => i > 1 && s[..i].chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.'),
        None => false,
    }
}

/// Opens a URL, file, folder or program with the shell. Blocking.
#[cfg(windows)]
pub fn open(args: &OpenArgs) -> SvcResult<()> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let raw = args.target.trim();
    if raw.is_empty() {
        return Err(SvcError::bad_args("no target was given to open"));
    }
    crate::services::core::smoke::guard("shell.open")?;
    let target = if looks_like_url(raw) { raw.to_string() } else { expand(raw) };
    if target.to_ascii_lowercase().starts_with("javascript:") {
        return Err(SvcError::Denied("links of this kind are blocked".into()));
    }
    let verb = HSTRING::from(args.verb.clone().unwrap_or_else(|| "open".into()));
    let file = HSTRING::from(target.as_str());
    let params = args.args.as_ref().map(|a| HSTRING::from(a.as_str()));
    let dir = args.cwd.as_ref().map(|d| HSTRING::from(expand(d).as_str()));
    let result = unsafe {
        ShellExecuteW(
            None,
            &verb,
            &file,
            match &params {
                Some(p) => PCWSTR(p.as_ptr()),
                None => PCWSTR::null(),
            },
            match &dir {
                Some(d) => PCWSTR(d.as_ptr()),
                None => PCWSTR::null(),
            },
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW returns a value greater than 32 on success.
    if (result.0 as isize) > 32 {
        Ok(())
    } else {
        Err(SvcError::NotFound(format!("Windows failed to open {target} (code {})", result.0 as isize)))
    }
}

#[cfg(not(windows))]
pub fn open(_args: &OpenArgs) -> SvcResult<()> {
    Err(SvcError::unsupported("shell.open works only on Windows"))
}

/// Convenience for Rust callers: open a path or URL with the default verb.
pub fn open_target(target: &str) -> SvcResult<()> {
    open(&OpenArgs { target: target.to_string(), args: None, verb: None, cwd: None })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunArgs {
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    /// Wait for the command and return its exit code and output.
    #[serde(default)]
    pub wait: bool,
    /// Hide the console window (default true).
    #[serde(default = "yes")]
    pub hidden: bool,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

fn yes() -> bool {
    true
}

#[derive(Serialize)]
pub struct RunResult {
    pub pid: Option<u32>,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

pub async fn run(args: RunArgs) -> SvcResult<RunResult> {
    if args.command.trim().is_empty() {
        return Err(SvcError::bad_args("empty command"));
    }
    let mut cmd = tokio::process::Command::new("cmd.exe");
    #[cfg(windows)]
    {
        cmd.raw_arg(format!("/D /S /C \"{}\"", args.command));
        if args.hidden {
            cmd.creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0);
        }
    }
    #[cfg(not(windows))]
    {
        cmd.arg("/C").arg(&args.command);
    }
    if let Some(dir) = &args.cwd {
        cmd.current_dir(expand(dir));
    }
    if !args.wait {
        let child = cmd.spawn().map_err(SvcError::from)?;
        return Ok(RunResult { pid: child.id(), code: None, stdout: String::new(), stderr: String::new() });
    }
    cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    let child = cmd.spawn().map_err(SvcError::from)?;
    let pid = child.id();
    let limit = Duration::from_millis(args.timeout_ms.unwrap_or(30_000).clamp(100, 600_000));
    match tokio::time::timeout(limit, child.wait_with_output()).await {
        Ok(Ok(out)) => Ok(RunResult {
            pid,
            code: out.status.code(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        }),
        Ok(Err(e)) => Err(SvcError::from(e)),
        Err(_) => Err(SvcError::Timeout("the command timed out".into())),
    }
}

pub fn register(reg: &mut Registrar) {
    reg.add_blocking("shell", "open", |_app: AppHandle, a: OpenArgs| open(&a));
    reg.add("shell", "run", |_app: AppHandle, a: RunArgs| async move {
        crate::services::core::smoke::guard("shell.run")?;
        run(a).await
    });
}
