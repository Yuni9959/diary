$ErrorActionPreference = "Stop"

$RepoRoot = $PSScriptRoot
$AppRoot = Join-Path $RepoRoot "Diary_formyWife"
$Pipeline = Join-Path $AppRoot "tools\diary_pipeline.py"

if (-not (Test-Path $Pipeline)) {
  Write-Host "Diary pipeline not found: $Pipeline" -ForegroundColor Red
  exit 1
}

Set-Location $AppRoot
& py -3 tools\diary_pipeline.py sync
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Set-Location $RepoRoot
git add .

$CommitMessage = -join ([char[]](0xC77C, 0xAE30, 0x20, 0xC5C5, 0xB370, 0xC774, 0xD2B8))

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "No diary changes to commit. Skipping git commit."
} else {
  git commit -m $CommitMessage
}

git pull --rebase origin main
git push -u origin main
