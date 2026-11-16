//! Online accounts that need more than the generic http service.
//!
//! - `online.oauth_sign_in`  PKCE sign-in (OAuth 2.0 auth code grant) through a loopback redirect
//!                            (Google for Gmail / Search Console, X). Tokens go straight to
//!                            Credential Manager; the UI only learns when the access token expires.
//! - `online.oauth_refresh`  trades the stored refresh token for a new access token.
//! - `online.set_wallpaper`  downloads a picture and makes it the desktop wallpaper.

mod oauth;
mod wallpaper;

use tauri::AppHandle;

use crate::registry::Registrar;

pub fn register(reg: &mut Registrar) {
    reg.add("online", "oauth_sign_in", |_app: AppHandle, a: oauth::SignInArgs| oauth::sign_in(a));
    reg.add("online", "oauth_refresh", |_app: AppHandle, a: oauth::RefreshArgs| oauth::refresh(a));
    reg.add("online", "set_wallpaper", |_app: AppHandle, a: wallpaper::SetWallpaperArgs| wallpaper::set_wallpaper(a));
}
