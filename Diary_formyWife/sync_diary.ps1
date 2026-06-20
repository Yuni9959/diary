$ErrorActionPreference = "Stop"

$AppRoot = $PSScriptRoot
Set-Location $AppRoot

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  Write-Host "Python 실행 관리자(py)를 찾지 못했습니다." -ForegroundColor Yellow
  Write-Host "1) PowerShell에서 py -3 --version 을 확인해 주세요."
  Write-Host "2) Python 설치가 필요할 수 있습니다."
  Write-Host "3) 설치 후 PowerShell을 새로 열어야 할 수 있습니다."
  exit 1
}

& py -3 tools\diary_pipeline.py sync
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Git 상태:"
if (Get-Command git -ErrorAction SilentlyContinue) {
  git rev-parse --is-inside-work-tree *> $null
  if ($LASTEXITCODE -eq 0) {
    git status --short
  } else {
    Write-Host "현재 폴더는 Git 저장소가 아닙니다. 필요하면 Git 저장소 위치에서 직접 확인해 주세요."
  }
} else {
  Write-Host "git 명령을 찾지 못했습니다. Git이 설치되어 있지 않거나 PATH에 없습니다."
}

Write-Host ""
Write-Host "확인 후 직접 실행할 Git 명령:"
Write-Host "git add obsidian data inbox"
Write-Host "git commit -m `"Update diary data`""
Write-Host "git push"
