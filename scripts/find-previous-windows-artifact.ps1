param(
  [Parameter(Mandatory = $true)]
  [string]$Workflow,
  [Parameter(Mandatory = $true)]
  [string]$Branch,
  [Parameter(Mandatory = $true)]
  [string]$CurrentSha,
  [Parameter(Mandatory = $true)]
  [string]$Destination
)

$ErrorActionPreference = 'Stop'
# PowerShell 7.4 turns a non-zero native exit code into a terminating error while
# $ErrorActionPreference is 'Stop'. Every gh invocation below is checked through
# $LASTEXITCODE so that a missing baseline falls back instead of failing the job.
$PSNativeCommandUseErrorActionPreference = $false

if ($CurrentSha -notmatch '^[0-9a-f]{40}$') {
  throw 'CurrentSha must be a full lowercase Git commit ID.'
}
if ($env:GITHUB_REPOSITORY -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
  throw 'GITHUB_REPOSITORY is missing or invalid.'
}
if ([string]::IsNullOrWhiteSpace($env:GITHUB_OUTPUT)) {
  throw 'GITHUB_OUTPUT is required.'
}

$baselineBranch = if ($Branch -eq 'main') { $Branch } else { 'main' }
$destinationPath = [IO.Path]::GetFullPath($Destination)
$downloadRoot = Join-Path $env:RUNNER_TEMP 'relay-previous-artifact'

function Write-StepOutput {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value
  )
  Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "$Name=$Value"
}

function Write-FallbackOutputs {
  Write-StepOutput -Name 'found' -Value 'false'
  Write-StepOutput -Name 'build_id' -Value "r0-$CurrentSha"
  Write-StepOutput -Name 'source_run_id' -Value ''
}

$escapedBranch = [Uri]::EscapeDataString($baselineBranch)
$runsUri = "repos/$env:GITHUB_REPOSITORY/actions/workflows/$Workflow/runs?branch=$escapedBranch&status=success&per_page=20"
$runsJson = & gh api $runsUri
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Could not list prior successful $Workflow runs; using a lightweight fallback."
  Write-FallbackOutputs
  exit 0
}
$runs = $runsJson | ConvertFrom-Json

foreach ($run in @($runs.workflow_runs)) {
  $headSha = [string]$run.head_sha
  if ($headSha -eq $CurrentSha -or $headSha -notmatch '^[0-9a-f]{40}$') {
    continue
  }

  $artifactsJson = & gh api "repos/$env:GITHUB_REPOSITORY/actions/runs/$($run.id)/artifacts?per_page=100"
  if ($LASTEXITCODE -ne 0) {
    continue
  }
  $artifacts = $artifactsJson | ConvertFrom-Json
  $artifact = @($artifacts.artifacts) |
    Where-Object { $_.name -eq 'relay-windows' -and -not $_.expired } |
    Select-Object -First 1
  if ($null -eq $artifact) {
    continue
  }

  Remove-Item -LiteralPath $downloadRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
  & gh run download "$($run.id)" `
    --repo $env:GITHUB_REPOSITORY `
    --name relay-windows `
    --dir $downloadRoot
  if ($LASTEXITCODE -ne 0) {
    continue
  }

  $downloadedArtifact = Get-ChildItem -LiteralPath $downloadRoot -Filter Relay.exe -File -Recurse |
    Select-Object -First 1
  if ($null -eq $downloadedArtifact) {
    continue
  }

  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destinationPath)) -Force |
    Out-Null
  Copy-Item -LiteralPath $downloadedArtifact.FullName -Destination $destinationPath -Force
  Write-StepOutput -Name 'found' -Value 'true'
  Write-StepOutput -Name 'build_id' -Value "r1-$headSha"
  Write-StepOutput -Name 'source_run_id' -Value ([string]$run.id)
  Write-Host "Using relay-windows from successful run $($run.id) at $headSha."
  exit 0
}

Write-Warning "No usable prior relay-windows artifact was found; using a lightweight fallback."
Write-FallbackOutputs
# The pwsh step wrapper exits with $LASTEXITCODE, which still holds the status of
# the last gh call that this script deliberately tolerated.
exit 0
