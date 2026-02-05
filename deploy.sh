#!/bin/bash
# ASGARD CRM Deploy Script

echo "=== 1. Backup database ==="
pg_dump -Fc asgard_crm > backup_$(date +%Y%m%d_%H%M%S).dump

echo "=== 2. Pull latest code ==="
git pull origin claude/review-crm-files-3sa74

echo "=== 3. Install dependencies ==="
npm install

echo "=== 4. Run migrations ==="
psql -d asgard_crm -f migrations/V003__all_missing_columns.sql

echo "=== 5. Restart server ==="
pm2 restart asgard-crm || node src/index.js &

echo "=== 6. Health check ==="
sleep 5
curl -s http://localhost:3000/api/health

echo "=== Deploy complete ==="
