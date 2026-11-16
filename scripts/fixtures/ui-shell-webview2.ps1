# Native WebView2 renderer fixture; synthetic bridge, isolated profile, no Tauri/provider claim.
param([string]$Root, [string]$Sdk, [string]$Out, [string]$Scratch)
$ErrorActionPreference = 'Stop'
if (-not $Scratch) { $Scratch = Join-Path $env:TEMP ('open-sesame-ui-fixture-' + [Guid]::NewGuid().ToString()) }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Path $Scratch | Out-Null
$ui = Join-Path $Scratch 'ui'
Copy-Item -Recurse -Force (Join-Path $Root 'ui') $ui
Copy-Item (Join-Path $Root 'dist\vendor\xterm.js') (Join-Path $ui 'xterm.js')
Copy-Item (Join-Path $Root 'dist\vendor\xterm.css') (Join-Path $ui 'xterm.css')
$bin = Join-Path $Scratch 'sdk'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Copy-Item (Join-Path $Sdk 'lib\net462\*.dll') $bin
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {'arm64'} else {'x64'}
Copy-Item (Join-Path $Sdk "build\native\$arch\WebView2Loader.dll") $bin
Add-Type 'using System.Runtime.InteropServices; public class NativeLoader { [DllImport("kernel32", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool SetDllDirectory(string path); }'
[NativeLoader]::SetDllDirectory($bin) | Out-Null
Add-Type -Path (Join-Path $bin 'Microsoft.Web.WebView2.Core.dll')
Add-Type -Path (Join-Path $bin 'Microsoft.Web.WebView2.WinForms.dll')
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Open Sesame renderer fixture'
$form.ClientSize = New-Object System.Drawing.Size(1090,700)
$web = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$properties = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
$properties.UserDataFolder = Join-Path $Scratch 'profile'
$web.CreationProperties = $properties
$web.Dock = 'Fill'
$form.Controls.Add($web)
$hostScript = [IO.File]::ReadAllText((Join-Path $Root 'scripts\fixtures\ui-shell-host.js'))
$probeScript = [IO.File]::ReadAllText((Join-Path $Root 'scripts\fixtures\ui-shell-probe.js'))
$script:finished = $false
$script:passed = $false
$script:phase = 'start'
$script:deadline = [DateTime]::UtcNow.AddSeconds(90)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 50
function Finish($Report) {
  if ($script:finished) { return }
  $script:finished = $true
  $script:passed = ($Report.passed -eq $true)
  $Report | Add-Member -NotePropertyName renderer -NotePropertyValue 'WebView2' -Force
  $Report | Add-Member -NotePropertyName platform -NotePropertyValue ([Environment]::OSVersion.VersionString) -Force
  if ($web.CoreWebView2) { $Report | Add-Member -NotePropertyName version -NotePropertyValue $web.CoreWebView2.Environment.BrowserVersionString -Force }
  [IO.File]::WriteAllText($Out, ($Report | ConvertTo-Json -Depth 20))
  $timer.Stop()
  $web.Dispose()
  $form.Close()
}
$form.add_Shown({
  $script:init = $web.EnsureCoreWebView2Async($null)
  $script:phase = 'init'
  $timer.Start()
})
$timer.add_Tick({
  try {
    if ([DateTime]::UtcNow -gt $script:deadline) { throw 'Native renderer timed out.' }
    if ($script:phase -eq 'init' -and $script:init.IsCompleted) {
      if ($script:init.IsFaulted) { throw $script:init.Exception }
      $web.CoreWebView2.add_WebMessageReceived({
        param($sender,$eventArgs)
        try { Finish ($eventArgs.TryGetWebMessageAsString() | ConvertFrom-Json) }
        catch { Finish ([pscustomobject]@{passed=$false;error=$_.Exception.Message}) }
      })
      $web.CoreWebView2.add_NavigationCompleted({
        param($sender,$eventArgs)
        if (-not $eventArgs.IsSuccess) { Finish ([pscustomobject]@{passed=$false;error=$eventArgs.WebErrorStatus.ToString()}); return }
        $null = $web.CoreWebView2.ExecuteScriptAsync($probeScript)
      })
      $web.CoreWebView2.SetVirtualHostNameToFolderMapping('shell.test',$ui,[Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind]::DenyCors)
      $script:injected = $web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync($hostScript)
      $script:phase = 'host'
    }
    if ($script:phase -eq 'host' -and $script:injected.IsCompleted) {
      if ($script:injected.IsFaulted) { throw $script:injected.Exception }
      $script:phase = 'page'
      $web.Source = [Uri]'https://shell.test/index.html'
    }
  } catch { Finish ([pscustomobject]@{passed=$false;error=$_.Exception.ToString()}) }
})
[System.Windows.Forms.Application]::Run($form)
$timer.Dispose()
if (-not $script:finished) { throw 'Renderer exited without a report.' }

if (-not $script:passed) { exit 1 }
