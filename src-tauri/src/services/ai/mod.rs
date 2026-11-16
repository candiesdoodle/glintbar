//! AI usage: how much of each AI plan is left, read from the tools already on this PC.
//!
//! Everything here is read-only and talks only to the tool's own vendor:
//! - `ai.claude_usage`   Claude session/weekly limits via the Claude Code OAuth login (claude.rs)
//! - `ai.claude_local`   Claude Code token counts from its local history, incremental (claude_local.rs)
//! - `ai.codex_usage`    ChatGPT plan's Codex windows, local rollout snapshots first (codex.rs)
//! - `ai.gemini_usage`   Gemini CLI Pro/Flash quota (gemini.rs)
//! - `ai.opencode_usage` OpenCode tokens from its local database, offline (opencode.rs)
//! - `ai.cursor_usage`   Cursor plan/sign-in from its state database; usage is a preview (cursor.rs)
//! - `ai.grok_usage`     detection only (grok.rs)
//! DeepSeek and GLM use pasted keys and the generic http service from the UI.
//! Sign-in files are read fresh on each call; tokens are never logged, stored or sent elsewhere.

mod claude;
mod claude_local;
mod codex;
mod cursor;
mod gemini;
mod grok;
pub mod model;
mod opencode;
pub mod util;

use tauri::AppHandle;

use crate::registry::{NoArgs, Registrar};

pub fn register(reg: &mut Registrar) {
    reg.add("ai", "claude_usage", |_app: AppHandle, _: NoArgs| async move { claude::usage().await });
    reg.add_blocking("ai", "claude_local", |_app: AppHandle, _: NoArgs| claude_local::read());
    reg.add("ai", "codex_usage", |_app: AppHandle, _: NoArgs| async move { codex::usage().await });
    reg.add("ai", "gemini_usage", |_app: AppHandle, _: NoArgs| async move { gemini::usage().await });
    reg.add_blocking("ai", "opencode_usage", |_app: AppHandle, _: NoArgs| opencode::usage());
    reg.add_blocking("ai", "cursor_usage", |_app: AppHandle, _: NoArgs| cursor::usage());
    reg.add_blocking("ai", "grok_usage", |_app: AppHandle, _: NoArgs| grok::usage());
    reg.on_cleanup(claude_local::save_now);
}
