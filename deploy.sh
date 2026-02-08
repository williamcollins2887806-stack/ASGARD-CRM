#!/bin/bash
set -e

echo "=== ASGARD CRM DEPLOY ==="

APP_DIR="/var/www/asgard-crm"
BACKUP_DIR="${APP_DIR}-backup-$(date +%Y%m%d_%H%M%S)"

echo "[1/8] Backup..."
if [ -d "$APP_DIR" ]; then
  sudo cp -a "$APP_DIR" "$BACKUP_DIR"
  echo "  Backup: $BACKUP_DIR"
fi

echo "[2/8] Git clone..."
rm -rf /tmp/asgard-deploy
git clone --branch claude/branch-visibility-check-JjQcC --single-branch https://github.com/williamcollins2887806-stack/ASGARD-CRM.git /tmp/asgard-deploy
echo "  Cloned OK"

echo "[3/8] Save config..."
if [ -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env" /tmp/asgard-deploy/.env
  echo "  .env saved"
fi
if [ -d "$APP_DIR/uploads" ]; then
  cp -r "$APP_DIR/uploads" /tmp/asgard-deploy/uploads
  echo "  uploads saved"
fi

echo "[4/8] Stop PM2..."
pm2 stop asgard-crm 2>/dev/null || true

echo "[5/8] Replace app..."
sudo rm -rf "$APP_DIR"
sudo mv /tmp/asgard-deploy "$APP_DIR"
sudo chown -R ubuntu:ubuntu "$APP_DIR"
echo "  Files updated"

echo "[6/8] npm install..."
cd "$APP_DIR"
npm install --omit=dev
echo "  Dependencies installed"

echo "[7/8] Migrations..."
cd "$APP_DIR"
node migrations/run.js
echo "  Migrations done"

echo "[8/8] Start PM2..."
pm2 delete asgard-crm 2>/dev/null || true
cd "$APP_DIR"
pm2 start src/index.js --name asgard-crm
pm2 save

sleep 5
if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
  echo ""
  echo "=== DEPLOY OK ==="
  echo "  URL:    http://158.160.152.188:3000"
  echo "  Backup: $BACKUP_DIR"
else
  echo ""
  echo "=== DEPLOY FAILED ==="
  echo "  Logs:     pm2 logs asgard-crm --lines 50"
  echo "  Rollback: sudo rm -rf $APP_DIR && sudo mv $BACKUP_DIR $APP_DIR && pm2 restart asgard-crm"
fi
