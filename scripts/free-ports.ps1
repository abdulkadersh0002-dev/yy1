param(
  [string]$Ports = '4101,4173'
)

$portList = @()
foreach ($raw in ($Ports -split ',')) {
  $trimmed = $raw.Trim()
  if (-not $trimmed) { continue }
  $parsed = 0
  if ([int]::TryParse($trimmed, [ref]$parsed)) {
    $portList += $parsed
  }
}

if (-not $portList -or $portList.Count -eq 0) {
  $portList = @(4101, 4173)
}

$ErrorActionPreference = 'SilentlyContinue'
$selfProcessId = $PID

foreach ($p in $portList) {
  $conns = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }
  $processIds = @($conns | ForEach-Object { $_.OwningProcess } | Where-Object { $_ } | Sort-Object -Unique)

  if (-not $processIds -or $processIds.Count -eq 0) {
    Write-Output "Port $p already free"
    continue
  }

  foreach ($procId in $processIds) {
    if ($procId -eq $selfProcessId) {
      Write-Output "Port $p is owned by current PowerShell pid=$procId; skipping self-termination."
      continue
    }

    $proc = Get-Process -Id $procId
    $name = if ($proc) { $proc.ProcessName } else { 'unknown' }
    Write-Output "Stopping port $p pid=$procId name=$name"
    try {
      Stop-Process -Id $procId -Force
    } catch {
      Write-Output "Failed to stop pid=$procId for port ${p}: $($_.Exception.Message)"
    }
    Start-Sleep -Milliseconds 300
  }
}

foreach ($p in $portList) {
  $deadline = (Get-Date).AddSeconds(3)
  $still = $null
  do {
    $still = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue |
      Where-Object { $_.State -eq 'Listen' } |
      Select-Object -First 1

    if (-not ($still -and $still.OwningProcess)) {
      break
    }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)

  if ($still -and $still.OwningProcess) {
    Write-Output "Port $p STILL LISTENING pid=$($still.OwningProcess)"
  } else {
    Write-Output "Port $p FREE"
  }
}
