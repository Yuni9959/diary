param(
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl,

  [string]$Date = (Get-Date -Format "yyyy-MM-dd")
)

$token = $env:DIARY_WRITE_TOKEN
if (-not $token) {
  $secureToken = Read-Host "WRITE_TOKEN" -AsSecureString
  $token = [System.Net.NetworkCredential]::new("", $secureToken).Password
}

$utf8 = [System.Text.Encoding]::UTF8
$title = $utf8.GetString([Convert]::FromBase64String("UGhhc2UgMiBBUEkg7YWM7Iqk7Yq4"))
$body = $utf8.GetString([Convert]::FromBase64String("7J20IOq4gOydgCBQaGFzZSAyIEFQSSDthYzsiqTtirjsnoXri4jri6Qu"))

$payload = @{
  date = $Date
  title = $title
  body = $body
  clientId = "pwa-test"
} | ConvertTo-Json -Depth 4

$headers = @{
  Authorization = "Bearer $token"
  "Content-Type" = "application/json"
}

try {
  $response = Invoke-RestMethod -Method Post -Uri $ApiUrl -Headers $headers -Body $payload
  Write-Host "Request succeeded" -ForegroundColor Green
  $response | ConvertTo-Json -Depth 6
} catch {
  Write-Host "Request failed" -ForegroundColor Red
  if ($_.Exception.Response) {
    Write-Host "HTTP Status:" ([int]$_.Exception.Response.StatusCode)
  }
  if ($_.ErrorDetails.Message) {
    Write-Host $_.ErrorDetails.Message
  } else {
    Write-Host $_.Exception.Message
  }
}
