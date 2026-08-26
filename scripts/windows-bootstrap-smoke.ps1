param(
  [Parameter(Mandatory = $true)]
  [string]$Artifact,
  [Parameter(Mandatory = $true)]
  [string]$PreviousArtifact,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedBuildId,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedPreviousBuildId,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedTargetCommitish,
  [Parameter(Mandatory = $true)]
  [int]$ExpectedLauncherProtocolExitCode
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
if ($ExpectedTargetCommitish -notmatch '^[0-9a-f]{40}$') {
  throw 'ExpectedTargetCommitish must be a full lowercase Git commit ID.'
}
if ($ExpectedLauncherProtocolExitCode -lt 1 -or $ExpectedLauncherProtocolExitCode -gt 255) {
  throw 'ExpectedLauncherProtocolExitCode must be a process exit code from 1 through 255.'
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
$recoveryRoot = Join-Path $runtimeRoot 'Recovery'
$updateRequestPath = Join-Path $recoveryRoot 'update-request.ini'
$preparedPath = Join-Path $recoveryRoot 'prepared.ini'
$bootstrapLockPath = Join-Path $runtimeRoot 'bootstrap.lock'
$oldRuntimeHandle = $null

if (Test-Path -LiteralPath $runtimeRoot) {
  throw "Disposable smoke profile already contains $runtimeRoot"
}
if (Test-Path -LiteralPath $relayAppDataRoot) {
  throw "Disposable smoke profile already contains $relayAppDataRoot"
}

function Stop-ProcessTree {
  param([Parameter(Mandatory = $true)][Diagnostics.Process]$Process)

  # taskkill exits 128 when the target is already gone, and PowerShell 7.3+ turns any non-zero
  # native exit into a terminating error under $ErrorActionPreference = 'Stop'. That would
  # replace the caller's timeout message with an opaque native-exit error, so the preference is
  # disabled for this scope and the exit code is inspected here instead. Windows PowerShell 5.1
  # has no such preference and simply ignores the assignment.
  $PSNativeCommandUseErrorActionPreference = $false
  & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.Id /T /F 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 128) {
    Write-Warning "taskkill failed for PID $($Process.Id) with exit code $LASTEXITCODE."
  }
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

function Get-LauncherProtocolExitCode {
  param([Parameter(Mandatory = $true)][string]$Path)

  $process = Start-Process -FilePath $Path -ArgumentList '--relay-launcher-probe' -PassThru
  Wait-ProcessWithTimeout -Process $process -Context "Relay launcher probe: $Path" -TimeoutSeconds 15
  return $process.ExitCode
}

function Wait-BootstrapLockHeld {
  param(
    [Parameter(Mandatory = $true)][Diagnostics.Process]$Process,
    [int]$TimeoutSeconds = 15
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $Process.Refresh()
    if ($Process.HasExited) {
      $Process.WaitForExit()
      throw "Relay preparation exited with code $($Process.ExitCode) before its bootstrap lock was observed."
    }
    if (Test-Path -LiteralPath $bootstrapLockPath) {
      $probe = $null
      try {
        $probe = [IO.File]::Open(
          $bootstrapLockPath,
          [IO.FileMode]::Open,
          [IO.FileAccess]::ReadWrite,
          [IO.FileShare]::None
        )
      }
      catch [IO.IOException] {
        return
      }
      finally {
        if ($null -ne $probe) {
          $probe.Dispose()
        }
      }
    }
    Start-Sleep -Milliseconds 25
  }
  throw "Relay bootstrap lock was not observed within $TimeoutSeconds seconds."
}

function Invoke-RelayPreparation {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [string]$TransactionId = '',
    [switch]$ExpectFailure
  )

  $arguments = @('/relay-prepare-only')
  if ($TransactionId) {
    $arguments += "/relay-transaction=$TransactionId"
  }
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  $process = Start-Process -FilePath $Path -ArgumentList $arguments -PassThru
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

function Get-IniSectionValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Section,
    [Parameter(Mandatory = $true)][string]$Key
  )

  $currentSection = ''
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\[([^]]+)\]$') {
      $currentSection = $Matches[1]
      continue
    }
    if ($currentSection -eq $Section -and
        $line -match "^$([Regex]::Escape($Key))=(.*)$") {
      return $Matches[1]
    }
  }
  throw "Missing $Section.$Key in $Path"
}

function Get-IniSectionValueOrDefault {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Section,
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Default
  )

  try {
    return Get-IniSectionValue -Path $Path -Section $Section -Key $Key
  }
  catch {
    return $Default
  }
}

function New-RecoveryUpdateRequest {
  param([Parameter(Mandatory = $true)][string]$Path)

  $transactionId = [Guid]::NewGuid().ToString().ToLowerInvariant()
  $sourceBuildId = Get-IniSectionValue -Path $statePath -Section 'Relay' -Key 'current'
  $sourceMarkerPath = Get-RuntimeMarkerPath -BuildId $sourceBuildId
  $sourceExecutablePath = Join-Path (Join-Path $runtimeVersionsRoot $sourceBuildId) 'Relay.exe'
  if (-not (Test-Path -LiteralPath $sourceMarkerPath)) {
    throw "Recovery source marker was missing: $sourceMarkerPath"
  }
  $sourceProtocol = Get-IniSectionValue -Path $sourceMarkerPath -Section 'Relay' -Key 'protocol'
  $sourcePayloadHash = Get-IniSectionValue -Path $sourceMarkerPath -Section 'Relay' -Key 'payloadHash'
  $sourceRuntimeHash = if ($sourceProtocol -eq '2') {
    (Get-FileHash -LiteralPath $sourceMarkerPath -Algorithm SHA512).Hash.ToLowerInvariant()
  }
  else {
    $sourcePayloadHash.ToLowerInvariant()
  }
  $versionInfo = (Get-Item -LiteralPath $Path).VersionInfo
  $targetVersion = "$($versionInfo.FileMajorPart).$($versionInfo.FileMinorPart).$($versionInfo.FileBuildPart)"
  $installerHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  $requestedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $sourceVersionInfo = (Get-Item -LiteralPath $sourceExecutablePath).VersionInfo
  $sourceVersionDefault = "$($sourceVersionInfo.FileMajorPart).$($sourceVersionInfo.FileMinorPart).$($sourceVersionInfo.FileBuildPart)"
  $sourceVersion = Get-IniSectionValueOrDefault -Path $sourceMarkerPath -Section 'Relay' -Key 'version' -Default $sourceVersionDefault
  $sourceReleaseTag = Get-IniSectionValueOrDefault -Path $sourceMarkerPath -Section 'Relay' -Key 'releaseTag' -Default "v$sourceVersion"
  $sourceCommit = Get-IniSectionValueOrDefault -Path $sourceMarkerPath -Section 'Relay' -Key 'targetCommitish' -Default ($sourceBuildId -replace '^r\d+-', '')
  $sourceServerEpoch = Get-IniSectionValueOrDefault -Path $sourceMarkerPath -Section 'Relay' -Key 'serverDataEpoch' -Default '1'
  $sourceClientEpoch = Get-IniSectionValueOrDefault -Path $sourceMarkerPath -Section 'Relay' -Key 'clientDataEpoch' -Default '1'
  $sourceInstalledAt = Get-IniSectionValueOrDefault -Path $sourceMarkerPath -Section 'Relay' -Key 'installedAt' -Default $requestedAt
  New-Item -ItemType Directory -Path $recoveryRoot -Force | Out-Null
  $contents = @(
    '[RecoveryRequest]'
    'protocol=2'
    "transactionId=$transactionId"
    "targetVersion=$targetVersion"
    "targetCommitish=$ExpectedTargetCommitish"
    "targetInstallerSha256=$installerHash"
    'mode=unconfigured'
    'checkpoint=pending'
    'snapshotId='
    "requestedAt=$requestedAt"
    ''
    '[Source]'
    "buildId=$sourceBuildId"
    "version=$sourceVersion"
    "releaseTag=$sourceReleaseTag"
    "targetCommitish=$sourceCommit"
    "runtimeSha512=$sourceRuntimeHash"
    'installerSha256='
    "recoveryProtocol=$sourceProtocol"
    "serverDataEpoch=$sourceServerEpoch"
    "clientDataEpoch=$sourceClientEpoch"
    "installedAt=$sourceInstalledAt"
    'health=healthy'
    'rollbackSnapshotId='
  )
  [IO.File]::WriteAllText(
    $updateRequestPath,
    ($contents -join "`r`n") + "`r`n",
    [Text.UTF8Encoding]::new($false)
  )
  return $transactionId
}

function Assert-ProtectedUpdatePrepared {
  param([Parameter(Mandatory = $true)][string]$TransactionId)

  if ((Get-IniSectionValue -Path $statePath -Section 'Relay' -Key 'current') -ne $ExpectedPreviousBuildId) {
    throw 'Protected update preparation changed the active build before promotion.'
  }
  if (-not (Test-Path -LiteralPath $preparedPath)) {
    throw 'Protected update preparation did not write its candidate receipt.'
  }
  $expectedInstallerHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ((Get-IniSectionValue -Path $preparedPath -Section 'Prepared' -Key 'protocol') -ne '2' -or
      (Get-IniSectionValue -Path $preparedPath -Section 'Prepared' -Key 'transactionId') -ne $TransactionId -or
      (Get-IniSectionValue -Path $preparedPath -Section 'Prepared' -Key 'buildId') -ne $ExpectedBuildId -or
      (Get-IniSectionValue -Path $preparedPath -Section 'Prepared' -Key 'targetCommitish') -ne $ExpectedTargetCommitish -or
      (Get-IniSectionValue -Path $preparedPath -Section 'Prepared' -Key 'installerSha256') -ne $expectedInstallerHash -or
      (Get-IniSectionValue -Path $preparedPath -Section 'Prepared' -Key 'health') -ne 'candidate') {
    throw 'Protected update preparation wrote an invalid candidate receipt.'
  }
  Assert-EmbeddedBuildIdentity -BuildId $ExpectedBuildId
}

function Remove-ProtectedUpdateMetadata {
  foreach ($path in @($updateRequestPath, $preparedPath, "$preparedPath.new")) {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
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

  $previousFirstTimer = [Diagnostics.Stopwatch]::StartNew()
  $concurrentTimer = [Diagnostics.Stopwatch]::StartNew()
  $primaryPreviousProcess = Start-Process -FilePath $previousArtifactPath -ArgumentList '/relay-prepare-only' -PassThru
  Wait-BootstrapLockHeld -Process $primaryPreviousProcess
  $differentBuildContender = Start-Process -FilePath $artifactPath -ArgumentList '/relay-prepare-only' -PassThru
  Wait-ProcessWithTimeout -Process $differentBuildContender -Context 'Different-build preparation contender'
  Wait-ProcessWithTimeout -Process $primaryPreviousProcess -Context 'Primary previous-build preparation'
  $previousFirstTimer.Stop()
  $concurrentTimer.Stop()
  if ($primaryPreviousProcess.ExitCode -ne 0) {
    throw "Primary previous-build preparation failed with exit code $($primaryPreviousProcess.ExitCode)."
  }
  if ($differentBuildContender.ExitCode -eq 0) {
    throw 'A different-build prepare-only contender incorrectly reported success.'
  }
  $previousFirstPreparationMs = $previousFirstTimer.ElapsedMilliseconds
  $concurrentPreparationMs = $concurrentTimer.ElapsedMilliseconds

  if (-not (Test-Path -LiteralPath $statePath)) {
    throw 'Relay bootstrap did not create state.ini'
  }
  if ((Get-IniValue -Path $statePath -Key 'current') -ne $ExpectedPreviousBuildId) {
    throw 'Previous bootstrap did not activate the expected build.'
  }
  Assert-EmbeddedBuildIdentity -BuildId $ExpectedPreviousBuildId
  $previousLauncherProtocolExitCode = Get-LauncherProtocolExitCode -Path $launcherPath

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
  $previousStateProtocol = Get-IniSectionValue -Path $statePath -Section 'Relay' -Key 'protocol'
  $protectedRecoveryPreparation = $previousStateProtocol -eq '2'
  $legacyStateProtectedRecoveryPreparation = $false
  $legacyStatePreparationMs = $null
  $currentFreshActivationMs = $null
  $oldRuntimeHandle = [IO.File]::Open(
    $previousExecutable,
    [IO.FileMode]::Open,
    [IO.FileAccess]::Read,
    [IO.FileShare]::Read
  )
  try {
    if ($protectedRecoveryPreparation) {
      $protectedState = [IO.File]::ReadAllBytes($statePath)
      try {
        [IO.File]::WriteAllText(
          $statePath,
          "[Relay]`r`nprotocol=1`r`ncurrent=$ExpectedPreviousBuildId`r`nprevious=`r`n",
          [Text.UTF8Encoding]::new($false)
        )
        $legacyTransactionId = New-RecoveryUpdateRequest -Path $artifactPath
        $legacyStatePreparationMs = Invoke-RelayPreparation -Path $artifactPath -TransactionId $legacyTransactionId
        Assert-ProtectedUpdatePrepared -TransactionId $legacyTransactionId
        $legacyStateProtectedRecoveryPreparation = $true
      }
      finally {
        Remove-ProtectedUpdateMetadata
        [IO.File]::WriteAllBytes($statePath, $protectedState)
        Remove-Item -LiteralPath (Join-Path $runtimeVersionsRoot $ExpectedBuildId) -Recurse -Force -ErrorAction SilentlyContinue
      }

      $transactionId = New-RecoveryUpdateRequest -Path $artifactPath
      $currentFirstPreparationMs = Invoke-RelayPreparation -Path $artifactPath -TransactionId $transactionId
      Assert-ProtectedUpdatePrepared -TransactionId $transactionId
    }
    else {
      $currentFirstPreparationMs = Invoke-RelayPreparation -Path $artifactPath
    }
    $launcherProtocolExitCode = Get-LauncherProtocolExitCode -Path $launcherPath
    if ($launcherProtocolExitCode -ne $ExpectedLauncherProtocolExitCode) {
      throw "Current bootstrap retained launcher protocol exit code $launcherProtocolExitCode; expected $ExpectedLauncherProtocolExitCode."
    }
  }
  finally {
    $oldRuntimeHandle.Dispose()
    $oldRuntimeHandle = $null
  }

  if ($protectedRecoveryPreparation) {
    Remove-ProtectedUpdateMetadata
    Remove-Item -LiteralPath $statePath -Force
    $currentFreshActivationMs = Invoke-RelayPreparation -Path $artifactPath
  }

  if ((Get-IniValue -Path $statePath -Key 'current') -ne $ExpectedBuildId) {
    throw 'Current bootstrap did not activate the expected build.'
  }
  if (-not $protectedRecoveryPreparation -and
      (Get-IniValue -Path $statePath -Key 'previous') -ne $ExpectedPreviousBuildId) {
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

  $currentAppAsar = Join-Path (Join-Path $runtimeVersionsRoot $ExpectedBuildId) 'resources\app.asar'
  $expectedAppAsarHash = (Get-FileHash -LiteralPath $currentAppAsar -Algorithm SHA512).Hash
  $corruptStream = [IO.File]::Open(
    $currentAppAsar,
    [IO.FileMode]::Append,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None
  )
  try {
    $corruptStream.WriteByte(0)
  }
  finally {
    $corruptStream.Dispose()
  }
  $contentRepairPreparationMs = Invoke-RelayPreparation -Path $artifactPath
  if ((Get-FileHash -LiteralPath $currentAppAsar -Algorithm SHA512).Hash -ne $expectedAppAsarHash) {
    throw 'Relay bootstrap did not repair content corruption beyond the PE header.'
  }

  $currentRuntime = Join-Path $runtimeVersionsRoot $ExpectedBuildId
  $currentFfmpeg = Join-Path $currentRuntime 'ffmpeg.dll'
  $expectedFfmpegHash = (Get-FileHash -LiteralPath $currentFfmpeg -Algorithm SHA512).Hash
  $corruptStream = [IO.File]::Open(
    $currentFfmpeg,
    [IO.FileMode]::Append,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None
  )
  try {
    $corruptStream.WriteByte(0)
  }
  finally {
    $corruptStream.Dispose()
  }
  $dllRepairPreparationMs = Invoke-RelayPreparation -Path $artifactPath
  if ((Get-FileHash -LiteralPath $currentFfmpeg -Algorithm SHA512).Hash -ne $expectedFfmpegHash) {
    throw 'Relay bootstrap did not repair a corrupted Electron DLL.'
  }

  $currentPocketBaseHook = Join-Path $currentRuntime 'resources\pocketbase\hooks\relay_privileged_reauth.pb.js'
  $expectedPocketBaseHookHash = (Get-FileHash -LiteralPath $currentPocketBaseHook -Algorithm SHA512).Hash
  $corruptStream = [IO.File]::Open(
    $currentPocketBaseHook,
    [IO.FileMode]::Append,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None
  )
  try {
    $corruptStream.WriteByte(0)
  }
  finally {
    $corruptStream.Dispose()
  }
  $hookRepairPreparationMs = Invoke-RelayPreparation -Path $artifactPath
  if ((Get-FileHash -LiteralPath $currentPocketBaseHook -Algorithm SHA512).Hash -ne $expectedPocketBaseHookHash) {
    throw 'Relay bootstrap did not repair a corrupted PocketBase hook.'
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
  $actualCurrent = Get-IniValue -Path $statePath -Key 'current'
  $actualPrevious = Get-IniValue -Path $statePath -Key 'previous'
  if ($actualCurrent -ne $ExpectedBuildId -or $actualPrevious -ne $ExpectedPreviousBuildId) {
    $previousRuntimeExists = Test-Path -LiteralPath (Join-Path $runtimeVersionsRoot $ExpectedPreviousBuildId)
    $previousMarkerExists = Test-Path -LiteralPath $previousMarkerPath
    throw "A damaged recorded current runtime displaced the last usable previous build: actualCurrent='$actualCurrent' actualPrevious='$actualPrevious' previousRuntimeExists=$previousRuntimeExists previousMarkerExists=$previousMarkerExists"
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
    ContentCorruptionRepaired = $true
    DllCorruptionRepaired = $true
    PocketBaseHookCorruptionRepaired = $true
    MissingExecutableRepaired = $true
    BrokenCurrentPreservedPrevious = $true
    ConcurrentPreparation = $true
    DifferentBuildContentionRejected = $true
    UpdateWhilePreviousLocked = $true
    ProtectedRecoveryPreparation = $protectedRecoveryPreparation
    LegacyStateProtectedRecoveryPreparation = $legacyStateProtectedRecoveryPreparation
    PreviousLauncherProtocolExitCode = $previousLauncherProtocolExitCode
    LauncherProtocolExitCode = $launcherProtocolExitCode
    LauncherGenerationUpgraded = $previousLauncherProtocolExitCode -ne $launcherProtocolExitCode
    PreviousFirstPreparationMs = $previousFirstPreparationMs
    PreviousReusePreparationMs = $previousReusePreparationMs
    ConcurrentPreparationMs = $concurrentPreparationMs
    LegacyStatePreparationMs = $legacyStatePreparationMs
    CurrentFirstPreparationMs = $currentFirstPreparationMs
    CurrentFreshActivationMs = $currentFreshActivationMs
    CurrentReusePreparationMs = $currentReusePreparationMs
    CurrentRepairPreparationMs = $currentRepairPreparationMs
    ExecutableRepairPreparationMs = $executableRepairPreparationMs
    ContentRepairPreparationMs = $contentRepairPreparationMs
    DllRepairPreparationMs = $dllRepairPreparationMs
    HookRepairPreparationMs = $hookRepairPreparationMs
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
