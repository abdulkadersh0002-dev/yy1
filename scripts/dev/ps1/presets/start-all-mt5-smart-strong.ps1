param(
  [int]$ApiPort = 4101,
  [int]$DashboardPort = 4173,
  [switch]$FreePorts
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')

if ($FreePorts) {
  & (Join-Path $repoRoot 'scripts' 'free-ports.ps1') -Ports "$ApiPort,$DashboardPort" | Out-Host
}

$backendScript = Join-Path $repoRoot 'scripts' 'start-backend-mt5-smart-strong.ps1'
$dashScript    = Join-Path $repoRoot 'scripts' 'start-dashboard-dev.ps1'

Start-Process -FilePath 'powershell' -ArgumentList @(
  '-NoExit','-ExecutionPolicy','Bypass','-File', $backendScript,
  '-Port', "$ApiPort"
) | Out-Null

Start-Process -FilePath 'powershell' -ArgumentList @(
  '-NoExit','-ExecutionPolicy','Bypass','-File', $dashScript,
  '-ApiPort', "$ApiPort",
  '-Port', "$DashboardPort"
) | Out-Null

Write-Host "Started backend + dashboard." -ForegroundColor Green
Write-Host "Backend:   http://127.0.0.1:$ApiPort" -ForegroundColor Green
Write-Host "Dashboard: http://127.0.0.1:$DashboardPort" -ForegroundColor Green
