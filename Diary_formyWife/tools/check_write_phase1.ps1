$ErrorActionPreference = "Continue"

$OuterRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Index = Join-Path $OuterRoot "index.html"
$Failures = 0

function Test-Item {
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

Test-Item "write button exists" ($Html -match 'id="openWriterBtn"')
Test-Item "writer modal exists" ($Html -match 'id="writerModal"')
Test-Item "date input exists" ($Html -match 'id="writerDate"')
Test-Item "title input exists" ($Html -match 'id="writerTitleInput"')
Test-Item "body textarea exists" ($Html -match 'id="writerBody"')
Test-Item "draft save button exists" ($Html -match 'id="saveDraftBtn"')
Test-Item "download txt button exists" ($Html -match 'id="downloadDraftBtn"')
Test-Item "restore draft button exists" ($Html -match 'id="restoreDraftBtn"')
Test-Item "localStorage draft key exists" ($Html -match 'diaryWriterDraft:v1')
Test-Item "download uses Blob" ($Html -match 'new Blob')
Test-Item "no Phase 2 API call added" ($Html -notmatch '/api/diary')

if ($Failures -eq 0) {
  Write-Host ""
  Write-Host "Phase 1 글쓰기 UI 검증이 통과했습니다." -ForegroundColor Green
  Write-Host "수동 테스트:"
  Write-Host "cd `"$OuterRoot`""
  Write-Host "py -3 -m http.server 8000"
  Write-Host "http://localhost:8000"
} else {
  Write-Host ""
  Write-Host "Phase 1 검증 실패 항목 수: $Failures" -ForegroundColor Red
  exit 1
}
