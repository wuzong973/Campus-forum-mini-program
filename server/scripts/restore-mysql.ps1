param(
  [Parameter(Mandatory = $true)] [string]$BackupFile,
  [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env'),
  [switch]$ConfirmRestore
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmRestore) { throw 'Restore is destructive. Re-run with -ConfirmRestore after verifying the target database.' }
if (-not (Test-Path -LiteralPath $BackupFile) -or -not (Test-Path -LiteralPath $EnvFile)) { throw 'Backup file or environment file not found.' }

$config = @{}
Get-Content -LiteralPath $EnvFile | ForEach-Object {
  if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*)\s*$') { $config[$matches[1]] = $matches[2] }
}
$mysql = (Get-Command mysql -ErrorAction Stop).Source
$env:MYSQL_PWD = $config['DB_PASSWORD']
try {
  Get-Content -LiteralPath $BackupFile -Raw | & $mysql "--host=$($config['DB_HOST'])" "--port=$($config['DB_PORT'])" "--user=$($config['DB_USER'])" $config['DB_NAME']
  if ($LASTEXITCODE -ne 0) { throw "mysql restore failed with exit code $LASTEXITCODE" }
} finally {
  Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
}
