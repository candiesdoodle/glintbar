//! Settings export: writes the JSON the UI built (every store key, never secrets) to
//! Downloads\GlintBar settings <date>.json. Import needs no Rust: the UI reads the file the user picks.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{SvcError, SvcResult};
use crate::paths;

#[derive(Deserialize)]
pub struct ExportArgs {
    pub json: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exported {
    pub path: String,
    pub folder: String,
}

pub fn export(a: ExportArgs) -> SvcResult<Exported> {
    if a.json.len() > 8_000_000 {
        return Err(SvcError::bad_args("the settings exceed the export size limit"));
    }
    // Refuse anything that is not JSON, so the file can always be imported again.
    serde_json::from_str::<serde_json::Value>(&a.json)?;
    let downloads = paths::user_profile().map(|p| p.join("Downloads")).filter(|p| p.is_dir());
    let dir: PathBuf = match downloads {
        Some(d) => d,
        None => paths::data_dir(),
    };
    std::fs::create_dir_all(&dir)?;
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut path = dir.join(format!("GlintBar settings {date}.json"));
    let mut n = 2;
    while path.exists() && n < 100 {
        path = dir.join(format!("GlintBar settings {date} ({n}).json"));
        n += 1;
    }
    std::fs::write(&path, a.json.as_bytes())?;
    Ok(Exported { path: path.to_string_lossy().into_owned(), folder: dir.to_string_lossy().into_owned() })
}
