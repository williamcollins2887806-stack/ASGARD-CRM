#!/bin/bash
# ═══════════════════════════════════════════════════════════
# ASGARD CRM — Проверка деплоя изменений
# Проверяет что все фиксы из ветки claude/fix-test-failures-H7pjy
# корректно применены на сервере
# ═══════════════════════════════════════════════════════════

BASE="${1:-/var/www/asgard-crm}"
PASS=0
FAIL=0
WARN=0

green()  { echo -e "\e[32m  ✅ $1\e[0m"; PASS=$((PASS+1)); }
red()    { echo -e "\e[31m  ❌ $1\e[0m"; FAIL=$((FAIL+1)); }
yellow() { echo -e "\e[33m  ⚠️  $1\e[0m"; WARN=$((WARN+1)); }

check_exists() {
  local file="$BASE/$1"
  local desc="$2"
  if [ ! -f "$file" ]; then
    red "Файл не найден: $1"
    return 1
  fi
  return 0
}

check_contains() {
  local file="$BASE/$1"
  local pattern="$2"
  local desc="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    green "$desc"
  else
    red "$desc — паттерн не найден: $pattern"
  fi
}

check_not_contains() {
  local file="$BASE/$1"
  local pattern="$2"
  local desc="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    red "$desc — найден удалённый паттерн: $pattern"
  else
    green "$desc"
  fi
}

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ASGARD CRM — Проверка деплоя"
echo "  Директория: $BASE"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─── 1. ФИКС pre_tenders.js (500 ошибка на accept) ───────
echo "── 1. Фикс pre_tenders.js (500 ошибка accept/reject) ──"
if check_exists "src/routes/pre_tenders.js" "pre_tenders.js"; then
  check_not_contains "src/routes/pre_tenders.js" \
    "LEFT JOIN emails" \
    "LEFT JOIN emails удалён (разделён на отдельные запросы)"
  check_contains "src/routes/pre_tenders.js" \
    "slice(0, 500)" \
    "comment_to обрезается до 500 символов (.slice(0,500))"
fi
echo ""

# ─── 2. ФИКС imap.js (авто-провижн IMAP из ENV) ─────────
echo "── 2. Фикс imap.js (IMAP auto-provision из ENV) ──"
if check_exists "src/services/imap.js" "imap.js"; then
  check_contains "src/services/imap.js" \
    "autoProvisionFromEnv" \
    "Функция autoProvisionFromEnv() добавлена"
  check_contains "src/services/imap.js" \
    "IMAP_HOST" \
    "Чтение IMAP_HOST из process.env"
  check_contains "src/services/imap.js" \
    "IMAP_USER" \
    "Чтение IMAP_USER из process.env"
  check_contains "src/services/imap.js" \
    "IMAP_PASS" \
    "Чтение IMAP_PASS из process.env"
fi
echo ""

# ─── 3. Dashboard UI — custom_dashboard.js ────────────────
echo "── 3. Dashboard UI — custom_dashboard.js ──"
if check_exists "public/assets/js/custom_dashboard.js" "custom_dashboard.js"; then
  check_not_contains "public/assets/js/custom_dashboard.js" \
    "border-bottom" \
    "Все border-bottom убраны из виджетов"

  # Проверяем увеличенные отступы (padding:8px или больше вместо 3-4px)
  if grep -qE "padding:[34]px 0" "$BASE/public/assets/js/custom_dashboard.js" 2>/dev/null; then
    red "custom_dashboard.js — маленькие отступы (3-4px) всё ещё есть"
  else
    green "custom_dashboard.js — отступы увеличены (нет 3-4px)"
  fi
fi
echo ""

# ─── 4. Dashboard UI — dashboard.js ──────────────────────
echo "── 4. Dashboard UI — dashboard.js ──"
if check_exists "public/assets/js/dashboard.js" "dashboard.js"; then
  check_not_contains "public/assets/js/dashboard.js" \
    "border-bottom" \
    "Все border-bottom убраны из alert-item"
  check_contains "public/assets/js/dashboard.js" \
    "padding:24px" \
    "dash-card padding увеличен до 24px"
  check_contains "public/assets/js/dashboard.js" \
    "padding:20px" \
    "dash-chart-card/alerts padding увеличен до 20px"
  check_contains "public/assets/js/dashboard.js" \
    "gap:20px" \
    "dash-grid gap увеличен до 20px"
fi
echo ""

# ─── 5. Dashboard UI — engineer_dashboard.js ─────────────
echo "── 5. Dashboard UI — engineer_dashboard.js ──"
if check_exists "public/assets/js/engineer_dashboard.js" "engineer_dashboard.js"; then
  check_not_contains "public/assets/js/engineer_dashboard.js" \
    "border-bottom" \
    "Все border-bottom убраны из eq-item и maint-item"
  check_contains "public/assets/js/engineer_dashboard.js" \
    "padding:16px" \
    "pm-card padding увеличен до 16px"
  check_contains "public/assets/js/engineer_dashboard.js" \
    "margin-bottom:14px" \
    "pm-card margin-bottom увеличен до 14px"
fi
echo ""

# ─── 6. CSS — components.css ─────────────────────────────
echo "── 6. CSS — components.css ──"
if check_exists "public/assets/css/components.css" "components.css"; then
  # Проверяем что dash-widget-content имеет padding 20px
  if grep -q "dash-widget-content" "$BASE/public/assets/css/components.css" 2>/dev/null; then
    check_contains "public/assets/css/components.css" \
      "padding:20px" \
      "dash-widget-content padding увеличен до 20px"
  fi
fi
echo ""

# ─── 7. .env.example — IMAP переменные ───────────────────
echo "── 7. .env.example — IMAP переменные ──"
if check_exists ".env.example" ".env.example"; then
  check_contains ".env.example" "IMAP_HOST" "IMAP_HOST в .env.example"
  check_contains ".env.example" "IMAP_PORT" "IMAP_PORT в .env.example"
  check_contains ".env.example" "IMAP_USER" "IMAP_USER в .env.example"
  check_contains ".env.example" "IMAP_PASS" "IMAP_PASS в .env.example"
fi
echo ""

# ─── 8. .env — IMAP настроены на сервере ─────────────────
echo "── 8. .env — IMAP переменные настроены ──"
if [ -f "$BASE/.env" ]; then
  if grep -q "IMAP_HOST=.\+" "$BASE/.env" 2>/dev/null; then
    green "IMAP_HOST заполнен в .env"
  else
    yellow "IMAP_HOST пустой или отсутствует в .env"
  fi
  if grep -q "IMAP_USER=.\+" "$BASE/.env" 2>/dev/null; then
    green "IMAP_USER заполнен в .env"
  else
    yellow "IMAP_USER пустой или отсутствует в .env"
  fi
  if grep -q "IMAP_PASS=.\+" "$BASE/.env" 2>/dev/null; then
    green "IMAP_PASS заполнен в .env"
  else
    yellow "IMAP_PASS пустой или отсутствует в .env"
  fi
else
  yellow "Файл .env не найден"
fi
echo ""

# ─── 9. Git — проверяем коммиты ──────────────────────────
echo "── 9. Git — наличие коммитов ──"
cd "$BASE" 2>/dev/null
if git log --oneline --all 2>/dev/null | grep -q "eliminate uncaught DB errors"; then
  green "Коммит 637e2c9 (pre-tender fix) найден"
else
  red "Коммит 637e2c9 (pre-tender fix) НЕ найден"
fi
if git log --oneline --all 2>/dev/null | grep -q "auto-provision IMAP"; then
  green "Коммит e9eb30a (IMAP fix) найден"
else
  red "Коммит e9eb30a (IMAP fix) НЕ найден"
fi
if git log --oneline --all 2>/dev/null | grep -q "unified widget borders"; then
  green "Коммит 550f527 (dashboard UI fix) найден"
else
  red "Коммит 550f527 (dashboard UI fix) НЕ найден"
fi
echo ""

# ─── ИТОГО ────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════"
echo -e "  \e[32m✅ Прошло: $PASS\e[0m   \e[31m❌ Ошибок: $FAIL\e[0m   \e[33m⚠️  Варнинг: $WARN\e[0m"
if [ $FAIL -eq 0 ]; then
  echo -e "  \e[32m🎉 Все изменения успешно применены!\e[0m"
else
  echo -e "  \e[31m⚡ Есть проблемы — нужно исправить!\e[0m"
fi
echo "═══════════════════════════════════════════════════════"
echo ""
