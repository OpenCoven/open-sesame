# Starts the development binary on a Windows desktop and writes down what the companion rail's
# window does: where the strip is, whether it leaves the keyboard with the window that had it,
# and what resting on it, a click on it and `open-sesame --toggle` change. Resting is a stand-in
# file (OPEN_SESAME_DEV_POINTER); the click is a real one, so this moves the pointer and belongs
# on a machine nobody is using. Run by hosted CI on a virtual machine: no person, no real display,
# and it fills no smoke-pass cell. See docs/companion-rail.md.
param([Parameter(Mandatory)][string]$Binary, [Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class RailProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfoW(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);

  // What a person sees of the window, on the screen: left, top, width, height. A window with a
  // shadow and no frame has an unseen border around this.
  public static int[] Seen(IntPtr hwnd) {
    RECT client; GetClientRect(hwnd, out client);
    var origin = new POINT(); ClientToScreen(hwnd, ref origin);
    return new[] { origin.X, origin.Y, client.Right - client.Left, client.Bottom - client.Top };
  }

  // One press and release of the left button at a point of the screen.
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(120);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }

  static readonly object Gate = new object();

  // The process with what it writes appended to `log`, and no console window of its own.
  public static Process Start(string exe, string log) {
    var info = new ProcessStartInfo(exe) { UseShellExecute = false, RedirectStandardError = true, RedirectStandardOutput = true, CreateNoWindow = true };
    var process = new Process { StartInfo = info };
    DataReceivedEventHandler write = (sender, e) => { if (e.Data != null) lock (Gate) File.AppendAllText(log, e.Data + "\n"); };
    process.ErrorDataReceived += write;
    process.OutputDataReceived += write;
    process.Start();
    process.BeginErrorReadLine();
    process.BeginOutputReadLine();
    return process;
  }

  public static string Title(IntPtr hwnd) { var text = new StringBuilder(256); GetWindowTextW(hwnd, text, 256); return text.ToString(); }
  public static string Class(IntPtr hwnd) { var text = new StringBuilder(256); GetClassNameW(hwnd, text, 256); return text.ToString(); }
  public static uint Owner(IntPtr hwnd) { uint pid; GetWindowThreadProcessId(hwnd, out pid); return pid; }
  public static long Style(IntPtr hwnd) { return GetWindowLongPtr(hwnd, -16).ToInt64(); }
  public static long ExStyle(IntPtr hwnd) { return GetWindowLongPtr(hwnd, -20).ToInt64(); }

  // The top-level windows of one process that are on screen.
  public static List<IntPtr> Windows(uint pid) {
    var found = new List<IntPtr>();
    EnumWindows((hwnd, l) => { if (Owner(hwnd) == pid && IsWindowVisible(hwnd)) found.Add(hwnd); return true; }, IntPtr.Zero);
    return found;
  }

  // The part of the window's monitor that a window may use: left, top, right, bottom.
  public static int[] WorkArea(IntPtr hwnd) {
    var info = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
    GetMonitorInfoW(MonitorFromWindow(hwnd, 2), ref info);
    return new[] { info.rcWork.Left, info.rcWork.Top, info.rcWork.Right, info.rcWork.Bottom };
  }
}
'@

# Positions below are physical pixels, as the application's own are.
[RailProbe]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null

$Binary = (Resolve-Path $Binary).Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$scratch = Join-Path $env:TEMP ('open-sesame-rail-' + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $scratch | Out-Null
$log = Join-Path $Out 'application.log'
$pointer = Join-Path $scratch 'pointer.txt'
Set-Content -Path $log -Value '' -NoNewline
$env:OPEN_SESAME_DEV_CONFIG_DIR = Join-Path $scratch 'settings'
$env:OPEN_SESAME_DEV_POINTER = $pointer
New-Item -ItemType Directory -Path $env:OPEN_SESAME_DEV_CONFIG_DIR | Out-Null
# Far from either edge of the screen until a step puts it on the strip.
Set-Content -Path $pointer -Value '200 200'

$steps = New-Object System.Collections.ArrayList
$script:failed = $false
function Note($Name, $Passed, $Observed) {
  if (-not $Passed) { $script:failed = $true }
  [void]$steps.Add([ordered]@{ name = $Name; passed = [bool]$Passed; observed = $Observed })
  Write-Host ("{0} {1}: {2}" -f $(if ($Passed) { 'PASS' } else { 'FAIL' }), $Name, ($Observed | ConvertTo-Json -Compress -Depth 6))
}
function Pump($Milliseconds) {
  $until = [DateTime]::UtcNow.AddMilliseconds($Milliseconds)
  do { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 } while ([DateTime]::UtcNow -lt $until)
}
# Waits until the condition holds; `$false` when it never did.
function Wait-For([scriptblock]$Condition, $Seconds) {
  $until = [DateTime]::UtcNow.AddSeconds($Seconds)
  while ([DateTime]::UtcNow -lt $until) {
    if (& $Condition) { return $true }
    Pump 100
  }
  return [bool](& $Condition)
}
function Look($Hwnd) {
  $rect = New-Object RailProbe+RECT
  [void][RailProbe]::GetWindowRect($Hwnd, [ref]$rect)
  $seen = [RailProbe]::Seen($Hwnd)
  $front = [RailProbe]::GetForegroundWindow()
  $exStyle = [RailProbe]::ExStyle($Hwnd)
  [ordered]@{
    x = $seen[0]; y = $seen[1]; width = $seen[2]; height = $seen[3]
    withUnseenBorder = @($rect.Left, $rect.Top, ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
    visible = [RailProbe]::IsWindowVisible($Hwnd)
    refusesKeyboard = [bool]($exStyle -band 0x08000000)
    topmost = [bool]($exStyle -band 0x8)
    exStyle = ('0x{0:X8}' -f $exStyle)
    style = ('0x{0:X8}' -f [RailProbe]::Style($Hwnd))
    foreground = $(if ($front -eq $Hwnd) { 'rail' } elseif ($front -eq $other.Handle) { 'other window' } elseif ($front -eq [IntPtr]::Zero) { 'none' } else { 'something else: ' + [RailProbe]::Class($front) + ' / ' + [RailProbe]::Title($front) })
  }
}
function Capture($Name) {
  try {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $image = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($image)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $image.Save((Join-Path $Out "$Name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose(); $image.Dispose()
    return $true
  } catch { Write-Host "No image for ${Name}: $_"; return $false }
}

# Another application's window, which has the keyboard before the rail appears.
$other = New-Object System.Windows.Forms.Form
$other.Text = 'Open Sesame rail check: the other window'
$other.StartPosition = 'Manual'
$other.Location = New-Object System.Drawing.Point 80, 80
$other.Size = New-Object System.Drawing.Size 480, 320
$field = New-Object System.Windows.Forms.TextBox
$field.Dock = 'Fill'; $field.Multiline = $true
$other.Controls.Add($field)
$other.Show()
$other.Activate()
[void][RailProbe]::SetForegroundWindow($other.Handle)
$hasDesktop = Wait-For { [RailProbe]::GetForegroundWindow() -eq $other.Handle } 10
Note 'the other window has the keyboard before the application starts' $hasDesktop ([ordered]@{
  foreground = [RailProbe]::Title([RailProbe]::GetForegroundWindow())
  screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.ToString()
  system = [Environment]::OSVersion.VersionString
})

$process = $null
$images = [ordered]@{}
try {
  $process = [RailProbe]::Start($Binary, $log)
  $loaded = Wait-For { (Get-Content -Raw $log) -match 'open-sesame: page loaded' } 120
  $hwnd = [IntPtr]::Zero
  $appeared = Wait-For {
    $script:candidates = [RailProbe]::Windows([uint32]$process.Id)
    $candidates.Count -gt 0
  } 30
  # The toolkit also keeps windows of no size for its own messages; a person sees the ones with
  # the application's window class.
  $all = @($candidates | ForEach-Object { [ordered]@{ class = [RailProbe]::Class($_); title = [RailProbe]::Title($_) } })
  $own = @($candidates | Where-Object { [RailProbe]::Class($_) -eq 'Tauri Window' })
  foreach ($candidate in $own) { if ([RailProbe]::Title($candidate) -eq 'Open Sesame') { $hwnd = $candidate } }
  Note 'the application starts, loads its page and puts one window on the screen' ($loaded -and $appeared -and $hwnd -ne [IntPtr]::Zero -and $own.Count -eq 1) ([ordered]@{ pageLoaded = $loaded; windows = $all; exited = $process.HasExited })
  if ($hwnd -eq [IntPtr]::Zero) { throw 'The application put no window titled Open Sesame on the screen.' }

  $unit = [RailProbe]::GetDpiForWindow($hwnd) / 96.0
  $work = [RailProbe]::WorkArea($hwnd)
  $stripWidth = [int][Math]::Round(56 * $unit); $stripHeight = [int][Math]::Round(376 * $unit)
  $panelWidth = [int][Math]::Round(400 * $unit); $margin = [int][Math]::Round(8 * $unit)
  $panelHeight = ($work[3] - $work[1]) - 2 * $margin
  function Is-Strip($Seen) { $Seen.width -eq $stripWidth -and $Seen.height -eq $stripHeight }
  function Is-Panel($Seen) { $Seen.width -eq $panelWidth -and $Seen.height -eq $panelHeight }
  function At-Right-Edge($Seen) { ($Seen.x + $Seen.width) -eq ($work[2] - $margin) }

  # 1. The strip, where it belongs, and the keyboard still in the other window.
  Pump 1500
  $seen = Look $hwnd
  $seen.workArea = $work; $seen.unit = $unit
  $centred = [Math]::Abs(($seen.y + $seen.height / 2) - (($work[1] + $work[3]) / 2)) -le 1
  Note 'the strip is 56 by 376 against the right edge, centred, above other windows' ((Is-Strip $seen) -and (At-Right-Edge $seen) -and $centred -and $seen.topmost) $seen
  Note 'the strip appeared without taking the keyboard from the other window' ($seen.foreground -eq 'other window' -and $seen.refusesKeyboard) ([ordered]@{ foreground = $seen.foreground; refusesKeyboard = $seen.refusesKeyboard })
  # Not read: whether the taskbar has a button for it. The toolkit removes the button through
  # the taskbar's own interface, which leaves nothing in the window's styles; the images show it.
  $strip = $seen
  $images.strip = Capture 'strip'

  # 2. The pointer rests on the strip: the panel opens and the keyboard stays where it was.
  Set-Content -Path $pointer -Value ("{0} {1}" -f ($seen.x + [int]($seen.width / 2)), ($seen.y + [int]($seen.height / 2)))
  $opened = Wait-For { Is-Panel (Look $hwnd) } 10
  $seen = Look $hwnd
  Note 'resting on the strip opens the panel against the same edge' ($opened -and (At-Right-Edge $seen)) $seen
  Note 'the panel opened by resting leaves the keyboard with the other window' ($seen.foreground -eq 'other window') ([ordered]@{ foreground = $seen.foreground })
  $images.peek = Capture 'peek'
  Set-Content -Path $pointer -Value '200 200'
  $closed = Wait-For { Is-Strip (Look $hwnd) } 10
  $seen = Look $hwnd
  Note 'moving away closes it to the strip, the keyboard still with the other window' ($closed -and $seen.foreground -eq 'other window') $seen

  # 3. A real click on the strip's first view: the panel opens to stay, with the keyboard,
  # although the strip itself refuses the keyboard. The view's button is 79 pixels below the
  # strip's top at 100%; if the strip's layout changes, this number changes with it.
  $clickX = $strip.x + [int]($strip.width / 2); $clickY = $strip.y + [int][Math]::Round(79 * $unit)
  Set-Content -Path $pointer -Value ("{0} {1}" -f $clickX, $clickY)
  [RailProbe]::Click($clickX, $clickY)
  $opened = Wait-For { $now = Look $hwnd; (Is-Panel $now) -and $now.foreground -eq 'rail' } 10
  $seen = Look $hwnd
  Note 'a click on a view on the strip opens the panel to stay, with the keyboard' ($opened -and (At-Right-Edge $seen) -and -not $seen.refusesKeyboard) $seen
  Set-Content -Path $pointer -Value '200 200'
  Pump 1500
  $seen = Look $hwnd
  Note 'the panel opened by a click stays open when the pointer leaves' ((Is-Panel $seen) -and $seen.foreground -eq 'rail') ([ordered]@{ width = $seen.width; foreground = $seen.foreground })
  $second = Start-Process -FilePath $Binary -ArgumentList '--toggle' -NoNewWindow -PassThru
  $returned = $second.WaitForExit(15000)
  $closed = Wait-For { $now = Look $hwnd; (Is-Strip $now) -and $now.foreground -eq 'other window' } 10
  $seen = Look $hwnd
  Note 'open-sesame --toggle closes it and gives the keyboard back to the other window' ($returned -and $closed -and $seen.refusesKeyboard) $seen

  # 4. `open-sesame --toggle`: the panel opens with the keyboard, and closing gives it back.
  $second = Start-Process -FilePath $Binary -ArgumentList '--toggle' -NoNewWindow -PassThru
  $returned = $second.WaitForExit(15000)
  $opened = Wait-For { $now = Look $hwnd; (Is-Panel $now) -and $now.foreground -eq 'rail' } 10
  $seen = Look $hwnd
  Note 'open-sesame --toggle opens the panel and the second process exits' ($returned -and $opened -and (At-Right-Edge $seen)) ([ordered]@{ secondProcessExited = $returned; width = $seen.width; height = $seen.height; x = $seen.x })
  Note 'the panel opened by the command has the keyboard' ($seen.foreground -eq 'rail' -and -not $seen.refusesKeyboard) ([ordered]@{ foreground = $seen.foreground; refusesKeyboard = $seen.refusesKeyboard })
  $images.panel = Capture 'panel'

  $second = Start-Process -FilePath $Binary -ArgumentList '--toggle' -NoNewWindow -PassThru
  $returned = $second.WaitForExit(15000)
  $closed = Wait-For { $now = Look $hwnd; (Is-Strip $now) -and $now.foreground -eq 'other window' } 10
  $seen = Look $hwnd
  Note 'open-sesame --toggle closes the panel to the strip' ($returned -and $closed -and (At-Right-Edge $seen) -and $seen.visible) ([ordered]@{ secondProcessExited = $returned; width = $seen.width; height = $seen.height; x = $seen.x; visible = $seen.visible })
  Note 'closing gives the keyboard back to the other window' ($seen.foreground -eq 'other window' -and $seen.refusesKeyboard) ([ordered]@{ foreground = $seen.foreground; refusesKeyboard = $seen.refusesKeyboard })

  # 5. One application throughout.
  $text = Get-Content -Raw $log
  $loads = ([regex]::Matches($text, 'open-sesame: page loaded')).Count
  $running = @(Get-Process -Name 'open-sesame' -ErrorAction SilentlyContinue).Count
  Note 'one page load and one application process throughout' ($loads -eq 1 -and $running -eq 1 -and -not $process.HasExited) ([ordered]@{ pageLoads = $loads; processes = $running })
} catch {
  Note 'the check ran to its end' $false ([ordered]@{ error = "$_" })
} finally {
  if ($process -and -not $process.HasExited) { & taskkill /PID $process.Id /T /F | Out-Null }
  Pump 1500
  $left = @(Get-Process -Name 'open-sesame' -ErrorAction SilentlyContinue).Count
  Note 'no application process is left after the check stops it' ($left -eq 0) ([ordered]@{ processes = $left })
  $other.Close()
  Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
}

$report = [ordered]@{
  passed = -not $script:failed
  kind = 'launched development binary on a hosted Windows virtual machine; resting is a stand-in pointer and the click is real; no person'
  binary = $Binary
  images = $images
  steps = $steps
}
[IO.File]::WriteAllText((Join-Path $Out 'report.json'), ($report | ConvertTo-Json -Depth 8))
if ($script:failed) { Write-Host 'The rail check on Windows failed; see the FAIL lines above.'; exit 1 }
Write-Host 'The rail check on Windows passed.'
