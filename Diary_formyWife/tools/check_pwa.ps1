$ErrorActionPreference = "Continue"

$OuterRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Failures = 0

function Test-PwaItem {
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

$manifest = Join-Path $OuterRoot "manifest.webmanifest"
$sw = Join-Path $OuterRoot "sw.js"
$index = Join-Path $OuterRoot "index.html"

Test-PwaItem "manifest.webmanifest exists" (Test-Path $manifest)
Test-PwaItem "sw.js exists" (Test-Path $sw)
Test-PwaItem "icons/icon-192.png exists" (Test-Path (Join-Path $OuterRoot "icons\icon-192.png"))
Test-PwaItem "icons/icon-512.png exists" (Test-Path (Join-Path $OuterRoot "icons\icon-512.png"))
Test-PwaItem "icons/maskable-512.png exists" (Test-Path (Join-Path $OuterRoot "icons\maskable-512.png"))

$indexText = if (Test-Path $index) { Get-Content -Raw -Encoding UTF8 -Path $index } else { "" }
Test-PwaItem "index.html has rel=manifest" ($indexText -match 'rel=["'']manifest["'']')
Test-PwaItem "index.html has serviceWorker.register" ($indexText -match 'serviceWorker\.register')

try {
  Get-Content -Raw -Encoding UTF8 -Path $manifest | ConvertFrom-Json | Out-Null
  Test-PwaItem "manifest.webmanifest parses as JSON" $true
} catch {
  Test-PwaItem "manifest.webmanifest parses as JSON" $false
}

if ($Failures -eq 0) {
  Write-Host ""
  Write-Host "PWA 기본 검증이 통과했습니다." -ForegroundColor Green
  Write-Host "로컬 테스트:"
  Write-Host "cd `"$OuterRoot`""
  Write-Host "py -3 -m http.server 8000"
  Write-Host "http://localhost:8000"
} else {
  Write-Host ""
  Write-Host "PWA 검증 실패 항목 수: $Failures" -ForegroundColor Red
  exit 1
}
