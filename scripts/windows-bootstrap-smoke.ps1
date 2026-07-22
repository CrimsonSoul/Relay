param(
  [Parameter(Mandatory = $true)]
  [string]$Artifact,
  [Parameter(Mandatory = $true)]
  [string]$PreviousArtifact,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedBuildId,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedPreviousBuildId
)

$ErrorActionPreference = 'Stop'

if ($env:RELAY_BOOTSTRAP_SMOKE_CONFIRM -ne '1') {
  throw 'Set RELAY_BOOTSTRAP_SMOKE_CONFIRM=1 only in a disposable Windows profile.'
}
if ($ExpectedBuildId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or
    $ExpectedPreviousBuildId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or
    $ExpectedBuildId -eq $ExpectedPreviousBuildId) {
  throw 'Smoke build IDs must be distinct path-safe identifiers.'
}

$artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
$previousArtifactPath = (Resolve-Path -LiteralPath $PreviousArtifact).Path
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'Relay'
$runtimeVersionsRoot = Join-Path $runtimeRoot 'Runtime'
$relayAppDataRoot = Join-Path $env:APPDATA 'Relay'
$dataRoot = Join-Path $relayAppDataRoot 'data'
$sentinelPath = Join-Path $dataRoot 'bootstrap-smoke-sentinel.txt'
$desktopShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Relay.lnk'
$startMenuShortcutPath = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Relay\Relay.lnk'
$launcherPath = Join-Path $runtimeRoot 'Relay.exe'
$statePath = Join-Path $runtimeRoot 'state.ini'
$oldRuntimeHandle = $null

if (Test-Path -LiteralPath $runtimeRoot) {
  throw "Disposable smoke profile already contains $runtimeRoot"
}
if (Test-Path -LiteralPath $relayAppDataRoot) {
  throw "Disposable smoke profile already contains $relayAppDataRoot"
}

function Invoke-RelayPreparation {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [switch]$ExpectFailure
  )

  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  $process = Start-Process -FilePath $Path -ArgumentList '/relay-prepare-only' -Wait -PassThru
  $stopwatch.Stop()
  if ($ExpectFailure) {
    if ($process.ExitCode -eq 0) {
      throw 'Relay bootstrap unexpectedly accepted a blocked activation.'
    }
  }
  elseif ($process.ExitCode -ne 0) {
    throw "Relay bootstrap exited with code $($process.ExitCode)"
  }
  return $stopwatch.ElapsedMilliseconds
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

function Get-RuntimeMarkerPath {
  param([Parameter(Mandatory = $true)][string]$BuildId)
  return Join-Path (Join-Path $runtimeVersionsRoot $BuildId) '.relay-runtime-ready'
}

try {
  New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
  [IO.File]::WriteAllText($sentinelPath, "relay-bootstrap-smoke-$([Guid]::NewGuid())")
  $sentinelHashBefore = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash

  $previousFirstPreparationMs = Invoke-RelayPreparation -Path $previousArtifactPath
  if (-not (Test-Path -LiteralPath $statePath)) {
    throw 'Relay bootstrap did not create state.ini'
  }
  if ((Get-IniValue -Path $statePath -Key 'current') -ne $ExpectedPreviousBuildId) {
    throw 'Previous bootstrap did not activate the expected build.'
  }

  $previousMarkerPath = Get-RuntimeMarkerPath -BuildId $ExpectedPreviousBuildId
  if (-not (Test-Path -LiteralPath $previousMarkerPath)) {
    throw 'Previous bootstrap did not create its completion marker.'
  }
  $previousMarkerTimestamp = (Get-Item -LiteralPath $previousMarkerPath).LastWriteTimeUtc.Ticks
  $previousReusePreparationMs = Invoke-RelayPreparation -Path $previousArtifactPath
  if ((Get-Item -LiteralPath $previousMarkerPath).LastWriteTimeUtc.Ticks -ne $previousMarkerTimestamp) {
    throw 'Previous bootstrap extracted an already prepared build again.'
  }

  $previousExecutable = Join-Path (Join-Path $runtimeVersionsRoot $ExpectedPreviousBuildId) 'Relay.exe'
  $oldRuntimeHandle = [IO.File]::Open(
    $previousExecutable,
    [IO.FileMode]::Open,
    [IO.FileAccess]::Read,
    [IO.FileShare]::Read
  )
  try {
    $concurrentTimer = [Diagnostics.Stopwatch]::StartNew()
    $firstProcess = Start-Process -FilePath $artifactPath -ArgumentList '/relay-prepare-only' -PassThru
    $secondProcess = Start-Process -FilePath $artifactPath -ArgumentList '/relay-prepare-only' -PassThru
    $firstProcess.WaitForExit()
    $secondProcess.WaitForExit()
    $concurrentTimer.Stop()
    if ($firstProcess.ExitCode -ne 0 -or $secondProcess.ExitCode -ne 0) {
      throw "Concurrent preparation failed with $($firstProcess.ExitCode)/$($secondProcess.ExitCode)."
    }
    $concurrentPreparationMs = $concurrentTimer.ElapsedMilliseconds
  }
  finally {
    $oldRuntimeHandle.Dispose()
    $oldRuntimeHandle = $null
  }

  if ((Get-IniValue -Path $statePath -Key 'current') -ne $ExpectedBuildId) {
    throw 'Current bootstrap did not activate the expected build.'
  }
  if ((Get-IniValue -Path $statePath -Key 'previous') -ne $ExpectedPreviousBuildId) {
    throw 'Current bootstrap did not retain the former current build as previous.'
  }
  if (-not (Test-Path -LiteralPath $previousMarkerPath)) {
    throw 'Updating while the previous runtime was locked removed that runtime.'
  }

  $currentMarkerPath = Get-RuntimeMarkerPath -BuildId $ExpectedBuildId
  if (-not (Test-Path -LiteralPath $currentMarkerPath)) {
    throw 'Current bootstrap did not create its completion marker.'
  }
  $currentMarkerTimestamp = (Get-Item -LiteralPath $currentMarkerPath).LastWriteTimeUtc.Ticks
  $currentReusePreparationMs = Invoke-RelayPreparation -Path $artifactPath
  if ((Get-Item -LiteralPath $currentMarkerPath).LastWriteTimeUtc.Ticks -ne $currentMarkerTimestamp) {
    throw 'Current bootstrap extracted an already prepared build again.'
  }

  Remove-Item -LiteralPath $currentMarkerPath -Force
  $currentRepairPreparationMs = Invoke-RelayPreparation -Path $artifactPath
  if (-not (Test-Path -LiteralPath $currentMarkerPath)) {
    throw 'Relay bootstrap did not repair the damaged current runtime.'
  }
  $quarantinedRuntime = Get-ChildItem -LiteralPath $runtimeVersionsRoot -Directory |
    Where-Object { $_.Name -like ".corrupt-$ExpectedBuildId-*" } |
    Select-Object -First 1
  if ($null -eq $quarantinedRuntime) {
    throw 'Relay bootstrap did not quarantine the damaged current runtime.'
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

  & node scripts/verify-windows-pe.mjs $previousArtifactPath $artifactPath $launcherPath
  if ($LASTEXITCODE -ne 0) {
    throw 'Relay bootstrap or stable launcher requested elevation.'
  }

  $sentinelHashAfter = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash
  if ($sentinelHashAfter -ne $sentinelHashBefore) {
    throw 'Relay bootstrap modified application data'
  }

  [pscustomobject]@{
    BuildId = $ExpectedBuildId
    PreviousBuildId = $ExpectedPreviousBuildId
    CorruptRuntimeRepaired = $true
    ConcurrentPreparation = $true
    UpdateWhilePreviousLocked = $true
    PreviousFirstPreparationMs = $previousFirstPreparationMs
    PreviousReusePreparationMs = $previousReusePreparationMs
    ConcurrentPreparationMs = $concurrentPreparationMs
    CurrentReusePreparationMs = $currentReusePreparationMs
    CurrentRepairPreparationMs = $currentRepairPreparationMs
    Launcher = $launcherPath
    DataUnchanged = $true
  } | ConvertTo-Json
}
finally {
  if ($null -ne $oldRuntimeHandle) {
    $oldRuntimeHandle.Dispose()
  }
  if (Test-Path -LiteralPath $runtimeRoot) {
    Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $relayAppDataRoot) {
    Remove-Item -LiteralPath $relayAppDataRoot -Recurse -Force
  }
  Remove-Item -LiteralPath $desktopShortcutPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $startMenuShortcutPath -Force -ErrorAction SilentlyContinue
}
