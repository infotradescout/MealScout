param(
  [Parameter(Mandatory = $true)]
  [string]$Message,

  [Parameter(Mandatory = $true)]
  [string[]]$Files,

  [string]$Branch = "main",

  [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"

function Step($text) {
  Write-Host ""
  Write-Host "==> $text" -ForegroundColor Cyan
}

function Run($cmd) {
  Write-Host "PS> $cmd" -ForegroundColor DarkGray
  Invoke-Expression $cmd
}

Step "Fetch latest remote state"
Run "git fetch origin"

Step "Current status"
Run "git status --short"

Step "Stage only requested files"
foreach ($file in $Files) {
  if (-not (Test-Path $file)) {
    throw "File not found: $file"
  }
}
$quotedFiles = $Files | ForEach-Object { "`"$_`"" }
Run ("git add -- " + ($quotedFiles -join " "))

Step "Review staged changes"
Run "git diff --staged --stat"
Run "git diff --staged"

if (-not $SkipChecks) {
  Step "Run checks"
  Run "npm run check"
  Run "npm run test:run"
  Run "npm run build"
  Run "npm run verify:routes"
}

Step "Commit"
$escapedMessage = $Message.Replace('"', '\"')
Run "git commit -m `"$escapedMessage`""

Step "Push"
Run "git push origin $Branch"

Step "Done"
Write-Host "Pushed safely to origin/$Branch" -ForegroundColor Green
