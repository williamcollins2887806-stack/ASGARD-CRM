# ASGARD CRM — Asterisk / PBX ops

Конфиги-фрагменты для cutover Bitrix/Mango → CRM Asterisk + `asgard-pbx`.

## Предварительно

- PostgreSQL миграция `V359__pbx_core.sql` на проде.
- Файл `/etc/asgard-crm/pbx.env`: `DATABASE_URL`, `AMI_USER`, `AMI_SECRET`, `PBX_CMD_SECRET`, `AGI_PORT=4573`, `CMD_PORT=4575`.
- Каталоги: `/var/lib/asgard-crm/recordings`, `/var/lib/asgard-crm/tts-cache` (владелец `www-data`).

## Деплой конфигов Asterisk

1. Бэкап: `tar czf /root/snapshots/asterisk-pre-pbx-$(date +%Y%m%d).tgz /etc/asterisk`
2. Скопировать snippets в `/etc/asterisk/` и `#include` из `pjsip.conf`, `extensions.conf`, `manager.conf`, `rtp.conf`.
3. Подключить `nginx_pbx_ws.conf.snippet` в vhost CRM.
4. `asterisk -rx "core reload"` или `systemctl restart asterisk`.
5. Установить unit: `cp ops/asterisk/asgard-pbx.service /etc/systemd/system/` → `systemctl daemon-reload` → `systemctl enable --now asgard-pbx`.

## Проверка

- `curl -s -H "X-PBX-Secret: $PBX_CMD_SECRET" http://127.0.0.1:4575/health`
- В CRM: `GET /api/telephony/pbx/health` (после регистрации роута в `src/index.js`).
- Тестовый входящий на Mango → контекст `from-mango-inbound`.

## Откат

- Вернуть Mango/Bitrix маршрутизацию в ЛК Mango.
- `systemctl stop asgard-pbx`
- Восстановить `/etc/asterisk` из snapshot.

Подробный runbook: `docs/telephony-cutover-runbook.md`.
