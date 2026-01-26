param(
  [int]$Port = 4101,
  [switch]$FreePort,
  [ValidateSet('mt5')][string]$Broker = 'mt5'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')
Set-Location $repoRoot

if ($FreePort) {
  & (Join-Path $repoRoot 'scripts' 'free-ports.ps1') -Ports "$Port" | Out-Host
}

# Core runtime
$env:PORT = "$Port"

# EA-only realtime mode (recommended for live trading)
$env:REQUIRE_REALTIME_DATA = 'true'
$env:ALLOW_SYNTHETIC_DATA = 'false'

# Auto-trading autostart
$env:AUTO_TRADING_AUTOSTART = 'true'
$env:AUTO_TRADING_AUTOSTART_BROKER = $Broker

# SMART STRONG preset (still requires ENTER + shouldExecute=true)
# Tune these if you want stricter/looser execution.
$env:EA_SIGNAL_MIN_CONFIDENCE = '45'
$env:EA_SIGNAL_MIN_STRENGTH = '45'
$env:EA_SIGNAL_ALLOW_WAIT_MONITOR = 'true'
$env:EA_SIGNAL_ALLOW_NEAR_STRONG = 'true'

# Safety filter: forex + metals only (default). Override only if you know what you're doing.
$env:AUTO_TRADING_ASSET_CLASSES = 'forex,metals'

Write-Host "Starting backend on http://127.0.0.1:$Port (broker=$Broker)" -ForegroundColor Cyan
npm start
