$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Script = Join-Path $AppRoot "status_diary.ps1"

if (-not (Test-Path $Script)) {
  Write-Host "앱 루트의 status_diary.ps1을 찾지 못했습니다: $Script" -ForegroundColor Yellow
  exit 1
}

& $Script
exit $LASTEXITCODE
