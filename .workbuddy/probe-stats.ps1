param([string]$OutFile = "$env:TEMP\stats_result.txt")

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$secret = 'a8f5f167f44f4964e6c998dee827110c3b2e3f9e8e6f5a4d3c2b1a0f9e8d7c6b5a4938271605f4e3d2c1b0a9f8e7d6c5b4a39281706f5e4d3c2b1a0'
$baseUrl = 'https://payun01.cn/api/v1'

function B64Url([byte[]]$bytes) {
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-Jwt([int]$uid, [string]$sec) {
  $header = '{"alg":"HS256","typ":"JWT"}'
  $iat = [int][double]::Parse((Get-Date -UFormat %s))
  $payload = '{"userId":' + $uid + ',"iat":' + $iat + ',"exp":' + ($iat + 604800) + '}'
  $h = B64Url ([Text.Encoding]::UTF8.GetBytes($header))
  $p = B64Url ([Text.Encoding]::UTF8.GetBytes($payload))
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($sec)
  $sig = B64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($h + '.' + $p)))
  $hmac.Dispose()
  return $h + '.' + $p + '.' + $sig
}

$log = New-Object System.Collections.Generic.List[string]
$log.Add('=== probe start ' + (Get-Date -Format s) + ' ===')

foreach ($uid in 1,2,3,4,5) {
  $token = New-Jwt $uid $secret
  try {
    $r = Invoke-WebRequest -Uri "$baseUrl/admin/me" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 20
    $log.Add("uid=$uid /admin/me HTTP=$($r.StatusCode) BODY=$($r.Content)")
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    $body = ''
    try { $body = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch { $body = 'n/a' }
    $log.Add("uid=$uid /admin/me ERR HTTP=$code BODY=$body")
  }
  try {
    $r2 = Invoke-WebRequest -Uri "$baseUrl/admin/stats" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 20
    $log.Add("uid=$uid /admin/stats HTTP=$($r2.StatusCode) BODY=$($r2.Content)")
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    $body = ''
    try { $body = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch { $body = 'n/a' }
    $log.Add("uid=$uid /admin/stats ERR HTTP=$code BODY=$body")
  }
}

$log.Add('=== probe end ===')
$log -join "`r`n" | Out-File -FilePath $OutFile -Encoding utf8
