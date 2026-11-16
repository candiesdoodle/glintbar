//! Grok: xAI has no documented way for another app to read SuperGrok credits, so this only
//! reports whether the Grok CLI is set up and says plainly that the numbers aren't available yet.

use super::model::ToolReading;
use super::util;
use crate::error::SvcResult;

const TOOL: &str = "grok";

pub fn usage() -> SvcResult<ToolReading> {
    let found = util::home().map(|h| h.join(".grok").is_dir()).unwrap_or(false);
    let r = if found {
        ToolReading::new(
            TOOL,
            "unavailable",
            Some("Grok CLI found, but xAI gives other apps no access to SuperGrok credits yet. Until that changes, the tile shows sample figures."),
        )
    } else {
        ToolReading::new(
            TOOL,
            "unavailable",
            Some("SuperGrok credits can't be read yet because xAI offers other apps no way to see them. Until that changes, the tile shows sample figures."),
        )
    };
    Ok(r)
}
