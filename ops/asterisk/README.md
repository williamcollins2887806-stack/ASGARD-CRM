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

### ⚠️ Обязательно: порядок идентификации PJSIP (инцидент 09.10.2026)

Скопировать `pjsip.global.snippet` в `/etc/asterisk/` и подключить его из
`pjsip.conf`. Без этого **WebRTC-регистрация операторов не работает**:

- браузеры подключаются к Asterisk через nginx, т.е. с `127.0.0.1`;
- `pjsip_asgard_trunks.conf` содержит `[identify-livekit] match=127.0.0.1/32`;
- при порядке по умолчанию (`ip,username,anonymous`) IP-правило срабатывает
  раньше username → REGISTER оператора опознаётся как `livekit-ting`
  (у него нет AOR) → Asterisk отвечает **404 Not Found**;
- SIP не поднимается → исходящий уходит серверным путём (звонок на мобильный),
  а не из браузера.

Фикс: `endpoint_identifier_order=username,ip,anonymous`. Требуется **полный
рестарт** asterisk (опция не поддерживает reload).

Проверка после деплоя (WS доступен только с loopback, поэтому запускать на сервере):

```bash
node tools/verify_sip_register.js      # ожидается N/N зарегистрировано, 200 OK
```


### ⚠️ Обязательно: кодеки WebRTC = кодеки транка (инцидент 09.10.2026)

`pjsip_asgard_webrtc.conf`, шаблон `[webrtc-template]`:

```
disallow=all
allow=g722,ulaw,alaw     ; НЕ добавлять opus
```

**Opus ставить нельзя, пока в сборке нет `codec_opus.so`.** Симптом при opus:

```
channel.c: Unable to find a codec translation path: (opus) -> (ulaw)
app_dial.c: Had to drop call because I couldn't make PJSIP/u<id> compatible with PJSIP/mango-trunk
```

То есть браузер отдаёт Opus, транк принимает ulaw/alaw/g722, пути пересчёта нет —
и вызов рвётся **сразу после ответа** оператора. Собственный набор транка Mango
менять не нужно: держим WebRTC-эндпоинты в том же наборе.

Проверка после деплоя:

```bash
asterisk -rx "pjsip show endpoint u3474" | grep -E " allow| disallow"   # g722|ulaw|alaw
asterisk -rx "core show translation paths opus" | grep "To ulaw"        # No Translation Path — норма
```

Установка opus (если понадобится): `codec_opus` отсутствует в репозиториях
Ubuntu, нужен пакет с сайта Asterisk (sangoma) под ту же версию ядра.

## Проверка

- `curl -s -H "X-PBX-Secret: $PBX_CMD_SECRET" http://127.0.0.1:4575/health`
- В CRM: `GET /api/telephony/pbx/health` (после регистрации роута в `src/index.js`).
- Тестовый входящий на Mango → контекст `from-mango-inbound`.

## Откат

- Вернуть Mango/Bitrix маршрутизацию в ЛК Mango.
- `systemctl stop asgard-pbx`
- Восстановить `/etc/asterisk` из snapshot.

Подробный runbook: `docs/telephony-cutover-runbook.md`.
