#!/bin/bash
# D-366: ставит ежедневную очистку заброшенных черновиков заявок.
# Запуск: bash tools/install_draft_cleanup.sh
set -e
CRON_USER="${CRON_USER:-root}"
SCHEDULE="${SCHEDULE:-30 6 * * *}"   # каждый день 06:30 MSK (до рабочего дня)
APP=/var/www/asgard-crm
MARK="# ASGARD_DRAFT_CLEANUP"

mkdir -p /var/log
touch /var/log/asgard-draft-cleanup.log

CMD="cd $APP && /usr/bin/node tools/cleanup_drafts.js --apply >> /var/log/asgard-draft-cleanup.log 2>&1"

if crontab -l -u "$CRON_USER" 2>/dev/null | grep -q "ASGARD_DRAFT_CLEANUP"; then
  echo "уже установлено — обновляю"
  crontab -l -u "$CRON_USER" 2>/dev/null | grep -v "ASGARD_DRAFT_CLEANUP" | grep -v "cleanup_drafts.js" > /tmp/cron.draft || true
else
  crontab -l -u "$CRON_USER" 2>/dev/null > /tmp/cron.draft || true
fi

echo "$MARK" >> /tmp/cron.draft
echo "$SCHEDULE $CMD $MARK" >> /tmp/cron.draft
crontab -u "$CRON_USER" /tmp/cron.draft
rm -f /tmp/cron.draft

echo "=== cron ==="
crontab -l -u "$CRON_USER" | grep -A1 "ASGARD_DRAFT_CLEANUP"
echo "расписание: $SCHEDULE | порог: \${DOC_DRAFT_TTL_HOURS:-168}ч (7 суток)"
echo "лог: /var/log/asgard-draft-cleanup.log"
