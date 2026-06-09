$ErrorActionPreference = "Stop"

$OuterRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$IconDir = Join-Path $OuterRoot "icons"
$Source = Join-Path $OuterRoot "img\bouquet.png"

Add-Type -AssemblyName System.Drawing
$Background = [System.Drawing.ColorTranslator]::FromHtml("#FAF4EA")

if (-not (Test-Path $Source)) {
  Write-Host "아이콘 원본 이미지를 찾지 못했습니다: $Source" -ForegroundColor Yellow
  Write-Host "img/bouquet.png를 추가한 뒤 다시 실행해 주세요."
  exit 1
}

New-Item -ItemType Directory -Force -Path $IconDir | Out-Null

function New-PwaIcon {
  param(
    [string]$OutputName,
    [int]$Size,
    [double]$ImageScale
  )

  $sourceImage = [System.Drawing.Image]::FromFile($Source)
  try {
    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.Clear($Background)

        $maxW = [int]($Size * $ImageScale)
        $maxH = [int]($Size * $ImageScale)
        $ratio = [Math]::Min($maxW / $sourceImage.Width, $maxH / $sourceImage.Height)
        $drawW = [int]($sourceImage.Width * $ratio)
        $drawH = [int]($sourceImage.Height * $ratio)
        $x = [int](($Size - $drawW) / 2)
        $y = [int](($Size - $drawH) / 2)
        $graphics.DrawImage($sourceImage, $x, $y, $drawW, $drawH)
      } finally {
        $graphics.Dispose()
      }

      $target = Join-Path $IconDir $OutputName
      $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Host "created $target"
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $sourceImage.Dispose()
  }
}

try {
  New-PwaIcon -OutputName "icon-192.png" -Size 192 -ImageScale 0.78
  New-PwaIcon -OutputName "icon-512.png" -Size 512 -ImageScale 0.78
  New-PwaIcon -OutputName "maskable-192.png" -Size 192 -ImageScale 0.62
  New-PwaIcon -OutputName "maskable-512.png" -Size 512 -ImageScale 0.62
  New-PwaIcon -OutputName "apple-touch-icon.png" -Size 180 -ImageScale 0.78
} catch {
  Write-Host "PWA 아이콘 생성에 실패했습니다." -ForegroundColor Yellow
  Write-Host $_.Exception.Message
  Write-Host "Windows의 System.Drawing 지원 상태를 확인해 주세요. manifest와 service worker는 별도로 사용할 수 있습니다."
  exit 1
}
