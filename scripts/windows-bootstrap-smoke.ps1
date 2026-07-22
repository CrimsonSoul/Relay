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

function Stop-ProcessTree {
  param([Parameter(Mandatory = $true)][Diagnostics.Process]$Process)
  & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.Id /T /F 2>$null | Out-Null
}

function Wait-ProcessWithTimeout {
  param(
    [Parameter(Mandatory = $true)][Diagnostics.Process]$Process,
    [Parameter(Mandatory = $true)][string]$Context,
    [int]$TimeoutSeconds = 120
  )

  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-ProcessTree -Process $Process
    throw "$Context timed out after $TimeoutSeconds seconds."
  }
  $Process.WaitForExit()
}

function Invoke-RelayPreparation {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [switch]$ExpectFailure
  )

  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  $process = Start-Process -FilePath $Path -ArgumentList '/relay-prepare-only' -PassThru
  Wait-ProcessWithTimeout -Process $process -Context "Relay preparation: $Path"
  $stopwatch.Stop()
  if ($ExpectFailure) {
    if ($process.ExitCode -eq 0) {
      throw 'Relay bootstrap unexpectedly accepted a blocked activation.'
    }
  }
  elseif ($process.ExitCode -ne 0) {
    $bootstrapErrorPath = Join-Path $runtimeRoot 'bootstrap-error.ini'
    $failureMessage = 'No bootstrap failure record was written.'
    if (Test-Path -LiteralPath $bootstrapErrorPath) {
      $match = Select-String -LiteralPath $bootstrapErrorPath -Pattern '^message=(.+)$' |
        Select-Object -First 1
      if ($null -ne $match) {
        $failureMessage = $match.Matches[0].Groups[1].Value
      }
    }
    throw "Relay bootstrap failure: $failureMessage (exit code $($process.ExitCode))"
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

function Assert-EmbeddedBuildIdentity {
  param([Parameter(Mandatory = $true)][string]$BuildId)

  $identityPath = Join-Path (Join-Path $runtimeVersionsRoot $BuildId) 'resources\relay-build-id.txt'
  if (-not (Test-Path -LiteralPath $identityPath)) {
    throw "Runtime $BuildId did not contain its embedded build identity."
  }
  if (([IO.File]::ReadAllText($identityPath).Trim()) -ne $BuildId) {
    throw "Runtime $BuildId contained the wrong embedded build identity."
  }
}

function Get-DirectoryTreeHash {
  param([Parameter(Mandatory = $true)][string]$Path)

  $records = @(
    Get-ChildItem -LiteralPath $Path -Recurse -File -Force |
      Sort-Object -Property FullName |
      ForEach-Object {
        $relativePath = [IO.Path]::GetRelativePath($Path, $_.FullName).Replace('\', '/')
        $fileHash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        "$relativePath|$($_.Length)|$fileHash"
      }
  )
  $hasher = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($records -join "`n"))
    return [Convert]::ToHexString($hasher.ComputeHash($bytes))
  }
  finally {
    $hasher.Dispose()
  }
}

try {
  New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
  [IO.File]::WriteAllText($sentinelPath, "relay-bootstrap-smoke-$([Guid]::NewGuid())")
  $dataTreeHashBefore = Get-DirectoryTreeHash -Path $relayAppDataRoot

  $previousFirstPreparationMs = Invoke-RelayPreparation -Path $previousArtifactPath
  if (-not (Test-Path -LiteralPath $statePath)) {
    throw 'Relay bootstrap did not create state.ini'
  }
  if ((Get-IniValue -Path $statePath -Key 'current') -ne $ExpectedPreviousBuildId) {
    throw 'Previous bootstrap did not activate the expected build.'
  }
  Assert-EmbeddedBuildIdentity -BuildId $ExpectedPreviousBuildId

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
    Wait-ProcessWithTimeout -Process $firstProcess -Context 'First concurrent preparation'
    Wait-ProcessWithTimeout -Process $secondProcess -Context 'Second concurrent preparation'
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
  Assert-EmbeddedBuildIdentity -BuildId $ExpectedBuildId
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

  $currentExecutable = Join-Path (Join-Path $runtimeVersionsRoot $ExpectedBuildId) 'Relay.exe'
  Remove-Item -LiteralPath $currentExecutable -Force
  $executableRepairPreparationMs = Invoke-RelayPreparation -Path $artifactPath
  if (-not (Test-Path -LiteralPath $currentExecutable)) {
    throw 'Relay bootstrap did not repair a runtime with a missing executable.'
  }

  $brokenCurrentBuildId = 'smoke-broken-current'
  $brokenCurrentRuntime = Join-Path $runtimeVersionsRoot $brokenCurrentBuildId
  New-Item -ItemType Directory -Path $brokenCurrentRuntime -Force | Out-Null
  [IO.File]::WriteAllText(
    (Join-Path $brokenCurrentRuntime '.relay-runtime-ready'),
    "[Relay]`nprotocol=1`nbuildId=$brokenCurrentBuildId`nexecutable=Relay.exe`n"
  )
  [IO.File]::WriteAllText((Join-Path $brokenCurrentRuntime 'Relay.exe'), 'not-a-pe')
  [IO.File]::WriteAllText(
    $statePath,
    "[Relay]`nprotocol=1`ncurrent=$brokenCurrentBuildId`nprevious=$ExpectedPreviousBuildId`n"
  )
  $null = Invoke-RelayPreparation -Path $artifactPath
  if ((Get-IniValue -Path $statePath -Key 'current') -ne $ExpectedBuildId -or
      (Get-IniValue -Path $statePath -Key 'previous') -ne $ExpectedPreviousBuildId) {
    throw 'A damaged recorded current runtime displaced the last usable previous build.'
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

  & node scripts/verify-windows-pe.mjs `
    $previousArtifactPath $artifactPath $launcherPath $previousExecutable $currentExecutable
  if ($LASTEXITCODE -ne 0) {
    throw 'Relay bootstrap or stable launcher requested elevation.'
  }

  $dataTreeHashAfter = Get-DirectoryTreeHash -Path $relayAppDataRoot
  if ($dataTreeHashAfter -ne $dataTreeHashBefore) {
    throw 'Relay bootstrap modified application data'
  }

  [pscustomobject]@{
    BuildId = $ExpectedBuildId
    PreviousBuildId = $ExpectedPreviousBuildId
    CorruptRuntimeRepaired = $true
    MissingExecutableRepaired = $true
    BrokenCurrentPreservedPrevious = $true
    ConcurrentPreparation = $true
    UpdateWhilePreviousLocked = $true
    PreviousFirstPreparationMs = $previousFirstPreparationMs
    PreviousReusePreparationMs = $previousReusePreparationMs
    ConcurrentPreparationMs = $concurrentPreparationMs
    CurrentReusePreparationMs = $currentReusePreparationMs
    CurrentRepairPreparationMs = $currentRepairPreparationMs
    ExecutableRepairPreparationMs = $executableRepairPreparationMs
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
