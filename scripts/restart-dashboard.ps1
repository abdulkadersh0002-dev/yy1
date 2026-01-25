$ErrorActionPreference = 'Stop'

$port = if ($env:DASHBOARD_PORT) { [int]$env:DASHBOARD_PORT } else { 4173 }
$apiPort = if ($env:PORT) { [int]$env:PORT } else { 4101 }
$dashUrl = "http://127.0.0.1:$port/"

function Stop-ListenersOnPort([int]$p) {
  try {
    $listeners = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  } catch {
    $listeners = @()
  }

  if (-not $listeners -or $listeners.Count -eq 0) {
    Write-Host "[restart-dashboard] No listeners on port $p"
    return
  }

  $procIds = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $procIds) {
    if (-not $procId) { continue }
    try {
      $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($proc) {
        Write-Host "[restart-dashboard] Stopping PID $procId ($($proc.ProcessName)) on port $p"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      }
    } catch {
      # best-effort
    }
  }
}

Stop-ListenersOnPort -p $port

Write-Host "[restart-dashboard] Starting dashboard on port $port (detached)..."

# Ensure Vite proxy points at the backend.
$env:VITE_DEV_PROXY_TARGET = "http://127.0.0.1:$apiPort"
$env:VITE_API_BASE_URL = "http://127.0.0.1:$apiPort"

# Start Vite dev server hidden and detached.
$cmd = "npm --prefix clients\neon-dashboard run dev -- --host 127.0.0.1 --port $port"
Start-Process -FilePath "cmd.exe" -ArgumentList @('/d','/s','/c', $cmd) -WorkingDirectory (Resolve-Path "$PSScriptRoot\..") -WindowStyle Hidden

Start-Sleep -Seconds 2

try {
  $r = Invoke-WebRequest -UseBasicParsing $dashUrl -TimeoutSec 5
  Write-Host "[restart-dashboard] dashboard => $($r.StatusCode)"
  if ($r.StatusCode -lt 200 -or $r.StatusCode -ge 400) {
    exit 1
  }
} catch {
  Write-Host "[restart-dashboard] dashboard check failed: $($_.Exception.Message)"
  exit 1
}
