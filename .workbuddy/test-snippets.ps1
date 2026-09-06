$errs = $null
$snippets = @{}
$snippets['A_pairs'] = '$pairs = @(@(''{'', ''}''), @(''('', '')''), @(''['', '']''))'
$snippets['B_backslash'] = "if (`$c -eq '\') { `$i += 2; continue }"
$snippets['C_charset'] = "`$prev = ' '; if ('(,=:[!&|?;{+-*%<>~^'.IndexOf(`$prev) -ge 0) { 'x' }"
$snippets['D_fmt'] = '[void]$out.AppendLine("  UNBALANCED $($p[0])$($p[1]): open=$open close=$close")'

$log = New-Object System.Collections.Generic.List[string]
foreach ($k in $snippets.Keys) {
  $e2 = $null
  [System.Management.Automation.Language.Parser]::ParseInput($snippets[$k], [ref]$null, [ref]$e2) | Out-Null
  if ($e2 -and $e2.Count) { $log.Add("$k ERROR: " + (($e2 | ForEach-Object { $_.Message }) -join '; ')) } else { $log.Add("$k ok") }
}
$log -join "`n" | Out-File "$env:TEMP\wb_snippets.txt" -Encoding utf8
