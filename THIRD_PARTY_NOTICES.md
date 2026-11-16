# Third-party notices

GlintBar is built on open-source software and public data services. Their licences are listed
here; the full licence texts ship with each package (node_modules, the Cargo registry).

## Libraries in the app

| Component | Licence |
|---|---|
| Tauri, tauri-plugin-single-instance, tauri-plugin-autostart, @tauri-apps/api | Apache-2.0 OR MIT |
| windows-rs (windows, windows-core, windows-collections) | MIT OR Apache-2.0 |
| React, React DOM | MIT |
| zustand | MIT |
| Tailwind CSS (generated styles) | MIT |
| Lucide icons (lucide-react) | ISC |
| Simple Icons (brand glyphs) | CC0-1.0; the brands themselves are trademarks of their owners |
| serde, serde_json, tokio, chrono, thiserror, tracing, reqwest, image, keyring, getrandom | MIT OR Apache-2.0 (tokio, tracing: MIT) |
| rusqlite with bundled SQLite | MIT; SQLite is in the public domain |

## Data

- Weather and city search: [Open-Meteo](https://open-meteo.com/), data licensed under
  CC BY 4.0. Weather data by Open-Meteo.com.
- Every other widget talks to the service you connect it to, with your own key or sign-in.

## Adapted code

Code adapted from other projects, with their licences.

### dock (MIT) — Win32 call patterns in src-tauri/src/services/apps

The apps service was written for GlintBar, but a few Win32 call patterns were adapted from an
MIT-licensed Tauri dock project: reading the taskbar's pin order from the Taskband
"Favorites" blob, turning a shell icon bitmap (premultiplied BGRA) into straight RGBA, the
Alt-key tap before SetForegroundWindow, the hidden shell-hook window for HSHELL_FLASH, and the
FileDescription lookup in a program's version resource.

```
MIT License

Copyright (c) 2026 Dhyey

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
