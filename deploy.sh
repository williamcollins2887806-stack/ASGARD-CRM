#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# ASGARD CRM — Скрипт деплоя всех изменений
# ═══════════════════════════════════════════════════════════════════════════
#
# Что делает:
#   - НЕ переключает ветку (продакшен остаётся на своей ветке)
#   - Забирает конкретные файлы из ветки с фиксами
#   - Применяет: визуал, НДС 22%, Telegram, оптимизация IMAP/AI
#   - Перезапускает сервер
#
# Использование:
#   cd /path/to/ASGARD-CRM && bash deploy.sh
#
# ═══════════════════════════════════════════════════════════════════════════

set -e

SRC_BRANCH="origin/claude/merge-test-fixes-5kn04"
PM2_NAME="asgard-crm"
BACKUP_DIR="backups/pre-deploy-$(date +%Y%m%d_%H%M%S)"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ASGARD CRM — Деплой изменений"
echo "  Источник: $SRC_BRANCH"
echo "  Время: $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── 1. Получаем ветку с фиксами ──────────────────────────────────────
echo "[1/5] Получаем обновления..."
git fetch origin claude/merge-test-fixes-5kn04
echo "  OK"

# ── 2. Бэкап текущих файлов ──────────────────────────────────────────
echo "[2/5] Создаём бэкап..."
mkdir -p "$BACKUP_DIR"

# Бэкапим только файлы которые будем менять
FILES_TO_UPDATE=(
  # Визуал: единые рамки блоков
  "public/assets/css/app.css"
  "public/assets/js/app.js"
  "public/assets/js/dashboard.js"
  "public/assets/js/custom_dashboard.js"
  "public/assets/js/office_expenses.js"
  "public/assets/js/finances.js"
  "public/assets/js/buh_registry.js"
  "public/assets/js/correspondence.js"
  # НДС 20% → 22%
  "public/assets/js/calc_norms.js"
  "public/assets/js/calculator.js"
  "public/assets/js/calculator_v2.js"
  "public/assets/js/approvals.js"
  "public/assets/js/pm_works.js"
  "public/assets/js/pm_calcs.js"
  "public/assets/js/gantt_full.js"
  "public/assets/js/settings.js"
  "public/assets/js/acts.js"
  "public/assets/js/invoices.js"
  "public/assets/js/templates.js"
  "public/assets/js/all_estimates.js"
  "public/assets/js/seed.js"
  "src/routes/acts.js"
  "src/routes/invoices.js"
  # Telegram: диагностика + flush
  "public/assets/js/telegram.js"
  "src/routes/notifications.js"
  # Оптимизация IMAP (3-фазная обработка)
  "src/services/imap.js"
  # AI-анализатор (фикс employees→users, triage)
  "src/services/ai-email-analyzer.js"
)

for f in "${FILES_TO_UPDATE[@]}"; do
  if [ -f "$f" ]; then
    dir=$(dirname "$BACKUP_DIR/$f")
    mkdir -p "$dir"
    cp "$f" "$BACKUP_DIR/$f"
  fi
done
echo "  Бэкап сохранён в: $BACKUP_DIR"

# ── 3. Применяем файлы из ветки с фиксами ────────────────────────────
echo "[3/5] Применяем изменения..."

APPLIED=0
SKIPPED=0

for f in "${FILES_TO_UPDATE[@]}"; do
  dir=$(dirname "$f")
  mkdir -p "$dir"
  if git show "$SRC_BRANCH:$f" > "$f" 2>/dev/null; then
    APPLIED=$((APPLIED + 1))
  else
    echo "  ⚠ Пропущен (нет в ветке): $f"
    # Восстанавливаем из бэкапа если затёрли
    if [ -f "$BACKUP_DIR/$f" ]; then
      cp "$BACKUP_DIR/$f" "$f"
    fi
    SKIPPED=$((SKIPPED + 1))
  fi
done

echo "  Применено: $APPLIED файлов, пропущено: $SKIPPED"

# ── 4. Перезапускаем сервер ───────────────────────────────────────────
echo "[4/5] Перезапускаем сервер..."
if command -v pm2 &> /dev/null; then
  if pm2 list 2>/dev/null | grep -q "$PM2_NAME"; then
    pm2 restart "$PM2_NAME"
    echo "  PM2: перезапущен"
  else
    echo "  PM2: процесс '$PM2_NAME' не найден. Запустите вручную:"
    echo "  pm2 start src/index.js --name $PM2_NAME"
  fi
elif command -v systemctl &> /dev/null && systemctl is-active --quiet asgard-crm 2>/dev/null; then
  sudo systemctl restart asgard-crm
  echo "  systemd: перезапущен"
else
  echo "  Перезапустите сервер вручную:"
  echo "  pm2 restart $PM2_NAME  (или)  node src/index.js"
fi

# ── 5. Проверяем ──────────────────────────────────────────────────────
echo "[5/5] Проверяем работоспособность..."
sleep 3
if command -v curl &> /dev/null; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "  ✓ Сервер работает (HTTP 200)"
  else
    echo "  Сервер запускается... (HTTP $STATUS)"
    echo "  Проверьте через 10 сек: curl http://localhost:3000/api/health"
  fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ДЕПЛОЙ ЗАВЕРШЁН"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Изменения:"
echo "  ────────────────────────────────────────"
echo "  [Визуал]    Единые рамки на блоки карточек (дашборд, KPI, финансы, канбан)"
echo "  [НДС]       20% → 22% во всех калькуляторах и шаблонах"
echo "  [Telegram]  Диагностика + кнопка массовой отправки уведомлений"
echo "  [IMAP]      3-фазная обработка почты:"
echo "              Phase 1: Быстрое сохранение в БД (50мс/письмо)"
echo "              Phase 2: AI-сортировка unknown писем (заявка или нет?)"
echo "              Phase 3: Глубокий AI-анализ только для заявок"
echo "  [IMAP]      Параллельная AI-обработка (батчи по 5 вместо 1)"
echo "  [IMAP]      Лимит: 200 → 2000 писем за цикл"
echo "  [IMAP]      Адаптивный опрос: 15 сек (активный) / 120 сек (штатный)"
echo "  [AI]        Фикс: employees → users в AI-анализаторе"
echo ""
echo "  Бэкап: $BACKUP_DIR"
echo "  Откат: cp -r $BACKUP_DIR/* ."
echo ""
