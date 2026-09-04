param(
  [ValidateSet('full', 'incremental')]
  [string]$Mode = 'full',
  [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env'),
  [string]$BackupDir = (Join-Path $PSScriptRoot '..\backups'),
  [int]$RetentionDays = 14,
  [string]$BinlogStart = ''
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Environment file not found: $EnvFile" }

$config = @{}
Get-Content -LiteralPath $EnvFile | ForEach-Object {
  if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*)\s*$') { $config[$matches[1]] = $matches[2] }
}

$required = 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME'
foreach ($key in $required) { if (-not $config[$key]) { throw "Missing $key in $EnvFile" } }
$dump = (Get-Command mysqldump -ErrorAction Stop).Source
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $BackupDir $Mode
New-Item -ItemType Directory -Force -Path $target | Out-Null

$env:MYSQL_PWD = $config['DB_PASSWORD']
try {
  if ($Mode -eq 'full') {
    $file = Join-Path $target ("$($config['DB_NAME'])-$stamp.sql")
    & $dump '--single-transaction' '--routines' '--events' '--triggers' '--set-gtid-purged=OFF' '--master-data=2' "--host=$($config['DB_HOST'])" "--port=$($config['DB_PORT'])" "--user=$($config['DB_USER'])" $config['DB_NAME'] | Out-File -LiteralPath $file -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "mysqldump failed with exit code $LASTEXITCODE" }
  } else {
    if (-not $BinlogStart) { throw 'Incremental backup requires -BinlogStart, for example mysql-bin.000001:4' }
    $parts = $BinlogStart.Split(':', 2)
    if ($parts.Count -ne 2) { throw 'BinlogStart format must be mysql-bin.000001:position' }
    $binlog = (Get-Command mysqlbinlog -ErrorAction Stop).Source
    $file = Join-Path $target ("$($config['DB_NAME'])-$stamp-binlog.sql")
    & $binlog '--read-from-remote-server' "--host=$($config['DB_HOST'])" "--port=$($config['DB_PORT'])" "--user=$($config['DB_USER'])" "--start-position=$($parts[1])" $parts[0] | Out-File -LiteralPath $file -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "mysqlbinlog failed with exit code $LASTEXITCODE" }
  }
} finally {
  Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
}

Get-ChildItem -LiteralPath $target -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } | Remove-Item -Force
