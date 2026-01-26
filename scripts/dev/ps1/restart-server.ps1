$ErrorActionPreference = 'Stop'

$port = if ($env:PORT) { [int]$env:PORT } else { 4101 }
$healthUrl = "http://127.0.0.1:$port/api/healthz"

function Stop-ListenersOnPort([int]$p) {
  try {
    $listeners = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  } catch {
    $listeners = @()
  }

  if (-not $listeners -or $listeners.Count -eq 0) {
    Write-Host "[restart-server] No listeners on port $p"
    return
  }

  $procIds = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $procIds) {
    if (-not $procId) { continue }
    try {
      $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($proc) {
        Write-Host "[restart-server] Stopping PID $procId ($($proc.ProcessName)) on port $p"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      }
    } catch {
      # best-effort
    }
  }
}

Stop-ListenersOnPort -p $port

Write-Host "[restart-server] Starting backend on port $port (detached)..."
Start-Process -FilePath "node" -ArgumentList "scripts/dev/start-backend.mjs" -WorkingDirectory "$PSScriptRoot\..\..\.." -WindowStyle Hidden

Start-Sleep -Seconds 2

try {
  $status = (Invoke-WebRequest -UseBasicParsing $healthUrl -TimeoutSec 5).StatusCode
  Write-Host "[restart-server] healthz => $status"
  if ($status -ne 200 -and $status -ne 503) {
    exit 1
  }
} catch {
  Write-Host "[restart-server] healthz check failed: $($_.Exception.Message)"
  exit 1
}
