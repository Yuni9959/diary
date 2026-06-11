$ErrorActionPreference = "Continue"

$OuterRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Worker = Join-Path $OuterRoot "worker\src\index.js"
$Wrangler = Join-Path $OuterRoot "worker\wrangler.toml"
$Failures = 0

function Test-Phase2Item {
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

Test-Phase2Item "worker/src/index.js exists" (Test-Path $Worker)
Test-Phase2Item "worker/wrangler.toml exists" (Test-Path $Wrangler)

$WorkerText = if (Test-Path $Worker) { Get-Content -Raw -Encoding UTF8 -Path $Worker } else { "" }
$WranglerText = if (Test-Path $Wrangler) { Get-Content -Raw -Encoding UTF8 -Path $Wrangler } else { "" }

Test-Phase2Item "POST /api/diary route exists" ($WorkerText -match "/api/diary")
Test-Phase2Item "WRITE_TOKEN check exists" ($WorkerText -match "WRITE_TOKEN")
Test-Phase2Item "GITHUB_TOKEN is server-side only" ($WorkerText -match "GITHUB_TOKEN")
Test-Phase2Item "GitHub contents API is used" ($WorkerText -match "/contents/")
Test-Phase2Item "Base64 content encoding exists" ($WorkerText -match "base64Utf8")
Test-Phase2Item "nested inbox/new target path exists" ($WorkerText -match "Diary_formyWife/inbox/new/")
Test-Phase2Item "date validation exists" ($WorkerText -match "isRealDate")
Test-Phase2Item "body length limit exists" ($WorkerText -match "MAX_BODY_LENGTH")
Test-Phase2Item "CORS origin restriction exists" ($WorkerText -match "ALLOWED_ORIGINS")
Test-Phase2Item "GitHub token is not in frontend" ((Get-Content -Raw -Encoding UTF8 -Path (Join-Path $OuterRoot "index.html")) -notmatch "GITHUB_TOKEN")
Test-Phase2Item "wrangler has GitHub owner var" ($WranglerText -match "GITHUB_OWNER")
Test-Phase2Item "wrangler documents secrets" ($WranglerText -match "wrangler secret put GITHUB_TOKEN" -and $WranglerText -match "wrangler secret put WRITE_TOKEN")

if ($Failures -eq 0) {
  Write-Host ""
  Write-Host "Phase 2 Worker 정적 검증이 통과했습니다." -ForegroundColor Green
  Write-Host "다음 단계는 Cloudflare에서 secret을 설정하고 wrangler dev/deploy로 확인하는 것입니다."
} else {
  Write-Host ""
  Write-Host "Phase 2 검증 실패 항목 수: $Failures" -ForegroundColor Red
  exit 1
}
