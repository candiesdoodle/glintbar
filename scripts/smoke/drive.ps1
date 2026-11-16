<#
.SYNOPSIS
  Drives a GlintBar build on the GitHub Actions Windows runner (the only place it ever runs).

.DESCRIPTION
  Launches glintbar.exe in smoke mode (GLINTBAR_SMOKE=1, GLINTBAR_NO_CAPTURE_EXCLUDE=1), moves the real
  mouse with SendInput using the rects the app publishes in %APPDATA%\GlintBar\smoke\layout.json,
  screenshots every step (CopyFromScreen with CaptureBlt, so layered windows are included), drives
  the app through the command channel (command.json -> command-result.json, see src/smoke), then
  quits and checks that the Windows taskbar and the work area are back.

  Round two (steps tagged -Check) drives the risky paths: typing into the picker and a card with
  SendInput Unicode keys (focus must come back), the Alt+T hotkey, the Apps tile with a real File
  Explorer (launch, minimize, restore, preview, menu, close) and the Start button, drag-reordering
  tiles and dragging the dock to the top and back, a card at the top edge, auto-hide, full-screen
  hiding (a borderless topmost test window), live glass with capture exclusion really on for a few
  seconds (smoke.capture_override), the three taskbar modes, idle CPU/memory, and finally a hard
  kill with the taskbar hidden followed by a relaunch (crash recovery) before the normal quit.

  Round three: Displays = All on the one-screen runner, then the dock watchdog (the dock window
  hidden with SW_HIDE and stripped of HWND_TOPMOST from here must come back, with a log line), Mac-
  style magnification at 200 % (the hovered app rises above the bar, is visible there in screen
  pixels and takes a click there), and a full-width dock aligned left, centre and right.

  Every step is logged to <OutDir>\drive.log and recorded in <OutDir>\drive.json; one failing step
  never stops the run. Exit code 1 only when the app crashed, the dock never rendered, or the
  taskbar / work area was not restored on quit.

.EXAMPLE
  pwsh -File scripts/smoke/drive.ps1 -Exe src-tauri/target/release/glintbar.exe -OutDir smoke
#>
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string]$OutDir = 'smoke',
    [int]$BudgetSec = 600,
    [int]$Width = 1920,
    [int]$Height = 1080
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$script:T0 = [System.Diagnostics.Stopwatch]::StartNew()

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
$LogFile = Join-Path $OutDir 'drive.log'
$AppData = [Environment]::GetFolderPath('ApplicationData')
$AppSmoke = Join-Path $AppData 'GlintBar\smoke'

$script:Steps = [System.Collections.Generic.List[object]]::new()
$script:Shots = [System.Collections.Generic.List[string]]::new()
$script:ShotSeq = 0
$script:CmdSeq = 0
$script:Proc = $null
$script:Crashed = $false
$script:CrashInfo = $null
$script:Quitting = $false
$script:NativeOk = $false
$script:DockRendered = $false
$script:TaskbarRestored = $false
$script:Report = [ordered]@{
    startedAt = (Get-Date).ToString('o')
    exe       = $Exe
}

function Write-Log([string]$Message) {
    $line = '[{0,7:N1}s] {1}' -f $script:T0.Elapsed.TotalSeconds, $Message
    Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
    Write-Host $line
}

# ---- native helpers ---------------------------------------------------------------------------

$nativeSource = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace GlintBarSmoke {
    public static class Native {
        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

        // 64-bit INPUT: type (4) + padding (4) + MOUSEINPUT (32) = 40 bytes. MOUSEINPUT is the
        // largest union member, so declaring only it gives the right size and offsets.
        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT {
            public uint type;
            public MOUSEINPUT mi;
        }

        const uint INPUT_MOUSE = 0;
        const uint MOVE = 0x0001, LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;
        const uint VIRTUALDESK = 0x4000, ABSOLUTE = 0x8000;

        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
        [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowW(string cls, string title);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SystemParametersInfoW(uint action, uint param, ref RECT r, uint winIni);
        [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);

        public static string MakeDpiAware() {
            try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return "per-monitor v2"; } catch (Exception) { }
            try { if (SetProcessDPIAware()) return "system aware"; } catch (Exception) { }
            return "unchanged (already set by the host)";
        }

        public static int InputSize() { return Marshal.SizeOf(typeof(INPUT)); }

        // Virtual screen: x, y, width, height (physical px once DPI aware).
        public static int[] VirtualScreen() {
            return new int[] { GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79) };
        }

        public static int[] PrimaryScreen() {
            return new int[] { GetSystemMetrics(0), GetSystemMetrics(1) };
        }

        static uint Send(uint flags, int dx, int dy) {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_MOUSE;
            inputs[0].mi.dx = dx;
            inputs[0].mi.dy = dy;
            inputs[0].mi.dwFlags = flags;
            uint sent = SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
            if (sent == 0) mouse_event(flags, dx, dy, 0, UIntPtr.Zero);
            return sent;
        }

        public static uint Move(int x, int y) {
            SetCursorPos(x, y);
            int[] v = VirtualScreen();
            int nx = (int)(((long)(x - v[0]) * 65535) / Math.Max(1, v[2] - 1));
            int ny = (int)(((long)(y - v[1]) * 65535) / Math.Max(1, v[3] - 1));
            return Send(MOVE | ABSOLUTE | VIRTUALDESK, nx, ny);
        }

        public static uint Click(int x, int y, bool right) {
            uint sent = Move(x, y);
            Thread.Sleep(60);
            sent += Send(right ? RIGHTDOWN : LEFTDOWN, 0, 0);
            Thread.Sleep(50);
            sent += Send(right ? RIGHTUP : LEFTUP, 0, 0);
            return sent;
        }

        public static int[] Cursor() {
            POINT p;
            GetCursorPos(out p);
            return new int[] { p.X, p.Y };
        }

        public static string ClassOf(IntPtr h) {
            if (h == IntPtr.Zero) return "";
            StringBuilder sb = new StringBuilder(256);
            GetClassNameW(h, sb, 256);
            return sb.ToString();
        }

        public static uint PidOf(IntPtr h) {
            uint pid = 0;
            if (h != IntPtr.Zero) GetWindowThreadProcessId(h, out pid);
            return pid;
        }

        // The top-level window under a screen point (respects window regions).
        public static IntPtr RootAt(int x, int y) {
            POINT p;
            p.X = x;
            p.Y = y;
            IntPtr h = WindowFromPoint(p);
            if (h == IntPtr.Zero) return h;
            IntPtr root = GetAncestor(h, 2);
            return root == IntPtr.Zero ? h : root;
        }

        public static IntPtr Foreground() { return GetForegroundWindow(); }

        public static IntPtr Taskbar() { return FindWindowW("Shell_TrayWnd", null); }

        public static int[] WorkArea() {
            RECT r = new RECT();
            SystemParametersInfoW(0x0030, 0, ref r, 0);
            return new int[] { r.Left, r.Top, r.Right, r.Bottom };
        }

        public static int[] WindowRect(IntPtr h) {
            RECT r;
            if (!GetWindowRect(h, out r)) return new int[] { 0, 0, 0, 0 };
            return new int[] { r.Left, r.Top, r.Right, r.Bottom };
        }
    }
}
'@

$displaySource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace GlintBarSmoke {
    public static class Display {
        // DEVMODEW, display variant (220 bytes).
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct DEVMODE {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
            public short dmSpecVersion;
            public short dmDriverVersion;
            public short dmSize;
            public short dmDriverExtra;
            public int dmFields;
            public int dmPositionX;
            public int dmPositionY;
            public int dmDisplayOrientation;
            public int dmDisplayFixedOutput;
            public short dmColor;
            public short dmDuplex;
            public short dmYResolution;
            public short dmTTOption;
            public short dmCollate;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
            public short dmLogPixels;
            public int dmBitsPerPel;
            public int dmPelsWidth;
            public int dmPelsHeight;
            public int dmDisplayFlags;
            public int dmDisplayFrequency;
            public int dmICMMethod;
            public int dmICMIntent;
            public int dmMediaType;
            public int dmDitherType;
            public int dmReserved1;
            public int dmReserved2;
            public int dmPanningWidth;
            public int dmPanningHeight;
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "EnumDisplaySettingsW")]
        static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "ChangeDisplaySettingsW")]
        static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);

        static DEVMODE NewMode() {
            DEVMODE dm = new DEVMODE();
            dm.dmDeviceName = "";
            dm.dmFormName = "";
            dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
            return dm;
        }

        public static string Modes() {
            List<string> list = new List<string>();
            for (int i = 0; i < 400; i++) {
                DEVMODE dm = NewMode();
                if (!EnumDisplaySettings(null, i, ref dm)) break;
                string m = dm.dmPelsWidth + "x" + dm.dmPelsHeight;
                if (!list.Contains(m)) list.Add(m);
            }
            return string.Join(" ", list.ToArray());
        }

        public static string Set(int width, int height) {
            DEVMODE dm = NewMode();
            if (!EnumDisplaySettings(null, -1, ref dm)) return "EnumDisplaySettings failed";
            if (dm.dmPelsWidth == width && dm.dmPelsHeight == height) return "ok (already " + width + "x" + height + ")";
            dm.dmPelsWidth = width;
            dm.dmPelsHeight = height;
            dm.dmFields = 0x00080000 | 0x00100000;
            int test = ChangeDisplaySettings(ref dm, 2);
            if (test != 0) return "rejected " + width + "x" + height + " (test " + test + ")";
            int result = ChangeDisplaySettings(ref dm, 0);
            return result == 0 ? "ok" : "ChangeDisplaySettings returned " + result;
        }
    }
}
'@

try {
    Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop
    $script:NativeOk = $true
    Write-Log ("native helpers ready; DPI: {0}; INPUT size {1}" -f [GlintBarSmoke.Native]::MakeDpiAware(), [GlintBarSmoke.Native]::InputSize())
} catch {
    Write-Log "HARNESS ERROR: native helpers did not compile: $($_.Exception.Message)"
}
try {
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
} catch {
    Write-Log "HARNESS ERROR: System.Drawing is unavailable: $($_.Exception.Message)"
}

# Round two: keyboard input, drags, windows, the taskbar's app-bar state and test windows. A
# separate Add-Type so a problem here never takes the round-one helpers down with it.
$extraSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace GlintBarSmoke {
    // SendInput with the whole INPUT union (MOUSEINPUT and KEYBDINPUT overlap). MOUSEINPUT is the
    // largest member (32 bytes on x64), so INPUT is 40 bytes on x64 (type 4 + padding 4 + union 32)
    // and 28 on x86, the sizes SendInput expects in cbSize.
    public static class Input2 {
        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        // x64: wVk 0, wScan 2, dwFlags 4, time 8, (padding 12), dwExtraInfo 16 = 24 bytes.
        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct INPUTUNION {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT {
            public uint type;
            public INPUTUNION u;
        }

        const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
        const uint KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004;
        const uint MOVE = 0x0001, LEFTDOWN = 0x0002, LEFTUP = 0x0004, VIRTUALDESK = 0x4000, ABSOLUTE = 0x8000;

        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
        [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);

        public static int Size() { return Marshal.SizeOf(typeof(INPUT)); }

        static uint SendOne(INPUT input) {
            INPUT[] one = new INPUT[] { input };
            return SendInput(1, one, Size());
        }

        static INPUT Key(ushort vk, ushort scan, uint flags) {
            INPUT i = new INPUT();
            i.type = INPUT_KEYBOARD;
            i.u.ki.wVk = vk;
            i.u.ki.wScan = scan;
            i.u.ki.dwFlags = flags;
            i.u.ki.time = 0;
            i.u.ki.dwExtraInfo = IntPtr.Zero;
            return i;
        }

        // Types text as Unicode key events (they reach the focused window as VK_PACKET / WM_CHAR).
        public static uint Type(string text, int delayMs) {
            uint sent = 0;
            foreach (char c in text) {
                sent += SendOne(Key(0, (ushort)c, KEYEVENTF_UNICODE));
                sent += SendOne(Key(0, (ushort)c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
                if (delayMs > 0) Thread.Sleep(delayMs);
            }
            return sent;
        }

        // Presses virtual keys together: down in order, up in reverse order.
        public static uint Press(int[] vks, int holdMs) {
            uint sent = 0;
            for (int k = 0; k < vks.Length; k++) {
                sent += SendOne(Key((ushort)vks[k], 0, 0));
                Thread.Sleep(25);
            }
            if (holdMs > 0) Thread.Sleep(holdMs);
            for (int k = vks.Length - 1; k >= 0; k--) {
                sent += SendOne(Key((ushort)vks[k], 0, KEYEVENTF_KEYUP));
                Thread.Sleep(25);
            }
            return sent;
        }

        static uint SendMouse(uint flags, int dx, int dy) {
            INPUT i = new INPUT();
            i.type = INPUT_MOUSE;
            i.u.mi.dx = dx;
            i.u.mi.dy = dy;
            i.u.mi.mouseData = 0;
            i.u.mi.dwFlags = flags;
            i.u.mi.time = 0;
            i.u.mi.dwExtraInfo = IntPtr.Zero;
            return SendOne(i);
        }

        public static uint MoveTo(int x, int y) {
            SetCursorPos(x, y);
            int vx = GetSystemMetrics(76);
            int vy = GetSystemMetrics(77);
            int vw = GetSystemMetrics(78);
            int vh = GetSystemMetrics(79);
            int nx = (int)(((long)(x - vx) * 65535) / Math.Max(1, vw - 1));
            int ny = (int)(((long)(y - vy) * 65535) / Math.Max(1, vh - 1));
            return SendMouse(MOVE | ABSOLUTE | VIRTUALDESK, nx, ny);
        }

        public static uint LeftDown() { return SendMouse(LEFTDOWN, 0, 0); }

        public static uint LeftUp() { return SendMouse(LEFTUP, 0, 0); }
    }

    public static class Win {
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

        // x64: cbSize 4 + padding 4, hWnd 8, uCallbackMessage 4, uEdge 4, rc 16, lParam 8 = 48 bytes.
        [StructLayout(LayoutKind.Sequential)]
        public struct APPBARDATA {
            public uint cbSize;
            public IntPtr hWnd;
            public uint uCallbackMessage;
            public uint uEdge;
            public RECT rc;
            public IntPtr lParam;
        }

        public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

        [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint dwMessage, ref APPBARDATA pData);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowW(string cls, string title);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] static extern bool GetWindowDisplayAffinity(IntPtr h, out uint affinity);

        static IntPtr H(long h) { return new IntPtr(h); }

        // Every top-level window of a class (visible or not).
        public static long[] ByClass(string cls) {
            List<long> found = new List<long>();
            EnumWindowsProc cb = delegate (IntPtr h, IntPtr l) {
                StringBuilder sb = new StringBuilder(256);
                GetClassNameW(h, sb, 256);
                if (sb.ToString() == cls) found.Add(h.ToInt64());
                return true;
            };
            EnumWindows(cb, IntPtr.Zero);
            GC.KeepAlive(cb);
            return found.ToArray();
        }

        public static string ClassOf(long h) {
            if (h == 0) return "";
            StringBuilder sb = new StringBuilder(256);
            GetClassNameW(H(h), sb, 256);
            return sb.ToString();
        }

        public static uint PidOf(long h) {
            uint pid = 0;
            if (h != 0) GetWindowThreadProcessId(H(h), out pid);
            return pid;
        }

        public static bool Visible(long h) { return IsWindowVisible(H(h)); }
        public static bool Exists(long h) { return h != 0 && IsWindow(H(h)); }
        public static bool Minimized(long h) { return IsIconic(H(h)); }
        public static long Foreground() { return GetForegroundWindow().ToInt64(); }

        // SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
        public static bool MoveTo(long h, int x, int y) { return SetWindowPos(H(h), IntPtr.Zero, x, y, 0, 0, 0x0001 | 0x0004 | 0x0010); }

        // WM_CLOSE, as the window's own close button would.
        public static bool Close(long h) { return PostMessageW(H(h), 0x0010, IntPtr.Zero, IntPtr.Zero); }

        public static int[] Rect(long h) {
            RECT r;
            if (!GetWindowRect(H(h), out r)) return new int[] { 0, 0, 0, 0 };
            return new int[] { r.Left, r.Top, r.Right, r.Bottom };
        }

        // GetWindowDisplayAffinity works for any process's window: 0 none, 17 excluded from capture.
        public static long Affinity(long h) {
            uint a;
            if (!GetWindowDisplayAffinity(H(h), out a)) return -1;
            return a;
        }

        public static int AppBarDataSize() { return Marshal.SizeOf(typeof(APPBARDATA)); }

        // ABM_GETSTATE of the primary taskbar: 1 = ABS_AUTOHIDE, 2 = ABS_ALWAYSONTOP; -1 when there is none.
        public static long TaskbarState() {
            APPBARDATA d = new APPBARDATA();
            d.cbSize = (uint)Marshal.SizeOf(typeof(APPBARDATA));
            d.hWnd = FindWindowW("Shell_TrayWnd", null);
            if (d.hWnd == IntPtr.Zero) return -1;
            return (long)SHAppBarMessage(4, ref d).ToUInt64();
        }
    }

    // Plain Win32 test windows, each on its own thread with its own message loop (no WinForms, so
    // nothing depends on which assemblies PowerShell can reference).
    public static class TestWindow {
        public delegate IntPtr WndProcFn(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam);

        // x64: 80 bytes, like WNDCLASSEXW.
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct WNDCLASSEX {
            public uint cbSize;
            public uint style;
            public IntPtr lpfnWndProc;
            public int cbClsExtra;
            public int cbWndExtra;
            public IntPtr hInstance;
            public IntPtr hIcon;
            public IntPtr hCursor;
            public IntPtr hbrBackground;
            public string lpszMenuName;
            public string lpszClassName;
            public IntPtr hIconSm;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        // x64: 48 bytes, like MSG.
        [StructLayout(LayoutKind.Sequential)]
        public struct MSG {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public POINT pt;
            public uint lPrivate;
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern ushort RegisterClassExW(ref WNDCLASSEX wc);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateWindowExW(uint exStyle, string cls, string title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
        [DllImport("user32.dll")] static extern IntPtr DefWindowProcW(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] static extern int GetMessageW(out MSG m, IntPtr h, uint min, uint max);
        [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
        [DllImport("user32.dll")] static extern IntPtr DispatchMessageW(ref MSG m);
        [DllImport("user32.dll")] static extern void PostQuitMessage(int code);
        [DllImport("user32.dll")] static extern IntPtr LoadCursorW(IntPtr instance, IntPtr name);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] static extern bool UpdateWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
        [DllImport("gdi32.dll")] static extern IntPtr CreateSolidBrush(uint color);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string name);

        // Kept in a static field so the delegate outlives every window.
        static readonly WndProcFn Proc = new WndProcFn(Handle);
        static readonly object Gate = new object();
        static readonly List<string> Registered = new List<string>();

        static IntPtr Handle(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam) {
            if (msg == 0x0002) { // WM_DESTROY: end this window's thread
                PostQuitMessage(0);
                return IntPtr.Zero;
            }
            return DefWindowProcW(h, msg, wParam, lParam);
        }

        // One window class per background colour (0xRRGGBB).
        static string ClassFor(uint rgb) {
            string name = "GlintBarSmokeWindow" + rgb.ToString("X6");
            lock (Gate) {
                if (Registered.Contains(name)) return name;
                WNDCLASSEX wc = new WNDCLASSEX();
                wc.cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX));
                wc.lpfnWndProc = Marshal.GetFunctionPointerForDelegate(Proc);
                wc.hInstance = GetModuleHandleW(null);
                wc.hCursor = LoadCursorW(IntPtr.Zero, new IntPtr(32512));
                uint colorref = ((rgb & 0xFFu) << 16) | (rgb & 0xFF00u) | ((rgb >> 16) & 0xFFu);
                wc.hbrBackground = CreateSolidBrush(colorref);
                wc.lpszMenuName = null;
                wc.lpszClassName = name;
                if (RegisterClassExW(ref wc) == 0) {
                    int err = Marshal.GetLastWin32Error();
                    if (err != 1410) throw new InvalidOperationException("RegisterClassEx failed: " + err);
                }
                Registered.Add(name);
                return name;
            }
        }

        // kind: "normal" (title bar, like an app window), "popup" (borderless tool window) or
        // "fullscreen" (borderless, topmost, the whole primary screen). Returns the HWND.
        public static long Open(string kind, string title, int x, int y, int w, int h, uint rgb) {
            string cls = ClassFor(rgb);
            long result = 0;
            string error = null;
            ManualResetEvent ready = new ManualResetEvent(false);
            Thread t = new Thread(new ThreadStart(delegate () {
                uint ex = 0;
                uint style = 0x00CF0000u | 0x10000000u; // WS_OVERLAPPEDWINDOW | WS_VISIBLE
                int px = x, py = y, pw = w, ph = h;
                if (kind == "fullscreen") {
                    ex = 0x00000008u; // WS_EX_TOPMOST
                    style = 0x80000000u | 0x10000000u; // WS_POPUP | WS_VISIBLE
                    px = 0;
                    py = 0;
                    pw = GetSystemMetrics(0);
                    ph = GetSystemMetrics(1);
                } else if (kind == "popup") {
                    ex = 0x00000080u; // WS_EX_TOOLWINDOW
                    style = 0x80000000u | 0x10000000u;
                }
                IntPtr hwnd = CreateWindowExW(ex, cls, title, style, px, py, pw, ph, IntPtr.Zero, IntPtr.Zero, GetModuleHandleW(null), IntPtr.Zero);
                if (hwnd == IntPtr.Zero) {
                    error = "CreateWindowEx failed: " + Marshal.GetLastWin32Error();
                    ready.Set();
                    return;
                }
                ShowWindow(hwnd, 5);
                UpdateWindow(hwnd);
                SetForegroundWindow(hwnd);
                result = hwnd.ToInt64();
                ready.Set();
                MSG m;
                while (GetMessageW(out m, IntPtr.Zero, 0, 0) > 0) {
                    TranslateMessage(ref m);
                    DispatchMessageW(ref m);
                }
            }));
            t.IsBackground = true;
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            if (!ready.WaitOne(10000)) throw new TimeoutException("the test window did not appear within 10 s");
            if (error != null) throw new InvalidOperationException(error);
            return result;
        }
    }
}
'@

$script:ExtraOk = $false
if ($script:NativeOk) {
    try {
        Add-Type -TypeDefinition $extraSource -Language CSharp -IgnoreWarnings -ErrorAction Stop
        $script:ExtraOk = $true
        $inSize = [GlintBarSmoke.Input2]::Size()
        Write-Log ("round-two helpers ready; INPUT (union) size {0} (round one: {1}), APPBARDATA size {2}" -f $inSize, [GlintBarSmoke.Native]::InputSize(), [GlintBarSmoke.Win]::AppBarDataSize())
        if ($inSize -ne [GlintBarSmoke.Native]::InputSize()) { Write-Log 'HARNESS WARNING: the two INPUT layouts differ in size; keyboard input may fail' }
    } catch {
        Write-Log "HARNESS ERROR: round-two helpers did not compile: $($_.Exception.Message)"
    }
}

# Round three: hide a dock window or drop its topmost flag behind GlintBar's back (the watchdog
# check). Its own Add-Type, so a problem here never takes the other helpers down with it.
$guardSource = @'
using System;
using System.Runtime.InteropServices;

namespace GlintBarSmoke {
    public static class Guard {
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int index);

        // SW_HIDE, as any other program could do it.
        public static bool Hide(long h) { return ShowWindow(new IntPtr(h), 0); }

        // HWND_NOTOPMOST (-2) with SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE.
        public static bool DropTopmost(long h) { return SetWindowPos(new IntPtr(h), new IntPtr(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); }

        // WS_EX_TOPMOST (0x8) in GWL_EXSTYLE (-20).
        public static bool IsTopmost(long h) { return (GetWindowLongPtr(new IntPtr(h), -20).ToInt64() & 0x8) != 0; }
    }
}
'@

$script:GuardOk = $false
if ($script:NativeOk) {
    try {
        Add-Type -TypeDefinition $guardSource -Language CSharp -IgnoreWarnings -ErrorAction Stop
        $script:GuardOk = $true
    } catch {
        Write-Log "HARNESS ERROR: watchdog helpers did not compile: $($_.Exception.Message)"
    }
}

# ---- small helpers ----------------------------------------------------------------------------

function Get-ScreenBounds {
    if ($script:NativeOk) {
        $v = [GlintBarSmoke.Native]::VirtualScreen()
        $p = [GlintBarSmoke.Native]::PrimaryScreen()
        return [ordered]@{ x = $v[0]; y = $v[1]; width = $v[2]; height = $v[3]; primaryWidth = $p[0]; primaryHeight = $p[1] }
    }
    return [ordered]@{ x = 0; y = 0; width = 1024; height = 768; primaryWidth = 1024; primaryHeight = 768 }
}

# Graphics.CopyFromScreen rejects SourceCopy|CaptureBlt as an enum value, so call BitBlt directly.
function Initialize-Cap {
    if (-not ('GlintBarSmoke.Cap' -as [type])) {
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; namespace GlintBarSmoke { public static class Cap { [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h); [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc); [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop); public static bool Grab(IntPtr dst, int sx, int sy, int w, int h) { IntPtr src = GetDC(IntPtr.Zero); try { return BitBlt(dst, 0, 0, w, h, src, sx, sy, 0x40CC0020); } finally { ReleaseDC(IntPtr.Zero, src); } } } }' -ErrorAction Stop
    }
}

# One screen pixel as a screenshot sees it (CaptureBlt): @(R, G, B).
function Get-ScreenColor([int]$X, [int]$Y) {
    Initialize-Cap
    $bmp = New-Object System.Drawing.Bitmap -ArgumentList 1, 1
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $hdc = $g.GetHdc()
        try { [void][GlintBarSmoke.Cap]::Grab($hdc, $X, $Y, 1, 1) } finally { $g.ReleaseHdc($hdc) }
        $c = $bmp.GetPixel(0, 0)
        return @([int]$c.R, [int]$c.G, [int]$c.B)
    } finally {
        $g.Dispose()
        $bmp.Dispose()
    }
}

# Largest per-channel difference between two @(R, G, B).
function Get-ColorDistance($A, $B) {
    $d = 0
    for ($i = 0; $i -lt 3; $i++) { $d = [Math]::Max($d, [Math]::Abs([int]$A[$i] - [int]$B[$i])) }
    return $d
}

# Full virtual screen, CaptureBlt so layered (transparent) windows are included. Not downscaled.
function Save-Shot([string]$Name) {
    $script:ShotSeq++
    $file = Join-Path $OutDir ('{0:D2}-{1}.png' -f $script:ShotSeq, $Name)
    try {
        $b = Get-ScreenBounds
        $bmp = New-Object System.Drawing.Bitmap -ArgumentList ([int]$b.width), ([int]$b.height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        Initialize-Cap
        $hdc = $g.GetHdc()
        try { [void][GlintBarSmoke.Cap]::Grab($hdc, [int]$b.x, [int]$b.y, [int]$b.width, [int]$b.height) } finally { $g.ReleaseHdc($hdc) }
        $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose()
        $bmp.Dispose()
        $script:Shots.Add((Split-Path -Leaf $file))
        Write-Log "  shot $(Split-Path -Leaf $file)"
    } catch {
        Write-Log "  shot $Name FAILED: $($_.Exception.Message)"
    }
}

function Test-Alive {
    if ($null -eq $script:Proc) { return $false }
    try { $script:Proc.Refresh() } catch { }
    if ($script:Proc.HasExited) {
        if (-not $script:Quitting -and -not $script:Crashed) {
            $script:Crashed = $true
            $code = $null
            try { $code = $script:Proc.ExitCode } catch { }
            $script:CrashInfo = "exited unexpectedly (exit code $code) after $([int]$script:T0.Elapsed.TotalSeconds) s"
            Write-Log "APP $($script:CrashInfo)"
        }
        return $false
    }
    return $true
}

# Reads a JSON file the app writes; shares the file so the app can replace it meanwhile.
function Read-SmokeJson([string]$Name) {
    $path = Join-Path $AppSmoke $Name
    for ($i = 0; $i -lt 5; $i++) {
        if (-not (Test-Path -LiteralPath $path)) { return $null }
        try {
            $share = [System.IO.FileShare]'ReadWrite, Delete'
            $fs = [System.IO.FileStream]::new($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
            try {
                $sr = [System.IO.StreamReader]::new($fs, [System.Text.Encoding]::UTF8)
                $text = $sr.ReadToEnd()
                $sr.Dispose()
            } finally {
                $fs.Dispose()
            }
            if ($text) { return ($text | ConvertFrom-Json -ErrorAction Stop) }
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
    return $null
}

# Atomic replace (UTF-8 without BOM).
function Write-SmokeFile([string]$Name, [string]$Text) {
    $path = Join-Path $AppSmoke $Name
    $tmp = "$path.driver.tmp"
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($tmp, $Text, $utf8)
    for ($i = 0; $i -lt 10; $i++) {
        try {
            [System.IO.File]::Move($tmp, $path, $true)
            return
        } catch {
            Start-Sleep -Milliseconds 50
        }
    }
    [System.IO.File]::WriteAllText($path, $Text, $utf8)
}

# Writes command.json and waits for command-result.json with the same id. Returns the result
# (arrays stay arrays: the leading comma stops PowerShell from unrolling them).
function Send-Command {
    param([string]$Action, $CmdArgs = $null, [int]$TimeoutSec = 20)
    if (-not (Test-Alive)) { throw 'the app is not running' }
    $script:CmdSeq++
    $id = 'd{0}-{1}' -f $script:CmdSeq, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $json = [ordered]@{ id = $id; action = $Action; args = $CmdArgs } | ConvertTo-Json -Depth 10 -Compress
    Write-SmokeFile 'command.json' $json
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 150
        $res = Read-SmokeJson 'command-result.json'
        if ($null -ne $res -and $res.id -eq $id) {
            if (-not $res.ok) { throw "command $Action failed: $($res.error)" }
            return , ($res.result)
        }
        if (-not (Test-Alive)) { throw "the app exited while running $Action" }
    }
    throw "command $Action timed out after $TimeoutSec s"
}

function Get-Layout { return (Send-Command -Action 'dumpLayout') }

function Invoke-Click([int]$X, [int]$Y, [switch]$Right) {
    if (-not $script:NativeOk) { throw 'no native input helpers' }
    $sent = [GlintBarSmoke.Native]::Click($X, $Y, [bool]$Right)
    $kind = 'left'
    if ($Right) { $kind = 'right' }
    Write-Log ("  {0} click at {1},{2} (SendInput events: {3})" -f $kind, $X, $Y, $sent)
}

function Move-Mouse([int]$X, [int]$Y) {
    if ($script:NativeOk) { [void][GlintBarSmoke.Native]::Move($X, $Y) }
}

# A point on the empty desktop, away from the dock and from cards/panels.
function Get-DesktopPoint($Layout) {
    $b = Get-ScreenBounds
    $x = [int]($b.x + $b.primaryWidth * 0.97)
    if ($null -ne $Layout -and $Layout.edge -eq 'top') {
        $y = [int]($b.y + $b.primaryHeight * 0.96)
    } else {
        $y = [int]($b.y + $b.primaryHeight * 0.04)
    }
    return @($x, $y)
}

function Get-WindowAt([int]$X, [int]$Y) {
    $h = [GlintBarSmoke.Native]::RootAt($X, $Y)
    $procId = [GlintBarSmoke.Native]::PidOf($h)
    $isGlintBar = ($null -ne $script:Proc -and [int]$procId -eq $script:Proc.Id)
    return [ordered]@{ hwnd = $h.ToInt64(); class = [GlintBarSmoke.Native]::ClassOf($h); pid = [int]$procId; isGlintBar = $isGlintBar }
}

# Clicks the desktop and checks that every card, menu and panel closed (Rust's outside-click).
function Close-ByDesktopClick([string]$What) {
    $l = Get-Layout
    $p = Get-DesktopPoint $l
    $at = Get-WindowAt $p[0] $p[1]
    Invoke-Click $p[0] $p[1]
    Start-Sleep -Milliseconds 700
    $after = Get-Layout
    $open = @()
    if ($null -ne $after.ui.card) { $open += 'card' }
    if ($after.ui.menu) { $open += 'menu' }
    if ($null -ne $after.ui.panel) { $open += "panel $($after.ui.panel)" }
    if ($open.Count -gt 0) {
        [void](Send-Command -Action 'closeAll')
        throw "a desktop click (window there: $($at.class), glintbar=$($at.isGlintBar)) did not close the $What; still open: $($open -join ', ')"
    }
    return "closed by a desktop click (window there: $($at.class))"
}

# abm: the primary taskbar's ABM_GETSTATE (1 auto-hide, 2 always on top), -1 when unknown.
function Get-TaskbarState {
    if (-not $script:NativeOk) { return [ordered]@{ found = $false; visible = $false; workArea = @(0, 0, 0, 0); abm = -1 } }
    $h = [GlintBarSmoke.Native]::Taskbar()
    $found = ($h -ne [IntPtr]::Zero)
    $visible = $false
    if ($found) { $visible = [GlintBarSmoke.Native]::IsWindowVisible($h) }
    $wa = [GlintBarSmoke.Native]::WorkArea()
    $abm = -1
    if ($script:ExtraOk) { try { $abm = [long][GlintBarSmoke.Win]::TaskbarState() } catch { $abm = -1 } }
    return [ordered]@{ found = $found; visible = [bool]$visible; workArea = @($wa[0], $wa[1], $wa[2], $wa[3]); abm = $abm }
}

# Runs one step; a throw marks it failed, the run goes on. Skipped once the app is gone, the dock
# never rendered, or the time budget is used up (unless -Always).
# -Check tags the round-two checks; summarize.mjs lists them with PASS/FAIL and their evidence.
function Invoke-Step {
    param([string]$Name, [scriptblock]$Body, [switch]$Always, [string]$Check = '')
    $n = $script:Steps.Count + 1
    if (-not $Always) {
        $why = $null
        if ($script:Crashed) { $why = 'the app is not running' }
        elseif (-not $script:DockRendered) { $why = 'the dock never rendered' }
        elseif ($script:T0.Elapsed.TotalSeconds -gt $BudgetSec) { $why = 'time budget used up' }
        if ($null -ne $why) {
            $script:Steps.Add([ordered]@{ n = $n; name = $Name; check = $Check; status = 'skipped'; ms = 0; detail = $why; error = $null })
            Write-Log "SKIP $n $Name ($why)"
            return
        }
    }
    Write-Log "STEP $n $Name"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $status = 'ok'
    $detail = $null
    $err = $null
    try {
        $out = & $Body
        if ($null -ne $out) { $detail = (@($out) | ForEach-Object { "$_" }) -join '; ' }
    } catch {
        $status = 'failed'
        $err = "$($_.Exception.Message) (drive.ps1 line $($_.InvocationInfo.ScriptLineNumber))"
    }
    [void](Test-Alive)
    if ($null -ne $detail -and $detail.Length -gt 900) { $detail = $detail.Substring(0, 900) + '...' }
    if ($null -ne $err -and $err.Length -gt 1200) { $err = $err.Substring(0, 1200) + '...' }
    $script:Steps.Add([ordered]@{ n = $n; name = $Name; check = $Check; status = $status; ms = $sw.ElapsedMilliseconds; detail = $detail; error = $err })
    if ($status -eq 'ok') { Write-Log "  ok ($($sw.ElapsedMilliseconds) ms) $detail" } else { Write-Log "  FAILED ($($sw.ElapsedMilliseconds) ms): $err" }
}

function Find-Tile($Layout, [string]$WidgetId) {
    foreach ($t in @($Layout.tiles)) { if ($t.widgetId -eq $WidgetId) { return $t } }
    return $null
}

# ---- round-two helpers ------------------------------------------------------------------------

$VK_RETURN = 0x0D
$VK_ESCAPE = 0x1B
$VK_MENU = 0x12
$VK_T = 0x54

function Assert-Extra {
    if (-not $script:ExtraOk) { throw 'round-two native helpers are unavailable (see the HARNESS lines in drive.log)' }
}

function Send-Text([string]$Text) {
    Assert-Extra
    $n = [GlintBarSmoke.Input2]::Type($Text, 40)
    Write-Log "  typed '$Text' (SendInput events: $n of $(2 * $Text.Length))"
    return $n
}

function Send-Keys([int[]]$Vks, [int]$HoldMs = 40) {
    Assert-Extra
    $n = [GlintBarSmoke.Input2]::Press($Vks, $HoldMs)
    Write-Log ("  keys {0} (SendInput events: {1})" -f (($Vks | ForEach-Object { '0x{0:X2}' -f $_ }) -join '+'), $n)
    return $n
}

# Left button down at (X1, Y1), several moves to (X2, Y2), up. Always releases the button.
function Invoke-Drag {
    param([int]$X1, [int]$Y1, [int]$X2, [int]$Y2, [int]$Steps = 12, [int]$StepMs = 40, [int]$HoldMs = 150)
    Assert-Extra
    [void][GlintBarSmoke.Input2]::MoveTo($X1, $Y1)
    Start-Sleep -Milliseconds 150
    $down = $false
    try {
        [void][GlintBarSmoke.Input2]::LeftDown()
        $down = $true
        Start-Sleep -Milliseconds $HoldMs
        for ($i = 1; $i -le $Steps; $i++) {
            $x = [int]($X1 + ($X2 - $X1) * $i / $Steps)
            $y = [int]($Y1 + ($Y2 - $Y1) * $i / $Steps)
            [void][GlintBarSmoke.Input2]::MoveTo($x, $y)
            Start-Sleep -Milliseconds $StepMs
        }
        Start-Sleep -Milliseconds 300
    } finally {
        if ($down) { [void][GlintBarSmoke.Input2]::LeftUp() }
    }
    Write-Log "  drag $X1,$Y1 -> $X2,$Y2 in $Steps moves"
}

function Get-ForegroundInfo {
    if (-not $script:ExtraOk) { return [ordered]@{ hwnd = [long]0; class = ''; pid = 0; exe = '' } }
    $h = [long][GlintBarSmoke.Win]::Foreground()
    $procId = [int][GlintBarSmoke.Win]::PidOf($h)
    $exe = ''
    if ($procId -gt 0) {
        try { $exe = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $exe = '?' }
    }
    return [ordered]@{ hwnd = $h; class = [GlintBarSmoke.Win]::ClassOf($h); pid = $procId; exe = $exe }
}

function Format-Window($Info) {
    if ($null -eq $Info) { return 'none' }
    $who = $Info.exe
    if ($null -ne $script:Proc -and $Info.pid -eq $script:Proc.Id) { $who = 'glintbar' }
    return "$($Info.class)/$who"
}

# Clicks the middle of a window (brings it to the front the way a user would).
function Invoke-ClickWindow([long]$Hwnd) {
    Assert-Extra
    $r = [GlintBarSmoke.Win]::Rect($Hwnd)
    Invoke-Click ([int](($r[0] + $r[2]) / 2)) ([int](($r[1] + $r[3]) / 2))
}

$script:TestWindows = [System.Collections.Generic.List[long]]::new()

# kind: normal | popup | fullscreen; Rgb 0xRRGGBB.
function Open-TestWindow([string]$Kind, [string]$Title, [int]$X, [int]$Y, [int]$W, [int]$H, [uint32]$Rgb) {
    Assert-Extra
    $hwnd = [long][GlintBarSmoke.TestWindow]::Open($Kind, $Title, $X, $Y, $W, $H, $Rgb)
    $script:TestWindows.Add($hwnd)
    Write-Log ("  test window '{0}' ({1}) 0x{2:X} at {3},{4} {5}x{6}" -f $Title, $Kind, $hwnd, $X, $Y, $W, $H)
    return $hwnd
}

function Close-TestWindow([long]$Hwnd) {
    if ($Hwnd -eq 0 -or -not $script:ExtraOk) { return }
    if (-not [GlintBarSmoke.Win]::Exists($Hwnd)) { return }
    [void][GlintBarSmoke.Win]::Close($Hwnd)
    for ($i = 0; $i -lt 30 -and [GlintBarSmoke.Win]::Exists($Hwnd); $i++) { Start-Sleep -Milliseconds 100 }
}

# The end of %APPDATA%\GlintBar\logs\glintbar.log (shared read: the app keeps it open).
function Read-GlintBarLogTail([int]$Bytes = 262144) {
    $path = Join-Path $AppData 'GlintBar\logs\glintbar.log'
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    try {
        $share = [System.IO.FileShare]'ReadWrite, Delete'
        $fs = [System.IO.FileStream]::new($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
        try {
            if ($fs.Length -gt $Bytes) { [void]$fs.Seek(-1 * [long]$Bytes, [System.IO.SeekOrigin]::End) }
            $sr = [System.IO.StreamReader]::new($fs, [System.Text.Encoding]::UTF8)
            $text = $sr.ReadToEnd()
            $sr.Dispose()
            return $text
        } finally {
            $fs.Dispose()
        }
    } catch {
        return ''
    }
}

function Find-LogLines([string]$Pattern, [int]$Max = 2) {
    $lines = @((Read-GlintBarLogTail) -split "`r?`n" | Where-Object { $_ -match $Pattern })
    if ($lines.Count -gt $Max) { $lines = $lines[($lines.Count - $Max)..($lines.Count - 1)] }
    return , $lines
}

# glintbar.exe and every process under it (the WebView2 browser, renderer, GPU ... processes).
function Get-GlintBarTree {
    if ($null -eq $script:Proc) { return , @() }
    $all = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine -ErrorAction Stop)
    $ids = [System.Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add([int]$script:Proc.Id)
    $grew = $true
    while ($grew) {
        $grew = $false
        foreach ($p in $all) {
            if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) {
                [void]$ids.Add([int]$p.ProcessId)
                $grew = $true
            }
        }
    }
    $out = @($all | Where-Object { $ids.Contains([int]$_.ProcessId) } | ForEach-Object { [ordered]@{ pid = [int]$_.ProcessId; name = [string]$_.Name; kind = (Get-ProcessKind ([string]$_.Name) ([string]$_.CommandLine)) } })
    return , $out
}

# pid -> cpu ms, working set, private bytes, name.
function Get-ProcessSample([int[]]$Ids) {
    $map = @{}
    foreach ($id in $Ids) {
        try {
            $p = Get-Process -Id $id -ErrorAction Stop
            $map[$id] = [ordered]@{ cpu = [double]$p.TotalProcessorTime.TotalMilliseconds; ws = [long]$p.WorkingSet64; priv = [long]$p.PrivateMemorySize64; name = [string]$p.ProcessName }
        } catch { }
    }
    return $map
}

# What a process of the glintbar tree is, from its command line: app (glintbar.exe), browser (the
# WebView2 main process), gpu-process, renderer, utility:<service>, crashpad-handler ...
function Get-ProcessKind([string]$Name, [string]$CommandLine) {
    if ($Name -match '^glintbar') { return 'app' }
    if ([string]::IsNullOrEmpty($CommandLine)) { return 'unknown' }
    if ($CommandLine -match '--type=([\w-]+)') {
        $t = $Matches[1]
        if ($t -eq 'utility' -and $CommandLine -match '--utility-sub-type=([\w.]+)') { return 'utility:' + (($Matches[1] -split '\.')[0]) }
        return $t
    }
    return 'browser'
}

# CPU and memory of glintbar.exe + its WebView2 processes with the harness quiet: the page stops
# polling command.json / layout.json for the whole window ('quiet' command), the driver waits
# $IdleSec, then samples $SampleSec. Returns the record the report and summarize.mjs use.
function Measure-GlintBarIdle([string]$Label, [int]$IdleSec, [int]$SampleSec) {
    $quiet = $false
    try {
        [void](Send-Command -Action 'quiet' -CmdArgs @{ seconds = ($IdleSec + $SampleSec + 1) })
        $quiet = $true
    } catch { Write-Log "  quiet failed (harness polling is in the measurement): $($_.Exception.Message)" }
    Start-Sleep -Seconds $IdleSec
    $tree = Get-GlintBarTree
    $ids = [int[]]@($tree | ForEach-Object { $_.pid })
    $kinds = @{}
    foreach ($p in $tree) { $kinds[[int]$p.pid] = [string]$p.kind }
    $t0 = Get-ProcessSample $ids
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Start-Sleep -Seconds $SampleSec
    $t1 = Get-ProcessSample $ids
    $secs = $sw.Elapsed.TotalSeconds
    $cores = [Environment]::ProcessorCount
    $rows = @()
    $byKind = [ordered]@{}
    $cpuMs = 0.0
    $ws = [long]0
    $priv = [long]0
    foreach ($id in $ids) {
        if (-not ($t0.ContainsKey($id) -and $t1.ContainsKey($id))) { continue }
        $d = $t1[$id].cpu - $t0[$id].cpu
        $kind = [string]$kinds[$id]
        $cpuMs += $d
        $ws += $t1[$id].ws
        $priv += $t1[$id].priv
        if ($byKind.Contains($kind)) { $byKind[$kind] = [Math]::Round($byKind[$kind] + $d, 1) } else { $byKind[$kind] = [Math]::Round($d, 1) }
        $rows += [ordered]@{ pid = $id; name = $t1[$id].name; kind = $kind; cpuMs = [Math]::Round($d, 1); workingSetMB = [Math]::Round($t1[$id].ws / 1MB, 1); privateMB = [Math]::Round($t1[$id].priv / 1MB, 1) }
    }
    if ($rows.Count -eq 0) { throw "no glintbar processes could be sampled ($Label)" }
    $oneCore = 100.0 * $cpuMs / ($secs * 1000.0)
    $machine = $oneCore / [Math]::Max(1, $cores)
    $kindText = (@($byKind.Keys | ForEach-Object { "$_ $($byKind[$_]) ms" }) -join ', ')
    $msg = "{0}: {1:N2} % of the machine ({2:N2} % of one core, {3:N0} ms in {4:N1} s, {5} processes: {6}); working set {7:N0} MB, private {8:N0} MB" -f $Label, $machine, $oneCore, $cpuMs, $secs, $rows.Count, $kindText, ($ws / 1MB), ($priv / 1MB)
    # No Write-Log here: console output could change what is behind the dock (the glass step).
    return [ordered]@{
        label = $Label
        idleSeconds = $IdleSec
        sampleSeconds = [Math]::Round($secs, 1)
        harnessQuiet = $quiet
        cores = $cores
        processes = $rows.Count
        cpuMs = [Math]::Round($cpuMs, 1)
        cpuPercentOfOneCore = [Math]::Round($oneCore, 2)
        cpuPercentOfMachine = [Math]::Round($machine, 2)
        workingSetMB = [Math]::Round($ws / 1MB, 1)
        privateMB = [Math]::Round($priv / 1MB, 1)
        byKind = $byKind
        perProcess = $rows
        text = $msg
    }
}

function Get-AppsItem($State, [string]$Key) {
    foreach ($i in @($State.items)) { if ($i.key -eq $Key) { return $i } }
    return $null
}

function Get-ExplorerWindows {
    if (-not $script:ExtraOk) { return , @() }
    $list = @([GlintBarSmoke.Win]::ByClass('CabinetWClass') | Where-Object { [GlintBarSmoke.Win]::Visible($_) })
    return , $list
}

function Start-GlintBar {
    $env:GLINTBAR_SMOKE = '1'
    $env:GLINTBAR_NO_CAPTURE_EXCLUDE = '1'
    $exePath = (Resolve-Path -LiteralPath $Exe).Path
    $p = Start-Process -FilePath $exePath -PassThru -WorkingDirectory (Split-Path -Parent $exePath)
    Write-Log "launched pid $($p.Id)"
    return $p
}

# layout.json with tiles and a visible window, or $null after TimeoutSec.
function Wait-DockRendered([int]$TimeoutSec) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
    while ([DateTime]::UtcNow -lt $deadline -and (Test-Alive)) {
        $l = Read-SmokeJson 'layout.json'
        if ($null -ne $l -and @($l.tiles).Count -gt 0 -and $null -ne $l.window -and $l.window.visible) { return $l }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

# ---- 1. prepare -------------------------------------------------------------------------------

Write-Log "GlintBar smoke drive: exe=$Exe out=$OutDir budget=$BudgetSec s"
if (-not (Test-Path -LiteralPath $Exe)) { Write-Log "HARNESS ERROR: $Exe does not exist" }

Get-Process -Name glintbar -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$script:Report.screenBefore = Get-ScreenBounds
$res = 'not attempted'
try {
    $cmd = Get-Command Set-DisplayResolution -ErrorAction SilentlyContinue
    if ($null -ne $cmd) {
        Set-DisplayResolution -Width $Width -Height $Height -Force -ErrorAction Stop
        $res = "Set-DisplayResolution $($Width)x$($Height)"
    } else {
        $res = 'Set-DisplayResolution unavailable'
    }
} catch {
    $res = "Set-DisplayResolution failed: $($_.Exception.Message)"
}
$now = Get-ScreenBounds
if ($script:NativeOk -and $now.primaryWidth -lt $Width) {
    try {
        Add-Type -TypeDefinition $displaySource -Language CSharp -ErrorAction Stop
        Write-Log "display modes: $([GlintBarSmoke.Display]::Modes())"
        foreach ($m in @(@($Width, $Height), @(1920, 1080), @(1680, 1050), @(1600, 900), @(1440, 900), @(1366, 768), @(1280, 1024), @(1280, 800))) {
            $r = [GlintBarSmoke.Display]::Set($m[0], $m[1])
            $res += "; ChangeDisplaySettings $($m[0])x$($m[1]): $r"
            if ($r.StartsWith('ok')) { break }
        }
    } catch {
        $res += "; display helper failed: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 2
}
$script:Report.resolution = $res
$script:Report.screen = Get-ScreenBounds
Write-Log "resolution: $res -> $($script:Report.screen.primaryWidth)x$($script:Report.screen.primaryHeight)"

# Clear the desktop so screenshots show the dock and its panels with nothing else behind them.
try {
    (New-Object -ComObject Shell.Application).MinimizeAll()
    Start-Sleep -Milliseconds 800
    Write-Log "desktop cleared: other windows minimized"
} catch {
    Write-Log "minimize all failed: $($_.Exception.Message)"
}

$script:Report.taskbarBefore = Get-TaskbarState
Write-Log "taskbar before launch: $($script:Report.taskbarBefore | ConvertTo-Json -Compress)"

if (Test-Path -LiteralPath $AppSmoke) { Remove-Item -LiteralPath $AppSmoke -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $AppSmoke | Out-Null

# ---- 2. launch --------------------------------------------------------------------------------

try {
    $script:Proc = Start-GlintBar
} catch {
    Write-Log "HARNESS ERROR: could not start the app: $($_.Exception.Message)"
}

# ---- 3. wait for the dock ---------------------------------------------------------------------

$script:Layout = Wait-DockRendered 60
$script:DockRendered = ($null -ne $script:Layout)
$script:Report.smokeStarted = Test-Path -LiteralPath (Join-Path $AppSmoke 'smoke-start.json')
if ($script:DockRendered) {
    Start-Sleep -Seconds 2
    try { $script:Layout = Get-Layout } catch { Write-Log "dumpLayout failed: $($_.Exception.Message)" }
    $w = $script:Layout.window
    Write-Log ("dock rendered: {0} tiles, bar {1}, window {2}x{3} at {4},{5}, scale {6}" -f @($script:Layout.tiles).Count, ($script:Layout.bar | ConvertTo-Json -Compress), $w.outerWidth, $w.outerHeight, $w.outerX, $w.outerY, $w.scale)
    if ($null -ne $w.native) {
        Write-Log ("native: affinity {0}, exStyle 0x{1:X}, region kind {2} box {3}" -f $w.native.displayAffinity, [int64]$w.native.exStyle, $w.native.regionKind, ($w.native.regionBox -join ','))
        if ($w.native.displayAffinity -eq 17) { Write-Log 'WARNING: the dock window is excluded from capture (WDA_EXCLUDEFROMCAPTURE): screenshots will not show it' }
    }
    $script:Report.firstLayout = $script:Layout
} else {
    Write-Log "the dock never rendered (smoke-start.json present: $($script:Report.smokeStarted))"
}
Save-Shot 'idle'
$script:Report.taskbarWhileRunning = Get-TaskbarState

# Idle cost first, while the dock has only its first-run widgets. Two measurements with the
# harness quiet: only the Clock on the dock (WebView2's own floor), then the default dock, so the
# widgets' share is the difference. The glass step adds a third (live glass on, resting).
Invoke-Step 'idle resources: CPU and memory of glintbar.exe + WebView2' -Check 'resources' {
    [void](Send-Command -Action 'closeAll')
    $b = Get-ScreenBounds
    Move-Mouse ([int]($b.x + $b.primaryWidth / 2)) ([int]($b.y + $b.primaryHeight / 3))
    [void](Send-Command -Action 'setDock' -CmdArgs @{ widgetIds = @('clocks.clock') })
    $base = Measure-GlintBarIdle 'clock only' 8 10
    [void](Send-Command -Action 'restoreDock')
    $dock = Measure-GlintBarIdle 'default dock' 15 10
    Write-Log "  $($base.text)"
    Write-Log "  $($dock.text)"
    $res = [ordered]@{}
    foreach ($k in $dock.Keys) { $res[$k] = $dock[$k] }
    $res.targetPercent = 2
    $res.baseline = $base
    $res.widgetsPercentOfMachine = [Math]::Round($dock.cpuPercentOfMachine - $base.cpuPercentOfMachine, 2)
    $script:Report.resources = $res
    $msg = "$($dock.text) | $($base.text) | widgets ~$($res.widgetsPercentOfMachine) % of the machine"
    if ($dock.cpuPercentOfMachine -ge 2.0) { throw "idle CPU is not under 2 %: $msg" }
    $msg
}

# ---- 4. drive ---------------------------------------------------------------------------------

Invoke-Step 'hover a tile' {
    $t = @($script:Layout.tiles | Where-Object { $null -ne $_.click })[0]
    if ($null -eq $t) { throw 'no tile with a clickable point' }
    Move-Mouse $t.click.x $t.click.y
    Start-Sleep -Milliseconds 1100
    Save-Shot "hover-$($t.widgetId)"
    $b = Get-ScreenBounds
    Move-Mouse ([int]($b.x + $b.primaryWidth / 2)) ([int]($b.y + $b.primaryHeight / 3))
    "hovered $($t.widgetId)"
}

Invoke-Step 'right-click the bar: dock menu' {
    $l = Get-Layout
    if ($null -eq $l.barFreePoint) { throw 'no empty spot on the bar' }
    Invoke-Click $l.barFreePoint.x $l.barFreePoint.y -Right
    Start-Sleep -Milliseconds 800
    $l = Get-Layout
    Save-Shot 'menu'
    if (-not $l.ui.menu) { throw 'the menu did not open' }
    "menu items: $(@($l.menuItems | ForEach-Object { $_.label }) -join ', ')"
}

Invoke-Step 'menu -> Widgets... (picker)' {
    $l = Get-Layout
    if (-not $l.ui.menu) {
        Invoke-Click $l.barFreePoint.x $l.barFreePoint.y -Right
        Start-Sleep -Milliseconds 800
        $l = Get-Layout
    }
    $item = @($l.menuItems | Where-Object { $_.label -like 'Widgets*' })[0]
    if ($null -eq $item) { throw 'no Widgets item in the menu' }
    Invoke-Click $item.x $item.y
    Start-Sleep -Milliseconds 2500
    $l = Get-Layout
    Save-Shot 'picker'
    if ($l.ui.panel -ne 'widgets') { throw "the picker did not open (panel: $($l.ui.panel))" }
    'picker open'
}

Invoke-Step 'close the picker with a desktop click' { Close-ByDesktopClick 'picker' }

$script:SettingsNav = @()
Invoke-Step 'menu -> Settings' {
    $l = Get-Layout
    Invoke-Click $l.barFreePoint.x $l.barFreePoint.y -Right
    Start-Sleep -Milliseconds 800
    $l = Get-Layout
    $item = @($l.menuItems | Where-Object { $_.label -like 'Settings*' })[0]
    if ($null -eq $item) { throw 'no Settings item in the menu' }
    Invoke-Click $item.x $item.y
    Start-Sleep -Milliseconds 1800
    $l = Get-Layout
    if ($l.ui.panel -ne 'settings') { throw "Settings did not open (panel: $($l.ui.panel))" }
    $script:SettingsNav = @($l.settingsNav)
    "sections: $(@($l.settingsNav | ForEach-Object { $_.label }) -join ', ')"
}

Invoke-Step 'Settings: every page' {
    $done = @()
    $failed = @()
    foreach ($nav in @($script:SettingsNav)) {
        if ($null -eq $nav) { continue }
        Invoke-Click $nav.x $nav.y
        Start-Sleep -Milliseconds 900
        $l = Get-Layout
        $label = ($nav.label -replace '[^A-Za-z0-9]', '').ToLower()
        Save-Shot "settings-$label"
        if ($l.ui.panel -ne 'settings') { $failed += "$($nav.label) (panel closed)" } else { $done += "$($nav.label)=$($l.ui.settingsSection)" }
    }
    if ($done.Count -eq 0) { throw 'no settings page could be opened' }
    if ($failed.Count -gt 0) { throw "pages that failed: $($failed -join ', ')" }
    $done -join ', '
}

Invoke-Step 'close Settings with a desktop click' { Close-ByDesktopClick 'settings' }

# The window is bigger than the bar (room for cards); only the bar's window region may take
# clicks. A click just above the bar, and one beside a centred bar, must reach the desktop.
Invoke-Step 'click-through: just above the dock and beside it' {
    [void](Send-Command -Action 'closeAll')
    Start-Sleep -Milliseconds 500
    $l = Get-Layout
    $gap = [int][Math]::Max(6, 8 * $l.scale)
    $aboveY = [int]($l.bar.y - $gap)
    if ($l.edge -eq 'top') { $aboveY = [int]($l.bar.y + $l.bar.height + $gap) }
    $points = @()
    $points += , @('above', [int]($l.bar.x + $l.bar.width / 2), $aboveY)
    if (-not $l.fullWidth -and ($l.bar.x - 60 * $l.scale) -gt 0) {
        $points += , @('beside', [int]($l.bar.x - 60 * $l.scale), [int]($l.bar.y + $l.bar.height / 2))
    }
    $results = @()
    $bad = @()
    foreach ($p in $points) {
        $before = Get-Layout
        $at = Get-WindowAt $p[1] $p[2]
        Invoke-Click $p[1] $p[2]
        Start-Sleep -Milliseconds 500
        $after = Get-Layout
        $seen = [int]$after.pointer.downs - [int]$before.pointer.downs
        $results += "$($p[0]) ($($p[1]),$($p[2])): window $($at.class) glintbar=$($at.isGlintBar), page saw $seen press(es)"
        if ($at.isGlintBar -or $seen -gt 0) { $bad += $p[0] }
    }
    Save-Shot 'click-through'
    if ($bad.Count -gt 0) { throw "clicks were caught by the dock window at: $($bad -join ', ') :: $($results -join ' | ')" }
    $results -join ' | '
}

Invoke-Step 'service self-test' {
    $r = Send-Command -Action 'runSelftest' -CmdArgs @{ listenMs = 3000 } -TimeoutSec 180
    "ok $($r.counts.ok), error $($r.counts.error), timeout $($r.counts.timeout), denied $($r.counts.denied); silent topics: $(@($r.topicsSilent) -join ' ')"
}

# Cards: a few tiles at a time so they always fit on the bar, clicked with the real mouse.
$cardGroups = @(
    @('apps.recycle', 'system.cpu', 'media.nowplaying', 'weather.now'),
    @('clocks.clock', 'productivity.calendar', 'productivity.todos', 'system.quick-toggles'),
    @('ai.claude', 'system.ram', 'system.network', 'stocks.crypto')
)
$gi = 0
foreach ($group in $cardGroups) {
    $gi++
    Invoke-Step "cards group $gi : $($group -join ', ')" {
        [void](Send-Command -Action 'setDock' -CmdArgs @{ widgetIds = $group })
        Start-Sleep -Milliseconds 2500
        $l = Get-Layout
        "tiles: $(@($l.tiles | ForEach-Object { $_.widgetId }) -join ', ')"
    }
    foreach ($wid in $group) {
        Invoke-Step "card $wid" {
            $l = Get-Layout
            $t = Find-Tile $l $wid
            if ($null -eq $t) { throw "$wid is not on the dock" }
            if ($null -eq $t.click) {
                [void](Send-Command -Action 'openCard' -CmdArgs @{ widgetId = $wid })
                $how = 'command (no safe spot to click)'
            } else {
                Invoke-Click $t.click.x $t.click.y
                $how = 'mouse'
            }
            Start-Sleep -Milliseconds 1500
            $l = Get-Layout
            Save-Shot "card-$wid"
            $opened = ($null -ne $l.ui.card -and $l.ui.card.widgetId -eq $wid)
            if (-not $opened) {
                if (-not $t.hasCard) { return "$wid has no card (clicked via $how)" }
                throw "the card did not open (via $how; ui: $($l.ui | ConvertTo-Json -Compress))"
            }
            $closeNote = Close-ByDesktopClick "card of $wid"
            "opened via $how; $closeNote"
        }
    }
}

Invoke-Step 'restore the first-run dock' {
    [void](Send-Command -Action 'restoreDock')
    Start-Sleep -Milliseconds 2000
    "tiles: $(@((Get-Layout).tiles).Count)"
}
foreach ($th in @('black', 'white', 'midnight', 'glass', 'ios-glass', 'clear')) {
    Invoke-Step "theme $th" {
        [void](Send-Command -Action 'setTheme' -CmdArgs @{ theme = $th })
        Start-Sleep -Milliseconds 1500
        Save-Shot "theme-$th"
        "theme $((Get-Layout).theme)"
    }
}
Invoke-Step 'theme back to midnight' { [void](Send-Command -Action 'setTheme' -CmdArgs @{ theme = 'midnight' }); 'midnight' }

Invoke-Step 'top edge' {
    [void](Send-Command -Action 'setEdge' -CmdArgs @{ edge = 'top' })
    Start-Sleep -Milliseconds 3000
    $l = Get-Layout
    Save-Shot 'edge-top'
    $b = Get-ScreenBounds
    if ($l.edge -ne 'top') { throw "edge is $($l.edge)" }
    if ($l.bar.y -gt ($b.y + $b.primaryHeight / 2)) { throw "the bar is still at the bottom (y $($l.bar.y))" }
    "bar at y $($l.bar.y), window y $($l.window.outerY), work area $((Get-TaskbarState).workArea -join ',')"
}
Invoke-Step 'back to the bottom edge' {
    [void](Send-Command -Action 'setEdge' -CmdArgs @{ edge = 'bottom' })
    Start-Sleep -Milliseconds 3000
    $l = Get-Layout
    $b = Get-ScreenBounds
    if ($l.bar.y -lt ($b.y + $b.primaryHeight / 2)) { throw "the bar is still at the top (y $($l.bar.y))" }
    "bar at y $($l.bar.y), work area $((Get-TaskbarState).workArea -join ',')"
}
Invoke-Step 'full width' {
    [void](Send-Command -Action 'setFullWidth' -CmdArgs @{ fullWidth = $true })
    Start-Sleep -Milliseconds 1500
    $l = Get-Layout
    Save-Shot 'full-width'
    [void](Send-Command -Action 'setFullWidth' -CmdArgs @{ fullWidth = $false })
    "bar width $($l.bar.width) of $((Get-ScreenBounds).primaryWidth)"
}
foreach ($sz in @('s', 'l')) {
    Invoke-Step "size $sz" {
        [void](Send-Command -Action 'setSize' -CmdArgs @{ size = $sz })
        Start-Sleep -Milliseconds 2000
        $l = Get-Layout
        Save-Shot "size-$sz"
        "bar height $($l.bar.height), window height $($l.window.outerHeight)"
    }
}
Invoke-Step 'size back to m' { [void](Send-Command -Action 'setSize' -CmdArgs @{ size = 'm' }); Start-Sleep -Milliseconds 1000; 'm' }

# Every widget against the real backend, a dock-full at a time.
$script:Batches = @()
Invoke-Step 'plan widget batches' {
    $l = Get-Layout
    $maxWidth = [int]($l.viewport.width - 140)
    $script:Batches = Send-Command -Action 'planBatches' -CmdArgs @{ maxWidth = $maxWidth } -TimeoutSec 30
    "$(@($script:Batches).Count) batches for $maxWidth CSS px"
}
$bi = 0
foreach ($batch in @($script:Batches)) {
    $bi++
    $label = 'b{0:D2}' -f $bi
    Invoke-Step "widgets batch $label ($(@($batch).Count) tiles)" {
        [void](Send-Command -Action 'setDock' -CmdArgs @{ widgetIds = @($batch) } -TimeoutSec 30)
        Start-Sleep -Milliseconds 4500
        Save-Shot "widgets-$label"
        $r = Send-Command -Action 'tileStatus' -CmdArgs @{ batch = $label }
        $problems = @()
        if (@($r.crashed).Count -gt 0) { $problems += "crashed: $(@($r.crashed) -join ' ')" }
        if (@($r.notRendered).Count -gt 0) { $problems += "not rendered: $(@($r.notRendered) -join ' ')" }
        if ($problems.Count -gt 0) { throw ($problems -join '; ') }
        "$($r.tiles) tiles ok; off screen: $(@($r.offScreen) -join ' ')"
    }
}

Invoke-Step 'restore the dock and collect blocked side effects' {
    [void](Send-Command -Action 'restoreDock')
    Start-Sleep -Milliseconds 1500
    $script:Report.blocked = Send-Command -Action 'blocked'
    Save-Shot 'final'
    "blocked: $(@($script:Report.blocked) -join ', ')"
}


# ---- 4b. round two: the risky interactive paths -------------------------------------------------

# 1. Keyboard focus and typing. A plain app window is in front first; the dock must take focus for
# its text fields and give it back when they close.
$script:FocusTarget = [long]0
# GlintBar log lines (timestamp and level cut) matching $Pattern written after Get-LogMark returned $Mark.
$FocusLogPattern = 'shell::focus:'
function Get-LogMark([string]$Pattern) { return @((Read-GlintBarLogTail) -split "`r?`n" | Where-Object { $_ -match $Pattern }).Count }
function Get-NewLogLines([string]$Pattern, [int]$Mark) {
    $all = @((Read-GlintBarLogTail) -split "`r?`n" | Where-Object { $_ -match $Pattern })
    if ($all.Count -le $Mark) { return , @() }
    return , @($all[$Mark..($all.Count - 1)] | ForEach-Object { ($_ -replace '^\S+\s+\S+\s+', '').Trim() })
}
function Format-LogLines($Lines) {
    if (@($Lines).Count -eq 0) { return 'none' }
    return (@($Lines) -join ' / ')
}
Invoke-Step 'typing: picker search box (real clicks + SendInput Unicode keys)' -Check 'typing-picker' {
    Assert-Extra
    [void](Send-Command -Action 'restoreDock')
    [void](Send-Command -Action 'closeAll')
    $b = Get-ScreenBounds
    $script:FocusTarget = Open-TestWindow 'normal' 'GlintBar smoke focus target' ([int]($b.x + 120)) ([int]($b.y + 120)) 640 360 0x30609F
    Start-Sleep -Milliseconds 600
    Invoke-ClickWindow $script:FocusTarget
    Start-Sleep -Milliseconds 500
    $before = Get-ForegroundInfo
    $focusMark = Get-LogMark $FocusLogPattern
    # Open the picker the way a user does: right-click the bar, click "Widgets...".
    $l = Get-Layout
    if ($null -eq $l.barFreePoint) { throw 'no empty spot on the bar' }
    Invoke-Click $l.barFreePoint.x $l.barFreePoint.y -Right
    Start-Sleep -Milliseconds 900
    $l = Get-Layout
    $item = @($l.menuItems | Where-Object { $_.label -like 'Widgets*' })[0]
    if ($null -eq $item) { throw 'no Widgets item in the dock menu' }
    Invoke-Click $item.x $item.y
    Start-Sleep -Milliseconds 2500
    $l = Get-Layout
    $box = @($l.inputs | Where-Object { $_.panel -eq 'panel' -and ($_.label -eq 'Search widgets' -or $_.placeholder -eq 'Search') })[0]
    if ($null -eq $box) { throw "no search box in the picker (panel $($l.ui.panel), $(@($l.inputs).Count) text fields)" }
    Invoke-Click $box.x $box.y
    Start-Sleep -Milliseconds 600
    $during = Get-ForegroundInfo
    [void](Send-Text 'cpu')
    Start-Sleep -Milliseconds 1000
    $f = Send-Command -Action 'focusInfo'
    Save-Shot 'typing-picker'
    $ev = "before: $(Format-Window $before) (target: $($before.hwnd -eq $script:FocusTarget)); after clicking the box: $(Format-Window $during); box value '$($f.picker.query)'; $($f.picker.heading) - $($f.picker.summary); page focus $($f.hasFocus), active $($f.active.tag) '$($f.active.label)'"
    [void](Send-Command -Action 'closeAll')
    Start-Sleep -Milliseconds 1000
    $after = Get-ForegroundInfo
    $again = ($after.hwnd -eq $script:FocusTarget)
    $ev += "; after closing the picker: $(Format-Window $after) (target again: $again); focus log: $(Format-LogLines (Get-NewLogLines $FocusLogPattern $focusMark))"
    if ($f.picker.query -ne 'cpu') { throw "the search box holds '$($f.picker.query)', not 'cpu' :: $ev" }
    if ($f.picker.summary -notmatch '^\d+ widget') { throw "the picker did not filter :: $ev" }
    if ($before.hwnd -ne $script:FocusTarget) { throw "the test window was not in front before the picker opened :: $ev" }
    if (-not $again) { throw "focus did not return to the test window after the picker closed :: $ev" }
    $ev
}

Invoke-Step 'typing: Todos card (type a task + Enter), Esc closes it, focus goes back' -Check 'typing-todos' {
    Assert-Extra
    [void](Send-Command -Action 'closeAll')
    [void](Send-Command -Action 'addWidget' -CmdArgs @{ widgetId = 'productivity.todos' })
    Start-Sleep -Milliseconds 1500
    if (-not [GlintBarSmoke.Win]::Exists($script:FocusTarget)) {
        $b = Get-ScreenBounds
        $script:FocusTarget = Open-TestWindow 'normal' 'GlintBar smoke focus target' ([int]($b.x + 120)) ([int]($b.y + 120)) 640 360 0x30609F
        Start-Sleep -Milliseconds 600
    }
    Invoke-ClickWindow $script:FocusTarget
    Start-Sleep -Milliseconds 500
    $before = Get-ForegroundInfo
    $focusMark = Get-LogMark $FocusLogPattern
    $l = Get-Layout
    $t = Find-Tile $l 'productivity.todos'
    if ($null -eq $t) { throw 'the Todos tile is not on the dock' }
    $opened = 'a click on the tile'
    if ($null -ne $t.click) {
        Invoke-Click $t.click.x $t.click.y
    } else {
        [void](Send-Command -Action 'openCard' -CmdArgs @{ widgetId = 'productivity.todos' })
        $opened = 'the openCard command (no safe spot on the tile)'
    }
    Start-Sleep -Milliseconds 1600
    $l = Get-Layout
    if ($null -eq $l.ui.card -or $l.ui.card.widgetId -ne 'productivity.todos') { throw "the Todos card did not open (card: $($l.ui.card.widgetId))" }
    $box = @($l.inputs | Where-Object { $_.panel -eq 'card' -and $_.placeholder -like 'Add a task*' })[0]
    if ($null -eq $box) { $box = @($l.inputs | Where-Object { $_.panel -eq 'card' })[0] }
    if ($null -eq $box) { throw 'no text field in the Todos card' }
    Invoke-Click $box.x $box.y
    Start-Sleep -Milliseconds 500
    $during = Get-ForegroundInfo
    $task = 'Smoke task ' + (Get-Random -Minimum 1000 -Maximum 9999)
    [void](Send-Text $task)
    Start-Sleep -Milliseconds 300
    [void](Send-Keys @($VK_RETURN))
    Start-Sleep -Milliseconds 1000
    $items = Send-Command -Action 'todos'
    $found = (@($items | Where-Object { $_.text -eq $task }).Count -gt 0)
    $f = Send-Command -Action 'focusInfo'
    Save-Shot 'typing-todos'
    # Esc, not a desktop click: a click on the desktop would move the focus by itself.
    [void](Send-Keys @($VK_ESCAPE))
    Start-Sleep -Milliseconds 1000
    $l = Get-Layout
    $closed = ($null -eq $l.ui.card)
    if (-not $closed) {
        [void](Send-Command -Action 'closeAll')
        Start-Sleep -Milliseconds 600
    }
    Start-Sleep -Milliseconds 700
    $after = Get-ForegroundInfo
    $back = ($after.hwnd -eq $before.hwnd)
    [void](Send-Command -Action 'todosRemove' -CmdArgs @{ text = $task })
    $ev = "card opened by $opened; typed '$task' + Enter -> in the list: $found (field now '$($f.active.value)'); foreground before $(Format-Window $before), while typing $(Format-Window $during), after closing $(Format-Window $after); Esc closed the card: $closed; focus back on the previous window: $back; focus log: $(Format-LogLines (Get-NewLogLines $FocusLogPattern $focusMark))"
    $bad = @()
    if (-not $found) { $bad += 'the task was not added' }
    if (-not $closed) { $bad += 'Esc did not close the card' }
    if (-not $back) { $bad += 'focus did not return to the previous window' }
    if ($bad.Count -gt 0) { throw "$($bad -join '; ') :: $ev" }
    $ev
}

# 2. Global hotkey.
Invoke-Step 'global hotkey Alt+T opens the To-do card' -Check 'hotkey' {
    Assert-Extra
    [void](Send-Command -Action 'closeAll')
    Start-Sleep -Milliseconds 500
    if ([GlintBarSmoke.Win]::Exists($script:FocusTarget)) {
        Invoke-ClickWindow $script:FocusTarget
        Start-Sleep -Milliseconds 500
    }
    $before = Get-ForegroundInfo
    [void](Send-Keys @($VK_MENU, $VK_T) 60)
    Start-Sleep -Milliseconds 1600
    $l = Get-Layout
    Save-Shot 'hotkey-alt-t'
    $opened = ($null -ne $l.ui.card -and $l.ui.card.widgetId -eq 'productivity.todos')
    [void](Send-Keys @($VK_ESCAPE))
    Start-Sleep -Milliseconds 600
    [void](Send-Command -Action 'closeAll')
    Close-TestWindow $script:FocusTarget
    $ev = "pressed with $(Format-Window $before) in front; card open afterwards: $($l.ui.card.widgetId)"
    if (-not $opened) { throw "Alt+T did not open the To-do card :: $ev" }
    $ev
}

# 3. The Apps tile for real: Start, then File Explorer launched, toggled, previewed and closed.
Invoke-Step 'apps: the Start tile opens the Start menu, Esc closes it' -Check 'start-menu' {
    Assert-Extra
    [void](Send-Command -Action 'restoreDock')
    [void](Send-Command -Action 'closeAll')
    Start-Sleep -Milliseconds 1500
    $s = Send-Command -Action 'appsState'
    if (-not $s.onDock) { throw 'the Apps tile is not on the dock' }
    $start = Get-AppsItem $s '__start'
    if ($null -eq $start) { throw 'no Start item on the Apps tile' }
    Invoke-Click $start.x $start.y
    $fg = $null
    $open = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while (-not $open -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 300
        $fg = Get-ForegroundInfo
        $open = ($fg.class -eq 'Windows.UI.Core.CoreWindow') -or ($fg.exe -match '^(StartMenuExperienceHost|SearchHost|SearchApp|ShellExperienceHost)$')
    }
    Save-Shot 'start-menu'
    [void](Send-Keys @($VK_ESCAPE))
    Start-Sleep -Milliseconds 1200
    $after = Get-ForegroundInfo
    $closed = -not (($after.class -eq 'Windows.UI.Core.CoreWindow') -and ($after.exe -eq $fg.exe))
    if (-not $closed) { [void](Send-Keys @($VK_ESCAPE)) }
    $ev = "in front after the click: $(Format-Window $fg); after Esc: $(Format-Window $after)"
    if (-not $open) { throw "the Start menu did not come to the front :: $ev" }
    if (-not $closed) { throw "Esc did not close the Start menu :: $ev" }
    $ev
}

$script:ExplorerKey = $null
$script:ExplorerHwnd = [long]0
$script:PinsBefore = $null
Invoke-Step 'apps: a left click on the File Explorer pin opens Explorer, the tile shows it running' -Check 'apps-launch' {
    Assert-Extra
    [void](Send-Command -Action 'closeAll')
    $s = Send-Command -Action 'appsState'
    if (-not $s.onDock) { throw 'the Apps tile is not on the dock' }
    $exe = ("$env:WINDIR\explorer.exe").ToLowerInvariant()
    $pin = @($s.pins | Where-Object { $_.kind -ne 'group' -and (($_.aumid -like '*Windows.Explorer*') -or ($_.exe -eq $exe) -or ($_.target -like '*\explorer.exe') -or ($_.name -like '*File Explorer*')) })[0]
    $how = "the taskbar's own pin"
    if ($null -ne $pin) {
        $script:ExplorerKey = $pin.id
    } else {
        # No Explorer pin on this machine: add one the way "Pin to dock" would.
        $entry = [ordered]@{ id = "exe:$exe"; name = 'File Explorer'; kind = 'app'; target = "$env:WINDIR\explorer.exe"; args = $null; aumid = $null; exe = $exe; icon = $exe }
        $r = Send-Command -Action 'appsAddPin' -CmdArgs @{ entry = $entry }
        $script:PinsBefore = @($r.before)
        $script:ExplorerKey = $entry.id
        $how = 'a pin added for the test (none on this machine)'
        Start-Sleep -Milliseconds 1200
        $s = Send-Command -Action 'appsState'
    }
    $item = Get-AppsItem $s $script:ExplorerKey
    if ($null -eq $item) { throw "no dock item for $($script:ExplorerKey) ($how); items: $(@($s.items | ForEach-Object { $_.key }) -join ', ')" }
    $before = Get-ExplorerWindows
    [void](Send-Command -Action 'allowLaunch' -CmdArgs @{ seconds = 15 })
    Invoke-Click $item.x $item.y
    $new = [long]0
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    while ($new -eq 0 -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 400
        foreach ($h in (Get-ExplorerWindows)) {
            if ($before -notcontains $h) { $new = [long]$h; break }
        }
    }
    [void](Send-Command -Action 'allowLaunch' -CmdArgs @{ seconds = 0 })
    if ($new -eq 0) { throw "no File Explorer window appeared within 12 s ($how; blocked so far: $(@(Send-Command -Action 'blocked') -join ', '))" }
    $script:ExplorerHwnd = $new
    Start-Sleep -Milliseconds 1800
    $s = Send-Command -Action 'appsState'
    $item = Get-AppsItem $s $script:ExplorerKey
    Save-Shot 'apps-explorer-open'
    $fg = Get-ForegroundInfo
    $win = @($s.windows | Where-Object { [long]$_.hwnd -eq $new })[0]
    $onPin = ($null -ne $item -and @($item.windows | Where-Object { [long]$_.hwnd -eq $new }).Count -gt 0)
    $holders = @($s.items | Where-Object { @($_.windows | Where-Object { [long]$_.hwnd -eq $new }).Count -gt 0 } | ForEach-Object { $_.key })
    $ev = "pin $($script:ExplorerKey) ($how); new window 0x$('{0:X}' -f $new) (exe $($win.exe), aumid $($win.aumid)); in front: $($fg.hwnd -eq $new); shown on: $($holders -join ', '); pin running: $($item.running)"
    if (-not $onPin) {
        # Keep testing on whichever item has the window.
        if ($holders.Count -gt 0) { $script:ExplorerKey = $holders[0] }
        throw "the Explorer window is not shown on its pin :: $ev"
    }
    $ev
}

Invoke-Step 'apps: a click on the running Explorer (in front) minimizes it' -Check 'apps-minimize' {
    Assert-Extra
    $h = $script:ExplorerHwnd
    if ($h -eq 0 -or -not [GlintBarSmoke.Win]::Exists($h)) { throw 'no Explorer window from the launch step' }
    $s = Send-Command -Action 'appsState'
    $item = Get-AppsItem $s $script:ExplorerKey
    if ($null -eq $item) { throw "no dock item $($script:ExplorerKey)" }
    $log = @()
    $minimized = $false
    for ($i = 1; $i -le 3 -and -not $minimized; $i++) {
        $front = (([long][GlintBarSmoke.Win]::Foreground()) -eq $h) -and -not [GlintBarSmoke.Win]::Minimized($h)
        Invoke-Click $item.x $item.y
        Start-Sleep -Milliseconds 1300
        $minimized = [GlintBarSmoke.Win]::Minimized($h)
        $log += "click $i (it was in front: $front) -> minimized $minimized, in front now $(Format-Window (Get-ForegroundInfo))"
        if ($minimized -and -not $front) { throw "a click minimized a window that was not in front :: $($log -join ' | ')" }
    }
    Save-Shot 'apps-explorer-minimized'
    if (-not $minimized) { throw "three clicks never minimized it :: $($log -join ' | ')" }
    $log -join ' | '
}

Invoke-Step 'apps: the next click restores it to the front' -Check 'apps-restore' {
    Assert-Extra
    $h = $script:ExplorerHwnd
    if ($h -eq 0 -or -not [GlintBarSmoke.Win]::Exists($h)) { throw 'no Explorer window' }
    $s = Send-Command -Action 'appsState'
    $item = Get-AppsItem $s $script:ExplorerKey
    if ($null -eq $item) { throw "no dock item $($script:ExplorerKey)" }
    $wasMin = [GlintBarSmoke.Win]::Minimized($h)
    Invoke-Click $item.x $item.y
    Start-Sleep -Milliseconds 1500
    $min = [GlintBarSmoke.Win]::Minimized($h)
    $front = (([long][GlintBarSmoke.Win]::Foreground()) -eq $h)
    Save-Shot 'apps-explorer-restored'
    $ev = "minimized before $wasMin -> after the click minimized $min, in front $front ($(Format-Window (Get-ForegroundInfo)))"
    if ($min -or -not $front) { throw "not restored to the front :: $ev" }
    $ev
}

Invoke-Step 'apps: hovering the running app shows its window preview' -Check 'apps-preview' {
    Assert-Extra
    $s = Send-Command -Action 'appsState'
    $item = Get-AppsItem $s $script:ExplorerKey
    if ($null -eq $item -or -not $item.running) { throw "no running item $($script:ExplorerKey)" }
    $b = Get-ScreenBounds
    Move-Mouse ([int]($b.x + $b.primaryWidth * 0.97)) ([int]($b.y + $b.primaryHeight * 0.5))
    Start-Sleep -Milliseconds 400
    Move-Mouse ([int]$item.x - 3) ([int]$item.y)
    Start-Sleep -Milliseconds 150
    Move-Mouse ([int]$item.x) ([int]$item.y)
    Start-Sleep -Milliseconds 1600
    $s2 = Send-Command -Action 'appsState'
    $l = Get-Layout
    Save-Shot 'apps-preview'
    $panel = @($l.panels | Where-Object { $_.id -eq 'apps-preview' })[0]
    $box = 'none'
    if ($null -ne $panel) { $box = "$($panel.rect.width)x$($panel.rect.height) at $($panel.rect.x),$($panel.rect.y)" }
    Move-Mouse ([int]($b.x + $b.primaryWidth * 0.97)) ([int]($b.y + $b.primaryHeight * 0.5))
    Start-Sleep -Milliseconds 700
    $ev = "popup $($s2.popup.kind) on $($s2.popup.key); preview panel $box"
    if ($s2.popup.kind -ne 'preview' -or $null -eq $panel) { throw "no window preview :: $ev" }
    $ev
}

Invoke-Step 'apps: right-click menu lists its items, Esc closes it' -Check 'apps-menu' {
    Assert-Extra
    [void](Send-Command -Action 'appsClosePopup')
    $s = Send-Command -Action 'appsState'
    $item = Get-AppsItem $s $script:ExplorerKey
    if ($null -eq $item) { throw "no dock item $($script:ExplorerKey)" }
    Invoke-Click $item.x $item.y -Right
    Start-Sleep -Milliseconds 1300
    $l = Get-Layout
    $s2 = Send-Command -Action 'appsState'
    Save-Shot 'apps-menu'
    $labels = @($l.popupItems | Where-Object { $_.panel -eq 'apps-menu' } | ForEach-Object { $_.label })
    if ($s2.popup.kind -ne 'menu' -or $labels.Count -eq 0) { throw "the app menu did not open (popup: $($s2.popup.kind))" }
    # The dock does not take focus on a right-click, so Esc must come through Rust's keyboard hook
    # (installed while a popover is open) and the svc://shell/escape event.
    $escPattern = 'Esc with a popover open|popover open: watching|no keyboard hook|hooks removed'
    $escMark = Get-LogMark $escPattern
    $fgAtEsc = Get-ForegroundInfo
    $pageFocus = (Send-Command -Action 'focusInfo').hasFocus
    [void](Send-Keys @($VK_ESCAPE))
    Start-Sleep -Milliseconds 900
    $s3 = Send-Command -Action 'appsState'
    $escClosed = ($null -eq $s3.popup)
    $escLog = Get-NewLogLines $escPattern $escMark
    if (-not $escClosed) { [void](Send-Command -Action 'appsClosePopup') }
    $ev = "items: $($labels -join ' | '); at Esc: in front $(Format-Window $fgAtEsc), page focus $pageFocus; Esc closed it: $escClosed (in front: $(Format-Window (Get-ForegroundInfo))); Rust log after Esc: $(Format-LogLines $escLog)"
    if (-not $escClosed) { throw "Esc did not close the app menu :: $ev" }
    $ev
}

Invoke-Step 'apps: Close from the app menu closes Explorer, the running dot goes away' -Check 'apps-close' {
    Assert-Extra
    $h = $script:ExplorerHwnd
    if ($h -eq 0 -or -not [GlintBarSmoke.Win]::Exists($h)) { throw 'no Explorer window to close' }
    $s = Send-Command -Action 'appsState'
    $item = Get-AppsItem $s $script:ExplorerKey
    if ($null -eq $item) { throw "no dock item $($script:ExplorerKey)" }
    Invoke-Click $item.x $item.y -Right
    Start-Sleep -Milliseconds 1300
    $l = Get-Layout
    $close = @($l.popupItems | Where-Object { $_.panel -eq 'apps-menu' -and $_.label -match '^Close ' })[0]
    if ($null -ne $close) {
        Invoke-Click $close.x $close.y
        $how = "the menu's '$($close.label)'"
    } else {
        [void](Send-Command -Action 'appsClosePopup')
        [void][GlintBarSmoke.Win]::Close($h)
        $how = 'WM_CLOSE (the menu has no Close item)'
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    while ([GlintBarSmoke.Win]::Exists($h) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 300 }
    $gone = -not [GlintBarSmoke.Win]::Exists($h)
    Start-Sleep -Milliseconds 1500
    $s2 = Send-Command -Action 'appsState'
    $item2 = Get-AppsItem $s2 $script:ExplorerKey
    $still = ($null -ne $item2 -and $item2.running)
    Save-Shot 'apps-explorer-closed'
    if (-not $gone) { [void][GlintBarSmoke.Win]::Close($h) }
    $ev = "closed with $how; window gone: $gone; item afterwards: $(if ($null -eq $item2) { 'removed (it was not pinned)' } else { "running $($item2.running)" })"
    if (-not $gone) { throw "the Explorer window did not close :: $ev" }
    if ($still) { throw "the tile still shows it running :: $ev" }
    $ev
}

Invoke-Step 'apps: put the pins back' {
    if ($script:ExplorerHwnd -ne 0) { Close-TestWindow $script:ExplorerHwnd }
    if ($null -eq $script:PinsBefore) { return 'nothing to restore (the existing pin was used)' }
    [void](Send-Command -Action 'appsSetPins' -CmdArgs @{ pins = @($script:PinsBefore) })
    "$(@($script:PinsBefore).Count) pins restored"
}

# 4. Drags with the real mouse: reorder tiles, then move the whole dock to the top and back.
Invoke-Step 'drag: the 2nd widget tile past the 4th, order changes, then restored' -Check 'drag-reorder' {
    Assert-Extra
    [void](Send-Command -Action 'restoreDock')
    [void](Send-Command -Action 'closeAll')
    [void](Send-Command -Action 'setDockPrefs' -CmdArgs @{ lockDock = $false })
    Start-Sleep -Milliseconds 1500
    $orderBefore = @((Send-Command -Action 'dockOrder') | ForEach-Object { $_.instanceId })
    $l = Get-Layout
    $tiles = @($l.tiles)
    if ($tiles.Count -lt 4) { throw "only $($tiles.Count) tiles on the dock" }
    $t2 = $tiles[1]
    $t4 = $tiles[3]
    if ($null -eq $t2.click) { throw "$($t2.widgetId) has no spot to press" }
    $c2 = $t2.rect.x + $t2.rect.width / 2
    $target = $t4.rect.x + $t4.rect.width * 0.8
    $dx = [int]($target - $c2)
    $x1 = [int]$t2.click.x
    $y1 = [int]$t2.click.y
    Invoke-Drag -X1 $x1 -Y1 $y1 -X2 ($x1 + $dx) -Y2 $y1 -Steps 14 -StepMs 45
    Start-Sleep -Milliseconds 1000
    $orderAfter = @((Send-Command -Action 'dockOrder') | ForEach-Object { $_.instanceId })
    $i2 = [array]::IndexOf($orderAfter, $t2.instanceId)
    $i4 = [array]::IndexOf($orderAfter, $t4.instanceId)
    Save-Shot 'drag-reorder'
    $l2 = Get-Layout
    $cardOpened = ($null -ne $l2.ui.card)
    $ev = "dragged $($t2.widgetId) by $dx px past $($t4.widgetId): order now $(($orderAfter | ForEach-Object { $_.Split('#')[0] }) -join ', ')"
    [void](Send-Command -Action 'reorderDock' -CmdArgs @{ order = $orderBefore })
    [void](Send-Command -Action 'closeAll')
    Start-Sleep -Milliseconds 800
    $orderNow = @((Send-Command -Action 'dockOrder') | ForEach-Object { $_.instanceId })
    $restored = (($orderNow -join '|') -eq ($orderBefore -join '|'))
    $ev += "; order restored: $restored; a card opened on release: $cardOpened"
    if ($i2 -le $i4) { throw "the order did not change ($($t2.widgetId) at $i2, $($t4.widgetId) at $i4) :: $ev" }
    if ($cardOpened) { throw "releasing the drag opened a card :: $ev" }
    if (-not $restored) { throw "the order could not be restored :: $ev" }
    $ev
}

Invoke-Step 'drag: the dock by an empty spot into the top half -> top edge, app bar moves' -Check 'drag-edge' {
    Assert-Extra
    [void](Send-Command -Action 'closeAll')
    Start-Sleep -Milliseconds 600
    $l = Get-Layout
    if ($l.edge -ne 'bottom') { throw "the dock starts at the $($l.edge) edge" }
    if ($null -eq $l.barFreePoint) { throw 'no empty spot on the bar' }
    $b = Get-ScreenBounds
    $wa0 = (Get-TaskbarState).workArea
    $x = [int]$l.barFreePoint.x
    $y = [int]$l.barFreePoint.y
    Invoke-Drag -X1 $x -Y1 $y -X2 $x -Y2 ([int]($b.y + $b.primaryHeight * 0.22)) -Steps 16 -StepMs 50 -HoldMs 150
    Start-Sleep -Milliseconds 3000
    $l2 = Get-Layout
    $st = Send-Command -Action 'shellState'
    $wa1 = (Get-TaskbarState).workArea
    Save-Shot 'drag-dock-top'
    $ev = "edge $($l2.edge) (Rust: $($st.rust.geometry.edge)); bar y $($l.bar.y) -> $($l2.bar.y); window y $($l.window.outerY) -> $($l2.window.outerY); work area $($wa0 -join ',') -> $($wa1 -join ',')"
    if ($l2.edge -ne 'top') { throw "the dock did not move to the top :: $ev" }
    if ($l2.bar.y -gt ($b.y + $b.primaryHeight / 2)) { throw "the bar is still in the lower half :: $ev" }
    if ([int]$wa1[1] -le [int]$wa0[1]) { throw "the work area top did not move down (no app bar at the top) :: $ev" }
    $ev
}

# 5. Cards open away from the edge.
Invoke-Step 'top edge: a card opens below the bar and inside the screen' -Check 'card-top' {
    [void](Send-Command -Action 'closeAll')
    $l = Get-Layout
    if ($l.edge -ne 'top') { throw "the dock is not at the top (edge $($l.edge))" }
    $t = @($l.tiles | Where-Object { $_.hasCard -and $null -ne $_.click -and $_.widgetId -ne 'apps.apps' })[0]
    if ($null -eq $t) { throw 'no tile with a card to click' }
    Invoke-Click $t.click.x $t.click.y
    Start-Sleep -Milliseconds 1600
    $l = Get-Layout
    Save-Shot "card-top-$($t.widgetId)"
    $card = @($l.panels | Where-Object { $_.id -eq 'card' })[0]
    if ($null -eq $card) { throw "no card after clicking $($t.widgetId) (ui card: $($l.ui.card.widgetId))" }
    $b = Get-ScreenBounds
    $r = $card.rect
    $barBottom = $l.bar.y + $l.bar.height
    $ev = "card of $($t.widgetId) at $($r.x),$($r.y) $($r.width)x$($r.height); bar bottom $barBottom; screen $($b.primaryWidth)x$($b.primaryHeight)"
    [void](Send-Command -Action 'closeAll')
    $bad = @()
    if ($r.y -lt $barBottom) { $bad += 'it overlaps the bar' }
    if (($r.y + $r.height) -gt ($b.y + $b.primaryHeight)) { $bad += 'it runs off the bottom' }
    if ($r.x -lt $b.x -or ($r.x + $r.width) -gt ($b.x + $b.primaryWidth)) { $bad += 'it runs off a side' }
    if ($bad.Count -gt 0) { throw "$($bad -join ', ') :: $ev" }
    $ev
}

Invoke-Step 'drag: the dock back to the bottom edge' -Check 'drag-edge-back' {
    Assert-Extra
    [void](Send-Command -Action 'closeAll')
    Start-Sleep -Milliseconds 600
    $l = Get-Layout
    $b = Get-ScreenBounds
    if ($l.edge -eq 'top' -and $null -ne $l.barFreePoint) {
        $x = [int]$l.barFreePoint.x
        $y = [int]$l.barFreePoint.y
        Invoke-Drag -X1 $x -Y1 $y -X2 $x -Y2 ([int]($b.y + $b.primaryHeight * 0.8)) -Steps 16 -StepMs 50 -HoldMs 150
        Start-Sleep -Milliseconds 3000
    }
    $l2 = Get-Layout
    $how = 'mouse'
    if ($l2.edge -ne 'bottom') {
        [void](Send-Command -Action 'setEdge' -CmdArgs @{ edge = 'bottom' })
        Start-Sleep -Milliseconds 3000
        $how = 'the mouse drag failed; setEdge command'
        $l2 = Get-Layout
    }
    $wa = (Get-TaskbarState).workArea
    Save-Shot 'drag-dock-bottom'
    $ev = "edge $($l2.edge) via $how; bar y $($l2.bar.y); work area $($wa -join ',')"
    if ($how -ne 'mouse') { throw $ev }
    $ev
}

# 6. Auto-hide.
Invoke-Step 'auto-hide: slides away from the pointer, work area full, comes back at the edge' -Check 'autohide' {
    [void](Send-Command -Action 'closeAll')
    $b = Get-ScreenBounds
    $mid = @([int]($b.x + $b.primaryWidth / 2), [int]($b.y + $b.primaryHeight / 2))
    Move-Mouse $mid[0] $mid[1]
    [void](Send-Command -Action 'setAutoHide' -CmdArgs @{ on = $true })
    Start-Sleep -Milliseconds 3000
    $l = Get-Layout
    $st = Send-Command -Action 'shellState'
    $tb = Get-TaskbarState
    Save-Shot 'autohide-hidden'
    $n = $l.window.native
    $regionH = 99999
    $region = 'unknown'
    if ($null -ne $n) {
        $region = "kind $($n.regionKind) box $($n.regionBox -join ',')"
        if ([int]$n.regionKind -eq 1) { $regionH = 0 }
        elseif ([int]$n.regionKind -ge 2) { $regionH = [int]$n.regionBox[3] - [int]$n.regionBox[1] }
    }
    $dock = @($st.rust.docks)[0]
    $hiddenOk = ($l.visibility -eq 'autohidden')
    $fullArea = ([int]$tb.workArea[3] -ge ($b.y + $b.primaryHeight))
    $ev = "away: page $($l.visibility), Rust $($dock.visibility), app bar $($dock.appBar), window $($n.rect -join ','), region $region, work area $($tb.workArea -join ',')"
    $cx = [int]($b.x + $b.primaryWidth / 2)
    if ($null -ne $l.bar) { $cx = [int]($l.bar.x + $l.bar.width / 2) }
    Move-Mouse $cx ([int]($b.y + $b.primaryHeight - 1))
    Start-Sleep -Milliseconds 1500
    $l2 = Get-Layout
    Save-Shot 'autohide-revealed'
    $shownOk = ($l2.visibility -eq 'shown')
    $ev += "; pointer at the edge: page $($l2.visibility), region box $($l2.window.native.regionBox -join ',')"
    Move-Mouse $mid[0] $mid[1]
    [void](Send-Command -Action 'setAutoHide' -CmdArgs @{ on = $false })
    Start-Sleep -Milliseconds 2500
    $l3 = Get-Layout
    $tb3 = Get-TaskbarState
    $ev += "; auto-hide off: page $($l3.visibility), work area $($tb3.workArea -join ',')"
    $bad = @()
    if (-not $hiddenOk) { $bad += 'it did not hide' }
    if ($regionH -gt 8) { $bad += "the clickable region is still $regionH px tall while hidden" }
    if (-not $fullArea) { $bad += 'the work area is not full height while hidden' }
    if (-not $shownOk) { $bad += 'it did not come back with the pointer at the edge' }
    if ($l3.visibility -ne 'shown') { $bad += 'not shown after auto-hide was turned off' }
    if ($bad.Count -gt 0) { throw "$($bad -join '; ') :: $ev" }
    $ev
}

# 7. Full-screen apps hide the dock.
Invoke-Step 'full screen: a borderless topmost window over the screen hides the dock; closing it brings it back' -Check 'fullscreen' {
    Assert-Extra
    [void](Send-Command -Action 'closeAll')
    $b = Get-ScreenBounds
    $fs = Open-TestWindow 'fullscreen' 'GlintBar smoke full screen' 0 0 0 0 0x202020
    $ev = ''
    $hidden = $false
    $vis = $null
    try {
        Start-Sleep -Milliseconds 600
        Invoke-Click ([int]($b.x + $b.primaryWidth / 2)) ([int]($b.y + $b.primaryHeight / 2))
        $l = $null
        $deadline = [DateTime]::UtcNow.AddSeconds(6)
        while (-not $hidden -and [DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 400
            $l = Get-Layout
            $hidden = ($l.visibility -eq 'suppressed')
        }
        $fg = Get-ForegroundInfo
        if ($null -ne $l.window.native) { $vis = [bool]$l.window.native.visible }
        $logHide = Find-LogLines 'full-screen app in front' 1
        Save-Shot 'fullscreen-on'
        $ev = "in front: $(Format-Window $fg) (the test window: $($fg.hwnd -eq $fs)); page $($l.visibility), dock window visible $vis, log line: $($logHide.Count -gt 0)"
    } finally {
        Close-TestWindow $fs
    }
    $shown = $false
    $l2 = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(6)
    while (-not $shown -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 400
        $l2 = Get-Layout
        $shown = ($l2.visibility -eq 'shown')
    }
    $vis2 = $null
    if ($null -ne $l2.window.native) { $vis2 = [bool]$l2.window.native.visible }
    $logShow = Find-LogLines 'full-screen app gone' 1
    Save-Shot 'fullscreen-off'
    $ev += "; closed: page $($l2.visibility), dock window visible $vis2, log line: $($logShow.Count -gt 0)"
    $bad = @()
    if (-not $hidden) { $bad += 'the dock did not hide' }
    if ($hidden -and $vis -ne $false) { $bad += 'the dock window stayed visible' }
    if (-not $shown -or $vis2 -ne $true) { $bad += 'the dock did not come back' }
    if ($bad.Count -gt 0) { throw "$($bad -join '; ') :: $ev" }
    $ev
}

# 8. Live glass with capture exclusion really on (smoke mode normally forbids it).
Invoke-Step 'live glass: frames, real capture exclusion, then back to visible' -Check 'glass' {
    Assert-Extra
    [void](Send-Command -Action 'closeAll')
    [void](Send-Command -Action 'setTheme' -CmdArgs @{ theme = 'midnight' })
    Start-Sleep -Milliseconds 1500
    $l = Get-Layout
    $bar = $l.bar
    if ($null -eq $bar) { throw 'no bar' }
    $dockHwnd = [long]0
    if ($null -ne $l.window.native) { $dockHwnd = [long]$l.window.native.hwnd }
    # A magenta window parked under the left part of the bar (the dock is topmost: it stays in front).
    $ww = 360
    $wh = [int]($bar.height + 120)
    $wy = [int]($bar.y - 60)
    $x0 = [int]($bar.x + 40)
    $px = [int]($x0 + $ww / 2)
    $py = [int]($bar.y + $bar.height / 2)
    $magenta = @(255, 0, 255)
    $win = Open-TestWindow 'popup' 'GlintBar smoke glass target' $x0 $wy $ww $wh 0xFF00FF
    $start = $null
    $s1 = $null
    $s2 = $null
    $m0 = $null
    $s3 = $null
    $rest = $null
    $stop = $null
    $aff1 = -1
    $aff2 = -1
    $c1 = @(0, 0, 0)
    $c2 = @(255, 0, 255)
    try {
        Start-Sleep -Milliseconds 500
        # 60 s (the maximum) covers the moves and the 10 s resting measurement below.
        $start = Send-Command -Action 'glassStart' -CmdArgs @{ theme = 'glass'; seconds = 60 } -TimeoutSec 30
        Write-Log "  glassStart: $($start | ConvertTo-Json -Compress -Depth 6)"
        Start-Sleep -Milliseconds 2000
        $s1 = Send-Command -Action 'glassStats'
        if ($dockHwnd -ne 0) { $aff1 = [GlintBarSmoke.Win]::Affinity($dockHwnd) }
        $c1 = Get-ScreenColor $px $py
        Save-Shot 'glass-live'
        # Move the window along under the bar: what is behind the dock changes, so must the frames.
        $span = [int][Math]::Max(200, $bar.width - $ww - 80)
        for ($i = 1; $i -le 8; $i++) {
            [void][GlintBarSmoke.Win]::MoveTo($win, [int]($x0 + $span * $i / 8), $wy)
            Start-Sleep -Milliseconds 350
        }
        Start-Sleep -Milliseconds 1200
        $s2 = Send-Command -Action 'glassStats'
        Write-Log "  after the moves: $($s2 | ConvertTo-Json -Compress -Depth 6)"
        # Nothing moves now: after 1 s the loop rests and must send nothing. Third idle measurement.
        [void][GlintBarSmoke.Win]::MoveTo($win, $x0, $wy)
        Start-Sleep -Milliseconds 2500
        $m0 = Send-Command -Action 'glassStats' -CmdArgs @{ mark = $true }
        $rest = Measure-GlintBarIdle 'live glass on, resting' 1 10
        $s3 = Send-Command -Action 'glassStats' -CmdArgs @{ mark = $true }
        Write-Log "  $($rest.text); resting: $($s3.status.resting), frames UI $($s3.framesSinceMark), Rust sent $($s3.status.framesSent) (was $($m0.status.framesSent))"
        if ($null -ne $script:Report.resources) { $script:Report.resources.glassLive = $rest }
        $stop = Send-Command -Action 'glassStop' -TimeoutSec 20
        Start-Sleep -Milliseconds 800
        if ($dockHwnd -ne 0) { $aff2 = [GlintBarSmoke.Win]::Affinity($dockHwnd) }
        $c2 = Get-ScreenColor $px $py
        Save-Shot 'glass-live-off'
    } finally {
        Close-TestWindow $win
        try { [void](Send-Command -Action 'glassStop' -TimeoutSec 20) } catch { }
        try { [void](Send-Command -Action 'setTheme' -CmdArgs @{ theme = 'midnight' }) } catch { }
    }
    $d1 = Get-ColorDistance $c1 $magenta
    $d2 = Get-ColorDistance $c2 $magenta
    $restFramesUi = -1
    $restFramesRust = -1
    if ($null -ne $s3) { $restFramesUi = [int]$s3.framesSinceMark }
    if ($null -ne $s3 -and $null -ne $m0 -and $null -ne $s3.status -and $null -ne $m0.status -and $null -ne $s3.status.framesSent) { $restFramesRust = [int]$s3.status.framesSent - [int]$m0.status.framesSent }
    $script:Report.glass = [ordered]@{ start = $start; live = $s1; moved = $s2; restStart = $m0; restEnd = $s3; rest = $rest; stop = $stop; affinityLive = $aff1; affinityAfter = $aff2; pixelLive = $c1; pixelAfter = $c2; restFramesUi = $restFramesUi; restFramesRust = $restFramesRust }
    $st = $s1.status
    $reason = ''
    if ($st.reason) { $reason = "/$($st.reason)" }
    $ev = "override $($start.granted) s (error: $($start.overrideError)), capture tier after $($start.waitedMs) ms: $($start.state.tier); live: tier $($st.tier)$reason, affinity $($s1.affinity) (driver: $aff1), Rust: os build $($st.osBuild), canExclude $($st.canExclude), blockedByEnv $($st.blockedByEnv), excluded $($st.excluded), lastError '$($st.lastError)', area $($st.captureRect -join ',') -> $($st.output -join 'x'); $($s1.frames) frames $($s1.sizes -join ' '), screenshot pixel under the bar $($c1 -join ',') (magenta distance $d1)"
    $ev += "; window moved under the dock: $($s2.frames) frames, $($s2.distinctHashes) distinct (was $($s1.distinctHashes)), ~$($s2.bytes) bytes each, $($s2.magentaFrames) with magenta (max share $($s2.magentaMax)), Rust sent $($s2.status.framesSent)"
    $ev += "; resting: status resting $($s3.status.resting), frames during 11 s: UI $restFramesUi, Rust $restFramesRust; $($rest.text)"
    $ev += "; off: affinity $($stop.affinity) (driver: $aff2), pixel $($c2 -join ',') (magenta distance $d2)"
    $bad = @()
    if ($null -ne $start.overrideError) { $bad += 'the capture override failed' }
    if ([int]$s1.affinity -ne 17 -or $aff1 -ne 17) { $bad += 'the dock was not excluded from capture while live' }
    if ([int]$s2.frames -lt 5) { $bad += 'fewer than 5 frames arrived' }
    if ([int]$s2.distinctHashes -le [int]$s1.distinctHashes) { $bad += 'the frames did not change when a window moved behind the dock' }
    if ([int]$s2.magentaFrames -lt 1) { $bad += 'no frame contained the magenta window (the capture is not of what is behind the dock)' }
    if ($d1 -gt 40) { $bad += 'a screenshot still showed the dock while it was excluded' }
    if ($s3.status.resting -ne $true) { $bad += 'live glass did not rest while nothing moved behind the dock' }
    if ($restFramesUi -ne 0 -or $restFramesRust -gt 0) { $bad += 'frames kept arriving while nothing moved behind the dock' }
    if ([int]$stop.affinity -ne 0 -or $aff2 -ne 0) { $bad += 'the display affinity is not 0 after live glass was turned off' }
    if ($d2 -le 40) { $bad += 'screenshots do not show the dock after live glass was turned off' }
    if ($bad.Count -gt 0) { throw "$($bad -join '; ') :: $ev" }
    $ev
}

# 9. What GlintBar does with the Windows taskbar.
Invoke-Step 'taskbar modes: hidden -> auto-hide -> leave alone -> hidden' -Check 'taskbar-modes' {
    Assert-Extra
    $abmBefore = [long]$script:Report.taskbarBefore.abm
    $rows = @()
    $bad = @()
    foreach ($mode in @('hidden', 'autohide', 'leave', 'hidden')) {
        [void](Send-Command -Action 'setDockPrefs' -CmdArgs @{ taskbarMode = $mode })
        Start-Sleep -Milliseconds 2500
        $tb = Get-TaskbarState
        $auto = (([long]$tb.abm -band 1) -eq 1)
        $rows += "$mode -> Shell_TrayWnd visible $($tb.visible), ABM state $($tb.abm) (auto-hide $auto), work area $($tb.workArea -join ',')"
        switch ($mode) {
            'hidden' { if ($tb.visible -or -not $auto) { $bad += "$($mode): expected hidden with auto-hide on" } }
            'autohide' { if (-not $tb.visible -or -not $auto) { $bad += "$($mode): expected visible with auto-hide on" } }
            'leave' { if (-not $tb.visible -or ([long]$tb.abm -ne $abmBefore)) { $bad += "$($mode): expected visible with ABM state $abmBefore as before launch" } }
        }
    }
    Save-Shot 'taskbar-hidden-again'
    $ev = $rows -join ' | '
    if ($bad.Count -gt 0) { throw "$($bad -join '; ') :: $ev" }
    $ev
}

# ---- 4c. round three: Displays = All and the dock watchdog, magnification, full-width alignment --

# 11. Displays = All on a one-screen runner must not break anything. Then the watchdog must bring
# back a dock window hidden behind GlintBar's back (SW_HIDE from here) and one that lost HWND_TOPMOST,
# each within a few seconds and with a log line saying why.
Invoke-Step 'displays all on one screen; the watchdog shows a hidden dock again and makes it topmost again' -Check 'watchdog' {
    Assert-Extra
    if (-not $script:GuardOk) { throw 'the watchdog helpers are unavailable (see the HARNESS lines in drive.log)' }
    [void](Send-Command -Action 'closeAll')
    $prefs = Send-Command -Action 'setDockPrefs' -CmdArgs @{}
    $displaysBefore = [string]$prefs.displays
    if (-not $displaysBefore) { $displaysBefore = 'main' }
    $h = [long]0
    $bad = @()
    $ev = ''
    try {
        [void](Send-Command -Action 'setDockPrefs' -CmdArgs @{ displays = 'all' })
        Start-Sleep -Milliseconds 2500
        $st = Send-Command -Action 'shellState'
        $l = Get-Layout
        $docks = @($st.rust.docks)
        $mons = @($st.rust.monitors)
        $desc = @($docks | ForEach-Object { "$($_.label) on $($_.monitor) ($($_.visibility))" }) -join ', '
        $ev = "displays all: $($docks.Count) dock window(s) [$desc] for $($mons.Count) monitor(s); page $($l.visibility), $(@($l.tiles).Count) tiles"
        if ($docks.Count -ne $mons.Count) { $bad += 'not one dock window per monitor' }
        if ($l.visibility -ne 'shown' -or @($l.tiles).Count -eq 0) { $bad += 'the dock is not shown with Displays = All' }
        if ($null -ne $l.window.native) { $h = [long]$l.window.native.hwnd }
        if ($h -eq 0) { throw "no dock window handle :: $ev" }

        $mark = Get-LogMark 'dock watchdog'
        $wasVisible = [GlintBarSmoke.Win]::Visible($h)
        [void][GlintBarSmoke.Guard]::Hide($h)
        Start-Sleep -Milliseconds 150
        $hiddenNow = -not [GlintBarSmoke.Win]::Visible($h)
        $clock = [System.Diagnostics.Stopwatch]::StartNew()
        $back = $false
        while (-not $back -and $clock.Elapsed.TotalSeconds -lt 12) {
            Start-Sleep -Milliseconds 250
            $back = [GlintBarSmoke.Win]::Visible($h)
        }
        $hideSecs = [Math]::Round($clock.Elapsed.TotalSeconds, 1)
        Start-Sleep -Milliseconds 300
        $hideLines = Get-NewLogLines 'dock watchdog' $mark
        Save-Shot 'watchdog-shown-again'
        $ev += "; SW_HIDE (visible before $wasVisible, hidden after $hiddenNow) -> visible again: $back after $hideSecs s; log: $(Format-LogLines $hideLines)"
        if (-not $hiddenNow) { $bad += 'SW_HIDE from the driver did not hide the dock window (nothing to repair)' }
        if (-not $back) { $bad += 'the hidden dock window was not shown again within 12 s' }
        if (@($hideLines | Where-Object { $_ -match 'hidden' }).Count -eq 0) { $bad += 'no watchdog log line naming the hidden window' }

        $mark = Get-LogMark 'dock watchdog'
        [void][GlintBarSmoke.Guard]::DropTopmost($h)
        Start-Sleep -Milliseconds 150
        $dropped = -not [GlintBarSmoke.Guard]::IsTopmost($h)
        $clock = [System.Diagnostics.Stopwatch]::StartNew()
        $top = $false
        while (-not $top -and $clock.Elapsed.TotalSeconds -lt 12) {
            Start-Sleep -Milliseconds 250
            $top = [GlintBarSmoke.Guard]::IsTopmost($h)
        }
        $topSecs = [Math]::Round($clock.Elapsed.TotalSeconds, 1)
        Start-Sleep -Milliseconds 300
        $topLines = Get-NewLogLines 'dock watchdog' $mark
        $ev += "; HWND_NOTOPMOST (cleared $dropped) -> topmost again: $top after $topSecs s; log: $(Format-LogLines $topLines)"
        if (-not $dropped) { $bad += 'HWND_NOTOPMOST from the driver did not clear the topmost flag (nothing to repair)' }
        if (-not $top) { $bad += 'the dock window was not made topmost again within 12 s' }
        if (@($topLines | Where-Object { $_ -match 'not topmost' }).Count -eq 0) { $bad += 'no watchdog log line naming the lost topmost flag' }
    } finally {
        [void](Send-Command -Action 'setDockPrefs' -CmdArgs @{ displays = $displaysBefore })
        Start-Sleep -Milliseconds 1500
    }
    if ($bad.Count -gt 0) { throw "$($bad -join '; ') :: $ev" }
    $ev
}

# 12. Magnification at the largest size: the hovered app grows above the bar, is really drawn there
# (screen pixels with the pointer on it vs. away) and a click on the raised part reaches the app.
Invoke-Step 'magnification: the hovered app grows above the bar, shows on screen there and takes a click there' -Check 'magnify' {
    Assert-Extra
    [void](Send-Command -Action 'closeAll')
    $b = Get-ScreenBounds
    $away = @([int]($b.x + $b.primaryWidth * 0.97), [int]($b.y + $b.primaryHeight * 0.4))
    $prefs = Send-Command -Action 'setDockPrefs' -CmdArgs @{}
    $pinsBefore = $null
    $bad = @()
    $ev = ''
    try {
        [void](Send-Command -Action 'setDockPrefs' -CmdArgs @{ magnification = $true; magnifyScale = 2 })
        $s = Send-Command -Action 'appsState'
        if (-not $s.onDock) { throw 'the Apps tile is not on the dock' }
        # Five plain pins, so there is a middle one. Clicking one only asks Rust to launch it, which
        # smoke mode blocks and records (no program starts).
        $pins = @()
        foreach ($p in @('notepad.exe', 'regedit.exe', 'System32\cmd.exe', 'System32\calc.exe', 'explorer.exe')) {
            $target = Join-Path $env:WINDIR $p
            $exe = $target.ToLowerInvariant()
            $pins += , ([ordered]@{ id = "exe:$exe"; name = [System.IO.Path]::GetFileNameWithoutExtension($target); kind = 'app'; target = $target; args = $null; aumid = $null; exe = $exe; icon = $exe })
        }
        $set = Send-Command -Action 'appsSetPins' -CmdArgs @{ pins = $pins }
        $pinsBefore = @($set.before)
        Start-Sleep -Milliseconds 1500
        $s = Send-Command -Action 'appsState'
        $midKey = $pins[2].id
        $mid = Get-AppsItem $s $midKey
        if ($null -eq $mid) { throw "no dock item for $midKey; items: $(@($s.items | ForEach-Object { $_.key }) -join ', ')" }
        Move-Mouse $away[0] $away[1]
        Start-Sleep -Milliseconds 600
        foreach ($dx in @(-14, -6, 0)) {
            Move-Mouse ([int]$mid.x + $dx) ([int]$mid.y)
            Start-Sleep -Milliseconds 120
        }
        Start-Sleep -Milliseconds 900
        $ms = Send-Command -Action 'magnifyState'
        Save-Shot 'magnify-on'
        $copy = @($ms.copies | Where-Object { $_.key -eq $midKey })[0]
        if (-not $ms.layer -or $null -eq $copy -or $null -eq $ms.bar) { throw "no magnified icons (layer $($ms.layer), copies $(@($ms.copies).Count), magnification $($ms.magnification))" }
        $barTop = [int]$ms.bar.y
        $rise = $barTop - [int]$copy.rect.y
        $expected = [int]((([double]$ms.sizePx * ([double]$copy.scale - 1)) - [double]$ms.padding - 1) * [double]$ms.scale)
        $ev = "middle app $midKey at scale $($copy.scale): $($copy.rect.width)x$($copy.rect.height) at $($copy.rect.x),$($copy.rect.y); bar top $barTop; rises $rise px (expected about $expected)"
        $cx = [int]([int]$copy.rect.x + [int]$copy.rect.width / 2)
        $ys = @()
        for ($k = 1; $k -le 6; $k++) { $ys += [int]($barTop - [Math]::Max(2, $rise) * $k / 7) }
        $on = @()
        foreach ($y in $ys) { $on += , (Get-ScreenColor $cx $y) }
        # Straight up from the pointer (no sideways move, so the icons do not shift under it).
        $px = [int]$mid.x
        $clickY = [int]($barTop - [Math]::Max(3, [int]($rise / 3)))
        $at = Get-WindowAt $px $clickY
        $blk = Send-Command -Action 'blocked'
        $opensBefore = @($blk | Where-Object { "$_" -like 'shell.open*' }).Count
        Invoke-Click $px $clickY
        Start-Sleep -Milliseconds 1000
        $blk = Send-Command -Action 'blocked'
        $opensAfter = @($blk | Where-Object { "$_" -like 'shell.open*' }).Count
        $launched = ($opensAfter -gt $opensBefore)
        Move-Mouse $away[0] $away[1]
        Start-Sleep -Milliseconds 1200
        $off = @()
        foreach ($y in $ys) { $off += , (Get-ScreenColor $cx $y) }
        $maxDiff = 0
        for ($k = 0; $k -lt $ys.Count; $k++) { $maxDiff = [Math]::Max($maxDiff, (Get-ColorDistance $on[$k] $off[$k])) }
        $ms2 = Send-Command -Action 'magnifyState'
        Save-Shot 'magnify-off'
        $ev += "; pixels above the bar at x $cx differ by up to $maxDiff (pointer on vs away); window under the raised part at $px,$($clickY): $($at.class) (glintbar $($at.isGlintBar)); click there -> launch attempt $launched (shell.open blocked $opensBefore -> $opensAfter); pointer away: magnified layer $($ms2.layer)"
        if ($expected -lt 8) { $bad += "the expected rise ($expected px) is too small to judge" }
        if ($rise -lt [int]($expected * 0.8)) { $bad += "the icon rises $rise px above the bar, expected about $expected" }
        if ($maxDiff -lt 30) { $bad += 'the screen above the bar did not change (the raised part is clipped)' }
        if (-not $at.isGlintBar) { $bad += "the raised part is not in the dock window's click region (window there: $($at.class))" }
        if (-not $launched) { $bad += 'a click on the raised part did not activate the app' }
        if ($ms2.layer) { $bad += 'the magnified icons stayed after the pointer left' }
    } finally {
        Move-Mouse $away[0] $away[1]
        if ($null -ne $pinsBefore) { [void](Send-Command -Action 'appsSetPins' -CmdArgs @{ pins = @($pinsBefore) }) }
        [void](Send-Command -Action 'setDockPrefs' -CmdArgs @{ magnification = [bool]$prefs.magnification; magnifyScale = [double]$prefs.magnifyScale })
    }
    if ($bad.Count -gt 0) { throw "$($bad -join '; ') :: $ev" }
    $ev
}

# 13. Full width with the widgets at the left, in the centre and at the right (Settings > Dock).
Invoke-Step 'full width: widgets at the left, in the centre and at the right' -Check 'align' {
    [void](Send-Command -Action 'closeAll')
    $rows = @()
    $bad = @()
    try {
        foreach ($al in @('left', 'center', 'right')) {
            $set = Send-Command -Action 'setAlign' -CmdArgs @{ fullWidth = $true; align = $al }
            Start-Sleep -Milliseconds 1200
            $l = Get-Layout
            Save-Shot "align-$al"
            $tiles = @($l.tiles)
            if ($null -eq $l.bar -or $tiles.Count -eq 0) {
                $bad += "$($al): no bar or no tiles"
                continue
            }
            $first = $tiles[0]
            $last = $tiles[$tiles.Count - 1]
            $leftGap = [int]$first.rect.x - [int]$l.bar.x
            $rightGap = ([int]$l.bar.x + [int]$l.bar.width) - ([int]$last.rect.x + [int]$last.rect.width)
            $rows += "$($al): applied $($set.applied), overflowing $($set.overflowing), bar $($l.bar.width) px, gaps $leftGap / $rightGap px"
            if ($set.overflowing) { continue }
            $tol = [Math]::Max(12, [int]([int]$l.bar.width * 0.02))
            if ($al -eq 'left' -and $leftGap -gt 40) { $bad += "left: the first tile is $leftGap px from the start of the bar" }
            if ($al -eq 'center' -and [Math]::Abs($leftGap - $rightGap) -gt $tol) { $bad += "center: the gaps are $leftGap and $rightGap px" }
            if ($al -eq 'right' -and $rightGap -gt 40) { $bad += "right: the last tile is $rightGap px from the end of the bar" }
        }
    } finally {
        [void](Send-Command -Action 'setAlign' -CmdArgs @{ fullWidth = $false; align = 'left' })
        Start-Sleep -Milliseconds 800
    }
    $ev = $rows -join ' | '
    if ($bad.Count -gt 0) { throw "$($bad -join '; ') :: $ev" }
    $ev
}

# Leftovers from the steps above.
Invoke-Step 'close test windows' {
    $closed = 0
    foreach ($h in @($script:TestWindows)) {
        if ($script:ExtraOk -and [GlintBarSmoke.Win]::Exists($h)) {
            Close-TestWindow $h
            $closed++
        }
    }
    if ($script:ExtraOk -and $script:ExplorerHwnd -ne 0 -and [GlintBarSmoke.Win]::Exists($script:ExplorerHwnd)) {
        Close-TestWindow $script:ExplorerHwnd
        $closed++
    }
    [void](Send-Command -Action 'restoreDock')
    "$closed closed"
}

# 10. Crash recovery, last: kill hard while the taskbar is hidden, relaunch, then the normal quit
# below must restore everything.
Invoke-Step 'crash recovery: Stop-Process -Force with the taskbar hidden, relaunch, a normal quit restores the original taskbar' -Check 'crash-recovery' {
    Assert-Extra
    $flag = Join-Path $AppData 'GlintBar\taskbar-hidden.json'
    $orig = $script:Report.taskbarBefore
    $origArea = ($orig.workArea -join ',')
    $tb0 = Get-TaskbarState
    if ($tb0.visible) { throw 'the taskbar is visible before the kill; nothing to recover' }
    $tree = Get-GlintBarTree
    $oldPid = $script:Proc.Id
    $script:Quitting = $true
    Stop-Process -Id $oldPid -Force -ErrorAction Stop
    [void]$script:Proc.WaitForExit(10000)
    Start-Sleep -Milliseconds 2000
    # Windows shows Shell_TrayWnd again by itself when the app bar owner dies (auto-hide stays
    # set): expected, only recorded. What matters is the flag file holding the ORIGINAL state.
    $tb1 = Get-TaskbarState
    $flagLeft = Test-Path -LiteralPath $flag
    $flagText = ''
    $flagState = $null
    if ($flagLeft) {
        try {
            $flagText = (Get-Content -LiteralPath $flag -Raw -ErrorAction Stop).Trim()
            $flagState = ($flagText | ConvertFrom-Json -ErrorAction Stop).previousState
        } catch { $flagText = "unreadable: $($_.Exception.Message)" }
    }
    Save-Shot 'crash-killed'
    # The killed instance's WebView2 processes exit on their own; make sure before relaunching.
    $kids = @($tree | Where-Object { $_.pid -ne $oldPid })
    $alive = @()
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        $alive = @($kids | Where-Object { $null -ne (Get-Process -Id $_.pid -ErrorAction SilentlyContinue) })
        if ($alive.Count -eq 0) { break }
        Start-Sleep -Milliseconds 400
    } while ([DateTime]::UtcNow -lt $deadline)
    foreach ($k in $alive) { Stop-Process -Id $k.pid -Force -ErrorAction SilentlyContinue }
    $ev = "original: taskbar visible $($orig.visible), ABM $($orig.abm), work area $origArea; after the kill: taskbar visible $($tb1.visible) (Windows may re-show it), ABM $($tb1.abm), work area $($tb1.workArea -join ','), flag file left: $flagLeft ($flagText), WebView2 leftovers killed: $($alive.Count)"
    foreach ($name in @('layout.json', 'command.json', 'command-result.json')) {
        Remove-Item -LiteralPath (Join-Path $AppSmoke $name) -Force -ErrorAction SilentlyContinue
    }
    $script:Proc = Start-GlintBar
    $script:Quitting = $false
    $l = Wait-DockRendered 60
    $tb2 = Get-TaskbarState
    $recovered = Find-LogLines 'left changed by a previous run' 1
    Save-Shot 'crash-relaunched'
    $ev += "; relaunched pid $($script:Proc.Id): dock rendered $($null -ne $l), recovery logged $($recovered.Count -gt 0), while running: taskbar visible $($tb2.visible), ABM $($tb2.abm)"
    # The normal quit happens here (the quit step below then finds the app gone; the last step
    # checks the taskbar once more).
    $script:Quitting = $true
    $quitHow = 'app.quit'
    if (Test-Alive) {
        try { [void](Send-Command -Action 'quit' -TimeoutSec 10) } catch { if (-not $script:Proc.HasExited) { $quitHow = "app.quit failed ($($_.Exception.Message))" } }
        if (-not $script:Proc.WaitForExit(20000)) { $quitHow += '; did not exit within 20 s' }
    } else {
        $quitHow = 'the relaunched app was already gone'
    }
    $code = $null
    try { $code = $script:Proc.ExitCode } catch { }
    $script:Report.quit = "$quitHow (after the crash-recovery relaunch)"
    $script:Report.exitCode = $code
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 500
        $tb3 = Get-TaskbarState
        $flagGone = -not (Test-Path -LiteralPath $flag)
        $sameAbm = ([long]$orig.abm -lt 0) -or ([long]$tb3.abm -eq [long]$orig.abm)
        $sameArea = (($tb3.workArea -join ',') -eq $origArea)
        $restored = ($tb3.visible -and $sameAbm -and $sameArea -and $flagGone)
    } while (-not $restored -and [DateTime]::UtcNow -lt $deadline)
    $ev += "; after the normal quit ($quitHow, exit code $code): taskbar visible $($tb3.visible), ABM $($tb3.abm) (original $($orig.abm)), work area $($tb3.workArea -join ',') (original $origArea), flag file gone: $flagGone"
    $script:Report.crashRecovery = [ordered]@{ original = $orig; beforeKill = $tb0; afterKill = $tb1; flagLeft = $flagLeft; flag = $flagText; relaunched = ($null -ne $l); recoveryLogged = ($recovered.Count -gt 0); whileRunning = $tb2; quit = $quitHow; exitCode = $code; afterQuit = $tb3; flagGoneAfterQuit = $flagGone }
    $bad = @()
    if (-not $flagLeft) { $bad += 'no taskbar-hidden.json was left after the kill' }
    elseif ($null -eq $flagState) { $bad += 'taskbar-hidden.json has no previousState' }
    elseif ([long]$orig.abm -ge 0 -and [long]$flagState -ne [long]$orig.abm) { $bad += "taskbar-hidden.json holds ABM state $flagState, not the original $($orig.abm)" }
    if ($null -eq $l) { $bad += 'the relaunched dock did not render' }
    if ($recovered.Count -eq 0) { $bad += 'the relaunch did not log the taskbar recovery' }
    if (-not $tb3.visible) { $bad += 'the taskbar is not visible after the normal quit' }
    if (-not $sameAbm) { $bad += "ABM state after the quit is $($tb3.abm), not the original $($orig.abm)" }
    if (-not $sameArea) { $bad += "work area after the quit is $($tb3.workArea -join ','), not the original $origArea" }
    if (-not $flagGone) { $bad += 'taskbar-hidden.json is still there after the quit' }
    if ($bad.Count -gt 0) { throw "$($bad -join '; ') :: $ev" }
    $ev
}

# ---- 5. quit and check the taskbar ------------------------------------------------------------

Invoke-Step 'quit' -Always {
    if ($null -eq $script:Proc) { throw 'the app was never started' }
    if (-not (Test-Alive)) { return 'already gone' }
    $script:Quitting = $true
    $how = 'app.quit'
    try { [void](Send-Command -Action 'quit' -TimeoutSec 10) } catch { if (-not $script:Proc.HasExited) { $how = "app.quit failed ($($_.Exception.Message))" } }
    if (-not $script:Proc.WaitForExit(20000)) {
        $how += '; taskkill (WM_CLOSE)'
        & taskkill.exe /PID $script:Proc.Id 2>&1 | Out-Null
        if (-not $script:Proc.WaitForExit(10000)) {
            $how += '; FORCE KILLED (no cleanup ran)'
            Stop-Process -Id $script:Proc.Id -Force -ErrorAction SilentlyContinue
            [void]$script:Proc.WaitForExit(5000)
        }
    }
    $code = $null
    try { $code = $script:Proc.ExitCode } catch { }
    $script:Report.quit = $how
    $script:Report.exitCode = $code
    "$how; exit code $code"
}

Invoke-Step 'taskbar and work area restored' -Always {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 500
        $state = Get-TaskbarState
        $sameArea = (($state.workArea -join ',') -eq ($script:Report.taskbarBefore.workArea -join ','))
        # ABM state (auto-hide / always on top) as before launch, when both are known.
        $abmBefore = [long]$script:Report.taskbarBefore.abm
        $sameAbm = ($abmBefore -lt 0) -or ([long]$state.abm -lt 0) -or ([long]$state.abm -eq $abmBefore)
        $restoredNow = (($state.visible -eq $script:Report.taskbarBefore.visible) -and $sameArea -and $sameAbm)
    } while (-not $restoredNow -and [DateTime]::UtcNow -lt $deadline)
    $script:Report.taskbarAfter = $state
    $script:TaskbarRestored = [bool]$restoredNow
    Save-Shot 'after-quit'
    $msg = "taskbar visible $($state.visible) (before: $($script:Report.taskbarBefore.visible)); work area $($state.workArea -join ',') (before: $($script:Report.taskbarBefore.workArea -join ',')); ABM state $($state.abm) (before: $($script:Report.taskbarBefore.abm))"
    if (-not $restoredNow) { throw $msg }
    $msg
}

# ---- 6. verdict -------------------------------------------------------------------------------

$reasons = @()
if (-not $script:DockRendered) { $reasons += 'the dock never rendered' }
if ($script:Crashed) { $reasons += "the app crashed: $($script:CrashInfo)" }
if (-not $script:TaskbarRestored) { $reasons += 'the taskbar / work area was not restored on quit' }
if (-not $script:NativeOk) { $reasons += 'harness: the native helpers failed, nothing could be verified' }

$script:Report.finishedAt = (Get-Date).ToString('o')
$script:Report.seconds = [int]$script:T0.Elapsed.TotalSeconds
$script:Report.dockRendered = $script:DockRendered
$script:Report.crashed = $script:Crashed
$script:Report.crashInfo = $script:CrashInfo
$script:Report.taskbarRestored = $script:TaskbarRestored
$script:Report.steps = $script:Steps
$script:Report.shots = $script:Shots
$script:Report.verdict = [ordered]@{ fail = ($reasons.Count -gt 0); reasons = $reasons }
$script:Report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $OutDir 'drive.json') -Encoding utf8

$failedSteps = @($script:Steps | Where-Object { $_.status -eq 'failed' }).Count
$verdict = 'PASS'
if ($reasons.Count -gt 0) { $verdict = 'FAIL - ' + ($reasons -join '; ') }
Write-Log "done in $([int]$script:T0.Elapsed.TotalSeconds) s: $($script:Steps.Count) steps, $failedSteps failed; verdict: $verdict"
if ($reasons.Count -gt 0) { exit 1 }
exit 0
