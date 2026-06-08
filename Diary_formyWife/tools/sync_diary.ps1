param(
  [switch]$Commit,
  [switch]$Push
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

python tools/diary_pipeline.py sync

git status --short

if ($Commit) {
  git add obsidian data inbox tools DAILY_DIARY_WORKFLOW.md DIARY_PIPELINE_REPORT.md
  git commit -m "Update diary data"
}

if ($Push) {
  if (-not $Commit) {
    Write-Host "Push를 실행하려면 먼저 -Commit도 함께 지정하세요."
    exit 1
  }
  git push
}

Write-Host ""
Write-Host "다음 명령으로 직접 반영할 수 있습니다:"
Write-Host "git add obsidian data inbox tools DAILY_DIARY_WORKFLOW.md DIARY_PIPELINE_REPORT.md"
Write-Host "git commit -m `"Update diary data`""
Write-Host "git push"
