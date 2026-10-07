# ShangAn Assistant all-in-one launcher:
# start server (build first if needed) -> open standalone app window
# Called hidden by scripts/launch-app.vbs. Log: %TEMP%\shangan-launcher.log
$ErrorActionPreference = 'Stop'

$Root = 'D:\graduate ast'
$Port = 3000
$Url  = "http://localhost:$Port/"
$Log  = Join-Path $env:TEMP 'shangan-launcher.log'
$SrvLog = Join-Path $env:TEMP 'shangan-server.log'

function Write-Log([string]$msg) {
  try { Add-Content -Path $Log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) } catch { }
}

# balloon toast runs in a separate throwaway process; never blocks main flow
function Show-Balloon([string]$msg) {
  Write-Log "balloon: $msg"
  try {
    $inner = "Add-Type -AssemblyName System.Windows.Forms; " +
             "`$ni = New-Object System.Windows.Forms.NotifyIcon; " +
             "`$ni.Icon = [System.Drawing.SystemIcons]::Information; " +
             "`$ni.BalloonTipTitle = 'ShangAn'; " +
             "`$ni.BalloonTipText = '$msg'; " +
             "`$ni.Visible = `$true; `$ni.ShowBalloonTip(4000); Start-Sleep -Seconds 5; `$ni.Dispose()"
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
    Start-Process powershell -ArgumentList "-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", $enc -WindowStyle Hidden
  } catch { }
}

function Test-Port {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $c.Connect('127.0.0.1', $Port)
    return $c.Connected
  } catch {
    return $false
  } finally {
    $c.Close()
  }
}

Write-Log '---------- launcher start ----------'

try {
  # 1. server already running -> just open the window
  if (Test-Port) {
    Write-Log 'server already running, opening window directly'
  } else {
    # 2. production build missing -> build once
    if (-not (Test-Path (Join-Path $Root '.next\BUILD_ID'))) {
      Show-Balloon 'First run: building the app, 1-3 minutes, please wait...'
      Write-Log 'BUILD_ID missing, running: npm run build'
      $build = Start-Process cmd -ArgumentList "/c npm run build > `"$SrvLog`" 2>&1" -WorkingDirectory $Root -WindowStyle Hidden -PassThru -Wait
      Write-Log "build exit code: $($build.ExitCode)"
      if ($build.ExitCode -ne 0 -or -not (Test-Path (Join-Path $Root '.next\BUILD_ID'))) {
        Show-Balloon "Build failed (code $($build.ExitCode)). See log: $Log"
        exit 1
      }
    }

    Show-Balloon 'Starting server, about 10-30 seconds...'
    Write-Log 'starting: npm start'
    Start-Process cmd -ArgumentList "/c npm start >> `"$SrvLog`" 2>&1" -WorkingDirectory $Root -WindowStyle Hidden

    # 3. wait for port (max 90s, progress every 15s)
    $ready = $false
    for ($i = 1; $i -le 90; $i++) {
      if (Test-Port) { $ready = $true; break }
      if ($i % 15 -eq 0) { Write-Log "waiting for port, ${i}s elapsed" }
      Start-Sleep -Milliseconds 1000
    }
    if (-not $ready) {
      Show-Balloon "Start timeout. See log: $Log"
      Write-Log 'ERROR: port not ready within 90s'
      exit 1
    }
    Write-Log "server ready on port $Port"
  }

  # 4. open standalone app window (Edge/Chrome --app mode, no address bar)
  $browserPaths = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  $browser = $browserPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($browser) {
    Write-Log "opening app window: $browser --app=$Url"
    Start-Process $browser -ArgumentList "--app=$Url"
  } else {
    Write-Log 'no Edge/Chrome found, opening default browser'
    Start-Process $Url
  }
  Write-Log 'launcher finished OK'
} catch {
  Write-Log "FATAL: $($_.Exception.Message)"
  Show-Balloon "Launch error: $($_.Exception.Message)"
  exit 1
}
