<#
.SYNOPSIS
  Start everything needed to test the phone file bridge with a real phone.

  1. Camofox in Docker (VNC + phone bridge), reachable from your phone at http://<PhoneIp>:9377
  2. dashboard-server.js  (form agent backend, port 3001)  - new terminal window
  3. Next.js dashboard    (http://localhost:3000)         - new terminal window
  4. Camofox container logs                               - new terminal window

  Anything already listening on 3000/3001 and any container publishing 9377 is
  stopped first (containers are stopped, not deleted).

.EXAMPLE
  .\scripts\test-phone-bridge.ps1                         # auto-detect Wi-Fi IP
  .\scripts\test-phone-bridge.ps1 -PhoneIp 192.168.0.104  # IP your phone should use
  .\scripts\test-phone-bridge.ps1 -Rebuild                # rebuild the image after code changes
#>
param(
  [string]$PhoneIp = '',
  [switch]$Rebuild,
  [string]$Image = 'camofox-browser:phone-bridge',
  [string]$Container = 'camofox-phone-test'
)

$root = Split-Path -Parent $PSScriptRoot
$dash = Join-Path $root 'camofox-dashboard'

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# --- 1. Address the phone will use ------------------------------------------
if (-not $PhoneIp) {
  $PhoneIp = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi' -ErrorAction SilentlyContinue |
    Select-Object -First 1).IPAddress
}
if (-not $PhoneIp) { Write-Error 'Could not detect your Wi-Fi IP. Run again with -PhoneIp <your PC IP>.'; exit 1 }
$publicUrl = "http://${PhoneIp}:9377"

# --- 2. Secrets --------------------------------------------------------------
# VNC password: reuse the one the dashboard already uses (.env.local).
$vncPassword = ''
$envFile = Join-Path $dash '.env.local'
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^NEXT_PUBLIC_VNC_PASSWORD=' } | Select-Object -First 1
  if ($line) { $vncPassword = ($line -split '=', 2)[1].Trim().Trim('"') }
}
# API key shared by Camofox, the agent backend and the dashboard proxy (fresh each run).
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$apiKey = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')

# --- 3. Image ----------------------------------------------------------------
if ($Rebuild -or -not (docker images -q $Image)) {
  Step "Building $Image (first build takes several minutes)"
  docker build --target camofox-browser -t $Image $root
  if ($LASTEXITCODE -ne 0) { Write-Error 'docker build failed'; exit 1 }
}

# --- 4. Free the ports ---------------------------------------------------------
Step 'Freeing ports 9377 / 3000 / 3001'
foreach ($id in (docker ps -q --filter 'publish=9377')) {
  $name = docker inspect --format '{{.Name}}' $id
  Write-Host "  stopping container $name (bring it back later with: docker start $($name.TrimStart('/')))"
  docker stop $id | Out-Null
}
if (docker ps -aq --filter "name=^$Container$") { docker rm -f $Container | Out-Null }
foreach ($port in 3000, 3001) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
    Write-Host "  stopping pid $($_.OwningProcess) on port $port : $($p.CommandLine)"
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

# --- 5. Camofox container ------------------------------------------------------
Step "Starting Camofox container '$Container'"
$runArgs = @(
  'run', '-d', '--name', $Container,
  '-p', '9377:9377', '-p', '127.0.0.1:6080:6080',
  '-e', 'ENABLE_VNC=1', '-e', 'VNC_BIND=0.0.0.0',
  '-e', "CAMOFOX_API_KEY=$apiKey",
  '-e', "PHONE_BRIDGE_PUBLIC_URL=$publicUrl"
)
if ($vncPassword) { $runArgs += @('-e', "VNC_PASSWORD=$vncPassword") }
$runArgs += @($Image, 'sh', '-c', 'node --max-old-space-size=${MAX_OLD_SPACE_SIZE:-256} server.js')
docker @runArgs | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error 'docker run failed'; exit 1 }

$healthy = $false
for ($i = 0; $i -lt 60 -and -not $healthy; $i++) {
  try { Invoke-RestMethod 'http://localhost:9377/health' -TimeoutSec 2 | Out-Null; $healthy = $true }
  catch { Start-Sleep -Seconds 2 }
}
if (-not $healthy) { Write-Error "Camofox did not become healthy. Check: docker logs $Container"; exit 1 }
Write-Host '  Camofox is up.'

try {
  Invoke-WebRequest "$publicUrl/phone-bridge/m" -UseBasicParsing -TimeoutSec 5 | Out-Null
  Write-Host "  Phone page reachable at $publicUrl/phone-bridge/m"
} catch {
  Write-Warning "Phone page not reachable at $publicUrl - is $PhoneIp this PC's address?"
}

# --- 6. Terminal windows -------------------------------------------------------
function Start-Window($title, $dir, $vars, $command) {
  $sets = ($vars.GetEnumerator() | ForEach-Object { "`$env:$($_.Key)='$($_.Value)'" }) -join '; '
  $script = "`$Host.UI.RawUI.WindowTitle='$title'; Set-Location '$dir'; $sets; $command"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $script | Out-Null
}

Step 'Opening terminal windows'
Start-Window 'Camofox (docker logs)' $root @{} "docker logs -f --tail 20 $Container"
Start-Window 'Agent backend :3001' $root @{
  CAMOFOX_API_PORT = '9377'
  CAMOFOX_API_KEY  = $apiKey
  DASHBOARD_PORT   = '3001'
} 'node dashboard-server.js'
Start-Window 'Dashboard :3000' $dash @{
  CAMOFOX_INTERNAL_URL    = 'http://localhost:9377'
  CAMOFOX_API_KEY         = $apiKey
  NEXT_PUBLIC_CAMOFOX_URL = 'http://localhost:9377'
} 'npm run dev'

for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest 'http://localhost:3000' -UseBasicParsing -TimeoutSec 3 | Out-Null; break }
  catch { Start-Sleep -Seconds 2 }
}
Start-Process 'http://localhost:3000'

$profileName = (Get-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -ErrorAction SilentlyContinue).NetworkCategory
Write-Host ''
Write-Host 'Ready.' -ForegroundColor Green
Write-Host "  Dashboard:        http://localhost:3000"
Write-Host "  Phone connects to $publicUrl  (phone must be on the same Wi-Fi)"
Write-Host "  Phone check:      open $publicUrl/health on your phone - it should show JSON"
if ($profileName -eq 'Public') {
  Write-Warning 'Your Wi-Fi is a Public network: Windows Firewall may block the phone. Switch it to Private in Settings > Network.'
}
Write-Host "  Stop everything:  docker stop $Container  (and close the two windows)"
