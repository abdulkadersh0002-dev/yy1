# ==============================================
# Full One-Click Setup for SignalsStrategy-new-app
# ==============================================

# 1️⃣ إعداد المسار لمجلد المشروع
$projectDir = "C:\Users\wesam\Documents\SignalsStrategy-new"
Set-Location $projectDir

# 2️⃣ التأكد من أن البورت 4101 حر
Write-Host "Checking if port 4101 is free..."
$portProcess = Get-NetTCPConnection -LocalPort 4101 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($portProcess) {
    Write-Host "Stopping process PID $($portProcess.OwningProcess) using port 4101..."
    Stop-Process -Id $portProcess.OwningProcess -Force
} else {
    Write-Host "Port 4101 is free."
}

# 3️⃣ تنظيف Docker القديم
Write-Host "Cleaning old Docker containers, images, networks, volumes..."
docker compose down --volumes --remove-orphans
docker system prune -f

# 4️⃣ إنشاء ملف .env مع المفاتيح
$envFile = ".env"
Write-Host "Creating .env file with API keys..."
@"
OPENAI_API_KEY=YOUR_OPENAI_KEY
TWELVE_DATA_API_KEY=YOUR_TWELVE_KEY
ALPHA_VANTAGE_API_KEY=YOUR_ALPHA_VANTAGE_KEY
FINNHUB_API_KEY=YOUR_FINNHUB_KEY
POLYGON_API_KEY=YOUR_POLYGON_KEY
NEWSAPI_KEY=YOUR_NEWSAPI_KEY

FRED_API_KEY=YOUR_FRED_KEY
EXCHANGERATE_API_KEY=YOUR_EXCHANGERATE_KEY
FIXER_API_KEY=YOUR_FIXER_KEY
"@ | Out-File -Encoding UTF8 $envFile
Write-Host ".env created successfully."

# 5️⃣ إعادة بناء وتشغيل Docker Stack
$appService = "signalsstrategy-new-app"
Write-Host "Building and starting Docker stack..."
docker compose up --build -d $appService timescaledb

# 6️⃣ الانتظار لإقلاع الحاويات
Write-Host "Waiting 10 seconds for containers to initialize..."
Start-Sleep -Seconds 10

# 7️⃣ عرض حالة الحاويات
Write-Host "`nDocker container status:"
docker ps | Where-Object { $_ -match "$appService|timescaledb" }

# 8️⃣ عرض آخر 20 سطر من سجلات التطبيق
Write-Host "`nLast 20 lines of $appService logs:"
docker logs --tail 20 $appService

# 9️⃣ روابط التحقق من التطبيق
Write-Host "`nSetup complete. Verify the app via browser or PowerShell:"
Write-Host "http://localhost:4101/api/status"
Write-Host "http://localhost:4101/api/health/heartbeat"
