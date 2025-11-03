# Starts the AI Trading Signals server and opens the dashboard in your default browser
# 1) Frees ports 4101 (HTTP) and 8765 (WebSocket) if something is stuck
# 2) Starts the Node server
# 3) Opens http://localhost:4101

$ErrorActionPreference = 'SilentlyContinue'

# Kill any process listening on ports 4101, 8765
$ports = @(4101, 8765)
foreach ($p in $ports) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
      $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($pid in $pids) {
        try { Stop-Process -Id $pid -Force } catch {}
      }
    }
  } catch {}
}

# Start server
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Starting server from $here ..."
Start-Process -FilePath "node" -ArgumentList "simple-server.cjs" -WorkingDirectory $here
Start-Sleep -Seconds 2

# Open browser
try {
  Start-Process "http://localhost:4101/"
} catch {
  Write-Host "Open your browser to http://localhost:4101/"
}
