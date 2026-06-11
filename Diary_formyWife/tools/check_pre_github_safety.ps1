$ErrorActionPreference = "Continue"

$OuterRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Index = Join-Path $OuterRoot "index.html"
$Worker = Join-Path $OuterRoot "worker\src\index.js"
$Wrangler = Join-Path $OuterRoot "worker\wrangler.toml"
$Failures = 0

function Test-SafetyItem {
  param(
    [string]$Label,
    [bool]$Condition
  )
  if ($Condition) {
    Write-Host "[OK] $Label" -ForegroundColor Green
  } else {
    Write-Host "[FAIL] $Label" -ForegroundColor Red
    $script:Failures++
  }
}

$Html = if (Test-Path $Index) { Get-Content -Raw -Encoding UTF8 -Path $Index } else { "" }
$WorkerText = if (Test-Path $Worker) { Get-Content -Raw -Encoding UTF8 -Path $Worker } else { "" }
$WranglerText = if (Test-Path $Wrangler) { Get-Content -Raw -Encoding UTF8 -Path $Wrangler } else { "" }

Test-SafetyItem "index.html exists" (Test-Path $Index)
Test-SafetyItem "worker source exists" (Test-Path $Worker)
Test-SafetyItem "wrangler config exists" (Test-Path $Wrangler)

Test-SafetyItem "GitHub token name is not present in frontend" ($Html -notmatch "GITHUB_TOKEN")
Test-SafetyItem "GitHub bearer header is only in Worker" ($Html -notmatch "api.github.com|repos/.*/contents|X-GitHub-Api-Version")
Test-SafetyItem "WRITE_TOKEN is not persisted in localStorage settings" ($Html -notmatch '(?s)writeJsonStorage\(WRITER_SETTINGS_KEY,\s*\{[^}]*writeToken')
Test-SafetyItem "WRITE_TOKEN uses sessionStorage in frontend" ($Html -match "sessionStorage\.setItem\(WRITER_TOKEN_SESSION_KEY")
Test-SafetyItem "Worker reads GitHub token from env only" ($WorkerText -match "env\.GITHUB_TOKEN" -and $WorkerText -notmatch 'GITHUB_TOKEN\s*=')
Test-SafetyItem "Wrangler still has placeholder owner before final GitHub setup" ($WranglerText -match 'GITHUB_OWNER = "YOUR_GITHUB_OWNER"')
Test-SafetyItem "Wrangler still has placeholder repo before final GitHub setup" ($WranglerText -match 'GITHUB_REPO = "YOUR_REPOSITORY_NAME"')
Test-SafetyItem "Wrangler documents secrets without values" ($WranglerText -match "wrangler secret put GITHUB_TOKEN" -and $WranglerText -match "wrangler secret put WRITE_TOKEN")

if ($Failures -eq 0) {
  Write-Host ""
  Write-Host "Pre-GitHub safety check passed. Real GitHub owner/repo/secrets have not been wired yet." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "Pre-GitHub safety check failed: $Failures" -ForegroundColor Red
  exit 1
}
