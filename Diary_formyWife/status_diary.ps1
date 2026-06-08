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

& py -3 tools\diary_pipeline.py status
exit $LASTEXITCODE
