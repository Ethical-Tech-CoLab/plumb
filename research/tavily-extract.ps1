param(
  [Parameter(Mandatory = $true)][string[]]$Urls,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$Query = ""
)

$key = $env:TAVILY_API_KEY
if (-not $key) { throw "TAVILY_API_KEY not set" }

$payload = @{ urls = $Urls; extract_depth = "advanced"; format = "markdown" }
if ($Query) { $payload["query"] = $Query }
$body = $payload | ConvertTo-Json -Depth 5

try {
  $r = Invoke-RestMethod -Uri "https://api.tavily.com/extract" -Method Post `
    -Headers @{ "Authorization" = "Bearer $key"; "Content-Type" = "application/json" } `
    -Body $body -TimeoutSec 180
  $out = foreach ($res in $r.results) {
    "===== $($res.url) ====="
    $res.raw_content
    ""
  }
  $out | Out-File -FilePath $OutFile -Encoding utf8
  Write-Host "WROTE $OutFile ($($r.results.Count) ok, $($r.failed_results.Count) failed)"
  foreach ($f in $r.failed_results) { Write-Host "FAILED: $($f.url) :: $($f.error)" }
}
catch {
  Write-Host "ERROR: $($_.Exception.Message)"
  if ($_.ErrorDetails) { $_.ErrorDetails.Message }
}
