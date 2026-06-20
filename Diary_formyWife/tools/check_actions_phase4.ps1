$ErrorActionPreference = "Continue"

$OuterRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Workflow = Join-Path $OuterRoot ".github\workflows\diary-sync.yml"
$Failures = 0

function Test-Phase4Item {
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

Test-Phase4Item "workflow exists" (Test-Path $Workflow)

$Text = if (Test-Path $Workflow) { Get-Content -Raw -Encoding UTF8 -Path $Workflow } else { "" }

Test-Phase4Item "push trigger watches inbox/new" ($Text -match "Diary_formyWife/inbox/new/\*\*")
Test-Phase4Item "push trigger watches obsidian" ($Text -match "Diary_formyWife/obsidian/\*\*")
Test-Phase4Item "uses actions/checkout" ($Text -match "actions/checkout@v4")
Test-Phase4Item "uses setup-python" ($Text -match "actions/setup-python@v5")
Test-Phase4Item "runs diary_pipeline sync" ($Text -match "python tools/diary_pipeline.py sync")
Test-Phase4Item "commits generated data" ($Text -match "git commit -m `"Update diary data`"")
Test-Phase4Item "rebases before generated data push" ($Text -match "git pull --rebase origin")
Test-Phase4Item "uses configure-pages" ($Text -match "actions/configure-pages@v5")
Test-Phase4Item "uses upload-pages-artifact" ($Text -match "actions/upload-pages-artifact@v3")
Test-Phase4Item "uses deploy-pages" ($Text -match "actions/deploy-pages@v4")
Test-Phase4Item "sets contents write permission" ($Text -match "contents: write")
Test-Phase4Item "sets pages write permission" ($Text -match "pages: write")
Test-Phase4Item "sets id-token write permission" ($Text -match "id-token: write")
Test-Phase4Item "Pages artifact excludes inbox" ($Text -notmatch "copytree\(.*inbox")
Test-Phase4Item "Pages artifact excludes obsidian" ($Text -notmatch "copytree\(.*obsidian")
Test-Phase4Item "Pages artifact includes nested data" ($Text -match "Diary_formyWife.*data")

if ($Failures -eq 0) {
  Write-Host ""
  Write-Host "Phase 4 GitHub Actions 정적 검증이 통과했습니다." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "Phase 4 검증 실패 항목 수: $Failures" -ForegroundColor Red
  exit 1
}
