# ASGARD CRM Deploy Script (PowerShell)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $repoRoot "package.json"))) {
  throw "deploy.ps1 must be run from the ASGARD-CRM repo. package.json not found in $repoRoot."
}

Set-Location $repoRoot

function Require-Command([string]$command) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $command"
  }
}

Require-Command "git"
Require-Command "pg_dump"
Require-Command "psql"
Require-Command "npm"

Write-Host "=== 1. Backup database ==="
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
pg_dump -Fc asgard_crm > "backup_${timestamp}.dump"

Write-Host "=== 2. Pull latest code ==="
git pull origin claude/review-crm-files-3sa74

Write-Host "=== 3. Install dependencies ==="
npm install

Write-Host "=== 4. Run migrations ==="
psql -d asgard_crm -f migrations/V003__all_missing_columns.sql

Write-Host "=== 5. Restart server ==="
try {
  Require-Command "pm2"
  pm2 restart asgard-crm | Out-Host
} catch {
  Start-Process -NoNewWindow -FilePath "node" -ArgumentList "src/index.js"
}

Write-Host "=== 6. Health check ==="
Start-Sleep -Seconds 5
Invoke-RestMethod -Uri "http://localhost:3000/api/health"

Write-Host "=== Deploy complete ==="
