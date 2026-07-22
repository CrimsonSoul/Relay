param(
  [Parameter(Mandatory = $true)][string]$StoreArtifact,
  [Parameter(Mandatory = $true)][string]$NormalArtifact,
  [Parameter(Mandatory = $true)][string]$MaximumArtifact,
  [Parameter(Mandatory = $true)][string]$PortableArtifact,
  [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = 'Stop'

if ($env:RELAY_STARTUP_COMPARISON_CONFIRM -ne '1') {
  throw 'Set RELAY_STARTUP_COMPARISON_CONFIRM=1 only on a disposable Windows benchmark runner.'
}

$runtimeRoot = Join-Path $env:LOCALAPPDATA 'Relay'
$stableLauncher = Join-Path $runtimeRoot 'Relay.exe'
$sampleCount = 5

function Clear-DisposableRuntime {
  if (Test-Path -LiteralPath $runtimeRoot) {
    Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
  }
}

function Invoke-NodeBenchmark {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $json = & node @Arguments | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Startup benchmark failed with exit code $LASTEXITCODE."
  }
  return $json | ConvertFrom-Json
}

function Get-Median {
  param([Parameter(Mandatory = $true)][double[]]$Values)

  $sorted = @($Values | Sort-Object)
  if ($sorted.Count -eq 0) {
    throw 'Median requires at least one value.'
  }
  $middle = [Math]::Floor($sorted.Count / 2)
  if ($sorted.Count % 2 -eq 1) {
    return $sorted[$middle]
  }
  return ($sorted[$middle - 1] + $sorted[$middle]) / 2
}

function Invoke-PersistentCandidate {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Artifact
  )

  $artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
  $samples = @()
  for ($index = 0; $index -lt $sampleCount; $index += 1) {
    Clear-DisposableRuntime
    $samples += Invoke-NodeBenchmark -Arguments @(
      'scripts/benchmark-startup.mjs',
      '--scenario', 'prepare',
      '--artifact', $artifactPath,
      '--compression', $Label
    )
  }

  $stable = Invoke-NodeBenchmark -Arguments @(
    'scripts/benchmark-startup.mjs',
    '--scenario', 'stable',
    '--launcher', $stableLauncher,
    '--compression', $Label,
    '--runs', "$sampleCount"
  )
  if ($stable.runtimeReused -ne $true) {
    throw "$Label stable-launch benchmark did not reuse its runtime."
  }

  return [pscustomobject]@{
    Compression = $Label
    Artifact = $artifactPath
    ArtifactSizeBytes = (Get-Item -LiteralPath $artifactPath).Length
    PrepareSamples = $samples
    PrepareProcessHandoffMedianMs = Get-Median -Values @($samples.processHandoffMs)
    PrepareRendererMountedWallMedianMs = Get-Median -Values @($samples.rendererMountedWallMs)
    PrepareBeforeElectronMedianMs = Get-Median -Values @($samples.beforeElectronEntryMs)
    Stable = $stable
  }
}

try {
  $portablePath = (Resolve-Path -LiteralPath $PortableArtifact).Path
  Clear-DisposableRuntime
  $null = Invoke-NodeBenchmark -Arguments @(
    'scripts/benchmark-startup.mjs',
    '--scenario', 'portable',
    '--artifact', $portablePath,
    '--compression', 'profile-warmup'
  )

  $candidates = @(
    Invoke-PersistentCandidate -Label 'store' -Artifact $StoreArtifact
    Invoke-PersistentCandidate -Label 'normal' -Artifact $NormalArtifact
    Invoke-PersistentCandidate -Label 'maximum' -Artifact $MaximumArtifact
  )

  Clear-DisposableRuntime
  $portable = Invoke-NodeBenchmark -Arguments @(
    'scripts/benchmark-startup.mjs',
    '--scenario', 'portable',
    '--artifact', $portablePath,
    '--compression', 'former-maximum-portable',
    '--runs', "$sampleCount"
  )

  $recommended = $candidates |
    Sort-Object -Property PrepareRendererMountedWallMedianMs |
    Select-Object -First 1
  $portableRendererMedianMs = $portable.packagedMedian.rendererMountedWallMs
  $beatsPortableBaseline =
    $recommended.PrepareRendererMountedWallMedianMs -lt $portableRendererMedianMs
  $recommendedCompression = if ($beatsPortableBaseline) { $recommended.Compression } else { $null }
  $report = [pscustomobject]@{
    MeasuredAtUtc = [DateTime]::UtcNow.ToString('o')
    Host = [Environment]::MachineName
    OS = [Environment]::OSVersion.VersionString
    SampleCount = $sampleCount
    RecommendedCompression = $recommendedCompression
    BeatsPortableBaseline = $beatsPortableBaseline
    PortableRendererMountedWallMedianMs = $portableRendererMedianMs
    SelectionMetric = 'PrepareRendererMountedWallMedianMs'
    Candidates = $candidates
    PortableBaseline = $portable
  }

  $outputPath = [IO.Path]::GetFullPath($Output)
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($outputPath)) -Force |
    Out-Null
  $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outputPath -Encoding utf8
  $report | ConvertTo-Json -Depth 12
}
finally {
  Clear-DisposableRuntime
}
