#!/bin/bash
# Установка ежедневной проверки конвейера счетов в cron.
# Запуск: bash tools/install_pipeline_cron.sh
set -e

CRON_USER="${CRON_USER:-root}"
SCHEDULE="${SCHEDULE:-0 9 * * *}"        # каждый день в 09:00 по времени сервера (MSK)
APP=/var/www/asgard-crm

# Каталоги для состояния и лога.
mkdir -p /var/lib/asgard /var/log
touch /var/log/asgard-pipeline.log
chmod 644 /var/log/asgard-pipeline.log

# Команда: node с env из проекта. `cd` обязателен — скрипт ищет .env относительно корня.
CMD="cd $APP && /usr/bin/node tools/pipeline_alert.js >> /var/log/asgard-pipeline.log 2>&1"

# Ставим, если ещё нет (идемпотентно: ищем маркер).
MARK="# ASGARD_PIPELINE_CHECK"
if crontab -l -u "$CRON_USER" 2>/dev/null | grep -q "ASGARD_PIPELINE_CHECK"; then
  echo "уже установлено — обновляю строку расписания"
  crontab -l -u "$CRON_USER" 2>/dev/null | grep -v "ASGARD_PIPELINE_CHECK" | grep -v "pipeline_alert.js" > /tmp/cron.new || true
else
  crontab -l -u "$CRON_USER" 2>/dev/null > /tmp/cron.new || true
fi

echo "$MARK" >> /tmp/cron.new
echo "$SCHEDULE $CMD $MARK" >> /tmp/cron.new
crontab -u "$CRON_USER" /tmp/cron.new
rm -f /tmp/cron.new

echo "=== установлено для $CRON_USER ==="
crontab -l -u "$CRON_USER" | grep -A1 -B1 "pipeline_alert"
echo ""
echo "расписание: $SCHEDULE (сервер: $(date '+%Z %z'))"
echo "лог:        /var/log/asgard-pipeline.log"
echo "состояние:  /var/lib/asgard/pipeline-state.json"
