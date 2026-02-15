#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# АСГАРД CRM — Unified Deploy: Stages 7–11 + PWA Icons Hotfix
# ═══════════════════════════════════════════════════════════════════════════════
#
# Что входит:
#   Stage 7:  Icon rail sidebar (60px), command palette, Manrope, skeleton loading
#   Stage 8:  Slide-over drawer, semantic status system, micro-animations, invoices drawer
#   Stage 9:  Dashboard=Home, accent color system, responsive cards, empty state
#   Stage 10: Topbar breadcrumbs, toast redesign, table/form enhancements, FAB, polish
#   Stage 11: Object map (Yandex Maps 2.1), sites table + API, clusterer, drawer dossier
#   Hotfix:   PWA icons regenerated from logo, maskable icons, manifest split
#
# Новые файлы:
#   - migrations/V023__sites_table.sql      (sites table + site_id on works/tenders)
#   - src/routes/sites.js                   (CRUD + geocoding proxy)
#   - public/assets/js/object_map.js        (Yandex Maps frontend)
#   - public/assets/img/icon-*-maskable.png (PWA maskable icons)
#
# Изменённые файлы (основные):
#   - public/assets/css/design-tokens.css   (accent, semantic status vars)
#   - public/assets/css/components.css      (drawer, status, toast, table, form, empty-state)
#   - public/assets/css/layout.css          (icon rail, flyout, breadcrumbs, topbar-search)
#   - public/assets/css/app.css             (responsive cards, FAB, map, scrollbar, polish)
#   - public/assets/js/ui.js               (drawer, statusClass, toast, enableTableSort, formField)
#   - public/assets/js/app.js              (breadcrumbs, FAB, routes, NAV)
#   - public/assets/js/invoices.js         (drawer migration)
#   - public/assets/js/tenders.js          (responsive table)
#   - public/assets/js/custom_dashboard.js (inline styles removed)
#   - public/index.html                    (Yandex Maps API, object_map.js)
#   - public/manifest.json                 (separate any/maskable icons)
#   - public/sw.js                         (cache v24, object_map.js added)
#   - src/index.js                         (sites route registration)
#
# Требуется:
#   - .env: YANDEX_GEOCODER_API_KEY (optional, for geocoding)
#   - Node.js 18+
#   - PostgreSQL (для миграции V023)
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

BRANCH="claude/merge-branches-dedup-T8ugp"
APP_DIR="/opt/asgard-crm"
SERVICE="asgard-crm"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[DEPLOY]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✅ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠️  $1${NC}"; }
err()  { echo -e "${RED}  ❌ $1${NC}"; }

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  АСГАРД CRM — Deploy Stages 7–11 + PWA Icons${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# ─── 1. PRE-FLIGHT CHECKS ────────────────────────────────────────────────────
log "1/7 Pre-flight checks..."

if [ ! -d "$APP_DIR" ]; then
  err "App directory not found: $APP_DIR"
  exit 1
fi
ok "App directory: $APP_DIR"

if ! command -v node &>/dev/null; then
  err "Node.js not found"
  exit 1
fi
ok "Node.js: $(node -v)"

if ! command -v psql &>/dev/null; then
  warn "psql not found — migration verification will be skipped"
fi

if ! systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  warn "Service $SERVICE is not currently running"
else
  ok "Service $SERVICE is running"
fi

# ─── 2. GIT PULL ─────────────────────────────────────────────────────────────
log "2/7 Pulling latest from branch: $BRANCH..."

cd "$APP_DIR"

# Save current commit for rollback reference
PREV_COMMIT=$(git rev-parse HEAD)
log "  Current commit: $PREV_COMMIT"

git fetch origin "$BRANCH" 2>&1 | while read line; do echo "  $line"; done

# Checkout branch if not on it
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  log "  Switching from $CURRENT_BRANCH to $BRANCH..."
  git checkout "$BRANCH" 2>&1 | while read line; do echo "  $line"; done
fi

git pull origin "$BRANCH" 2>&1 | while read line; do echo "  $line"; done

NEW_COMMIT=$(git rev-parse HEAD)
if [ "$PREV_COMMIT" = "$NEW_COMMIT" ]; then
  warn "No new changes (already up to date)"
else
  COMMIT_COUNT=$(git rev-list "$PREV_COMMIT".."$NEW_COMMIT" --count 2>/dev/null || echo "?")
  ok "Pulled $COMMIT_COUNT new commits"
  echo ""
  git log --oneline "$PREV_COMMIT".."$NEW_COMMIT" 2>/dev/null | head -15 | while read line; do
    echo -e "    ${CYAN}$line${NC}"
  done
  echo ""
fi

# ─── 3. INSTALL DEPENDENCIES ─────────────────────────────────────────────────
log "3/7 Checking dependencies..."

if [ -f "package.json" ]; then
  # Only install if package-lock changed or node_modules missing
  if [ ! -d "node_modules" ] || git diff "$PREV_COMMIT".."$NEW_COMMIT" --name-only 2>/dev/null | grep -q "package"; then
    log "  Running npm install..."
    npm install --production 2>&1 | tail -3
    ok "Dependencies installed"
  else
    ok "Dependencies unchanged — skipping npm install"
  fi
fi

# ─── 4. DATABASE MIGRATIONS ──────────────────────────────────────────────────
log "4/7 Running database migrations..."

if [ -f "migrations/run.js" ]; then
  # Check if .env exists
  if [ ! -f ".env" ]; then
    err ".env file not found — cannot run migrations"
    err "Copy .env.example to .env and fill in DB credentials"
    exit 1
  fi

  node migrations/run.js 2>&1 | while read line; do echo "  $line"; done
  MIGRATE_STATUS=$?

  if [ $MIGRATE_STATUS -eq 0 ]; then
    ok "Migrations completed"
  else
    err "Migration failed (exit code: $MIGRATE_STATUS)"
    err "Rolling back to $PREV_COMMIT..."
    git checkout "$PREV_COMMIT" 2>/dev/null
    exit 1
  fi
else
  warn "Migration runner not found — skipping"
fi

# ─── 5. VERIFY NEW FILES ─────────────────────────────────────────────────────
log "5/7 Verifying key files..."

ERRORS=0

check_file() {
  if [ -f "$1" ]; then
    ok "$1"
  else
    err "MISSING: $1"
    ERRORS=$((ERRORS + 1))
  fi
}

check_file "src/routes/sites.js"
check_file "public/assets/js/object_map.js"
check_file "public/assets/img/icon-192-maskable.png"
check_file "public/assets/img/icon-512-maskable.png"
check_file "migrations/V023__sites_table.sql"

# Syntax checks
log "  Checking JS syntax..."
for f in public/assets/js/app.js public/assets/js/ui.js public/assets/js/object_map.js src/routes/sites.js; do
  if node --check "$f" 2>/dev/null; then
    ok "  $f — OK"
  else
    err "  $f — SYNTAX ERROR"
    ERRORS=$((ERRORS + 1))
  fi
done

# Verify manifest.json is valid JSON
if node -e "JSON.parse(require('fs').readFileSync('public/manifest.json','utf8'))" 2>/dev/null; then
  ok "  manifest.json — valid JSON"
else
  err "  manifest.json — INVALID JSON"
  ERRORS=$((ERRORS + 1))
fi

# Check cache version
CACHE_VER=$(grep "CACHE_NAME" public/sw.js | head -1)
ok "  SW $CACHE_VER"

if [ $ERRORS -gt 0 ]; then
  err "$ERRORS verification errors found!"
  exit 1
fi

# ─── 6. RESTART SERVICE ──────────────────────────────────────────────────────
log "6/7 Restarting service: $SERVICE..."

sudo systemctl restart "$SERVICE" 2>&1 | while read line; do echo "  $line"; done

# Wait and check
sleep 3

if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  ok "Service $SERVICE is running"
else
  err "Service $SERVICE failed to start!"
  echo ""
  log "Last 20 lines of journal:"
  sudo journalctl -u "$SERVICE" -n 20 --no-pager 2>&1 | while read line; do echo "  $line"; done
  echo ""
  err "Deploy FAILED — service not running"
  err "Rollback: git checkout $PREV_COMMIT && sudo systemctl restart $SERVICE"
  exit 1
fi

# ─── 7. POST-DEPLOY VERIFICATION ─────────────────────────────────────────────
log "7/7 Post-deploy verification..."

# Check if app responds
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  ok "API health check: HTTP $HTTP_CODE"
else
  warn "API health check returned: HTTP $HTTP_CODE (may need a moment)"
fi

# Check sites API (will 401 without auth, but that means the route exists)
SITES_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/sites 2>/dev/null || echo "000")
if [ "$SITES_CODE" = "401" ] || [ "$SITES_CODE" = "200" ]; then
  ok "Sites API route active: HTTP $SITES_CODE"
else
  warn "Sites API route returned: HTTP $SITES_CODE"
fi

# ─── DONE ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✅ DEPLOY COMPLETE${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Branch:     ${CYAN}$BRANCH${NC}"
echo -e "  Commit:     ${CYAN}$(git rev-parse --short HEAD)${NC} — $(git log -1 --format='%s')"
echo -e "  Previous:   ${CYAN}$(echo $PREV_COMMIT | cut -c1-7)${NC}"
echo -e "  Cache:      ${CYAN}$CACHE_VER${NC}"
echo ""
echo -e "  ${YELLOW}Rollback command:${NC}"
echo -e "    cd $APP_DIR && git checkout $PREV_COMMIT && sudo systemctl restart $SERVICE"
echo ""
echo -e "  ${YELLOW}Yandex Maps API:${NC}"
echo -e "    If geocoding is needed, add to .env:"
echo -e "    YANDEX_GEOCODER_API_KEY=your-key-from-developer.tech.yandex.ru"
echo ""

# Summary of what changed
echo -e "  ${BOLD}Changelog:${NC}"
echo -e "    Stage 7:  Icon rail sidebar, command palette, Manrope fonts, skeleton loading"
echo -e "    Stage 8:  Slide-over drawer, semantic status, micro-animations"
echo -e "    Stage 9:  Dashboard=Home, accent colors, responsive cards, empty state"
echo -e "    Stage 10: Breadcrumbs, toast redesign, table sort, form grid, FAB, polish"
echo -e "    Stage 11: Object map (Yandex Maps), sites DB + API, clusterer, pin placement"
echo -e "    Hotfix:   PWA icons regenerated, maskable icons, manifest updated"
echo ""
