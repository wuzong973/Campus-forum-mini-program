param([string]$OutFile = "$env:TEMP\waf_result.txt")

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 (0x08002830)'

function Grab([string]$label, [string]$url, [string]$method = 'Get') {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20 -UserAgent $ua -Method $method
    return "$label OK HTTP=$($r.StatusCode) LEN=$($r.RawContentLength) BODY0=$($r.Content.Substring(0, [Math]::Min(120, $r.Content.Length)))"
  } catch {
    $code = ''
    $body = ''
    if ($_.Exception.Response) {
      $code = $_.Exception.Response.StatusCode.value__
      if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $body = $_.ErrorDetails.Message }
      if (-not $body) { try { $body = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {} }
    }
    if (-not $body) { $body = $_.Exception.Message }
    return "$label ERR HTTP=$code BODY=$body"
  }
}

$log = New-Object System.Collections.Generic.List[string]
$log.Add('=== waf probe ' + (Get-Date -Format s) + ' ===')
$log.Add((Grab 'static-html' 'https://payun01.cn/wechat-qr.html'))
$log.Add((Grab 'root' 'https://payun01.cn/'))
$log.Add((Grab 'api-posts' 'https://payun01.cn/api/v1/posts?page=1&pageSize=1'))
$log.Add((Grab 'api-banners' 'https://payun01.cn/api/v1/config/home'))
$log.Add('=== end ===')
$log -join "`r`n" | Out-File -FilePath $OutFile -Encoding utf8
