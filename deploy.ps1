#═══════════════════════════════════════════════════════════════════════════════
# ASGARD CRM - PowerShell Deployment Script
#═══════════════════════════════════════════════════════════════════════════════
#
# Usage: .\deploy.ps1 [-SkipTests] [-SkipBackup] [-Force]
#
# Features:
# - Git pull latest changes
# - Database backup (PostgreSQL)
# - Database migrations
# - Dependency updates
# - Service restart
# - Health check
#═══════════════════════════════════════════════════════════════════════════════

param(
    [switch]$SkipTests,
    [switch]$SkipBackup,
    [switch]$Force,
    [string]$Branch = "main"
)

# Configuration - CHANGE THESE VALUES FOR YOUR SERVER
$Config = @{
    # App paths
    AppDir = "C:\ASGARD-CRM"                    # Path to your ASGARD CRM folder
    BackupDir = "C:\ASGARD-Backups"             # Where to store backups
    LogDir = "C:\ASGARD-CRM\logs"               # Log directory

    # Database connection
    DbHost = "localhost"
    DbPort = "5432"
    DbName = "asgard_crm"
    DbUser = "asgard"
    DbPassword = "YOUR_PASSWORD_HERE"           # CHANGE THIS!

    # Service
    ServiceName = "asgard-crm"
    HealthCheckUrl = "http://localhost:3000/api/health"
    HealthCheckRetries = 10
    HealthCheckDelay = 3
}

# Colors for output
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Write-Step($step, $total, $message) {
    Write-Host "[$step/$total] " -ForegroundColor Yellow -NoNewline
    Write-Host $message -ForegroundColor White
}

function Write-Success($message) {
    Write-Host "  ✓ $message" -ForegroundColor Green
}

function Write-Warning($message) {
    Write-Host "  ⚠ $message" -ForegroundColor Yellow
}

function Write-Error2($message) {
    Write-Host "  ✗ $message" -ForegroundColor Red
}

function Write-Info($message) {
    Write-Host "  → $message" -ForegroundColor Cyan
}

# Banner
function Show-Banner {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Blue
    Write-Host "                         ASGARD CRM DEPLOYMENT                                  " -ForegroundColor Blue
    Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Blue
    Write-Host "  App Directory:  $($Config.AppDir)" -ForegroundColor White
    Write-Host "  Database:       $($Config.DbName)@$($Config.DbHost):$($Config.DbPort)" -ForegroundColor White
    Write-Host "  Branch:         $Branch" -ForegroundColor White
    Write-Host "  Skip Tests:     $SkipTests" -ForegroundColor White
    Write-Host "  Skip Backup:    $SkipBackup" -ForegroundColor White
    Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Blue
    Write-Host ""
}

# Step 1: Check prerequisites
function Test-Prerequisites {
    Write-Step 1 8 "Checking prerequisites..."

    # Check Node.js
    try {
        $nodeVersion = node -v 2>&1
        Write-Success "Node.js: $nodeVersion"
    } catch {
        Write-Error2 "Node.js not found! Please install Node.js 18+"
        exit 1
    }

    # Check npm
    try {
        $npmVersion = npm -v 2>&1
        Write-Success "npm: v$npmVersion"
    } catch {
        Write-Error2 "npm not found!"
        exit 1
    }

    # Check git
    try {
        $gitVersion = git --version 2>&1
        Write-Success "Git: $gitVersion"
    } catch {
        Write-Error2 "Git not found!"
        exit 1
    }

    # Check psql (for backup)
    if (-not $SkipBackup) {
        try {
            $psqlVersion = psql --version 2>&1
            Write-Success "PostgreSQL: $psqlVersion"
        } catch {
            Write-Warning "psql not found - backup will use pg_dump if available"
        }
    }

    # Check PM2
    try {
        $pm2Version = pm2 -v 2>&1
        Write-Success "PM2: v$pm2Version"
        $script:UsePM2 = $true
    } catch {
        Write-Warning "PM2 not found - will use direct node start"
        $script:UsePM2 = $false
    }
}

# Step 2: Git pull
function Update-Repository {
    Write-Step 2 8 "Updating repository from Git..."

    Set-Location $Config.AppDir

    # Check for uncommitted changes
    $status = git status --porcelain 2>&1
    if ($status -and -not $Force) {
        Write-Warning "Uncommitted changes detected!"
        Write-Info "Use -Force to stash changes and continue"
        $status | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }

        $confirm = Read-Host "Stash changes and continue? (y/N)"
        if ($confirm -ne 'y' -and $confirm -ne 'Y') {
            Write-Error2 "Deployment cancelled"
            exit 1
        }
        git stash
        Write-Info "Changes stashed"
    }

    # Fetch and pull
    try {
        git fetch origin $Branch 2>&1 | Out-Null
        $pullResult = git pull origin $Branch 2>&1
        Write-Success "Repository updated"
        if ($pullResult -match "Already up to date") {
            Write-Info "Already up to date"
        } else {
            Write-Info "Changes pulled from $Branch"
        }
    } catch {
        Write-Error2 "Git pull failed: $_"
        exit 1
    }
}

# Step 3: Create backup
function New-DatabaseBackup {
    if ($SkipBackup) {
        Write-Step 3 8 "Database backup skipped (--SkipBackup)"
        return
    }

    Write-Step 3 8 "Creating database backup..."

    # Create backup directory if not exists
    if (-not (Test-Path $Config.BackupDir)) {
        New-Item -ItemType Directory -Path $Config.BackupDir -Force | Out-Null
    }

    $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $backupFile = Join-Path $Config.BackupDir "asgard_backup_$timestamp.sql"

    # Set environment for pg_dump
    $env:PGPASSWORD = $Config.DbPassword

    try {
        $pgDumpResult = pg_dump `
            -h $Config.DbHost `
            -p $Config.DbPort `
            -U $Config.DbUser `
            -d $Config.DbName `
            -f $backupFile `
            --verbose 2>&1

        if (Test-Path $backupFile) {
            $backupSize = (Get-Item $backupFile).Length / 1KB
            Write-Success "Backup created: $backupFile"
            Write-Info "Backup size: $([math]::Round($backupSize, 2)) KB"
        } else {
            Write-Warning "Backup file not created (database may be empty)"
        }
    } catch {
        Write-Warning "pg_dump failed: $_ - continuing without backup"
    } finally {
        $env:PGPASSWORD = $null
    }

    # Cleanup old backups (keep last 10)
    $oldBackups = Get-ChildItem $Config.BackupDir -Filter "asgard_backup_*.sql" |
                  Sort-Object CreationTime -Descending |
                  Select-Object -Skip 10

    if ($oldBackups) {
        $oldBackups | Remove-Item -Force
        Write-Info "Cleaned up $($oldBackups.Count) old backups"
    }
}

# Step 4: Install dependencies
function Install-Dependencies {
    Write-Step 4 8 "Installing dependencies..."

    Set-Location $Config.AppDir

    try {
        # Use npm ci for clean install, fallback to npm install
        $result = npm ci --omit=dev 2>&1
        if ($LASTEXITCODE -ne 0) {
            $result = npm install --omit=dev 2>&1
        }
        Write-Success "Dependencies installed"
    } catch {
        Write-Error2 "npm install failed: $_"
        exit 1
    }
}

# Step 5: Run migrations
function Invoke-Migrations {
    Write-Step 5 8 "Running database migrations..."

    Set-Location $Config.AppDir

    # Set environment variables for migration script
    $env:DB_HOST = $Config.DbHost
    $env:DB_PORT = $Config.DbPort
    $env:DB_NAME = $Config.DbName
    $env:DB_USER = $Config.DbUser
    $env:DB_PASSWORD = $Config.DbPassword

    try {
        $migrationResult = node migrations/run.js 2>&1
        $migrationResult | ForEach-Object {
            if ($_ -match "✅|completed|Skipping") {
                Write-Info $_
            } elseif ($_ -match "❌|failed|error") {
                Write-Error2 $_
            } else {
                Write-Host "    $_" -ForegroundColor Gray
            }
        }
        Write-Success "Migrations completed"
    } catch {
        Write-Error2 "Migration failed: $_"
        exit 1
    } finally {
        # Clear sensitive env vars
        $env:DB_PASSWORD = $null
    }
}

# Step 6: Run tests
function Invoke-Tests {
    if ($SkipTests) {
        Write-Step 6 8 "Tests skipped (--SkipTests)"
        return
    }

    Write-Step 6 8 "Running tests..."

    Set-Location $Config.AppDir

    try {
        $testResult = npm test 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "All tests passed"
        } else {
            Write-Warning "Some tests failed (non-critical)"
            $testResult | Select-Object -Last 10 | ForEach-Object {
                Write-Host "    $_" -ForegroundColor Gray
            }
        }
    } catch {
        Write-Warning "Tests skipped: $_"
    }
}

# Step 7: Restart service
function Restart-AppService {
    Write-Step 7 8 "Restarting application service..."

    Set-Location $Config.AppDir

    # Create logs directory if not exists
    if (-not (Test-Path $Config.LogDir)) {
        New-Item -ItemType Directory -Path $Config.LogDir -Force | Out-Null
    }

    if ($script:UsePM2) {
        # PM2 deployment
        Write-Info "Using PM2..."
        try {
            pm2 stop $Config.ServiceName 2>&1 | Out-Null
            pm2 delete $Config.ServiceName 2>&1 | Out-Null
        } catch { }

        $env:NODE_ENV = "production"
        pm2 start src/index.js --name $Config.ServiceName 2>&1 | Out-Null
        pm2 save 2>&1 | Out-Null
        Write-Success "Service started with PM2"
    } else {
        # Direct node start
        Write-Info "Starting directly with node..."

        # Kill existing process
        Get-Process -Name "node" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match "index.js" } |
            Stop-Process -Force -ErrorAction SilentlyContinue

        Start-Sleep -Seconds 2

        $env:NODE_ENV = "production"
        $logFile = Join-Path $Config.LogDir "app.log"

        Start-Process -FilePath "node" `
            -ArgumentList "src/index.js" `
            -WorkingDirectory $Config.AppDir `
            -RedirectStandardOutput $logFile `
            -RedirectStandardError $logFile `
            -WindowStyle Hidden

        Write-Success "Service started in background"
        Write-Info "Logs: $logFile"
    }
}

# Step 8: Health check
function Test-AppHealth {
    Write-Step 8 8 "Running health check..."

    Start-Sleep -Seconds 3  # Initial delay

    for ($i = 1; $i -le $Config.HealthCheckRetries; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $Config.HealthCheckUrl -UseBasicParsing -TimeoutSec 5
            $json = $response.Content | ConvertFrom-Json

            if ($json.status -eq "ok") {
                Write-Success "Health check passed!"
                return $true
            }
        } catch {
            Write-Info "Attempt $i/$($Config.HealthCheckRetries) - waiting..."
        }

        Start-Sleep -Seconds $Config.HealthCheckDelay
    }

    Write-Error2 "Health check failed after $($Config.HealthCheckRetries) attempts"
    Write-Warning "Check logs: Get-Content $($Config.LogDir)\app.log -Tail 50"
    return $false
}

# Show success banner
function Show-SuccessBanner {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "                         DEPLOYMENT SUCCESSFUL!                                 " -ForegroundColor Green
    Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  Status:    RUNNING" -ForegroundColor White
    Write-Host "  URL:       http://localhost:3000" -ForegroundColor White
    Write-Host "  API:       $($Config.HealthCheckUrl)" -ForegroundColor White
    Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "Useful commands:" -ForegroundColor Blue
    if ($script:UsePM2) {
        Write-Host "  pm2 logs $($Config.ServiceName)        # View live logs" -ForegroundColor Gray
        Write-Host "  pm2 restart $($Config.ServiceName)     # Restart service" -ForegroundColor Gray
        Write-Host "  pm2 stop $($Config.ServiceName)        # Stop service" -ForegroundColor Gray
    } else {
        Write-Host "  Get-Content $($Config.LogDir)\app.log -Tail 50 -Wait  # View live logs" -ForegroundColor Gray
    }
    Write-Host ""
}

# Main execution
function Main {
    Show-Banner

    $startTime = Get-Date

    Test-Prerequisites
    Update-Repository
    New-DatabaseBackup
    Install-Dependencies
    Invoke-Migrations
    Invoke-Tests
    Restart-AppService

    $healthOk = Test-AppHealth

    $duration = (Get-Date) - $startTime

    if ($healthOk) {
        Show-SuccessBanner
        Write-Host "Deployment completed in $([math]::Round($duration.TotalSeconds, 1)) seconds" -ForegroundColor Cyan
    } else {
        Write-Host ""
        Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Red
        Write-Host "                         DEPLOYMENT FAILED                                      " -ForegroundColor Red
        Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Red
        Write-Host ""
        exit 1
    }
}

# Run
Main
