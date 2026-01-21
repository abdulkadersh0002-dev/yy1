param(
  [int]$ApiPort = 4101,
  [string]$Host = '127.0.0.1',
  [int]$Port = 4173
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$apiBase = "http://127.0.0.1:$ApiPort"
$env:VITE_DEV_PROXY_TARGET = $apiBase
$env:VITE_API_BASE_URL = $apiBase

Write-Host "Starting dashboard on http://$Host:$Port (API=$apiBase)" -ForegroundColor Cyan
npm --prefix clients\neon-dashboard run dev -- --host $Host --port $Port
