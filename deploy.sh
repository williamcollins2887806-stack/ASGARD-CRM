#!/bin/bash
set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  ASGARD CRM — Full Deploy"
echo "═══════════════════════════════════════════════════════════════"

APP_DIR="/var/www/asgard-crm"
BACKUP_DIR="${APP_DIR}-backup-$(date +%Y%m%d_%H%M%S)"
BRANCH="claude/branch-visibility-check-JjQcC"
REPO="https://github.com/williamcollins2887806-stack/ASGARD-CRM.git"

# ── [1/9] Preflight checks ─────────────────────────────────
echo ""
echo "[1/9] Preflight checks..."
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm not found"; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo "ERROR: pm2 not found. Install: npm i -g pm2"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "ERROR: git not found"; exit 1; }
echo "  node $(node -v), npm $(npm -v), pm2 $(pm2 -v)"

# ── [2/9] Backup ───────────────────────────────────────────
echo ""
echo "[2/9] Backup current installation..."
if [ -d "$APP_DIR" ]; then
  sudo cp -a "$APP_DIR" "$BACKUP_DIR"
  echo "  Backup created: $BACKUP_DIR"
else
  echo "  No existing installation, fresh deploy"
fi

# ── [3/9] Clone repository ─────────────────────────────────
echo ""
echo "[3/9] Clone branch $BRANCH..."
rm -rf /tmp/asgard-deploy
git clone --branch "$BRANCH" --single-branch "$REPO" /tmp/asgard-deploy
echo "  Cloned $(cd /tmp/asgard-deploy && git log --oneline -1)"

# ── [4/9] Preserve config & data ───────────────────────────
echo ""
echo "[4/9] Preserve .env and uploads..."
if [ -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env" /tmp/asgard-deploy/.env
  echo "  .env preserved"
else
  echo "  WARNING: No .env found at $APP_DIR/.env"
  echo "  Copy .env.example to .env and fill in values before starting!"
  cp /tmp/asgard-deploy/.env.example /tmp/asgard-deploy/.env 2>/dev/null || true
fi
if [ -d "$APP_DIR/uploads" ]; then
  cp -r "$APP_DIR/uploads" /tmp/asgard-deploy/uploads
  echo "  uploads/ preserved ($(du -sh "$APP_DIR/uploads" | cut -f1))"
fi

# ── [5/9] Validate .env ────────────────────────────────────
echo ""
echo "[5/9] Validate .env..."
if [ -f "/tmp/asgard-deploy/.env" ]; then
  source /tmp/asgard-deploy/.env 2>/dev/null || true
  MISSING=""
  [ -z "$DB_PASSWORD" ] && MISSING="$MISSING DB_PASSWORD"
  [ -z "$JWT_SECRET" ] && MISSING="$MISSING JWT_SECRET"
  if [ -n "$MISSING" ]; then
    echo "  CRITICAL: Missing required variables:$MISSING"
    echo "  Edit $APP_DIR/.env before running deploy!"
    exit 1
  fi
  echo "  .env OK (DB_HOST=${DB_HOST:-localhost}, DB_NAME=${DB_NAME:-asgard_crm})"
fi

# ── [6/9] Stop PM2 ─────────────────────────────────────────
echo ""
echo "[6/9] Stop PM2 process..."
pm2 stop asgard-crm 2>/dev/null && echo "  Stopped" || echo "  Not running (fresh deploy)"

# ── [7/9] Replace app files ────────────────────────────────
echo ""
echo "[7/9] Replace app files..."
sudo rm -rf "$APP_DIR"
sudo mv /tmp/asgard-deploy "$APP_DIR"
sudo chown -R $(whoami):$(whoami) "$APP_DIR"
echo "  Files deployed to $APP_DIR"

# ── [8/9] Install dependencies + run migrations ────────────
echo ""
echo "[8/9] Install dependencies & run migrations..."
cd "$APP_DIR"
npm install --omit=dev 2>&1 | tail -3
echo ""
echo "  Running migrations V001-V021..."
node migrations/run.js
echo "  Migrations completed"

# ── [9/9] Start app & health check ─────────────────────────
echo ""
echo "[9/9] Start PM2 & health check..."
cd "$APP_DIR"
pm2 delete asgard-crm 2>/dev/null || true
pm2 start src/index.js --name asgard-crm --node-args="--max-old-space-size=512"
pm2 save

echo "  Waiting 5s for startup..."
sleep 5

if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  DEPLOY SUCCESS"
  echo "  URL:    http://158.160.152.188:3000"
  echo "  Backup: $BACKUP_DIR"
  echo "  Logs:   pm2 logs asgard-crm"
  echo "═══════════════════════════════════════════════════════════════"
else
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  DEPLOY FAILED — App not responding"
  echo "  Logs:     pm2 logs asgard-crm --lines 50"
  echo "  Rollback: sudo rm -rf $APP_DIR && sudo mv $BACKUP_DIR $APP_DIR && pm2 restart asgard-crm"
  echo "═══════════════════════════════════════════════════════════════"
  exit 1
fi
