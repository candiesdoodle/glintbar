# Changelog

## 0.1.5

- Fixed: clicking a window preview, or an item in an app's right-click menu, also opened the Apps
  settings card.
- Magnification eases in and out, and the app icons no longer jump sideways when it starts (most
  visible with Fill, left or right alignment).
- New option, Highlight the active app (Settings > Dock, or the Apps card): the app whose window is
  in front gets a coloured background.
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
