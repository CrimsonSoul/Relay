param(
  [Parameter(Mandatory = $true)]
  [string]$Artifact,
  [Parameter(Mandatory = $true)]
  [string]$PreviousArtifact,
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedBuildId,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedPreviousBuildId
)

$ErrorActionPreference = 'Stop'

if ($env:RELAY_BOOTSTRAP_BOUNDARY_CONFIRM -ne '1') {
  throw 'Set RELAY_BOOTSTRAP_BOUNDARY_CONFIRM=1 only for the isolated Windows harness.'
}
if ($ExpectedBuildId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or
    $ExpectedPreviousBuildId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or
    $ExpectedBuildId -eq $ExpectedPreviousBuildId) {
  throw 'Boundary build IDs must be distinct path-safe identifiers.'
}

$artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
$previousArtifactPath = (Resolve-Path -LiteralPath $PreviousArtifact).Path
$rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
$runnerTempPath = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
if (-not $rootPath.StartsWith("$runnerTempPath\", [StringComparison]::OrdinalIgnoreCase)) {
  throw "Harness root must be a child of RUNNER_TEMP: $runnerTempPath"
}
if (Test-Path -LiteralPath $rootPath) {
  throw "Isolated harness root already exists: $rootPath"
}

$runtimeVersionsRoot = Join-Path $rootPath 'Runtime'
$launcherPath = Join-Path $rootPath 'Relay.exe'
$statePath = Join-Path $rootPath 'state.ini'
$recoveryRoot = Join-Path $rootPath 'Recovery'
$updateRequestPath = Join-Path $recoveryRoot 'update-request.ini'
$preparedPath = Join-Path $recoveryRoot 'prepared.ini'
$preparedNewPath = Join-Path $recoveryRoot 'prepared.ini.new'
$probationResultPath = Join-Path $recoveryRoot 'probation-result.ini'
$settlementPath = Join-Path $recoveryRoot 'settled-update.ini'
$probationDiagnosticPath = Join-Path $rootPath 'probation-diagnostic.ini'
$desktopShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Relay.lnk'
$startMenuShortcutPath = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Relay\Relay.lnk'
$relayAppDataRoot = Join-Path $env:APPDATA 'Relay'
$relayAppDataRootExisted = Test-Path -LiteralPath $relayAppDataRoot
$dataRoot = Join-Path $relayAppDataRoot 'data'
$sentinelPath = Join-Path $dataRoot 'bootstrap-boundary-sentinel.txt'
$failurePoints = @(
  '.fail-after-extraction',
  '.fail-after-marker',
  '.fail-before-runtime-rename',
  '.fail-after-quarantine',
  '.fail-before-launcher-activation',
  '.fail-before-prepared-activation'
)

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

function Test-RelayRuntimeActive {
  param([Parameter(Mandatory = $true)][string]$ExecutablePath)

  $targetPath = [IO.Path]::GetFullPath($ExecutablePath)
  $records = @(Get-CimInstance Win32_Process -Filter "Name = 'Relay.exe'")
  foreach ($record in $records) {
    if ([string]::IsNullOrWhiteSpace([string]$record.ExecutablePath)) {
      continue
    }
    try {
      $candidatePath = [IO.Path]::GetFullPath([string]$record.ExecutablePath)
      if ([string]::Equals(
          $candidatePath,
          $targetPath,
          [StringComparison]::OrdinalIgnoreCase
        )) {
        return $true
      }
    }
    catch {
      # A process can exit between the CIM snapshot and path inspection.
      continue
    }
  }
  return $false
}

function Wait-RelayRuntimeQuiescence {
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [int]$TimeoutSeconds = 15
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $idleChecks = 0
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-RelayRuntimeActive -ExecutablePath $ExecutablePath) {
      $idleChecks = 0
    }
    else {
      $idleChecks += 1
      if ($idleChecks -ge 3) {
        return
      }
    }
    Start-Sleep -Milliseconds 100
  }
  throw "Relay runtime did not release its executable within $TimeoutSeconds seconds: $ExecutablePath"
}

function Get-IniValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Key
  )
  $match = Select-String -LiteralPath $Path -Pattern "^$([Regex]::Escape($Key))=(.+)$" |
    Select-Object -First 1
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

function New-RecoveryUpdateRequest {
  param([Parameter(Mandatory = $true)][string]$Path)

  $transactionId = [Guid]::NewGuid().ToString().ToLowerInvariant()
  $sourceBuildId = Get-IniSectionValue -Path $statePath -Section 'Relay' -Key 'current'
  $sourceSection = "Build.$sourceBuildId"
  $sourceVersion = Get-IniSectionValue -Path $statePath -Section $sourceSection -Key 'version'
  $sourceCommit = Get-IniSectionValue -Path $statePath -Section $sourceSection -Key 'targetCommitish'
  $installerHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  $requestedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  New-Item -ItemType Directory -Path $recoveryRoot -Force | Out-Null
  $contents = @(
    '[RecoveryRequest]'
    'protocol=2'
    "transactionId=$transactionId"
    "targetVersion=$sourceVersion"
    "targetCommitish=$sourceCommit"
    "targetInstallerSha256=$installerHash"
    'mode=unconfigured'
    'checkpoint=pending'
    'snapshotId='
    "requestedAt=$requestedAt"
    ''
    '[Source]'
    "buildId=$sourceBuildId"
    "version=$sourceVersion"
    "releaseTag=$(Get-IniSectionValue -Path $statePath -Section $sourceSection -Key 'releaseTag')"
    "targetCommitish=$sourceCommit"
    "runtimeSha512=$(Get-IniSectionValue -Path $statePath -Section $sourceSection -Key 'runtimeSha512')"
    "installerSha256=$(Get-IniSectionValue -Path $statePath -Section $sourceSection -Key 'installerSha256')"
    "recoveryProtocol=$(Get-IniSectionValue -Path $statePath -Section $sourceSection -Key 'recoveryProtocol')"
    "serverDataEpoch=$(Get-IniSectionValue -Path $statePath -Section $sourceSection -Key 'serverDataEpoch')"
    "clientDataEpoch=$(Get-IniSectionValue -Path $statePath -Section $sourceSection -Key 'clientDataEpoch')"
    "installedAt=$(Get-IniSectionValue -Path $statePath -Section $sourceSection -Key 'installedAt')"
    "health=$(Get-IniSectionValue -Path $statePath -Section $sourceSection -Key 'health')"
    "rollbackSnapshotId=$(Get-IniSectionValue -Path $statePath -Section $sourceSection -Key 'rollbackSnapshotId')"
  )
  [IO.File]::WriteAllText(
    $updateRequestPath,
    ($contents -join "`r`n") + "`r`n",
    [Text.UTF8Encoding]::new($false)
  )
  return $transactionId
}

function Complete-RecoveryUpdateRequest {
  $contents = [IO.File]::ReadAllText($updateRequestPath)
  $completed = $contents -replace '(?m)^checkpoint=pending\r?$', 'checkpoint=complete'
  if ($completed -eq $contents) {
    throw 'Boundary recovery request did not contain a pending checkpoint.'
  }
  [IO.File]::WriteAllText(
    $updateRequestPath,
    $completed,
    [Text.UTF8Encoding]::new($false)
  )
}

function Test-FixtureProbationReceipt {
  param([Parameter(Mandatory = $true)][string]$TransactionId)

  $candidateExecutable = Join-Path (
    Join-Path $runtimeVersionsRoot $ExpectedBuildId
  ) 'Relay.exe'
  Remove-Item -LiteralPath $probationResultPath -Force -ErrorAction SilentlyContinue
  $process = Start-Process `
    -FilePath $candidateExecutable `
    -ArgumentList "--relay-recovery-probation=$TransactionId" `
    -PassThru
  Wait-ProcessWithTimeout -Process $process -Context 'Direct fixture probation receipt'
  if ($process.ExitCode -ne 0) {
    throw "Direct fixture probation exited with code $($process.ExitCode)."
  }
  if (-not (Test-Path -LiteralPath $probationResultPath)) {
    throw 'Direct fixture probation did not write its receipt.'
  }

  $receiptSummary = (Get-Content -LiteralPath $probationResultPath) -join '; '
  try {
    if ((Get-IniSectionValue -Path $probationResultPath -Section 'Probation' -Key 'protocol') -ne '2' -or
        (Get-IniSectionValue -Path $probationResultPath -Section 'Probation' -Key 'transactionId') -ne $TransactionId -or
        (Get-IniSectionValue -Path $probationResultPath -Section 'Probation' -Key 'buildId') -ne $ExpectedBuildId -or
        (Get-IniSectionValue -Path $probationResultPath -Section 'Probation' -Key 'status') -ne 'healthy') {
      throw "Direct fixture probation wrote an invalid receipt: $receiptSummary"
    }
  }
  finally {
    Remove-Item -LiteralPath $probationResultPath -Force -ErrorAction SilentlyContinue
  }
}

function Remove-RecoveryMetadata {
  foreach ($path in @(
      $updateRequestPath,
      $preparedPath,
      $preparedNewPath,
      $probationResultPath,
      $settlementPath
    )) {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-Preparation {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$TransactionId = '',
    [switch]$ExpectFailure
  )
  $arguments = @('/relay-prepare-only')
  if ($TransactionId) {
    $arguments += "/relay-transaction=$TransactionId"
  }
  $process = Start-Process -FilePath $Path -ArgumentList $arguments -PassThru
  Wait-ProcessWithTimeout -Process $process -Context "Boundary preparation: $Path"
  if ($ExpectFailure -and $process.ExitCode -ne 197) {
    throw "Boundary harness exited with unexpected code $($process.ExitCode); expected 197: $Path"
  }
  if (-not $ExpectFailure -and $process.ExitCode -ne 0) {
    $bootstrapErrorPath = Join-Path $rootPath 'bootstrap-error.ini'
    $failureMessage = 'No bootstrap failure record was written.'
    if (Test-Path -LiteralPath $bootstrapErrorPath) {
      $match = Select-String -LiteralPath $bootstrapErrorPath -Pattern '^message=(.+)$' |
        Select-Object -First 1
      if ($null -ne $match) {
        $failureMessage = $match.Matches[0].Groups[1].Value
      }
    }
    throw "Boundary bootstrap failure: $failureMessage (exit code $($process.ExitCode); artifact $Path)"
  }
}

function Assert-PreviousActive {
  if ((Get-IniValue -Path $statePath -Key 'current') -ne $ExpectedPreviousBuildId) {
    throw 'Injected failure changed the active build.'
  }
  $previousMarker = Join-Path (Join-Path $runtimeVersionsRoot $ExpectedPreviousBuildId) '.relay-runtime-ready'
  if (-not (Test-Path -LiteralPath $previousMarker)) {
    throw 'Injected failure removed the previous runtime marker.'
  }
}

function Get-DirectoryEntrySummary {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return '<missing>'
  }
  return (Get-ChildItem -LiteralPath $Path -Force | Select-Object -ExpandProperty Name) -join ','
}

function Get-FileContentSummary {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return '<missing>'
  }
  return (Get-Content -LiteralPath $Path) -join '; '
}

function Invoke-StableFallback {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedActiveBuildId,
    [Parameter(Mandatory = $true)][string]$Context
  )

  $runId = [Guid]::NewGuid().ToString()
  $exitMarker = Join-Path (Join-Path $env:TEMP 'Relay\startup-benchmark') "$runId.complete"
  Remove-Item -LiteralPath $exitMarker -Force -ErrorAction SilentlyContinue
  $priorExitAfterRender = $env:RELAY_BENCHMARK_EXIT_AFTER_RENDER
  $priorRunId = $env:RELAY_BENCHMARK_RUN_ID
  $priorGpuDiagnostics = $env:RELAY_DISABLE_GPU_DIAGNOSTICS
  $priorCrashWatchdog = $env:RELAY_DISABLE_CRASH_WATCHDOG
  try {
    $env:RELAY_BENCHMARK_EXIT_AFTER_RENDER = '1'
    $env:RELAY_BENCHMARK_RUN_ID = $runId
    $env:RELAY_DISABLE_GPU_DIAGNOSTICS = '1'
    $env:RELAY_DISABLE_CRASH_WATCHDOG = '1'
    $launcher = Start-Process -FilePath $launcherPath -PassThru
    Wait-ProcessWithTimeout -Process $launcher -Context 'Stable fallback launch' -TimeoutSeconds 60
    if ($launcher.ExitCode -ne 0) {
      $recoveryFiles = Get-DirectoryEntrySummary -Path $recoveryRoot
      $stateSummary = Get-FileContentSummary -Path $statePath
      $probationDiagnostic = Get-FileContentSummary -Path $probationDiagnosticPath
      throw "Stable launcher exited with code $($launcher.ExitCode): context=$Context; recoveryFiles=$recoveryFiles; probationDiagnostic=$probationDiagnostic; state=$stateSummary"
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while (-not (Test-Path -LiteralPath $exitMarker) -and [DateTime]::UtcNow -lt $deadline) {
      Start-Sleep -Milliseconds 100
    }
    if (-not (Test-Path -LiteralPath $exitMarker)) {
      throw 'Stable launcher did not start and cleanly exit Relay.'
    }
    $runtimeExecutable = Join-Path (
      Join-Path $runtimeVersionsRoot $ExpectedActiveBuildId
    ) 'Relay.exe'
    Wait-RelayRuntimeQuiescence -ExecutablePath $runtimeExecutable
    $actualActiveBuildId = Get-IniValue -Path $statePath -Key 'current'
    if ($actualActiveBuildId -ne $ExpectedActiveBuildId) {
      $recoveryFiles = Get-DirectoryEntrySummary -Path $recoveryRoot
      $stateSummary = Get-FileContentSummary -Path $statePath
      $probationDiagnostic = Get-FileContentSummary -Path $probationDiagnosticPath
      throw "Stable launcher test observed an unexpected active build: context=$Context; expected=$ExpectedActiveBuildId; actual=$actualActiveBuildId; recoveryFiles=$recoveryFiles; probationDiagnostic=$probationDiagnostic; state=$stateSummary"
    }
    Write-Information "Boundary stable launch verified: context=$Context; active=$actualActiveBuildId" -InformationAction Continue
  }
  finally {
    $env:RELAY_BENCHMARK_EXIT_AFTER_RENDER = $priorExitAfterRender
    $env:RELAY_BENCHMARK_RUN_ID = $priorRunId
    $env:RELAY_DISABLE_GPU_DIAGNOSTICS = $priorGpuDiagnostics
    $env:RELAY_DISABLE_CRASH_WATCHDOG = $priorCrashWatchdog
    Remove-Item -LiteralPath $exitMarker -Force -ErrorAction SilentlyContinue
  }
}

function Remove-FailedBuildResidue {
  if (Test-Path -LiteralPath $runtimeVersionsRoot) {
    Get-ChildItem -LiteralPath $runtimeVersionsRoot -Force |
      Where-Object {
        $_.Name -eq $ExpectedBuildId -or
        $_.Name -like ".staging-$ExpectedBuildId-*" -or
        $_.Name -like ".corrupt-$ExpectedBuildId-*"
      } |
      Remove-Item -Recurse -Force
  }
  Remove-Item -LiteralPath (Join-Path $rootPath 'state.ini.new') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $rootPath 'Relay.exe.new') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $probationDiagnosticPath -Force -ErrorAction SilentlyContinue
  Remove-RecoveryMetadata
}

try {
  New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
  [IO.File]::WriteAllText($sentinelPath, "relay-boundary-$([Guid]::NewGuid())")
  $sentinelHashBefore = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash

  Invoke-Preparation -Path $previousArtifactPath
  Assert-PreviousActive
  Invoke-StableFallback -ExpectedActiveBuildId $ExpectedPreviousBuildId -Context 'initial-previous'

  foreach ($failurePoint in $failurePoints) {
    Remove-FailedBuildResidue
    $transactionId = New-RecoveryUpdateRequest -Path $artifactPath
    $repairRestoreSentinel = $null
    if ($failurePoint -eq '.fail-after-quarantine') {
      $damagedRuntime = Join-Path $runtimeVersionsRoot $ExpectedBuildId
      New-Item -ItemType Directory -Path $damagedRuntime -Force | Out-Null
      $repairRestoreSentinel = Join-Path $damagedRuntime 'repair-restore-sentinel.txt'
      [IO.File]::WriteAllText($repairRestoreSentinel, 'restore-me')
    }
    $failureSentinel = Join-Path $rootPath $failurePoint
    [IO.File]::WriteAllText($failureSentinel, $failurePoint)
    try {
      Invoke-Preparation -Path $artifactPath -TransactionId $transactionId -ExpectFailure
    }
    finally {
      Remove-Item -LiteralPath $failureSentinel -Force -ErrorAction SilentlyContinue
    }
    Remove-RecoveryMetadata
    Assert-PreviousActive
    if ($null -ne $repairRestoreSentinel) {
      $quarantinedSentinel = Get-ChildItem -LiteralPath $runtimeVersionsRoot -Directory |
        Where-Object { $_.Name -like ".corrupt-$ExpectedBuildId-*" } |
        ForEach-Object { Join-Path $_.FullName 'repair-restore-sentinel.txt' } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
      if ($null -eq $quarantinedSentinel) {
        throw 'Abrupt post-quarantine termination lost the damaged runtime directory.'
      }
    }
    Invoke-StableFallback -ExpectedActiveBuildId $ExpectedPreviousBuildId -Context "fallback-after-$failurePoint"
  }

  Remove-FailedBuildResidue
  $transactionId = New-RecoveryUpdateRequest -Path $artifactPath
  Invoke-Preparation -Path $artifactPath -TransactionId $transactionId
  Test-FixtureProbationReceipt -TransactionId $transactionId
  Complete-RecoveryUpdateRequest
  Assert-PreviousActive
  Invoke-StableFallback -ExpectedActiveBuildId $ExpectedBuildId -Context 'final-promotion'
  if ((Get-IniValue -Path $statePath -Key 'current') -ne $ExpectedBuildId -or
      (Get-IniValue -Path $statePath -Key 'previous0') -ne $ExpectedPreviousBuildId) {
    throw 'Harness could not activate the current build after injected failures.'
  }

  $sentinelHashAfter = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash
  if ($sentinelHashAfter -ne $sentinelHashBefore) {
    throw 'Boundary harness modified Relay application data.'
  }

  [pscustomobject]@{
    BuildId = $ExpectedBuildId
    PreviousBuildId = $ExpectedPreviousBuildId
    BoundaryFailuresPreservedFallback = $failurePoints.Count
    StableFallbackExecuted = $true
    FinalActivationSucceeded = $true
    DataUnchanged = $true
  } | ConvertTo-Json
}
finally {
  if (Test-Path -LiteralPath $rootPath) {
    Remove-Item -LiteralPath $rootPath -Recurse -Force
  }
  if (-not $relayAppDataRootExisted -and (Test-Path -LiteralPath $relayAppDataRoot)) {
    Remove-Item -LiteralPath $relayAppDataRoot -Recurse -Force
  }
  else {
    Remove-Item -LiteralPath $sentinelPath -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $desktopShortcutPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $startMenuShortcutPath -Force -ErrorAction SilentlyContinue
}
