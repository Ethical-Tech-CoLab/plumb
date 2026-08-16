param([string]$Path, [int]$Snip = 260)
$data = Get-Content $Path -Raw | ConvertFrom-Json
foreach ($q in $data) {
  "### Q: $($q.query)"
  if ($q.answer) { "ANSWER: " + ($q.answer -replace '\s+', ' ') }
  foreach ($r in $q.results) {
    $c = ($r.content -replace '\s+', ' ')
    if ($c.Length -gt $Snip) { $c = $c.Substring(0, $Snip) + "..." }
    "- [$($r.title)]($($r.url))"
    "  $c"
  }
  ""
}
