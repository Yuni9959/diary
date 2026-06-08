$ErrorActionPreference = "Stop"

$AppRoot = Join-Path $PSScriptRoot "Diary_formyWife"
$InnerScript = Join-Path $AppRoot "sync_diary.ps1"

if (-not (Test-Path $InnerScript)) {
  Write-Host "실제 앱 루트의 sync_diary.ps1을 찾지 못했습니다." -ForegroundColor Yellow
  Write-Host "확인한 경로: $InnerScript"
  exit 1
}

& $InnerScript
exit $LASTEXITCODE
