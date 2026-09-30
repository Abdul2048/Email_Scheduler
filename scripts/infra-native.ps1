<#
  Runs PostgreSQL, Redis and Elasticsearch natively on Windows without Docker or admin rights.
  Binaries and data live outside the repo in $env:INFRA_HOME (default: %USERPROFILE%\dev-infra).

  Usage:  powershell -ExecutionPolicy Bypass -File scripts/infra-native.ps1 start|stop|status
#>
param([ValidateSet('start', 'stop', 'status')][string]$Action = 'status')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$PgVersion = '16.10'
$RedisVersion = '8.10.2'
$EsVersion = '8.19.22'

$InfraHome = if ($env:INFRA_HOME) { $env:INFRA_HOME } else { Join-Path $env:USERPROFILE 'dev-infra' }
$Downloads = Join-Path $InfraHome 'downloads'
$DataDir = Join-Path $InfraHome 'data'
$LogDir = Join-Path $InfraHome 'logs'

$PgHome = Join-Path $InfraHome "pgsql-$PgVersion"
$RedisHome = Join-Path $InfraHome "redis-$RedisVersion"
$EsHome = Join-Path $InfraHome "elasticsearch-$EsVersion"

$PgData = Join-Path $DataDir 'postgres'
$RedisData = Join-Path $DataDir 'redis'
$EsData = Join-Path $DataDir 'elasticsearch'

$PgUser = 'app'
$PgPassword = 'app'
$PgDatabase = 'scheduler'

function Test-Port([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $Port); return $true } catch { return $false } finally { $client.Dispose() }
}

function Wait-Port([int]$Port, [string]$Name, [int]$TimeoutSec = 120) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $Port) { Write-Host "  $Name is up on port $Port"; return }
    Start-Sleep -Seconds 2
  }
  throw "$Name did not start on port $Port within $TimeoutSec s (see $LogDir)"
}

# Starts a long-running server via WMI so it inherits no handles from this script. With Start-Process, the
# server inherits the caller's stdout pipe and any `script | ...` pipeline would wait on it forever.
function Start-Detached([string]$CommandLine, [string]$WorkingDirectory) {
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $CommandLine; CurrentDirectory = $WorkingDirectory; ProcessStartupInformation = $startup
  }
  if ($result.ReturnValue -ne 0) { throw "Failed to start (code $($result.ReturnValue)): $CommandLine" }
}

function Get-Archive([string]$Url, [string]$FileName, [string]$TargetDir) {
  if (Test-Path $TargetDir) { return }
  New-Item -ItemType Directory -Force -Path $Downloads | Out-Null
  $zip = Join-Path $Downloads $FileName
  $done = "$zip.done"
  if (-not (Test-Path $done)) {
    Write-Host "  Downloading $FileName (resumable) ..."
    for ($attempt = 1; $attempt -le 20; $attempt++) {
      # Abort if throughput drops below 10 KB/s for 20 s, then resume from the partial file.
      curl.exe -L --fail -sS -C - --speed-limit 10240 --speed-time 20 -o $zip $Url
      if ($LASTEXITCODE -eq 0) { break }
      Write-Host "    attempt $attempt interrupted (curl exit $LASTEXITCODE), resuming ..."
      Start-Sleep -Seconds 2
    }
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
    New-Item -ItemType File -Path $done | Out-Null
  }
  $tmp = Join-Path $InfraHome "_extract_$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Write-Host "  Extracting $FileName ..."
  tar.exe -xf $zip -C $tmp
  if ($LASTEXITCODE -ne 0) { throw "Extract failed: $zip" }
  $inner = Get-ChildItem $tmp
  $source = if ($inner.Count -eq 1 -and $inner[0].PSIsContainer) { $inner[0].FullName } else { $tmp }
  Move-Item $source $TargetDir
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
}

function Install-All {
  New-Item -ItemType Directory -Force -Path $DataDir, $LogDir, $RedisData, $EsData | Out-Null

  Get-Archive "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-1-windows-x64-binaries.zip" `
    "postgresql-$PgVersion.zip" $PgHome
  Get-Archive "https://github.com/redis-windows/redis-windows/releases/download/$RedisVersion/Redis-$RedisVersion-Windows-x64-msys2.zip" `
    "redis-$RedisVersion.zip" $RedisHome
  Get-Archive "https://artifacts.elastic.co/downloads/elasticsearch/elasticsearch-$EsVersion-windows-x86_64.zip" `
    "elasticsearch-$EsVersion.zip" $EsHome

  if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
    Write-Host '  Initialising Postgres data directory ...'
    $pwFile = Join-Path $InfraHome 'pgpass.tmp'
    Set-Content -Path $pwFile -Value $PgPassword -NoNewline
    & (Join-Path $PgHome 'bin\initdb.exe') -D $PgData -U $PgUser --pwfile=$pwFile -A scram-sha-256 -E UTF8 | Out-Null
    Remove-Item $pwFile
  }

  $esConfig = Join-Path $EsHome 'config\elasticsearch.yml'
  if (-not (Select-String -Path $esConfig -Pattern 'reachinbox-local' -Quiet)) {
    Add-Content -Path $esConfig -Value @"

# reachinbox-local
cluster.name: reachinbox-local
discovery.type: single-node
network.host: 127.0.0.1
http.port: 9200
path.data: $($EsData -replace '\\', '/')
path.logs: $((Join-Path $LogDir 'elasticsearch') -replace '\\', '/')
xpack.security.enabled: false
xpack.ml.enabled: false
cluster.routing.allocation.disk.threshold_enabled: false
"@
    Set-Content -Path (Join-Path $EsHome 'config\jvm.options.d\heap.options') -Value "-Xms512m`n-Xmx512m"
  }
}

function Start-All {
  Install-All

  if (Test-Port 5432) { Write-Host '  Postgres already running' } else {
    Start-Detached "`"$(Join-Path $PgHome 'bin\pg_ctl.exe')`" -D `"$PgData`" -l `"$(Join-Path $LogDir 'postgres.log')`" -o `"-p 5432`" start" $PgHome
    Wait-Port 5432 'Postgres'
  }
  $env:PGPASSWORD = $PgPassword
  $exists = & (Join-Path $PgHome 'bin\psql.exe') -h 127.0.0.1 -U $PgUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$PgDatabase'"
  if ($exists -ne '1') {
    & (Join-Path $PgHome 'bin\createdb.exe') -h 127.0.0.1 -U $PgUser $PgDatabase
    Write-Host "  Created database '$PgDatabase'"
  }

  if (Test-Port 6379) { Write-Host '  Redis already running' } else {
    $redisArgs = '--port 6379 --bind 127.0.0.1 --dir . --appendonly yes --appendfsync everysec --maxmemory-policy noeviction'
    Start-Detached "cmd.exe /c `"`"$(Join-Path $RedisHome 'redis-server.exe')`" $redisArgs > `"$(Join-Path $LogDir 'redis.log')`" 2>&1`"" $RedisData
    Wait-Port 6379 'Redis'
  }

  if (Test-Port 9200) { Write-Host '  Elasticsearch already running' } else {
    # With ES_JAVA_HOME unset, Elasticsearch uses its bundled JDK.
    Start-Detached "cmd.exe /c `"`"$(Join-Path $EsHome 'bin\elasticsearch.bat')`" > `"$(Join-Path $LogDir 'elasticsearch.out.log')`" 2>&1`"" $EsHome
    Wait-Port 9200 'Elasticsearch' 180
  }
}

function Stop-All {
  if (Test-Path (Join-Path $PgData 'postmaster.pid')) {
    & (Join-Path $PgHome 'bin\pg_ctl.exe') -D $PgData -m fast -w stop | Out-Null
    Write-Host '  Postgres stopped'
  }
  if (Test-Port 6379) {
    & (Join-Path $RedisHome 'redis-cli.exe') -p 6379 shutdown
    Write-Host '  Redis stopped'
  }
  $es = Get-CimInstance Win32_Process -Filter "Name='java.exe'" | Where-Object { $_.CommandLine -like "*$EsHome*" }
  foreach ($p in $es) { Stop-Process -Id $p.ProcessId -Force }
  if ($es) { Write-Host '  Elasticsearch stopped' }
}

switch ($Action) {
  'start' { Write-Host "Starting infra from $InfraHome"; Start-All }
  'stop' { Write-Host 'Stopping infra'; Stop-All }
  'status' {
    foreach ($s in @(@('Postgres', 5432), @('Redis', 6379), @('Elasticsearch', 9200))) {
      Write-Host ("  {0,-14} {1}" -f $s[0], $(if (Test-Port $s[1]) { "up (port $($s[1]))" } else { 'down' }))
    }
  }
}
