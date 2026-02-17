#!/bin/bash
###############################################################################
# ASGARD CRM — Скрипт обновления сервера
# Ветка: claude/recover-server-rollback-cGV6m
# Дата: 2026-02-17
# Включает все 7 коммитов (16-17 февраля):
#   1. Major update: fix 18+ issues across CRM
#   2. Fix employee selectors and mobile layout
#   3. Add business process tests and fix duplicate tasks module
#   4. Remove fills/backgrounds from kanban cards and columns
#   5. Unified Messenger: merge direct + group chats into single tab
#   6. Mobile bottom nav, Viking naming, responsive messenger, cash migration
#   7. Redesign Касса: card-based UI with progress steps, categories, KPI
###############################################################################

set -e

APP_DIR="/root/ASGARD-CRM"
BRANCH="claude/recover-server-rollback-cGV6m"
BACKUP_DIR="/root/backups/$(date +%Y%m%d_%H%M%S)"
LOG_FILE="/root/update_$(date +%Y%m%d_%H%M%S).log"

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARN:${NC} $1" | tee -a "$LOG_FILE"; }
err() { echo -e "${RED}[$(date +%H:%M:%S)] ERROR:${NC} $1" | tee -a "$LOG_FILE"; }

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   ASGARD CRM — Обновление сервера (7 коммитов)     ║${NC}"
echo -e "${CYAN}║   Ветка: $BRANCH  ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

###############################################################################
# 1. Бэкап текущей версии
###############################################################################
log "1/8 Создание бэкапа..."
mkdir -p "$BACKUP_DIR"

if [ -d "$APP_DIR/public" ]; then
    cp -r "$APP_DIR/public" "$BACKUP_DIR/public"
    log "  -> public/ скопирован"
fi
if [ -d "$APP_DIR/src" ]; then
    cp -r "$APP_DIR/src" "$BACKUP_DIR/src"
    log "  -> src/ скопирован"
fi
if [ -f "$APP_DIR/package.json" ]; then
    cp "$APP_DIR/package.json" "$BACKUP_DIR/package.json"
fi
log "  Бэкап: $BACKUP_DIR"

###############################################################################
# 2. Переход в директорию приложения
###############################################################################
log "2/8 Переход в $APP_DIR..."
cd "$APP_DIR"

###############################################################################
# 3. Git pull
###############################################################################
log "3/8 Получение обновлений из git..."

# Проверяем текущую ветку
CURRENT=$(git branch --show-current 2>/dev/null || echo "unknown")
log "  Текущая ветка: $CURRENT"

if [ "$CURRENT" != "$BRANCH" ]; then
    log "  Переключение на ветку $BRANCH..."
    git fetch origin "$BRANCH" || { err "git fetch failed"; exit 1; }
    git checkout "$BRANCH" || git checkout -b "$BRANCH" "origin/$BRANCH" || { err "git checkout failed"; exit 1; }
fi

git pull origin "$BRANCH" || { err "git pull failed"; exit 1; }

COMMIT=$(git log -1 --format="%h %s")
log "  Текущий коммит: $COMMIT"

###############################################################################
# 4. Проверка зависимостей
###############################################################################
log "4/8 Проверка зависимостей..."
if [ -f "package.json" ]; then
    npm install --production 2>&1 | tail -3 | tee -a "$LOG_FILE"
    log "  npm install завершён"
fi

###############################################################################
# 5. Создание необходимых директорий
###############################################################################
log "5/8 Создание директорий для загрузок..."
mkdir -p uploads/chat
mkdir -p uploads/mail
mkdir -p uploads/pre_tenders
mkdir -p uploads/tkp
chmod -R 755 uploads/
log "  uploads/chat, uploads/mail, uploads/tkp — готовы"

###############################################################################
# 6. Проверка файлов (44 изменённых файла)
###############################################################################
log "6/8 Проверка наличия ключевых файлов..."

ERRORS=0

# --- Backend (13 файлов) ---
BACKEND_FILES=(
    "src/index.js"
    "src/routes/cash.js"
    "src/routes/chat_groups.js"
    "src/routes/data.js"
    "src/routes/payroll.js"
    "src/routes/pre_tenders.js"
    "src/routes/sites.js"
    "src/routes/tasks.js"
    "src/routes/acts.js"
    "src/routes/invoices.js"
    "src/routes/tkp.js"
    "src/routes/inbox_applications_ai.js"
    "src/services/ai-email-analyzer.js"
    "src/services/imap.js"
)

for f in "${BACKEND_FILES[@]}"; do
    if [ ! -f "$f" ]; then
        err "  ОТСУТСТВУЕТ: $f"
        ERRORS=$((ERRORS + 1))
    fi
done

# Синтаксическая проверка backend-файлов
for f in "${BACKEND_FILES[@]}"; do
    if [ -f "$f" ]; then
        node -c "$f" 2>/dev/null || { err "  СИНТАКС ОШИБКА: $f"; ERRORS=$((ERRORS + 1)); }
    fi
done

# --- Frontend CSS (3 файла) ---
CSS_FILES=(
    "public/assets/css/app.css"
    "public/assets/css/components.css"
    "public/assets/css/layout.css"
)

for f in "${CSS_FILES[@]}"; do
    if [ ! -f "$f" ]; then
        err "  ОТСУТСТВУЕТ: $f"
        ERRORS=$((ERRORS + 1))
    fi
done

# --- Frontend JS (24 файла) ---
JS_FILES=(
    "public/assets/js/app.js"
    "public/assets/js/acts.js"
    "public/assets/js/approvals.js"
    "public/assets/js/calc_excel_export.js"
    "public/assets/js/calculator_v2.js"
    "public/assets/js/cash.js"
    "public/assets/js/cash_admin.js"
    "public/assets/js/chat_groups.js"
    "public/assets/js/dashboard.js"
    "public/assets/js/email.js"
    "public/assets/js/geo_score.js"
    "public/assets/js/global_search.js"
    "public/assets/js/invoices.js"
    "public/assets/js/kpi_money.js"
    "public/assets/js/mobile.js"
    "public/assets/js/object_map.js"
    "public/assets/js/permit_applications.js"
    "public/assets/js/pm_calcs.js"
    "public/assets/js/tasks-page.js"
    "public/assets/js/tenders.js"
    "public/assets/js/tkp-page.js"
    "public/assets/js/warehouse.js"
)

for f in "${JS_FILES[@]}"; do
    if [ ! -f "$f" ]; then
        err "  ОТСУТСТВУЕТ: $f"
        ERRORS=$((ERRORS + 1))
    fi
done

# --- index.html ---
if [ ! -f "public/index.html" ]; then
    err "  ОТСУТСТВУЕТ: public/index.html"
    ERRORS=$((ERRORS + 1))
fi

# --- Тесты (4 файла) ---
TEST_FILES=(
    "tests/helpers/env-setup.js"
    "tests/helpers/global-setup.js"
    "tests/helpers/global-teardown.js"
    "tests/unit/business-logic.test.js"
)

for f in "${TEST_FILES[@]}"; do
    if [ ! -f "$f" ]; then
        warn "  Тест отсутствует (не критично): $f"
    fi
done

if [ $ERRORS -gt 0 ]; then
    err "Обнаружено $ERRORS ошибок! Прерываю обновление."
    err "Для отката: cp -r $BACKUP_DIR/* $APP_DIR/"
    exit 1
fi

log "  Все файлы на месте, синтаксис OK"

###############################################################################
# 7. Перезапуск сервера
###############################################################################
log "7/8 Перезапуск сервера..."

# Определяем менеджер процессов
if command -v pm2 &> /dev/null; then
    PM="pm2"
    pm2 restart asgard-crm 2>/dev/null || pm2 restart all 2>/dev/null || {
        warn "  pm2 restart не удался, пробуем запустить..."
        pm2 start src/index.js --name asgard-crm 2>&1 | tee -a "$LOG_FILE"
    }
    log "  PM2: перезапущен"
    sleep 3
    pm2 status | tee -a "$LOG_FILE"
elif command -v systemctl &> /dev/null && systemctl list-units --type=service | grep -q asgard; then
    PM="systemd"
    systemctl restart asgard-crm 2>&1 | tee -a "$LOG_FILE"
    log "  systemd: перезапущен"
    sleep 3
    systemctl status asgard-crm --no-pager | head -10 | tee -a "$LOG_FILE"
else
    PM="manual"
    warn "  PM2/systemd не найдены. Перезапустите вручную:"
    warn "  cd $APP_DIR && node src/index.js"
    # Попробуем найти запущенный процесс
    PID=$(pgrep -f "node.*index.js" 2>/dev/null || true)
    if [ -n "$PID" ]; then
        log "  Найден процесс PID=$PID, перезапускаю..."
        kill "$PID" 2>/dev/null || true
        sleep 2
        cd "$APP_DIR"
        nohup node src/index.js >> /root/asgard.log 2>&1 &
        log "  Запущен новый процесс PID=$!"
    fi
fi

###############################################################################
# 8. Проверка работы
###############################################################################
log "8/8 Проверка доступности..."

sleep 3

# Определяем порт
PORT=$(grep -oP 'PORT\s*=\s*\K\d+' "$APP_DIR/.env" 2>/dev/null || echo "3000")

if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    log "  /api/health — OK"
elif curl -sf "http://localhost:$PORT/" > /dev/null 2>&1; then
    log "  Сервер отвечает на порту $PORT — OK"
else
    warn "  Сервер не отвечает на порту $PORT"
    warn "  Проверьте: curl http://localhost:$PORT/"
    warn "  Логи: pm2 logs / journalctl -u asgard-crm / cat /root/asgard.log"
fi

###############################################################################
# Итого
###############################################################################
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN} Обновление завершено!${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e " Коммит:  ${YELLOW}$COMMIT${NC}"
echo -e " Бэкап:   $BACKUP_DIR"
echo -e " Лог:     $LOG_FILE"
echo -e " Менеджер: $PM"
echo ""
echo -e " ${CYAN}Что обновлено (7 коммитов):${NC}"
echo -e "  1. Major update: fix 18+ issues (калькулятор, тендеры, email AI, карта)"
echo -e "  2. Fix employee selectors + mobile layout"
echo -e "  3. Business process unit-тесты (756 строк)"
echo -e "  4. Убраны заливки/фоны канбан-карточек"
echo -e "  5. Единый мессенджер (личные + групповые чаты, файлы)"
echo -e "  6. Мобильная навигация + викинг-стиль + CSS адаптация"
echo -e "  7. Редизайн Кассы: карточки, KPI, категории расходов"
echo ""
echo -e " ${YELLOW}Для отката:${NC}"
echo -e "   cp -r $BACKUP_DIR/* $APP_DIR/"
echo -e "   pm2 restart asgard-crm"
echo ""
