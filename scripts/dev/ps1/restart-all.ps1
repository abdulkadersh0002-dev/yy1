$ErrorActionPreference = 'Stop'

Write-Host "[restart-all] Restarting backend..."
& "$PSScriptRoot\restart-server.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[restart-all] Restarting dashboard..."
& "$PSScriptRoot\restart-dashboard.ps1"
exit $LASTEXITCODE
