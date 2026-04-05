param(
  [string]$BaseUrl = "https://mealscout.onrender.com"
)

$ErrorActionPreference = "Stop"

function Get-OrPrompt {
  param(
    [string]$Name,
    [string]$Prompt,
    [bool]$Required = $true,
    [switch]$Secret
  )

  $existing = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [string]::IsNullOrWhiteSpace($existing)) {
    return $existing
  }

  if (-not $Required) {
    $value = Read-Host "$Prompt (optional, press Enter to skip)"
    if ([string]::IsNullOrWhiteSpace($value)) {
      return ""
    }
    [Environment]::SetEnvironmentVariable($Name, $value, "Process")
    return $value
  }

  if ($Secret) {
    $secure = Read-Host $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }

    if ([string]::IsNullOrWhiteSpace($plain)) {
      throw "Missing required value for $Name"
    }

    [Environment]::SetEnvironmentVariable($Name, $plain, "Process")
    return $plain
  }

  $input = Read-Host $Prompt
  if ([string]::IsNullOrWhiteSpace($input)) {
    throw "Missing required value for $Name"
  }

  [Environment]::SetEnvironmentVariable($Name, $input, "Process")
  return $input
}

function Ensure-IncidentSecret {
  $secret = [Environment]::GetEnvironmentVariable("INCIDENT_SIGNATURE_SECRET", "Process")
  if (-not [string]::IsNullOrWhiteSpace($secret)) {
    return $secret
  }

  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $generated = [Convert]::ToBase64String($bytes)
  [Environment]::SetEnvironmentVariable("INCIDENT_SIGNATURE_SECRET", $generated, "Process")
  Write-Host "Generated INCIDENT_SIGNATURE_SECRET for this session." -ForegroundColor Yellow
  return $generated
}

function Invoke-Step {
  param(
    [string]$Title,
    [string]$Command
  )

  Write-Host ""
  Write-Host "==> $Title" -ForegroundColor Cyan
  Write-Host "    $Command" -ForegroundColor DarkGray
  Invoke-Expression $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed: $Title"
  }
}

Write-Host ""
Write-Host "MealScout Guided Readiness Runner" -ForegroundColor Green
Write-Host "This script sets env vars for this shell only and runs all checks." -ForegroundColor Green

[Environment]::SetEnvironmentVariable("API_BASE", $BaseUrl, "Process")
Write-Host "API_BASE set to $BaseUrl" -ForegroundColor DarkGray

Write-Host ""
Write-Host "1) Incident channel setup" -ForegroundColor Magenta
Get-OrPrompt -Name "BREVO_API_KEY" -Prompt "Enter BREVO_API_KEY" -Required:$true -Secret
Get-OrPrompt -Name "INCIDENT_EMAIL_RECIPIENTS" -Prompt "Enter INCIDENT_EMAIL_RECIPIENTS (comma-separated emails)" -Required:$true
Get-OrPrompt -Name "INCIDENT_SMS_RECIPIENTS" -Prompt "Enter INCIDENT_SMS_RECIPIENTS (comma-separated E.164 numbers)" -Required:$true
Get-OrPrompt -Name "SLACK_WEBHOOK_URL" -Prompt "Enter SLACK_WEBHOOK_URL" -Required:$true
Ensure-IncidentSecret | Out-Null

Write-Host ""
Write-Host "2) RBAC cookies" -ForegroundColor Magenta
Get-OrPrompt -Name "RBAC_COOKIE_CUSTOMER" -Prompt "Paste RBAC_COOKIE_CUSTOMER (format: connect.sid=...)" -Required:$true
Get-OrPrompt -Name "RBAC_COOKIE_STAFF" -Prompt "Paste RBAC_COOKIE_STAFF (format: connect.sid=...)" -Required:$true
Get-OrPrompt -Name "RBAC_COOKIE_ADMIN" -Prompt "Paste RBAC_COOKIE_ADMIN (format: connect.sid=...)" -Required:$true
Get-OrPrompt -Name "RBAC_BASE_URL" -Prompt "RBAC_BASE_URL" -Required:$false | Out-Null
if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("RBAC_BASE_URL", "Process"))) {
  [Environment]::SetEnvironmentVariable("RBAC_BASE_URL", $BaseUrl, "Process")
}

Write-Host ""
Write-Host "3) Parking-pass Stripe smoke inputs" -ForegroundColor Magenta
Get-OrPrompt -Name "TEST_PARKING_PASS_ID" -Prompt "Paste TEST_PARKING_PASS_ID (must be payments-enabled)" -Required:$true
Get-OrPrompt -Name "TEST_TRUCK_ID" -Prompt "Paste TEST_TRUCK_ID" -Required:$true
Get-OrPrompt -Name "TEST_TRUCK_AUTH_COOKIE" -Prompt "Paste TEST_TRUCK_AUTH_COOKIE (format: connect.sid=...)" -Required:$true
Get-OrPrompt -Name "TEST_HOST_AUTH_COOKIE" -Prompt "Paste TEST_HOST_AUTH_COOKIE (optional)" -Required:$false | Out-Null

Write-Host ""
Write-Host "4) Run strict validations" -ForegroundColor Magenta
Invoke-Step -Title "Incident checklist strict" -Command "npm run checklist:incidents:strict"
Invoke-Step -Title "Security checklist strict" -Command "npm run checklist:security:strict"
Invoke-Step -Title "Stripe parking-pass smoke" -Command "npm run smoke:parking-pass-stripe"

Write-Host ""
Write-Host "All checks passed." -ForegroundColor Green
Write-Host "You are ready for paid-booking go-live verification." -ForegroundColor Green
