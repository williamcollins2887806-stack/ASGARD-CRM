#!/bin/bash
###############################################################################
# ASGARD CRM — Полный скрипт обновления сервера
# Ветка: claude/recover-server-rollback-cGV6m
# Дата: 2026-02-17
# Включает ВСЕ 8 коммитов:
#   1-7. Основные правки (18+ исправлений, мессенджер, касса, мобильная навигация)
#   8.   Cache Busting + Push-уведомления + WebAuthn (биометрия)
#
# Миграция БД: 3 новые таблицы + 2 колонки (авто через ensureTables)
# Новые зависимости: web-push, @simplewebauthn/server
###############################################################################

set -e

# ═══════════════════════════════════════════════════════════════════════════
# КОНФИГУРАЦИЯ — отредактируйте под ваш сервер
# ═══════════════════════════════════════════════════════════════════════════
APP_DIR="/var/www/asgard-crm"          # путь к проекту на сервере
BRANCH="claude/recover-server-rollback-cGV6m"
BACKUP_DIR="/root/backups/asgard_$(date +%Y%m%d_%H%M%S)"
LOG_FILE="/root/update_asgard_$(date +%Y%m%d_%H%M%S).log"
PM2_NAME="asgard-crm"                 # имя процесса в PM2

# Если APP_DIR не существует, проверяем альтернативный путь
if [ ! -d "$APP_DIR" ]; then
    if [ -d "/root/ASGARD-CRM" ]; then
        APP_DIR="/root/ASGARD-CRM"
    else
        echo "ОШИБКА: Директория проекта не найдена. Укажите APP_DIR вручную."
        exit 1
    fi
fi

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC}  $1" | tee -a "$LOG_FILE"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC}  $1" | tee -a "$LOG_FILE"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✓${NC}  $1" | tee -a "$LOG_FILE"; }

echo "" | tee -a "$LOG_FILE"
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════╗${NC}" | tee -a "$LOG_FILE"
echo -e "${CYAN}║     ASGARD CRM — Полное обновление сервера (8 коммитов)     ║${NC}" | tee -a "$LOG_FILE"
echo -e "${CYAN}║     Cache Busting + Push + WebAuthn + миграция БД           ║${NC}" | tee -a "$LOG_FILE"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════╝${NC}" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

###############################################################################
# 1/10 — БЭКАП
###############################################################################
log "1/10 Создание бэкапа..."
mkdir -p "$BACKUP_DIR"

for dir in public src scripts; do
    if [ -d "$APP_DIR/$dir" ]; then
        cp -r "$APP_DIR/$dir" "$BACKUP_DIR/$dir"
    fi
done
for f in package.json package-lock.json .env; do
    if [ -f "$APP_DIR/$f" ]; then
        cp "$APP_DIR/$f" "$BACKUP_DIR/$f"
    fi
done
ok "Бэкап: $BACKUP_DIR"

###############################################################################
# 2/10 — GIT PULL
###############################################################################
log "2/10 Получение обновлений из git..."
cd "$APP_DIR"

CURRENT=$(git branch --show-current 2>/dev/null || echo "unknown")
log "  Текущая ветка: $CURRENT"

# Fetch с ретраями
fetch_ok=0
for attempt in 1 2 3 4; do
    if git fetch origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE"; then
        fetch_ok=1
        break
    fi
    delay=$((2 ** attempt))
    warn "  git fetch попытка $attempt не удалась, ждём ${delay}с..."
    sleep $delay
done
if [ $fetch_ok -eq 0 ]; then
    err "git fetch не удался после 4 попыток"
    exit 1
fi

if [ "$CURRENT" != "$BRANCH" ]; then
    log "  Переключение на ветку $BRANCH..."
    # Сохраняем локальные изменения если есть
    if ! git diff --quiet 2>/dev/null; then
        warn "  Есть локальные изменения, делаем stash..."
        git stash push -m "auto-stash before update $(date +%Y%m%d_%H%M%S)" 2>&1 | tee -a "$LOG_FILE"
    fi
    git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH" 2>&1 | tee -a "$LOG_FILE"
    if [ $? -ne 0 ]; then
        err "Не удалось переключиться на ветку $BRANCH"
        exit 1
    fi
fi

git pull origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE" || { err "git pull failed"; exit 1; }

COMMIT=$(git log -1 --format="%h %s")
ok "Коммит: $COMMIT"

###############################################################################
# 3/10 — NPM INSTALL (новые зависимости: web-push, @simplewebauthn/server)
###############################################################################
log "3/10 Установка зависимостей (web-push, @simplewebauthn/server)..."
if [ -f "package.json" ]; then
    npm install --production 2>&1 | tail -5 | tee -a "$LOG_FILE"
    ok "npm install завершён"
else
    err "package.json не найден!"
    exit 1
fi

###############################################################################
# 4/10 — МИГРАЦИЯ БД (SQL — на случай если ensureTables не сработает)
###############################################################################
log "4/10 Миграция БД..."

# Читаем параметры подключения из .env
if [ -f ".env" ]; then
    source <(grep -E '^(DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD|DATABASE_URL)=' .env | sed 's/^/export /')
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-asgard_crm}"
DB_USER="${DB_USER:-asgard}"

# Формируем PGPASSWORD для psql
if [ -n "$DB_PASSWORD" ]; then
    export PGPASSWORD="$DB_PASSWORD"
fi

# Проверяем доступность psql
if command -v psql &> /dev/null; then
    log "  Выполняю SQL-миграцию..."

    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=0 <<'MIGRATION_SQL' 2>&1 | tee -a "$LOG_FILE"

-- ═══════════════════════════════════════════════════════════
-- Миграция: Phase 2 — Push Notifications
-- ═══════════════════════════════════════════════════════════

-- Таблица подписок на push-уведомления
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device_info VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_sub_user_id ON push_subscriptions(user_id);

-- Колонки url и body в notifications (если отсутствуют)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='notifications' AND column_name='url') THEN
        ALTER TABLE notifications ADD COLUMN url VARCHAR(500);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='notifications' AND column_name='body') THEN
        ALTER TABLE notifications ADD COLUMN body TEXT;
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- Миграция: Phase 3 — WebAuthn (Biometric Login)
-- ═══════════════════════════════════════════════════════════

-- Таблица WebAuthn-ключей пользователей
CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    credential_id TEXT NOT NULL UNIQUE,
    public_key BYTEA NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    device_name VARCHAR(255) DEFAULT 'Устройство',
    transports TEXT[],
    created_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_webauthn_user_id ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_cred_id ON webauthn_credentials(credential_id);

-- Таблица временных WebAuthn-челленджей (TTL 5 мин)
CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    challenge TEXT NOT NULL,
    type VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

MIGRATION_SQL

    if [ $? -eq 0 ]; then
        ok "SQL-миграция выполнена"
    else
        warn "SQL-миграция завершилась с предупреждениями (таблицы могут уже существовать)"
    fi
else
    warn "psql не найден — миграция будет выполнена автоматически при старте сервера (ensureTables)"
fi

###############################################################################
# 5/10 — VAPID КЛЮЧИ (для Push-уведомлений)
###############################################################################
log "5/10 Проверка VAPID-ключей..."

if [ -f ".env" ]; then
    HAS_VAPID=$(grep -c "VAPID_PUBLIC_KEY" .env 2>/dev/null || echo "0")
else
    HAS_VAPID=0
fi

if [ "$HAS_VAPID" -eq 0 ]; then
    log "  VAPID-ключи не найдены в .env, генерируем..."
    if [ -f "scripts/generate-vapid-keys.js" ]; then
        VAPID_OUTPUT=$(node scripts/generate-vapid-keys.js 2>/dev/null)
        if [ $? -eq 0 ]; then
            # Извлекаем ключи и добавляем в .env
            VPUB=$(echo "$VAPID_OUTPUT" | grep "VAPID_PUBLIC_KEY=" | cut -d'=' -f2)
            VPRIV=$(echo "$VAPID_OUTPUT" | grep "VAPID_PRIVATE_KEY=" | cut -d'=' -f2)
            VEMAIL=$(echo "$VAPID_OUTPUT" | grep "VAPID_EMAIL=" | cut -d'=' -f2)

            if [ -n "$VPUB" ] && [ -n "$VPRIV" ]; then
                echo "" >> .env
                echo "# Push Notifications (VAPID) — auto-generated $(date +%Y-%m-%d)" >> .env
                echo "VAPID_PUBLIC_KEY=$VPUB" >> .env
                echo "VAPID_PRIVATE_KEY=$VPRIV" >> .env
                echo "VAPID_EMAIL=${VEMAIL:-mailto:admin@asgard-crm.ru}" >> .env
                ok "VAPID-ключи сгенерированы и добавлены в .env"
            else
                warn "Не удалось извлечь VAPID-ключи из вывода скрипта"
            fi
        else
            warn "Генерация VAPID не удалась (web-push не установлен?)"
        fi
    else
        warn "scripts/generate-vapid-keys.js не найден"
    fi
else
    ok "VAPID-ключи уже есть в .env"
fi

###############################################################################
# 6/10 — ПРОВЕРКА .ENV (WebAuthn)
###############################################################################
log "6/10 Проверка .env переменных для WebAuthn..."

if [ -f ".env" ]; then
    MISSING_ENV=0

    # Определяем домен сервера
    SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
    DETECTED_DOMAIN=$(grep -oP 'DOMAIN\s*=\s*\K.*' .env 2>/dev/null || echo "")

    if ! grep -q "WEBAUTHN_ORIGIN" .env 2>/dev/null; then
        if [ -n "$DETECTED_DOMAIN" ]; then
            echo "WEBAUTHN_ORIGIN=https://$DETECTED_DOMAIN" >> .env
            echo "WEBAUTHN_RP_ID=$DETECTED_DOMAIN" >> .env
            ok "WebAuthn настроен для домена: $DETECTED_DOMAIN"
        else
            warn "Добавьте в .env вручную (замените YOUR_DOMAIN):"
            warn "  WEBAUTHN_ORIGIN=https://YOUR_DOMAIN"
            warn "  WEBAUTHN_RP_ID=YOUR_DOMAIN"
            echo "" >> .env
            echo "# WebAuthn (Biometric Login) — ЗАПОЛНИТЕ ВРУЧНУЮ" >> .env
            echo "# WEBAUTHN_ORIGIN=https://your-domain.ru" >> .env
            echo "# WEBAUTHN_RP_ID=your-domain.ru" >> .env
            MISSING_ENV=1
        fi
    else
        ok "WebAuthn .env уже настроен"
    fi
else
    err ".env файл не найден!"
fi

###############################################################################
# 7/10 — СОЗДАНИЕ ДИРЕКТОРИЙ
###############################################################################
log "7/10 Создание директорий..."
mkdir -p uploads/chat uploads/mail uploads/pre_tenders uploads/tkp
chmod -R 755 uploads/
ok "uploads/ — готовы"

###############################################################################
# 8/10 — ПРОВЕРКА ФАЙЛОВ
###############################################################################
log "8/10 Проверка файлов..."
ERRORS=0

# Backend-файлы (включая новые)
BACKEND_FILES=(
    "src/index.js"
    "src/config.js"
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
    "src/routes/push.js"
    "src/routes/webauthn.js"
    "src/routes/inbox_applications_ai.js"
    "src/services/ai-email-analyzer.js"
    "src/services/imap.js"
    "src/services/NotificationService.js"
)

for f in "${BACKEND_FILES[@]}"; do
    if [ ! -f "$f" ]; then
        err "ОТСУТСТВУЕТ: $f"
        ERRORS=$((ERRORS + 1))
    else
        node -c "$f" 2>/dev/null || { err "СИНТАКСИС: $f"; ERRORS=$((ERRORS + 1)); }
    fi
done

# Frontend JS (включая новые)
JS_FILES=(
    "public/assets/js/app.js"
    "public/assets/js/settings.js"
    "public/assets/js/push-notifications.js"
    "public/assets/js/webauthn.js"
    "public/assets/js/acts.js"
    "public/assets/js/approvals.js"
    "public/assets/js/calculator_v2.js"
    "public/assets/js/cash.js"
    "public/assets/js/dashboard.js"
    "public/assets/js/email.js"
    "public/assets/js/global_search.js"
    "public/assets/js/mobile.js"
    "public/assets/js/tenders.js"
    "public/assets/js/warehouse.js"
)

for f in "${JS_FILES[@]}"; do
    if [ ! -f "$f" ]; then
        err "ОТСУТСТВУЕТ: $f"
        ERRORS=$((ERRORS + 1))
    fi
done

# Ключевые файлы
for f in "public/index.html" "public/sw.js" "scripts/bump-version.js" "scripts/generate-vapid-keys.js"; do
    if [ ! -f "$f" ]; then
        err "ОТСУТСТВУЕТ: $f"
        ERRORS=$((ERRORS + 1))
    fi
done

if [ $ERRORS -gt 0 ]; then
    err "Обнаружено $ERRORS ошибок! Прерываю."
    err "Для отката: cp -r $BACKUP_DIR/* $APP_DIR/ && pm2 restart $PM2_NAME"
    exit 1
fi

ok "Все файлы на месте, синтаксис OK"

###############################################################################
# 9/10 — ПЕРЕЗАПУСК
###############################################################################
log "9/10 Перезапуск сервера..."

if command -v pm2 &> /dev/null; then
    pm2 restart "$PM2_NAME" 2>/dev/null || pm2 restart all 2>/dev/null || {
        warn "pm2 restart не удался, запускаю..."
        pm2 start src/index.js --name "$PM2_NAME" 2>&1 | tee -a "$LOG_FILE"
    }
    ok "PM2 перезапущен"
    sleep 3
    pm2 status | tee -a "$LOG_FILE"
else
    warn "PM2 не найден. Перезапустите вручную: cd $APP_DIR && node src/index.js"
fi

###############################################################################
# 10/10 — ПРОВЕРКА ЗДОРОВЬЯ
###############################################################################
log "10/10 Проверка доступности..."
sleep 3

PORT=$(grep -oP 'PORT\s*=\s*\K\d+' "$APP_DIR/.env" 2>/dev/null || echo "3000")

HEALTH_OK=0
for endpoint in "/api/health" "/"; do
    if curl -sf "http://localhost:$PORT$endpoint" > /dev/null 2>&1; then
        ok "Сервер отвечает на http://localhost:$PORT$endpoint"
        HEALTH_OK=1
        break
    fi
done

if [ $HEALTH_OK -eq 0 ]; then
    warn "Сервер не отвечает на порту $PORT"
    warn "Проверьте: pm2 logs $PM2_NAME"
fi

###############################################################################
# ИТОГО
###############################################################################
echo "" | tee -a "$LOG_FILE"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
echo -e "${GREEN}${BOLD} Обновление завершено!${NC}" | tee -a "$LOG_FILE"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo -e " Коммит:   ${YELLOW}$COMMIT${NC}" | tee -a "$LOG_FILE"
echo -e " Бэкап:    $BACKUP_DIR" | tee -a "$LOG_FILE"
echo -e " Лог:      $LOG_FILE" | tee -a "$LOG_FILE"
echo -e " Директория: $APP_DIR" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo -e " ${CYAN}Что включено (8 коммитов):${NC}" | tee -a "$LOG_FILE"
echo -e "  1. Major update: fix 18+ issues (калькулятор, тендеры, email AI, карта)" | tee -a "$LOG_FILE"
echo -e "  2. Fix employee selectors + mobile layout" | tee -a "$LOG_FILE"
echo -e "  3. Business process unit-тесты" | tee -a "$LOG_FILE"
echo -e "  4. Убраны заливки/фоны канбан-карточек" | tee -a "$LOG_FILE"
echo -e "  5. Единый мессенджер (личные + групповые чаты)" | tee -a "$LOG_FILE"
echo -e "  6. Мобильная навигация + викинг-стиль" | tee -a "$LOG_FILE"
echo -e "  7. Редизайн Кассы: карточки, KPI, категории" | tee -a "$LOG_FILE"
echo -e "  ${BOLD}8. Cache Busting + Push-уведомления + WebAuthn биометрия${NC}" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo -e " ${CYAN}Новое в коммите 8:${NC}" | tee -a "$LOG_FILE"
echo -e "  • Service Worker: Network First (HTML) + Stale-While-Revalidate (статика)" | tee -a "$LOG_FILE"
echo -e "  • Баннер обновления: «Доступна новая версия»" | tee -a "$LOG_FILE"
echo -e "  • Push-уведомления через VAPID (web-push)" | tee -a "$LOG_FILE"
echo -e "  • Биометрический вход: Face ID / Touch ID / отпечаток" | tee -a "$LOG_FILE"
echo -e "  • 3 новых таблицы: push_subscriptions, webauthn_credentials, webauthn_challenges" | tee -a "$LOG_FILE"
echo -e "  • scripts/bump-version.js — семвер для релизов" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo -e " ${YELLOW}Для отката:${NC}" | tee -a "$LOG_FILE"
echo -e "   cp -r $BACKUP_DIR/* $APP_DIR/" | tee -a "$LOG_FILE"
echo -e "   pm2 restart $PM2_NAME" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Напоминание про WebAuthn домен если не настроен
if [ "${MISSING_ENV:-0}" -eq 1 ]; then
    echo -e " ${RED}${BOLD}⚠ ВНИМАНИЕ: Настройте WebAuthn в .env:${NC}" | tee -a "$LOG_FILE"
    echo -e "   nano $APP_DIR/.env" | tee -a "$LOG_FILE"
    echo -e "   # Раскомментируйте и заполните:" | tee -a "$LOG_FILE"
    echo -e "   WEBAUTHN_ORIGIN=https://your-domain.ru" | tee -a "$LOG_FILE"
    echo -e "   WEBAUTHN_RP_ID=your-domain.ru" | tee -a "$LOG_FILE"
    echo -e "   # Затем: pm2 restart $PM2_NAME" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
fi
