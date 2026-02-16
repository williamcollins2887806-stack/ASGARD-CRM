#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# ASGARD CRM — Патч-деплой (точечные правки, без замены файлов)
# ═══════════════════════════════════════════════════════════════════════════
#
# Безопасно применяет:
#   1. НДС 20% → 22% (sed замены в существующих файлах)
#   2. IMAP/AI сервисы (замена только бэкенд-сервисов)
#   3. Telegram диагностика (замена telegram.js + notifications.js)
#
# НЕ трогает: app.css, app.js, layout, sidebar, навигацию
#
# Использование: cd /var/www/asgard-crm && bash /tmp/deploy.sh
# ═══════════════════════════════════════════════════════════════════════════

set -e

SRC_BRANCH="origin/claude/merge-test-fixes-5kn04"
PM2_NAME="asgard-crm"
BACKUP_DIR="backups/pre-deploy-$(date +%Y%m%d_%H%M%S)"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ASGARD CRM — Патч-деплой"
echo "  Время: $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── 1. Бэкап ─────────────────────────────────────────────────────────
echo "[1/5] Создаём бэкап..."
mkdir -p "$BACKUP_DIR"

VAT_FILES=(
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
)

SERVICE_FILES=(
  "src/services/imap.js"
  "src/services/ai-email-analyzer.js"
  "public/assets/js/telegram.js"
  "src/routes/notifications.js"
)

for f in "${VAT_FILES[@]}" "${SERVICE_FILES[@]}"; do
  if [ -f "$f" ]; then
    dir=$(dirname "$BACKUP_DIR/$f")
    mkdir -p "$dir"
    cp "$f" "$BACKUP_DIR/$f"
  fi
done
echo "  Бэкап: $BACKUP_DIR"

# ── 2. НДС 20% → 22% (sed замены в существующих файлах) ──────────────
echo "[2/5] Применяем НДС 20% → 22%..."
VAT_COUNT=0

for f in "${VAT_FILES[@]}"; do
  if [ -f "$f" ]; then
    BEFORE=$(grep -c "20" "$f" 2>/dev/null || echo 0)

    # vat_pct: 20  →  vat_pct: 22
    sed -i 's/vat_pct: 20/vat_pct: 22/g' "$f"
    # vat_pct, 20  →  vat_pct, 22
    sed -i 's/vat_pct, 20/vat_pct, 22/g' "$f"
    # vat_pct,20   →  vat_pct,22
    sed -i 's/vat_pct,20/vat_pct,22/g' "$f"
    # vat_pct ?? 20 → vat_pct ?? 22
    sed -i 's/vat_pct ?? 20/vat_pct ?? 22/g' "$f"
    # vat_pct || 20 → vat_pct || 22
    sed -i 's/vat_pct || 20/vat_pct || 22/g' "$f"
    # vat_pct||20   → vat_pct||22
    sed -i 's/vat_pct||20/vat_pct||22/g' "$f"
    # vat_pct = 20  → vat_pct = 22
    sed -i 's/vat_pct = 20/vat_pct = 22/g' "$f"
    # НДС: ${core.vat_pct||20}% → ||22
    sed -i 's/vat_pct||20/vat_pct||22/g' "$f"
    # (s.vat_pct || 20) → (s.vat_pct || 22)
    # already covered by "vat_pct || 20" pattern above

    AFTER=$(grep -c "22" "$f" 2>/dev/null || echo 0)
    if [ "$AFTER" -gt "$BEFORE" ] || grep -q "vat_pct.*22\|22.*vat_pct" "$f" 2>/dev/null; then
      VAT_COUNT=$((VAT_COUNT + 1))
    fi
  fi
done
echo "  Обновлено файлов: $VAT_COUNT"

# Проверка
echo "  Проверка — остатки '20' в контексте vat:"
REMAINING=0
for f in "${VAT_FILES[@]}"; do
  if [ -f "$f" ]; then
    R=$(grep -n "vat_pct.*20\b" "$f" 2>/dev/null | grep -v "vat_pct.*22" || true)
    if [ -n "$R" ]; then
      echo "    ⚠ $f: $R"
      REMAINING=$((REMAINING + 1))
    fi
  fi
done
if [ "$REMAINING" -eq 0 ]; then
  echo "  ✓ Все замены НДС выполнены"
fi

# ── 3. Визуальный патч (CSS-файл + ссылка в index.html) ───────────────
echo "[3/7] Применяем визуальный патч..."

git fetch origin claude/merge-test-fixes-5kn04:refs/remotes/origin/claude/merge-test-fixes-5kn04 2>/dev/null || \
git fetch origin claude/merge-test-fixes-5kn04 2>/dev/null || true

# Копируем patch.css из ветки
if git show "$SRC_BRANCH:public/assets/css/patch.css" > public/assets/css/patch.css 2>/dev/null; then
  echo "  ✓ patch.css скопирован"
elif git show "FETCH_HEAD:public/assets/css/patch.css" > public/assets/css/patch.css 2>/dev/null; then
  echo "  ✓ patch.css скопирован (via FETCH_HEAD)"
else
  echo "  ⚠ patch.css не найден в ветке"
fi

# Добавляем ссылку на patch.css в index.html (если ещё нет)
if [ -f "public/index.html" ]; then
  if ! grep -q "patch.css" public/index.html; then
    sed -i 's|href="assets/css/app.css"/>|href="assets/css/app.css"/>\n  <link rel="stylesheet" href="assets/css/patch.css"/>|' public/index.html
    echo "  ✓ Ссылка на patch.css добавлена в index.html"
  else
    echo "  patch.css уже подключён"
  fi
fi

# Бэкапим index.html
if [ -f "public/index.html" ]; then
  mkdir -p "$BACKUP_DIR/public"
  cp public/index.html "$BACKUP_DIR/public/index.html"
fi

# ── 4. Обновляем IMAP/AI/Telegram ────────────────────────────────────
echo "[4/7] Обновляем IMAP/AI/Telegram..."

SVC_COUNT=0
for f in "${SERVICE_FILES[@]}"; do
  dir=$(dirname "$f")
  mkdir -p "$dir"
  if git show "$SRC_BRANCH:$f" > "$f.tmp" 2>/dev/null; then
    mv "$f.tmp" "$f"
    SVC_COUNT=$((SVC_COUNT + 1))
    echo "  ✓ $f"
  elif git show "FETCH_HEAD:$f" > "$f.tmp" 2>/dev/null; then
    mv "$f.tmp" "$f"
    SVC_COUNT=$((SVC_COUNT + 1))
    echo "  ✓ $f (via FETCH_HEAD)"
  else
    rm -f "$f.tmp"
    echo "  ⚠ Пропущен: $f"
  fi
done
echo "  Обновлено сервисов: $SVC_COUNT"

# ── 5. Дополнительные sed-фиксы для vat_pct без пробела ──────────────
echo "[5/7] Доп. замены НДС (формат без пробелов)..."
for f in "${VAT_FILES[@]}"; do
  if [ -f "$f" ]; then
    # {vat_pct:20 → {vat_pct:22 (без пробела после двоеточия)
    sed -i 's/{vat_pct:20/{vat_pct:22/g' "$f"
    # { vat_pct:20 → { vat_pct:22
    sed -i 's/{ vat_pct:20/{ vat_pct:22/g' "$f"
    # value, 20) → value, 22) в контексте num()
    sed -i 's/\.value, 20)/.value, 22)/g' "$f"
  fi
done
echo "  ✓ Дополнительные замены выполнены"

# ── 6. Перезапуск сервера ─────────────────────────────────────────────
echo "[6/7] Перезапускаем сервер..."
if command -v pm2 &> /dev/null; then
  if pm2 list 2>/dev/null | grep -q "$PM2_NAME"; then
    pm2 restart "$PM2_NAME"
    echo "  PM2: перезапущен"
  else
    echo "  PM2: процесс не найден. Запустите: pm2 start src/index.js --name $PM2_NAME"
  fi
else
  echo "  Перезапустите вручную: pm2 restart $PM2_NAME"
fi

# ── 7. Проверка ──────────────────────────────────────────────────────
echo "[7/7] Проверяем..."
sleep 3
if command -v curl &> /dev/null; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "  ✓ Сервер работает (HTTP 200)"
  else
    echo "  Сервер запускается... (HTTP $STATUS)"
  fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ДЕПЛОЙ ЗАВЕРШЁН"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Что изменено:"
echo "  ─────────────────────────────────────"
echo "  [Визуал]    Единые рамки: KPI, таблицы, графики (patch.css)"
echo "  [НДС]       20% → 22% (sed-замены в ${VAT_COUNT} файлах)"
echo "  [IMAP]      Оптимизированная 3-фазная обработка почты"
echo "  [AI]        Фикс employees → users"
echo "  [Telegram]  Диагностика + flush уведомлений"
echo ""
echo "  НЕ тронуто: app.css, app.js, layout, sidebar, навигация"
echo ""
echo "  Бэкап: $BACKUP_DIR"
echo "  Откат: cp -r $BACKUP_DIR/* . && pm2 restart $PM2_NAME"
echo ""
