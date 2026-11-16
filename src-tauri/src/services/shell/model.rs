//! Placement rules with no Win32 in them: the settings the UI sends, rectangles, the input
//! region, which dock goes on which monitor, auto-hide decisions and hotkey parsing.
//! Kept pure so the rules can be unit-tested.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Edge {
    Top,
    Bottom,
}

/// What GlintBar does with the Windows taskbar.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskbarMode {
    /// Auto-hide on and the bar windows hidden on every screen that has a dock.
    Hidden,
    /// Only switch on Windows' own auto-hide.
    Autohide,
    /// Leave the taskbar alone.
    Normal,
}

/// Which screens get a dock.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Displays {
    /// One dock on the chosen (or primary) monitor.
    Main,
    /// One dock per monitor, each with its own reserved strip.
    All,
    /// One dock that moves to the screen where the pointer rests at the dock edge.
    Follow,
}

/// What the UI sends with `shell.set_dock`. Persisted under "shell.geometry" so the window is
/// placed correctly before the UI loads. Every field has a default, so older saves still load.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DockGeometry {
    pub edge: Edge,
    /// Strip height in CSS px: dock size + padding + distance from the edge.
    pub thickness: f64,
    /// Reserve the strip (app bar) so maximised windows stop at the dock.
    pub reserve_space: bool,
    /// Settings saved before `taskbar` existed only have this flag.
    pub hide_taskbar: bool,
    pub taskbar: Option<TaskbarMode>,
    pub auto_hide: bool,
    /// With auto-hide: stay up while the desktop is in front.
    pub show_on_desktop: bool,
    pub displays: Displays,
    /// Device name of the chosen monitor ("" = the primary one).
    pub monitor: String,
}

impl Default for DockGeometry {
    fn default() -> Self {
        DockGeometry {
            edge: Edge::Bottom,
            thickness: 64.0,
            reserve_space: true,
            hide_taskbar: true,
            taskbar: None,
            auto_hide: false,
            show_on_desktop: false,
            displays: Displays::Main,
            monitor: String::new(),
        }
    }
}

impl DockGeometry {
    pub fn taskbar_mode(&self) -> TaskbarMode {
        match self.taskbar {
            Some(mode) => mode,
            None if self.hide_taskbar => TaskbarMode::Hidden,
            None => TaskbarMode::Normal,
        }
    }

    /// The strip is reserved only while the dock stays up.
    pub fn wants_app_bar(&self) -> bool {
        self.reserve_space && !self.auto_hide
    }

    pub fn sanitized(mut self) -> DockGeometry {
        if !self.thickness.is_finite() {
            self.thickness = 64.0;
        }
        self.thickness = self.thickness.clamp(16.0, 400.0);
        if self.monitor.len() > 64 {
            self.monitor.clear();
        }
        self
    }
}

/// A physical-pixel rectangle.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn new(left: i32, top: i32, right: i32, bottom: i32) -> Rect {
        Rect { left, top, right, bottom }
    }
    pub fn width(&self) -> i32 {
        self.right - self.left
    }
    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
    pub fn is_empty(&self) -> bool {
        self.right <= self.left || self.bottom <= self.top
    }
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
    /// True when `self` covers all of `other`.
    pub fn covers(&self, other: &Rect) -> bool {
        self.left <= other.left && self.top <= other.top && self.right >= other.right && self.bottom >= other.bottom
    }
    pub fn offset(&self, dx: i32, dy: i32) -> Rect {
        Rect { left: self.left + dx, top: self.top + dy, right: self.right + dx, bottom: self.bottom + dy }
    }
}

/// A strip `thickness` px tall on `edge` of `base`.
pub fn edge_strip(base: Rect, edge: Edge, thickness: i32) -> Rect {
    match edge {
        Edge::Bottom => Rect { top: base.bottom - thickness, ..base },
        Edge::Top => Rect { bottom: base.top + thickness, ..base },
    }
}

/// The window: the strip grown away from the edge by `extra` px, never past the monitor and
/// never quite the whole monitor (a topmost window that covers a screen reads as "full screen"
/// to Windows and silences notifications).
pub fn grown_window(strip: Rect, monitor: Rect, edge: Edge, extra: i32) -> Rect {
    let max_height = (monitor.height() - 1).max(strip.height());
    let height = (strip.height() + extra.max(0)).min(max_height);
    match edge {
        Edge::Bottom => Rect { top: (strip.bottom - height).max(monitor.top), ..strip },
        Edge::Top => Rect { bottom: (strip.top + height).min(monitor.bottom), ..strip },
    }
}

/// Released in the upper half of a screen = top edge.
pub fn edge_for_point(monitor: Rect, y: i32) -> Edge {
    if y < monitor.top + monitor.height() / 2 {
        Edge::Top
    } else {
        Edge::Bottom
    }
}

/// A clickable area reported by the UI, in CSS px. `near`/`far` are distances from the
/// screen edge the dock sits on, so they stay valid while the window grows away from it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HitRect {
    pub left: f64,
    pub width: f64,
    pub near: f64,
    pub far: f64,
}

/// Maps a UI rectangle into window-relative physical pixels (clipped to the window).
pub fn hit_to_window(hit: &HitRect, edge: Edge, scale: f64, win_w: i32, win_h: i32) -> Option<Rect> {
    let vals = [hit.left, hit.width, hit.near, hit.far];
    if vals.iter().any(|v| !v.is_finite()) || hit.width <= 0.0 || hit.far <= hit.near {
        return None;
    }
    let s = if scale > 0.0 { scale } else { 1.0 };
    let left = (hit.left * s).floor() as i32;
    let right = ((hit.left + hit.width) * s).ceil() as i32;
    let near = (hit.near * s).floor() as i32;
    let far = (hit.far * s).ceil() as i32;
    let (top, bottom) = match edge {
        Edge::Bottom => (win_h - far, win_h - near),
        Edge::Top => (near, far),
    };
    let r = Rect { left: left.max(0), top: top.max(0), right: right.min(win_w), bottom: bottom.min(win_h) };
    if r.is_empty() {
        None
    } else {
        Some(r)
    }
}

/// The thin line at the screen edge that stays clickable while the dock is auto-hidden.
pub fn sliver(edge: Edge, win_w: i32, win_h: i32, px: i32) -> Rect {
    match edge {
        Edge::Bottom => Rect { left: 0, top: (win_h - px).max(0), right: win_w, bottom: win_h },
        Edge::Top => Rect { left: 0, top: 0, right: win_w, bottom: px.min(win_h) },
    }
}

/// How a dock window is showing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    Shown,
    /// Slid away; only the sliver at the edge takes the pointer.
    Autohidden,
    /// A full-screen app covers this screen: hidden and not drawing.
    Suppressed,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct VisibilityInputs {
    pub fullscreen: bool,
    pub auto_hide: bool,
    pub dragging: bool,
    pub hover: bool,
    pub popover: bool,
    pub start_open: bool,
    pub desktop_in_front: bool,
    pub show_on_desktop: bool,
    pub held: bool,
}

pub fn desired_visibility(i: &VisibilityInputs) -> Visibility {
    if i.fullscreen && !i.dragging {
        return Visibility::Suppressed;
    }
    let keep_up = !i.auto_hide
        || i.dragging
        || i.hover
        || i.popover
        || i.start_open
        || i.held
        || (i.show_on_desktop && i.desktop_in_front);
    if keep_up {
        Visibility::Shown
    } else {
        Visibility::Autohidden
    }
}

/// One monitor as far as the plan is concerned.
#[derive(Clone, Debug)]
pub struct PlanMonitor {
    pub id: String,
    pub primary: bool,
}

pub const MAIN_LABEL: &str = "main";

/// "dock-display2" for "\\\\.\\DISPLAY2".
pub fn label_for_monitor(id: &str) -> String {
    let clean: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
    if clean.is_empty() {
        "dock-x".to_string()
    } else {
        format!("dock-{clean}")
    }
}

/// Which window label goes on which monitor. The "main" window always exists; in `All` mode
/// it sits on the chosen monitor and every other monitor gets a "dock-..." window.
pub fn plan(monitors: &[PlanMonitor], displays: Displays, chosen: &str, follow: &str) -> Vec<(String, String)> {
    if monitors.is_empty() {
        return Vec::new();
    }
    let has = |id: &str| !id.is_empty() && monitors.iter().any(|m| m.id == id);
    let primary = monitors.iter().find(|m| m.primary).unwrap_or(&monitors[0]).id.clone();
    let main_monitor = match displays {
        Displays::Follow if has(follow) => follow.to_string(),
        _ if has(chosen) => chosen.to_string(),
        _ => primary,
    };
    let mut out = vec![(MAIN_LABEL.to_string(), main_monitor.clone())];
    if displays == Displays::All {
        for m in monitors {
            if m.id == main_monitor {
                continue;
            }
            let mut label = label_for_monitor(&m.id);
            let mut n = 2;
            while out.iter().any(|(l, _)| *l == label) {
                label = format!("{}-{n}", label_for_monitor(&m.id));
                n += 1;
            }
            out.push((label, m.id.clone()));
        }
    }
    out
}

pub const MOD_ALT: u32 = 0x1;
pub const MOD_CONTROL: u32 = 0x2;
pub const MOD_SHIFT: u32 = 0x4;
pub const MOD_WIN: u32 = 0x8;

/// "Alt+T", "Ctrl+Shift+F2", "Win+Space" -> (modifier flags, virtual key). At least one
/// modifier is required so a plain key is never taken from other apps.
pub fn parse_accelerator(text: &str) -> Option<(u32, u32)> {
    let mut mods = 0u32;
    let mut key: Option<u32> = None;
    for raw in text.split('+') {
        let part = raw.trim().to_ascii_lowercase();
        match part.as_str() {
            "alt" => mods |= MOD_ALT,
            "ctrl" | "control" => mods |= MOD_CONTROL,
            "shift" => mods |= MOD_SHIFT,
            "win" | "super" | "meta" => mods |= MOD_WIN,
            "" => return None,
            other => {
                if key.is_some() {
                    return None;
                }
                key = Some(virtual_key(other)?);
            }
        }
    }
    match key {
        Some(vk) if mods != 0 => Some((mods, vk)),
        _ => None,
    }
}

fn virtual_key(name: &str) -> Option<u32> {
    let bytes = name.as_bytes();
    if bytes.len() == 1 {
        let c = bytes[0].to_ascii_uppercase();
        if c.is_ascii_uppercase() || c.is_ascii_digit() {
            return Some(c as u32);
        }
    }
    if let Some(n) = name.strip_prefix('f').and_then(|n| n.parse::<u32>().ok()) {
        if (1..=24).contains(&n) {
            return Some(0x70 + n - 1);
        }
    }
    match name {
        "space" => Some(0x20),
        "enter" | "return" => Some(0x0D),
        "tab" => Some(0x09),
        "up" => Some(0x26),
        "down" => Some(0x28),
        "left" => Some(0x25),
        "right" => Some(0x27),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(id: &str, primary: bool) -> PlanMonitor {
        PlanMonitor { id: id.into(), primary }
    }

    #[test]
    fn plans_main_follow_and_all() {
        let ms = vec![mon("A", true), mon("B", false)];
        assert_eq!(plan(&ms, Displays::Main, "", ""), vec![("main".to_string(), "A".to_string())]);
        assert_eq!(plan(&ms, Displays::Main, "B", ""), vec![("main".to_string(), "B".to_string())]);
        assert_eq!(plan(&ms, Displays::Main, "gone", ""), vec![("main".to_string(), "A".to_string())]);
        assert_eq!(plan(&ms, Displays::Follow, "A", "B")[0].1, "B");
        let all = plan(&ms, Displays::All, "", "");
        assert_eq!(all.len(), 2);
        assert_eq!(all[1], ("dock-b".to_string(), "B".to_string()));
        assert!(plan(&[], Displays::All, "", "").is_empty());
    }

    #[test]
    fn hit_rects_map_from_the_edge() {
        let h = HitRect { left: 10.0, width: 100.0, near: 0.0, far: 50.0 };
        assert_eq!(hit_to_window(&h, Edge::Bottom, 2.0, 1000, 400), Some(Rect::new(20, 300, 220, 400)));
        assert_eq!(hit_to_window(&h, Edge::Top, 1.0, 1000, 400), Some(Rect::new(10, 0, 110, 50)));
        let bad = HitRect { left: 0.0, width: 0.0, near: 0.0, far: 10.0 };
        assert_eq!(hit_to_window(&bad, Edge::Top, 1.0, 100, 100), None);
    }

    #[test]
    fn window_never_covers_the_whole_monitor() {
        let m = Rect::new(0, 0, 1920, 1080);
        let strip = edge_strip(m, Edge::Bottom, 64);
        assert_eq!(grown_window(strip, m, Edge::Bottom, 5000), Rect::new(0, 1, 1920, 1080));
        assert_eq!(grown_window(strip, m, Edge::Bottom, 0), strip);
    }

    #[test]
    fn drops_snap_by_half() {
        let m = Rect::new(0, 0, 1920, 1080);
        assert_eq!(edge_for_point(m, 100), Edge::Top);
        assert_eq!(edge_for_point(m, 900), Edge::Bottom);
    }

    #[test]
    fn auto_hide_rules() {
        let mut i = VisibilityInputs { auto_hide: true, ..Default::default() };
        assert_eq!(desired_visibility(&i), Visibility::Autohidden);
        i.hover = true;
        assert_eq!(desired_visibility(&i), Visibility::Shown);
        i.fullscreen = true;
        assert_eq!(desired_visibility(&i), Visibility::Suppressed);
        let j = VisibilityInputs { auto_hide: true, show_on_desktop: true, desktop_in_front: true, ..Default::default() };
        assert_eq!(desired_visibility(&j), Visibility::Shown);
    }

    #[test]
    fn accelerators() {
        assert_eq!(parse_accelerator("Alt+T"), Some((MOD_ALT, 'T' as u32)));
        assert_eq!(parse_accelerator("ctrl+shift+f2"), Some((MOD_CONTROL | MOD_SHIFT, 0x71)));
        assert_eq!(parse_accelerator("T"), None);
        assert_eq!(parse_accelerator("Alt+T+Y"), None);
    }

    #[test]
    fn old_settings_keep_their_taskbar_choice() {
        let g: DockGeometry = serde_json::from_str(r#"{"edge":"top","hideTaskbar":false}"#).unwrap();
        assert_eq!(g.taskbar_mode(), TaskbarMode::Normal);
        assert_eq!(g.displays, Displays::Main);
    }
}
