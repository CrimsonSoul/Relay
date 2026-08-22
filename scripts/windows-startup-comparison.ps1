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

function Get-MedianAbsoluteDeviation {
  param([Parameter(Mandatory = $true)][double[]]$Values)

  $sampleMedian = Get-Median -Values $Values
  $deviations = @($Values | ForEach-Object { [Math]::Abs($_ - $sampleMedian) })
  return Get-Median -Values $deviations
}

function Get-RandomizedCandidateOrder {
  param([Parameter(Mandatory = $true)][object[]]$Candidates)

  return @($Candidates | Sort-Object { Get-Random })
}

function Invoke-MeasurementSample {
  param([Parameter(Mandatory = $true)][object]$Candidate)

  Clear-DisposableRuntime
  if ($Candidate.Kind -eq 'portable') {
    return Invoke-NodeBenchmark -Arguments @(
      'scripts/benchmark-startup.mjs',
      '--scenario', 'portable',
      '--artifact', $Candidate.Artifact,
      '--compression', $Candidate.Compression
    )
  }
  return Invoke-NodeBenchmark -Arguments @(
    'scripts/benchmark-startup.mjs',
    '--scenario', 'prepare',
    '--artifact', $Candidate.Artifact,
    '--compression', $Candidate.Compression
  )
}

function Complete-CandidateMeasurement {
  param([Parameter(Mandatory = $true)][object]$Candidate)

  # Install the candidate immediately before its stable-launch samples so the
  # stable path cannot accidentally measure whichever randomized candidate ran last.
  $null = Invoke-MeasurementSample -Candidate $Candidate
  $stable = Invoke-NodeBenchmark -Arguments @(
    'scripts/benchmark-startup.mjs',
    '--scenario', 'stable',
    '--launcher', $stableLauncher,
    '--compression', $Candidate.Compression,
    '--runs', "$sampleCount"
  )
  if ($stable.runtimeReused -ne $true) {
    throw "$($Candidate.Compression) stable-launch benchmark did not reuse its runtime."
  }

  $handoff = @($Candidate.PrepareSamples | ForEach-Object { [double]$_.processHandoffMs })
  $renderer = @($Candidate.PrepareSamples | ForEach-Object { [double]$_.rendererMountedWallMs })
  $beforeElectron = @($Candidate.PrepareSamples | ForEach-Object { [double]$_.beforeElectronEntryMs })
  return [pscustomobject]@{
    Compression = $Candidate.Compression
    Artifact = $Candidate.Artifact
    ArtifactSizeBytes = (Get-Item -LiteralPath $Candidate.Artifact).Length
    PrepareSamples = @($Candidate.PrepareSamples)
    PrepareProcessHandoffMedianMs = Get-Median -Values $handoff
    PrepareRendererMountedWallMedianMs = Get-Median -Values $renderer
    PrepareRendererMountedWallMadMs = Get-MedianAbsoluteDeviation -Values $renderer
    PrepareBeforeElectronMedianMs = Get-Median -Values $beforeElectron
    Stable = $stable
  }
}

function Complete-PortableMeasurement {
  param([Parameter(Mandatory = $true)][object]$Candidate)

  $samples = @($Candidate.PrepareSamples)
  return [pscustomobject]@{
    scenario = 'portable'
    compression = $Candidate.Compression
    runs = $samples.Count
    runtimeReused = $null
    packagedMedian = [pscustomobject]@{
      processHandoffMs = Get-Median -Values @($samples.processHandoffMs)
      processExitMs = Get-Median -Values @($samples.processExitMs)
      rendererMountedWallMs = Get-Median -Values @($samples.rendererMountedWallMs)
      beforeElectronEntryMs = Get-Median -Values @($samples.beforeElectronEntryMs)
      electronRendererMountedMs = Get-Median -Values @(
        $samples | ForEach-Object { [double]$_.timeline.'renderer-mounted' }
      )
    }
    samples = $samples
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

  $candidateDefinitions = @(
    [pscustomobject]@{
      Kind = 'persistent'
      Compression = 'store'
      Artifact = (Resolve-Path -LiteralPath $StoreArtifact).Path
      PrepareSamples = [Collections.Generic.List[object]]::new()
    }
    [pscustomobject]@{
      Kind = 'persistent'
      Compression = 'normal'
      Artifact = (Resolve-Path -LiteralPath $NormalArtifact).Path
      PrepareSamples = [Collections.Generic.List[object]]::new()
    }
    [pscustomobject]@{
      Kind = 'persistent'
      Compression = 'maximum'
      Artifact = (Resolve-Path -LiteralPath $MaximumArtifact).Path
      PrepareSamples = [Collections.Generic.List[object]]::new()
    }
  )
  $portableDefinition = [pscustomobject]@{
    Kind = 'portable'
    Compression = 'former-maximum-portable'
    Artifact = $portablePath
    PrepareSamples = [Collections.Generic.List[object]]::new()
  }
  $measurementDefinitions = @($candidateDefinitions) + @($portableDefinition)
  $measurementOrder = [Collections.Generic.List[string]]::new()
  for ($round = 1; $round -le $sampleCount; $round += 1) {
    foreach ($candidate in (Get-RandomizedCandidateOrder -Candidates $measurementDefinitions)) {
      $measurementOrder.Add("$round`:$($candidate.Compression)") | Out-Null
      $candidate.PrepareSamples.Add((Invoke-MeasurementSample -Candidate $candidate)) | Out-Null
    }
  }
  $candidates = @(
    $candidateDefinitions | ForEach-Object { Complete-CandidateMeasurement -Candidate $_ }
  )
  $portable = Complete-PortableMeasurement -Candidate $portableDefinition

  $ranked = @($candidates |
    Sort-Object -Property PrepareRendererMountedWallMedianMs |
    Select-Object -First 2)
  $best = $ranked[0]
  $runnerUp = $ranked[1]
  $portableRendererSamples = @(
    $portable.samples | ForEach-Object { [double]$_.rendererMountedWallMs }
  )
  $portableRendererMedianMs = Get-Median -Values $portableRendererSamples
  $portableRendererMadMs = Get-MedianAbsoluteDeviation -Values $portableRendererSamples
  $minimumMeaningfulDifferenceMs = [Math]::Max(
    100,
    [Math]::Round([double]$best.PrepareRendererMountedWallMedianMs * 0.05)
  )
  $winnerLeadMs =
    [double]$runnerUp.PrepareRendererMountedWallMedianMs -
    [double]$best.PrepareRendererMountedWallMedianMs
  $portableLeadMs =
    [double]$portableRendererMedianMs -
    [double]$best.PrepareRendererMountedWallMedianMs
  $portableVarianceLimitMs = [Math]::Max(
    100,
    [Math]::Round([double]$portableRendererMedianMs * 0.10)
  )
  $noisyCandidates = @(
    $candidates | Where-Object {
      $candidateVarianceLimitMs = [Math]::Max(
        100,
        [Math]::Round([double]$_.PrepareRendererMountedWallMedianMs * 0.10)
      )
      [double]$_.PrepareRendererMountedWallMadMs -gt $candidateVarianceLimitMs
    }
  )
  $allCandidateVarianceAcceptable = $noisyCandidates.Count -eq 0
  $varianceAcceptable =
    $allCandidateVarianceAcceptable -and
    [double]$portableRendererMadMs -le $portableVarianceLimitMs
  $meaningfulWinner = $winnerLeadMs -ge $minimumMeaningfulDifferenceMs
  $beatsPortableBaseline = $portableLeadMs -ge $minimumMeaningfulDifferenceMs
  $selectionConfidence = if (-not $varianceAcceptable) {
    'insufficient-variance'
  }
  elseif (-not $meaningfulWinner) {
    'statistical-tie'
  }
  elseif (-not $beatsPortableBaseline) {
    'portable-not-meaningfully-beaten'
  }
  else {
    'meaningful-winner'
  }
  $recommendedCompression = if ($selectionConfidence -eq 'meaningful-winner') {
    $best.Compression
  }
  else {
    $null
  }
  $report = [pscustomobject]@{
    MeasuredAtUtc = [DateTime]::UtcNow.ToString('o')
    Host = [Environment]::MachineName
    OS = [Environment]::OSVersion.VersionString
    SampleCount = $sampleCount
    RecommendedCompression = $recommendedCompression
    BeatsPortableBaseline = $beatsPortableBaseline
    SelectionConfidence = $selectionConfidence
    MinimumMeaningfulDifferenceMs = $minimumMeaningfulDifferenceMs
    WinnerLeadMs = $winnerLeadMs
    PortableLeadMs = $portableLeadMs
    VarianceAcceptable = $varianceAcceptable
    AllCandidateVarianceAcceptable = $allCandidateVarianceAcceptable
    PortableRendererMountedWallMedianMs = $portableRendererMedianMs
    PortableRendererMountedWallMadMs = $portableRendererMadMs
    SelectionMetric = 'PrepareRendererMountedWallMedianMs'
    MeasurementOrder = @($measurementOrder)
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
