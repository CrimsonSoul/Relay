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
  '.fail-before-state-activation'
)

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

function Invoke-Preparation {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$ExpectFailure
  )
  $process = Start-Process -FilePath $Path -ArgumentList '/relay-prepare-only' -Wait -PassThru
  if ($ExpectFailure -and $process.ExitCode -eq 0) {
    throw "Boundary harness unexpectedly succeeded: $Path"
  }
  if (-not $ExpectFailure -and $process.ExitCode -ne 0) {
    throw "Boundary harness exited with code $($process.ExitCode): $Path"
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

function Invoke-StableFallback {
  param([Parameter(Mandatory = $true)][string]$ExpectedActiveBuildId)

  $runId = [Guid]::NewGuid().ToString()
  $exitMarker = Join-Path (Join-Path $env:TEMP 'Relay\startup-benchmark') "$runId.complete"
  Remove-Item -LiteralPath $exitMarker -Force -ErrorAction SilentlyContinue
  $priorExitAfterRender = $env:RELAY_BENCHMARK_EXIT_AFTER_RENDER
  $priorRunId = $env:RELAY_BENCHMARK_RUN_ID
  $priorGpuDiagnostics = $env:RELAY_DISABLE_GPU_DIAGNOSTICS
  try {
    $env:RELAY_BENCHMARK_EXIT_AFTER_RENDER = '1'
    $env:RELAY_BENCHMARK_RUN_ID = $runId
    $env:RELAY_DISABLE_GPU_DIAGNOSTICS = '1'
    $launcher = Start-Process -FilePath $launcherPath -PassThru
    $launcher.WaitForExit()
    if ($launcher.ExitCode -ne 0) {
      throw "Stable launcher exited with code $($launcher.ExitCode)."
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while (-not (Test-Path -LiteralPath $exitMarker) -and [DateTime]::UtcNow -lt $deadline) {
      Start-Sleep -Milliseconds 100
    }
    if (-not (Test-Path -LiteralPath $exitMarker)) {
      throw 'Stable launcher did not start and cleanly exit Relay.'
    }
    if ((Get-IniValue -Path $statePath -Key 'current') -ne $ExpectedActiveBuildId) {
      throw 'Stable launcher test observed an unexpected active build.'
    }
  }
  finally {
    $env:RELAY_BENCHMARK_EXIT_AFTER_RENDER = $priorExitAfterRender
    $env:RELAY_BENCHMARK_RUN_ID = $priorRunId
    $env:RELAY_DISABLE_GPU_DIAGNOSTICS = $priorGpuDiagnostics
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
}

try {
  New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
  [IO.File]::WriteAllText($sentinelPath, "relay-boundary-$([Guid]::NewGuid())")
  $sentinelHashBefore = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash

  Invoke-Preparation -Path $previousArtifactPath
  Assert-PreviousActive
  Invoke-StableFallback -ExpectedActiveBuildId $ExpectedPreviousBuildId

  foreach ($failurePoint in $failurePoints) {
    Remove-FailedBuildResidue
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
      Invoke-Preparation -Path $artifactPath -ExpectFailure
    }
    finally {
      Remove-Item -LiteralPath $failureSentinel -Force -ErrorAction SilentlyContinue
    }
    Assert-PreviousActive
    if ($null -ne $repairRestoreSentinel -and
        -not (Test-Path -LiteralPath $repairRestoreSentinel)) {
      throw 'Post-quarantine failure did not restore the damaged runtime directory.'
    }
    Invoke-StableFallback -ExpectedActiveBuildId $ExpectedPreviousBuildId
  }

  Remove-FailedBuildResidue
  Invoke-Preparation -Path $artifactPath
  if ((Get-IniValue -Path $statePath -Key 'current') -ne $ExpectedBuildId -or
      (Get-IniValue -Path $statePath -Key 'previous') -ne $ExpectedPreviousBuildId) {
    throw 'Harness could not activate the current build after injected failures.'
  }
  Invoke-StableFallback -ExpectedActiveBuildId $ExpectedBuildId

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
