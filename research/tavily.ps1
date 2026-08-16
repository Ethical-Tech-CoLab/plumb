param(
  [Parameter(Mandatory = $true)][string]$QueryFile,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [int]$MaxResults = 8,
  [string]$Depth = "advanced"
)

$key = $env:TAVILY_API_KEY
if (-not $key) { throw "TAVILY_API_KEY not set" }

$queries = Get-Content $QueryFile | Where-Object { $_.Trim() -ne "" }
$all = @()

foreach ($q in $queries) {
  $body = @{
    query          = $q
    max_results    = $MaxResults
    search_depth   = $Depth
    include_answer = $true
  } | ConvertTo-Json -Depth 5

  try {
    $r = Invoke-RestMethod -Uri "https://api.tavily.com/search" -Method Post `
      -Headers @{ "Authorization" = "Bearer $key"; "Content-Type" = "application/json" } `
      -Body $body -TimeoutSec 120
    $all += [pscustomobject]@{ query = $q; answer = $r.answer; results = $r.results }
    Write-Host "OK   [$($r.results.Count)] $q"
  }
  catch {
    Write-Host "FAIL $q :: $($_.Exception.Message)"
    $all += [pscustomobject]@{ query = $q; error = $_.Exception.Message; results = @() }
  }
  Start-Sleep -Milliseconds 400
}

$all | ConvertTo-Json -Depth 8 | Out-File -FilePath $OutFile -Encoding utf8
Write-Host "WROTE $OutFile"
