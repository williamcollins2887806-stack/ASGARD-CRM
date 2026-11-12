#!/usr/bin/env bash
# Деплой UI: таблица объёмов в просчёте, одна кнопка файлов, скрытый input.
set -uo pipefail
cd /var/www/asgard-crm

for f in public/assets/js/rp_calc_modal.js \
         public/assets/css/rp-calc-modal.css \
         public/assets/css/app.css \
         public/index.html public/sw.js \
         public/h/index.html public/h/sw.js \
         public/ting/index.html public/ting-tv/index.html; do
  cp "/tmp/ui/$(basename "$f")" "$f" || { echo "FAIL copy $f"; exit 1; }
  echo "OK copy $f"
done

echo "--- маркеры:"
echo "rp-dv-table:        $(grep -c 'rp-dv-table' public/assets/js/rp_calc_modal.js)"
echo "rp-dv-row:          $(grep -c 'rp-dv-row' public/assets/js/rp_calc_modal.js)"
echo "карточек осталось:  $(grep -c 'rp-calc-dv-card' public/assets/js/rp_calc_modal.js || true)"
echo "file hidden fix:    $(grep -c 'input\[type="file"\]\[hidden\]' public/assets/css/app.css)"
echo "version:            $(grep -o "SHELL_VERSION = '[0-9.]*'" public/sw.js | head -1)"

echo "--- проверка синтаксиса:"
node --check public/assets/js/rp_calc_modal.js || exit 1

echo "--- рестарт:"
systemctl restart asgard-crm
sleep 3
systemctl is-active asgard-crm
for i in 1 2 3 4 5 6; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/api/health || true)
  echo "try_$i=$code"
  [ "$code" = "200" ] && break
  sleep 2
done
