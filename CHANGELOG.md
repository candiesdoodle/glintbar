# Changelog

## Unreleased

- The dock's height is now a share of the screen's height, shown as a percentage next to the
  Height slider in Settings > Dock. On a shorter or taller screen, such as a Remote Desktop session,
  the bar keeps its proportions instead of its pixel size; cards, menus and Settings keep their size.
  The widgets never get smaller or larger than the Height slider allows (26 to 120 px).
- The dock re-sizes itself if the screen's scale percentage changes without Windows announcing it.

## 0.1.5

- Fixed: clicking a window preview, or an item in an app's right-click menu, also opened the Apps
  settings card.
- Magnification eases in and out, and the app icons no longer jump sideways when it starts (most
  visible with Fill, left or right alignment).
- Magnified icons no longer follow the pointer while it is inside a window preview or a
  right-click menu, and they go back to normal after a click in one.
- New option, Highlight the active app (Settings > Dock, or the Apps card): the app whose window is
  in front gets a tinted background that follows the theme and widget style.
- Fixed: a grey box around Settings, cards and menus over a bright window (the panel's shadow was
  wider than the part of the screen the dock draws on). Panel shadows are smaller now.
- Audio Output: click the tile's round icon to mute or unmute.
- Tray: on Windows 11 22H2 and later, where tray icons can't be listed, a click on the tile opens
  Windows' own hidden-icons flyout directly.

## 0.1.4

- Settings > About links to the project page and to the issue list on GitHub.

## 0.1.3

- Fixed: with a dock on each display, the dock on a second display could disappear after its
  right-click menu, Settings or the widget search was used. It now stays visible, and the log
  records every time a dock window is hidden, moved or re-created, with the reason.
- Settings > Dock > Align widgets has a new choice, Fill: on a full-width dock the widgets stretch so
  together they span the whole bar, with each one's content kept at its usual size in its middle.

## 0.1.2

First public release.

- A dock that replaces the Windows 10/11 taskbar: pinned and running apps with window previews and
  jump lists, a Start button, tray icons, and space reserved so maximised windows stop at the dock.
- 110 widgets in 13 categories: system monitors, media, weather, clocks, calendar, to-dos, notes,
  timers, screen time, files, and account widgets for AI plan limits, revenue, analytics,
  developer tools, mail, GitHub, stocks and social follower counts.
- Account widgets show sample numbers until connected. Keys stay in Windows Credential Manager and
  every request goes straight from the PC to the service; there is no server or telemetry.
- Top or bottom edge, pill or full width, three sizes plus a height slider, auto-hide, magnified
  icons, one dock per display or one that follows the pointer, and six themes including two glass.
- Hides the Windows taskbar while running (or switches on its auto-hide, or leaves it alone) and
  always restores it on exit, sign-out or a crash.
- Hides on displays showing a full-screen app, idles well under 1 % CPU, and offers automations
  such as pausing music before meetings and alerts when an AI plan is nearly used up.
- Keyboard control of the dock (Win+Alt+T), and settings backup and restore.
