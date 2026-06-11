$ErrorActionPreference = "Continue"

$OuterRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Index = Join-Path $OuterRoot "index.html"
$Failures = 0

function Test-Phase3Item {
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

if (-not (Test-Path $Index)) {
  Write-Host "[FAIL] index.html not found: $Index" -ForegroundColor Red
  exit 1
}

$Html = Get-Content -Raw -Encoding UTF8 -Path $Index

Test-Phase3Item "Worker API URL input exists" ($Html -match 'id="writerApiUrl"')
Test-Phase3Item "write token input exists" ($Html -match 'id="writerToken"')
Test-Phase3Item "upload button exists" ($Html -match 'id="uploadDraftBtn"')
Test-Phase3Item "retry button exists" ($Html -match 'id="retryUploadBtn"')
Test-Phase3Item "outbox status exists" ($Html -match 'id="writerOutbox"')
Test-Phase3Item "settings storage key exists" ($Html -match 'diaryWriterSettings:v1')
Test-Phase3Item "token session storage key exists" ($Html -match 'diaryWriterToken:session:v1')
Test-Phase3Item "outbox storage key exists" ($Html -match 'diaryWriterOutbox:v1')
Test-Phase3Item "archive storage key exists" ($Html -match 'diaryWriterArchive:v1')
Test-Phase3Item "write token is kept in sessionStorage" ($Html -match 'sessionStorage\.setItem\(WRITER_TOKEN_SESSION_KEY')
Test-Phase3Item "write token is not persisted in writer settings" ($Html -notmatch '(?s)writeJsonStorage\(WRITER_SETTINGS_KEY,\s*\{[^}]*writeToken')
Test-Phase3Item "upload uses POST" ($Html -match "method:'POST'")
Test-Phase3Item "upload sends Authorization bearer" ($Html -match 'Authorization`:\`Bearer|Authorization''\:\`Bearer|Authorization.:`Bearer|Authorization')
Test-Phase3Item "payload includes clientId pwa" ($Html -match "clientId:'pwa'")
Test-Phase3Item "failed upload queues draft" ($Html -match 'queueWriterDraft')
Test-Phase3Item "retry outbox function exists" ($Html -match 'retryWriterOutbox')
Test-Phase3Item "offline branch keeps draft" ($Html -match 'navigator.onLine')
Test-Phase3Item "GitHub token is not in frontend" ($Html -notmatch 'GITHUB_TOKEN')

if ($Failures -eq 0) {
  Write-Host ""
  Write-Host "Phase 3 업로드 UI 정적 검증이 통과했습니다." -ForegroundColor Green
  Write-Host "실제 업로드 테스트는 Worker URL과 WRITE_TOKEN을 입력한 뒤 브라우저에서 진행하세요."
} else {
  Write-Host ""
  Write-Host "Phase 3 검증 실패 항목 수: $Failures" -ForegroundColor Red
  exit 1
}
