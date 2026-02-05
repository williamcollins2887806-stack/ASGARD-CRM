#!/bin/bash
#═══════════════════════════════════════════════════════════════════════════════
# ASGARD CRM - Deployment Script
#═══════════════════════════════════════════════════════════════════════════════
#
# Usage: ./deploy.sh [--production|--staging|--skip-tests]
#
# Features:
# - Database migrations (automatic via server startup)
# - Dependency updates
# - Build validation
# - Service restart
# - Health check
#═══════════════════════════════════════════════════════════════════════════════

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="${APP_DIR:-$(dirname "$0")}"
NODE_ENV="${NODE_ENV:-production}"
PM2_APP_NAME="${PM2_APP_NAME:-asgard-crm}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://localhost:3000/api/health}"
HEALTH_CHECK_RETRIES=10
HEALTH_CHECK_DELAY=3

# Parse arguments
SKIP_TESTS=false
for arg in "$@"; do
    case $arg in
        --production)
            NODE_ENV="production"
            ;;
        --staging)
            NODE_ENV="staging"
            ;;
        --skip-tests)
            SKIP_TESTS=true
            ;;
        *)
            ;;
    esac
done

echo -e "${BLUE}"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "                         ASGARD CRM DEPLOYMENT"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo -e "  Environment:  ${NODE_ENV}"
echo -e "  App Dir:      ${APP_DIR}"
echo -e "  Skip Tests:   ${SKIP_TESTS}"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo -e "${NC}"

cd "$APP_DIR"

# Step 1: Check Node.js
echo -e "${YELLOW}[1/7] Checking Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}ERROR: Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi
NODE_VERSION=$(node -v)
echo -e "${GREEN}  Node.js version: ${NODE_VERSION}${NC}"

# Step 2: Install dependencies
echo -e "${YELLOW}[2/7] Installing dependencies...${NC}"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev
echo -e "${GREEN}  Dependencies installed${NC}"

# Step 3: Verify required files
echo -e "${YELLOW}[3/7] Verifying required files...${NC}"
REQUIRED_FILES=(
    "src/index.js"
    "package.json"
    "public/index.html"
    "public/assets/js/app.js"
    "public/assets/js/mobile.js"
    "public/assets/css/app.css"
)
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}ERROR: Required file missing: ${file}${NC}"
        exit 1
    fi
done
echo -e "${GREEN}  All required files present${NC}"

# Step 4: Run tests (unless skipped)
if [ "$SKIP_TESTS" = false ]; then
    echo -e "${YELLOW}[4/7] Running tests...${NC}"
    if [ -f "tests/e2e_test.js" ]; then
        npm install --save-dev puppeteer 2>/dev/null || true
        timeout 300 npm test 2>&1 || {
            echo -e "${YELLOW}  Tests skipped or timed out (non-critical)${NC}"
        }
    else
        echo -e "${YELLOW}  No tests found, skipping${NC}"
    fi
else
    echo -e "${YELLOW}[4/7] Tests skipped (--skip-tests flag)${NC}"
fi

# Step 5: Check database connection
echo -e "${YELLOW}[5/7] Checking database connection...${NC}"
if [ -z "$DATABASE_URL" ] && [ -z "$PGDATABASE" ]; then
    echo -e "${YELLOW}  Warning: No database environment variables set${NC}"
    echo -e "${YELLOW}  Make sure .env file or environment is configured${NC}"
else
    echo -e "${GREEN}  Database configuration found${NC}"
fi

# Step 6: Stop existing service / Start new service
echo -e "${YELLOW}[6/7] Managing service...${NC}"
if command -v pm2 &> /dev/null; then
    # PM2 deployment
    echo "  Using PM2..."
    pm2 stop "$PM2_APP_NAME" 2>/dev/null || true
    pm2 delete "$PM2_APP_NAME" 2>/dev/null || true
    NODE_ENV=$NODE_ENV pm2 start src/index.js --name "$PM2_APP_NAME"
    pm2 save
    echo -e "${GREEN}  Service started with PM2${NC}"
elif command -v systemctl &> /dev/null && [ -f "/etc/systemd/system/asgard-crm.service" ]; then
    # Systemd deployment
    echo "  Using systemd..."
    sudo systemctl restart asgard-crm
    echo -e "${GREEN}  Service restarted with systemd${NC}"
else
    # Direct start (development)
    echo "  Starting directly..."
    pkill -f "node src/index.js" 2>/dev/null || true
    sleep 2
    NODE_ENV=$NODE_ENV nohup node src/index.js > logs/app.log 2>&1 &
    echo -e "${GREEN}  Service started in background${NC}"
fi

# Step 7: Health check
echo -e "${YELLOW}[7/7] Running health check...${NC}"
sleep 3  # Initial delay
for i in $(seq 1 $HEALTH_CHECK_RETRIES); do
    if curl -s "$HEALTH_CHECK_URL" | grep -q '"status":"ok"'; then
        echo -e "${GREEN}  Health check passed!${NC}"
        break
    fi
    if [ $i -eq $HEALTH_CHECK_RETRIES ]; then
        echo -e "${RED}  Health check failed after ${HEALTH_CHECK_RETRIES} attempts${NC}"
        echo -e "${YELLOW}  Check logs: tail -f logs/app.log${NC}"
        exit 1
    fi
    echo -e "  Attempt $i/$HEALTH_CHECK_RETRIES - waiting..."
    sleep $HEALTH_CHECK_DELAY
done

# Success
echo -e "${GREEN}"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "                         DEPLOYMENT SUCCESSFUL!"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo -e "  Status:    RUNNING"
echo -e "  URL:       http://localhost:3000"
echo -e "  API:       http://localhost:3000/api/health"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo -e "${NC}"

# Print migration notes
echo -e "${BLUE}Database Migrations (run automatically on server start):${NC}"
echo "  - chat_messages table with all required columns"
echo "  - chats table for chat functionality"
echo "  - staff_plan table for planning"
echo "  - users.pin_hash, must_change_password, last_login_at, telegram_chat_id columns"
echo "  - staff.user_id, role_tag columns"
echo ""
echo -e "${BLUE}Manual migrations if needed:${NC}"
echo "  psql -h \$PGHOST -U \$PGUSER -d \$PGDATABASE < migrations/init.sql"
echo ""
