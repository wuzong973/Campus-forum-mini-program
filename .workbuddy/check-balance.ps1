param([string]$OutFile = "$env:TEMP\wb_balance.txt")

# Coarse JS structure check: strip strings/templates/comments, then verify pairing.
function Check-Js([string]$path) {
  $lines = [IO.File]::ReadAllLines($path)
  $sb = New-Object System.Text.StringBuilder
  foreach ($line in $lines) { [void]$sb.AppendLine($line) }
  $src = $sb.ToString()

  $out = New-Object System.Text.StringBuilder
  $i = 0; $n = $src.Length; $state = 'code'
  $clean = New-Object System.Text.StringBuilder
  while ($i -lt $n) {
    $c = $src[$i]
    $c2 = ' '
    if ($i + 1 -lt $n) { $c2 = $src[$i + 1] }
    if ($state -eq 'code') {
      if ($c -eq '/' -and $c2 -eq '/') { $state = 'line'; $i += 2; continue }
      if ($c -eq '/' -and $c2 -eq '*') { $state = 'block'; $i += 2; continue }
      if ($c -eq "'") { $state = 'sq'; $i++; [void]$clean.Append(' '); continue }
      if ($c -eq '"') { $state = 'dq'; $i++; [void]$clean.Append(' '); continue }
      if ($c -eq '`') { $state = 'tpl'; $i++; [void]$clean.Append(' '); continue }
      if ($c -eq '/') {
        $prev = ' '
        for ($j = $clean.Length - 1; $j -ge 0; $j--) { $ch = $clean[$j]; if (-not [char]::IsWhiteSpace($ch)) { $prev = $ch; break } }
        if ('(,=:[!&|?;{+-*%<>~^'.IndexOf($prev) -ge 0) { $state = 'regex'; $i++; [void]$clean.Append(' '); continue }
      }
      [void]$clean.Append($c); $i++
    } elseif ($state -eq 'line') {
      if ($c -eq "`n") { $state = 'code'; [void]$clean.Append("`n") }
      $i++
    } elseif ($state -eq 'block') {
      if ($c -eq '*' -and $c2 -eq '/') { $state = 'code'; $i += 2; [void]$clean.Append('  '); continue }
      if ($c -eq "`n") { [void]$clean.Append("`n") }
      $i++
    } elseif ($state -eq 'sq') {
      if ($c -eq '\') { $i += 2; continue }
      if ($c -eq "'") { $state = 'code' }
      if ($c -eq "`n") { $state = 'code' }
      $i++
    } elseif ($state -eq 'dq') {
      if ($c -eq '\') { $i += 2; continue }
      if ($c -eq '"') { $state = 'code' }
      if ($c -eq "`n") { $state = 'code' }
      $i++
    } elseif ($state -eq 'tpl') {
      if ($c -eq '\') { $i += 2; continue }
      if ($c -eq '`') { $state = 'code' }
      $i++
    } elseif ($state -eq 'regex') {
      if ($c -eq '\') { $i += 2; continue }
      if ($c -eq '/') { $state = 'code' }
      if ($c -eq "`n") { $state = 'code' }
      $i++
    }
  }
  $text = $clean.ToString()
  $pairs = @(@('{', '}'), @('(', ')'), @('[', ']'))
  $ok = $true
  foreach ($p in $pairs) {
    $open = ($text.ToCharArray() | Where-Object { $_ -eq $p[0] }).Count
    $close = ($text.ToCharArray() | Where-Object { $_ -eq $p[1] }).Count
    if ($open -ne $close) { $ok = $false; [void]$out.AppendLine(("  UNBALANCED {0}{1}: open={2} close={3}" -f $p[0], $p[1], $open, $close)) }
  }
  if ($state -ne 'code') { $ok = $false; [void]$out.AppendLine(("  UNTERMINATED state={0}" -f $state)) }
  if ($ok) { [void]$out.AppendLine('  BALANCED OK') }
  return $out.ToString()
}

$log = New-Object System.Collections.Generic.List[string]
$base = 'D:\{0}' -f [char]0x6821 + [char]0x56ED + [char]0x8BBA + [char]0x575B + [char]0x5C0F + [char]0x7A0B + [char]0x5E8F
$files = @(
  (Join-Path $base 'server\controllers\adminController.js'),
  (Join-Path $base 'server\routes\adminRoutes.js'),
  (Join-Path $base 'utils\admin.js'),
  (Join-Path $base 'pages\admin\index.js')
)
foreach ($f in $files) {
  $log.Add("FILE: $f")
  if (Test-Path -LiteralPath $f) { $log.Add((Check-Js $f)) } else { $log.Add('  MISSING!') }
}
$log -join "`r`n" | Out-File -FilePath $OutFile -Encoding utf8
