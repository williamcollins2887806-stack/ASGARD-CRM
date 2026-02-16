#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# ASGARD CRM — Deploy Script
# ═══════════════════════════════════════════════════════════════════════════
# Использование: bash deploy.sh
# ═══════════════════════════════════════════════════════════════════════════

set -e

BRANCH="claude/merge-test-fixes-5kn04"
APP_DIR=$(pwd)
PM2_NAME="asgard-crm"

echo "═══════════════════════════════════════════════════════════════"
echo "  ASGARD CRM — Деплой"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Директория: $APP_DIR"
echo "Ветка: $BRANCH"
echo ""

# 1. Сохраняем текущее состояние
echo "[1/6] Сохраняем текущее состояние..."
git stash --include-untracked 2>/dev/null || true

# 2. Получаем обновления
echo "[2/6] Получаем обновления с сервера..."
git fetch origin "$BRANCH"

# 3. Переключаемся на ветку и обновляем
echo "[3/6] Переключаемся на ветку $BRANCH..."
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
git pull origin "$BRANCH"

# 4. Устанавливаем зависимости (если package.json изменился)
echo "[4/6] Проверяем зависимости..."
if git diff HEAD~1 --name-only 2>/dev/null | grep -q "package.json"; then
  echo "  package.json изменился, устанавливаем зависимости..."
  npm install --production
else
  echo "  Зависимости не изменились, пропускаем."
fi

# 5. Перезапускаем сервер
echo "[5/6] Перезапускаем сервер..."
if command -v pm2 &> /dev/null; then
  if pm2 list | grep -q "$PM2_NAME"; then
    pm2 restart "$PM2_NAME"
  else
    pm2 start src/index.js --name "$PM2_NAME"
  fi
  pm2 save
  echo "  PM2: сервер перезапущен."
elif command -v systemctl &> /dev/null && systemctl is-active --quiet asgard-crm 2>/dev/null; then
  sudo systemctl restart asgard-crm
  echo "  systemd: сервер перезапущен."
else
  echo "  Менеджер процессов не найден. Перезапустите сервер вручную:"
  echo "  node src/index.js"
fi

# 6. Проверяем
echo "[6/6] Проверяем..."
sleep 2
if command -v curl &> /dev/null; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "  Сервер работает (HTTP 200)"
  else
    echo "  Сервер ещё запускается (HTTP $STATUS). Подождите и проверьте: curl http://localhost:3000/api/health"
  fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Деплой завершён!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Что нового:"
echo "  - Оптимизация IMAP: параллельная обработка AI (батчи по 5)"
echo "  - Лимит sync_max_emails: 200 → 2000"
echo "  - Адаптивный интервал опроса: 15 сек при активной синхронизации"
echo "  - Исправлен запрос employees → users в AI-анализаторе"
echo "  - Единые рамки на блоки карточек (дашборд, KPI, канбан)"
echo "  - НДС 20% → 22%"
echo "  - Telegram: диагностика + массовая отправка уведомлений"
echo ""
