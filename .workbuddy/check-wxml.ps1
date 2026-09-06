param([string]$Path, [string]$OutFile = "$env:TEMP\wb_wxml.txt")

$text = [IO.File]::ReadAllText($Path)
# Blank out {{ ... }} expressions first: they may contain '>' which breaks tag matching.
$text = [regex]::Replace($text, '\{\{.*?\}\}', 'X')
$tags = [regex]::Matches($text, '<(/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(/?)>')
$stack = New-Object System.Collections.Generic.List[string]
$errors = New-Object System.Collections.Generic.List[string]
$voidOk = @('input', 'image', 'import', 'include', 'wxs')
foreach ($m in $tags) {
  $closing = $m.Groups[1].Value -eq '/'
  $name = $m.Groups[2].Value
  $selfClose = $m.Groups[4].Value -eq '/'
  if ($closing) {
    if ($stack.Count -gt 0 -and $stack[$stack.Count - 1] -eq $name) { $stack.RemoveAt($stack.Count - 1) }
    else { $errors.Add(("mismatched closing </{0}> at index {1}" -f $name, $m.Index)) }
  } else {
    if (-not $selfClose) { $stack.Add($name) }
  }
}
$log = New-Object System.Collections.Generic.List[string]
$log.Add(("FILE: {0}" -f $Path))
if ($stack.Count -gt 0) { $log.Add(("UNCLOSED: {0}" -f (($stack | Select-Object -Unique) -join ', ')) ) }
if ($errors.Count -gt 0) { foreach ($e in $errors) { $log.Add($e) } }
if ($stack.Count -eq 0 -and $errors.Count -eq 0) { $log.Add('TAGS BALANCED OK') }
$log -join "`r`n" | Out-File -FilePath $OutFile -Encoding utf8
