param(
  [Parameter(Mandatory = $true)]
  [string]$Artifact
)

$ErrorActionPreference = 'Stop'

if ($env:RELAY_BOOTSTRAP_SMOKE_CONFIRM -ne '1') {
  throw 'Set RELAY_BOOTSTRAP_SMOKE_CONFIRM=1 only in a disposable Windows profile.'
}

$artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'Relay'
$relayAppDataRoot = Join-Path $env:APPDATA 'Relay'
$dataRoot = Join-Path $relayAppDataRoot 'data'
$sentinelPath = Join-Path $dataRoot 'bootstrap-smoke-sentinel.txt'
$desktopShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Relay.lnk'
$startMenuShortcutPath = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Relay\Relay.lnk'
$launcherPath = Join-Path $runtimeRoot 'Relay.exe'

if (Test-Path -LiteralPath $runtimeRoot) {
  throw "Disposable smoke profile already contains $runtimeRoot"
}
if (Test-Path -LiteralPath $relayAppDataRoot) {
  throw "Disposable smoke profile already contains $relayAppDataRoot"
}

function Invoke-RelayPreparation {
  $process = Start-Process -FilePath $artifactPath -ArgumentList '/relay-prepare-only' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Relay bootstrap exited with code $($process.ExitCode)"
  }
}

function Get-IniValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Key
  )

  $match = Select-String -LiteralPath $Path -Pattern "^$([Regex]::Escape($Key))=(.+)$" | Select-Object -First 1
  if ($null -eq $match) {
    throw "Missing $Key in $Path"
  }
  return $match.Matches[0].Groups[1].Value
}

try {
  New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
  [IO.File]::WriteAllText($sentinelPath, "relay-bootstrap-smoke-$([Guid]::NewGuid())")
  $sentinelHashBefore = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash

  Invoke-RelayPreparation

  $statePath = Join-Path $runtimeRoot 'state.ini'
  if (-not (Test-Path -LiteralPath $statePath)) {
    throw 'Relay bootstrap did not create state.ini'
  }
  $buildId = Get-IniValue -Path $statePath -Key 'current'
  if ($buildId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
    throw "Relay bootstrap wrote an unsafe build ID: $buildId"
  }

  $markerPath = Join-Path (Join-Path (Join-Path $runtimeRoot 'Runtime') $buildId) '.relay-runtime-ready'
  if (-not (Test-Path -LiteralPath $markerPath)) {
    throw 'Relay bootstrap did not create its completion marker'
  }
  $firstMarkerTimestamp = (Get-Item -LiteralPath $markerPath).LastWriteTimeUtc.Ticks

  Invoke-RelayPreparation

  $secondMarkerTimestamp = (Get-Item -LiteralPath $markerPath).LastWriteTimeUtc.Ticks
  if ($secondMarkerTimestamp -ne $firstMarkerTimestamp) {
    throw 'Relay bootstrap extracted an already prepared build again'
  }

  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcutPath in @($desktopShortcutPath, $startMenuShortcutPath)) {
    if (-not (Test-Path -LiteralPath $shortcutPath)) {
      throw "Relay bootstrap did not create $shortcutPath"
    }
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ($shortcut.TargetPath -ne $launcherPath) {
      throw "Relay shortcut targets $($shortcut.TargetPath) instead of $launcherPath"
    }
  }

  $sentinelHashAfter = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash
  if ($sentinelHashAfter -ne $sentinelHashBefore) {
    throw 'Relay bootstrap modified application data'
  }

  [pscustomobject]@{
    BuildId = $buildId
    RuntimeReused = $true
    Launcher = $launcherPath
    DataUnchanged = $true
  } | ConvertTo-Json
}
finally {
  if (Test-Path -LiteralPath $runtimeRoot) {
    Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $relayAppDataRoot) {
    Remove-Item -LiteralPath $relayAppDataRoot -Recurse -Force
  }
  Remove-Item -LiteralPath $desktopShortcutPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $startMenuShortcutPath -Force -ErrorAction SilentlyContinue
}
