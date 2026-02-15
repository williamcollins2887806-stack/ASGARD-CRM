#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  ASGARD CRM — Миграции + Деплой + Тесты (всё в одном)
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Использование:
#    ./scripts/deploy-and-test.sh                  # полный цикл
#    ./scripts/deploy-and-test.sh --skip-backup    # без бэкапа (dev)
#    ./scripts/deploy-and-test.sh --skip-tests     # без тестов
#    ./scripts/deploy-and-test.sh --local          # без git pull, работает с текущей папкой
#    ./scripts/deploy-and-test.sh --dry-run        # показать план без выполнения
#
set -euo pipefail

# ─── Цвета ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Конфигурация ─────────────────────────────────────────────────────────────
APP_DIR="${APP_DIR:-/var/www/asgard-crm}"
BRANCH="${BRANCH:-claude/fix-test-failures-H7pjy}"
REPO="${REPO:-https://github.com/williamcollins2887806-stack/ASGARD-CRM.git}"
PORT="${PORT:-3000}"
HEALTH_URL="http://localhost:${PORT}/api/health"
MAX_WAIT=30           # секунд ждать старта
TEST_TIMEOUT=300      # секунд на тесты

# ─── Флаги ────────────────────────────────────────────────────────────────────
SKIP_BACKUP=false
SKIP_TESTS=false
LOCAL_MODE=false
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --skip-backup) SKIP_BACKUP=true ;;
    --skip-tests)  SKIP_TESTS=true ;;
    --local)       LOCAL_MODE=true ;;
    --dry-run)     DRY_RUN=true ;;
    --help|-h)
      echo "Использование: $0 [--skip-backup] [--skip-tests] [--local] [--dry-run]"
      echo ""
      echo "  --skip-backup   Пропустить создание бэкапа"
      echo "  --skip-tests    Пропустить запуск тестов"
      echo "  --local         Работать с текущей папкой (без git clone)"
      echo "  --dry-run       Показать план без выполнения"
      echo ""
      echo "Переменные окружения:"
      echo "  APP_DIR   Путь к приложению (default: /var/www/asgard-crm)"
      echo "  BRANCH    Git-ветка (default: claude/fix-test-failures-H7pjy)"
      echo "  PORT      Порт приложения (default: 3000)"
      exit 0
      ;;
    *) echo -e "${RED}Неизвестный аргумент: $arg${NC}"; exit 1 ;;
  esac
done

# ─── Утилиты ──────────────────────────────────────────────────────────────────
STEP=0
TOTAL_STEPS=8

step() {
  STEP=$((STEP + 1))
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  [${STEP}/${TOTAL_STEPS}] $1${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

ok()   { echo -e "  ${GREEN}✅ $1${NC}"; }
warn() { echo -e "  ${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "  ${RED}❌ $1${NC}"; }
info() { echo -e "  ${BLUE}▸ $1${NC}"; }

die() {
  fail "$1"
  echo ""
  echo -e "${RED}═══ ДЕПЛОЙ ПРЕРВАН ══=${NC}"
  exit 1
}

DEPLOY_START=$(date +%s)
BACKUP_DIR=""

# ─── Заголовок ────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   ⚔️  ASGARD CRM — Миграции + Деплой + Тесты                 ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Дата:   $(date '+%Y-%m-%d %H:%M:%S')"
echo -e "  Ветка:  ${CYAN}${BRANCH}${NC}"
echo -e "  Режим:  $( [ "$LOCAL_MODE" = true ] && echo 'локальный' || echo 'полный деплой' )"
echo -e "  Тесты:  $( [ "$SKIP_TESTS" = true ] && echo 'пропущены' || echo 'будут запущены' )"
echo -e "  Бэкап:  $( [ "$SKIP_BACKUP" = true ] && echo 'пропущен' || echo 'будет создан' )"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo -e "${YELLOW}  ── DRY RUN: план выполнения ──${NC}"
  echo "  1. Проверка зависимостей (node, npm, pg)"
  echo "  2. Бэкап текущей версии"
  echo "  3. $( [ "$LOCAL_MODE" = true ] && echo 'Использовать текущую папку' || echo "Git clone $BRANCH" )"
  echo "  4. Проверка .env (DB_PASSWORD, JWT_SECRET)"
  echo "  5. npm install"
  echo "  6. Миграции БД (V001..V035)"
  echo "  7. Перезапуск приложения (PM2 или node)"
  echo "  8. Health-check + запуск тестов"
  echo ""
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  ШАГ 1: Проверка зависимостей
# ═══════════════════════════════════════════════════════════════════════════════
step "Проверка зависимостей"

command -v node >/dev/null 2>&1 || die "node не найден. Установите Node.js 18+"
command -v npm  >/dev/null 2>&1 || die "npm не найден"

NODE_VER=$(node -v)
info "Node.js ${NODE_VER}"
info "npm $(npm -v)"

# PM2 — опционально (если нет, запустим через node)
HAS_PM2=false
if command -v pm2 >/dev/null 2>&1; then
  HAS_PM2=true
  info "PM2 $(pm2 -v)"
else
  warn "PM2 не найден — приложение будет запущено через node"
fi

# PostgreSQL клиент для проверки соединения
if command -v psql >/dev/null 2>&1; then
  info "psql $(psql --version | head -1)"
else
  warn "psql не найден — проверка БД будет через node"
fi

ok "Зависимости в порядке"

# ═══════════════════════════════════════════════════════════════════════════════
#  ШАГ 2: Бэкап
# ═══════════════════════════════════════════════════════════════════════════════
step "Бэкап текущей версии"

if [ "$SKIP_BACKUP" = true ]; then
  info "Бэкап пропущен (--skip-backup)"
elif [ "$LOCAL_MODE" = true ]; then
  info "Локальный режим — бэкап не требуется"
elif [ -d "$APP_DIR" ]; then
  BACKUP_DIR="${APP_DIR}-backup-$(date +%Y%m%d_%H%M%S)"
  sudo cp -a "$APP_DIR" "$BACKUP_DIR"
  BACKUP_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
  ok "Бэкап создан: ${BACKUP_DIR} (${BACKUP_SIZE})"
else
  info "Папка $APP_DIR не найдена — первый деплой"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  ШАГ 3: Получение кода
# ═══════════════════════════════════════════════════════════════════════════════
step "Получение кода"

if [ "$LOCAL_MODE" = true ]; then
  # Работаем в текущей директории
  WORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  info "Локальный режим: ${WORK_DIR}"

  cd "$WORK_DIR"

  if [ -d .git ]; then
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    info "Текущая ветка: ${CURRENT_BRANCH}"

    # Подтянуть последние изменения, если это git-репо
    if git remote -v 2>/dev/null | grep -q origin; then
      info "Подтягиваю обновления..."
      git pull origin "$CURRENT_BRANCH" 2>/dev/null || warn "git pull не удался (возможно, offline)"
    fi

    LAST_COMMIT=$(git log --oneline -1 2>/dev/null || echo "unknown")
    ok "Коммит: ${LAST_COMMIT}"
  else
    warn "Не git-репозиторий"
  fi
else
  # Полный деплой: клонируем с github
  info "Клонирую ветку ${BRANCH}..."

  rm -rf /tmp/asgard-deploy
  git clone --branch "$BRANCH" --single-branch --depth 1 "$REPO" /tmp/asgard-deploy \
    || die "Не удалось клонировать репозиторий"

  LAST_COMMIT=$(cd /tmp/asgard-deploy && git log --oneline -1)
  ok "Клонировано: ${LAST_COMMIT}"

  # Сохранить .env и uploads из старой версии
  if [ -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env" /tmp/asgard-deploy/.env
    ok "Конфиг .env перенесён"
  elif [ -f /tmp/asgard-deploy/.env.example ]; then
    cp /tmp/asgard-deploy/.env.example /tmp/asgard-deploy/.env
    warn ".env не найден — скопирован .env.example (отредактируйте!)"
  fi

  if [ -d "$APP_DIR/uploads" ]; then
    cp -r "$APP_DIR/uploads" /tmp/asgard-deploy/uploads
    ok "Папка uploads перенесена"
  fi

  WORK_DIR="/tmp/asgard-deploy"
  cd "$WORK_DIR"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  ШАГ 4: Проверка .env
# ═══════════════════════════════════════════════════════════════════════════════
step "Проверка конфигурации (.env)"

ENV_FILE="${WORK_DIR}/.env"

if [ ! -f "$ENV_FILE" ]; then
  die ".env файл не найден в ${WORK_DIR}. Создайте из .env.example"
fi

# Загрузить переменные
set +u
source "$ENV_FILE" 2>/dev/null || true
set -u

MISSING=""
[ -z "${DB_PASSWORD:-}" ] && MISSING="${MISSING} DB_PASSWORD"
[ -z "${JWT_SECRET:-}" ] && MISSING="${MISSING} JWT_SECRET"

if [ -n "$MISSING" ]; then
  die "Не заданы обязательные переменные:${MISSING}. Отредактируйте ${ENV_FILE}"
fi

info "DB_HOST=${DB_HOST:-localhost}  DB_NAME=${DB_NAME:-asgard_crm}  DB_USER=${DB_USER:-asgard}"
info "PORT=${PORT:-3000}"
info "NODE_ENV=${NODE_ENV:-development}"

# Проверка соединения с БД
info "Проверяю подключение к PostgreSQL..."
DB_CHECK=$(cd "$WORK_DIR" && node -e "
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'asgard_crm',
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 5000
  });
  pool.query('SELECT 1 AS ok')
    .then(() => { console.log('OK'); pool.end(); })
    .catch(e => { console.log('FAIL:' + e.message); pool.end(); process.exit(1); });
" 2>&1) || true

if echo "$DB_CHECK" | grep -q "^OK$"; then
  ok "PostgreSQL подключён"
else
  die "Не удалось подключиться к БД: ${DB_CHECK}"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  ШАГ 5: Установка зависимостей
# ═══════════════════════════════════════════════════════════════════════════════
step "Установка зависимостей (npm install)"

cd "$WORK_DIR"

info "npm install..."
if [ "${NODE_ENV:-}" = "production" ]; then
  npm install --omit=dev 2>&1 | tail -5
else
  npm install 2>&1 | tail -5
fi

ok "Зависимости установлены"

# ═══════════════════════════════════════════════════════════════════════════════
#  ШАГ 6: Миграции
# ═══════════════════════════════════════════════════════════════════════════════
step "Миграции базы данных"

cd "$WORK_DIR"

# Подсчитать количество миграций
MIGRATION_COUNT=$(ls -1 migrations/V*.sql 2>/dev/null | wc -l)
info "Файлов миграций: ${MIGRATION_COUNT}"

info "Запускаю миграции..."
MIGRATION_OUTPUT=$(node migrations/run.js 2>&1) || {
  echo "$MIGRATION_OUTPUT"
  die "Миграции провалились! Смотрите вывод выше."
}

# Показать результат
echo "$MIGRATION_OUTPUT" | while IFS= read -r line; do
  if echo "$line" | grep -q "✅"; then
    echo -e "  ${GREEN}${line}${NC}"
  elif echo "$line" | grep -q "⏭️"; then
    echo -e "  ${BLUE}${line}${NC}"
  elif echo "$line" | grep -q "❌"; then
    echo -e "  ${RED}${line}${NC}"
  elif echo "$line" | grep -q "🚀"; then
    echo -e "  ${YELLOW}${line}${NC}"
  else
    echo "  $line"
  fi
done

# Подсчёт выполненных
APPLIED=$(echo "$MIGRATION_OUTPUT" | grep -c "✅" || true)
SKIPPED=$(echo "$MIGRATION_OUTPUT" | grep -c "⏭️" || true)

ok "Миграции завершены: ${APPLIED} применено, ${SKIPPED} уже были"

# ═══════════════════════════════════════════════════════════════════════════════
#  ШАГ 7: Деплой + запуск приложения
# ═══════════════════════════════════════════════════════════════════════════════
step "Запуск приложения"

# Если это полный деплой (не --local) — перемещаем файлы
if [ "$LOCAL_MODE" = false ]; then
  info "Размещаю файлы в ${APP_DIR}..."

  # Остановить PM2
  if [ "$HAS_PM2" = true ]; then
    pm2 stop asgard-crm 2>/dev/null || true
  fi

  sudo rm -rf "$APP_DIR"
  sudo mv "$WORK_DIR" "$APP_DIR"
  sudo chown -R "$(whoami):$(whoami)" "$APP_DIR"
  cd "$APP_DIR"
  WORK_DIR="$APP_DIR"
  ok "Файлы размещены в ${APP_DIR}"
fi

# Перезапуск
APP_PID=""
if [ "$HAS_PM2" = true ]; then
  info "Перезапуск через PM2..."
  cd "$WORK_DIR"
  pm2 delete asgard-crm 2>/dev/null || true
  pm2 start src/index.js \
    --name asgard-crm \
    --node-args="--max-old-space-size=512" \
    --cwd "$WORK_DIR" \
    --update-env
  pm2 save 2>/dev/null || true
  ok "PM2 запущен"
else
  info "Запуск через node..."
  cd "$WORK_DIR"

  # Остановить предыдущий процесс, если есть
  if [ -f "$WORK_DIR/.pid" ]; then
    OLD_PID=$(cat "$WORK_DIR/.pid")
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi

  # Запустить в фоне
  NODE_ENV="${NODE_ENV:-production}" nohup node src/index.js > "$WORK_DIR/app.log" 2>&1 &
  APP_PID=$!
  echo "$APP_PID" > "$WORK_DIR/.pid"
  ok "Приложение запущено (PID: ${APP_PID})"
fi

# ── Health-check ──────────────────────────────────────────────────────────────
info "Жду запуска приложения (до ${MAX_WAIT}с)..."

WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
  printf "."
done
echo ""

if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
  HEALTH=$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "{}")
  ok "Приложение работает (${HEALTH_URL})"
  info "Health: ${HEALTH}"
else
  fail "Приложение не отвечает после ${MAX_WAIT}с"
  echo ""
  echo -e "${YELLOW}  Последние логи:${NC}"
  if [ "$HAS_PM2" = true ]; then
    pm2 logs asgard-crm --lines 20 --nostream 2>/dev/null || true
  elif [ -f "$WORK_DIR/app.log" ]; then
    tail -20 "$WORK_DIR/app.log"
  fi
  echo ""

  # Откат если есть бэкап
  if [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
    echo -e "${YELLOW}  Для отката выполните:${NC}"
    echo "    sudo rm -rf $APP_DIR && sudo mv $BACKUP_DIR $APP_DIR"
    echo "    pm2 restart asgard-crm"
  fi
  die "Health-check провален"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  ШАГ 8: Запуск тестов
# ═══════════════════════════════════════════════════════════════════════════════
step "Запуск тестов"

if [ "$SKIP_TESTS" = true ]; then
  info "Тесты пропущены (--skip-tests)"
else
  cd "$WORK_DIR"

  # Убедиться, что devDependencies установлены (для тестов нужны)
  if [ ! -d "node_modules/jsonwebtoken" ]; then
    info "Установка devDependencies для тестов..."
    npm install 2>&1 | tail -3
  fi

  info "Запускаю тесты (таймаут: ${TEST_TIMEOUT}с)..."
  echo ""

  # Запуск API + E2E тестов
  TEST_EXIT=0
  timeout "${TEST_TIMEOUT}" node tests/runner.js --api --e2e || TEST_EXIT=$?

  echo ""

  if [ $TEST_EXIT -eq 0 ]; then
    ok "Все тесты пройдены!"
  elif [ $TEST_EXIT -eq 124 ]; then
    warn "Тесты прервались по таймауту (${TEST_TIMEOUT}с)"
  else
    warn "Есть провалившиеся тесты (exit code: ${TEST_EXIT})"
  fi

  # HTML-отчёт
  REPORT_FILE="${WORK_DIR}/tests/report.html"
  if [ -f "$REPORT_FILE" ]; then
    info "HTML-отчёт: ${REPORT_FILE}"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  ИТОГО
# ═══════════════════════════════════════════════════════════════════════════════
DEPLOY_END=$(date +%s)
DURATION=$((DEPLOY_END - DEPLOY_START))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
if [ "${TEST_EXIT:-0}" -eq 0 ]; then
  echo -e "${BOLD}║   ${GREEN}✅ ДЕПЛОЙ ЗАВЕРШЁН УСПЕШНО${NC}${BOLD}                               ║${NC}"
else
  echo -e "${BOLD}║   ${YELLOW}⚠️  ДЕПЛОЙ ЗАВЕРШЁН (есть проблемы с тестами)${NC}${BOLD}              ║${NC}"
fi
echo -e "${BOLD}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}║${NC}  Время:     ${MINUTES}м ${SECONDS}с"
echo -e "${BOLD}║${NC}  Ветка:     ${BRANCH}"
echo -e "${BOLD}║${NC}  Коммит:    ${LAST_COMMIT:-unknown}"
echo -e "${BOLD}║${NC}  URL:       http://localhost:${PORT}"
[ -n "$BACKUP_DIR" ] && \
echo -e "${BOLD}║${NC}  Бэкап:     ${BACKUP_DIR}"
echo -e "${BOLD}║${NC}"
echo -e "${BOLD}║${NC}  Логи:      $( [ "$HAS_PM2" = true ] && echo 'pm2 logs asgard-crm' || echo "${WORK_DIR}/app.log" )"
echo -e "${BOLD}║${NC}  Тесты:     ${WORK_DIR}/tests/report.html"
[ -n "$BACKUP_DIR" ] && \
echo -e "${BOLD}║${NC}  Откат:     sudo rm -rf ${APP_DIR} && sudo mv ${BACKUP_DIR} ${APP_DIR} && pm2 restart asgard-crm"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
