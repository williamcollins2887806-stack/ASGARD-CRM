# LiveKit ops for Тинг (ASGARD CRM)

## Цель

Self-hosted LiveKit на том же хосте CRM (`92.242.61.184`), нагрузка v1: **2–3 video + audio**.

## Порты (развести с Asterisk)

| Сервис | Порты | Примечание |
|--------|-------|------------|
| Asterisk RTP | UDP **10000–20000** | уже в `ops/asterisk/rtp.conf.snippet` |
| coturn listen | UDP **3478** | STUN/TURN |
| coturn relay | UDP **40000–49900** | `min-port`/`max-port` в `turnserver.conf` |
| LiveKit RTC | UDP **50000–60000** | `rtc.port_range_start/end` в `livekit.yaml` |
| LiveKit API | 7880 | только localhost / nginx |
| LiveKit RTC TCP | 7881 | fallback |
| Redis | 6379 | localhost, отдельный db index |

## Файлы

- `livekit.yaml` — конфиг SFU (`rtc.turn_servers` → coturn)
- `turnserver.conf` — coturn (shared secret, realm, relay range)
- `docker-compose.yml` — livekit + redis + coturn + egress + sip
- `nginx_ting.conf.snippet` — `/ting/` SPA + `/ting/rtc` → LiveKit

## Секреты

`/etc/asgard-crm/thing.env` (не в git):

```bash
LIVEKIT_URL=http://127.0.0.1:7880
LIVEKIT_WS_URL=wss://asgard-crm.ru/ting/rtc
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
THING_DIALIN_SECRET=...
THING_WORKERS=1
# TURN / coturn (один shared secret в turnserver.conf и livekit.yaml rtc.turn_servers[].secret)
TURN_HOST=asgard-crm.ru
TURN_SECRET=...
```

Подключать в `asgard-crm.service` через `EnvironmentFile=`.

## coturn (TURN для Symmetric NAT)

Нужен, если гости за жёстким NAT не доходят до LiveKit RTC напрямую.

1. В `turnserver.conf`: заменить `CHANGE_ME_TURN_SECRET` на значение `TURN_SECRET`; раскомментировать/задать `external-ip=` (публичный IP хоста, при NAT — `PUBLIC/PRIVATE`).
2. В `livekit.yaml` → `rtc.turn_servers`: тот же `secret`, `host` = `TURN_HOST` (или IP).
3. Firewall (ufw/iptables) на хосте:
   - UDP **3478** (listen)
   - UDP **40000–49900** (relay)
4. Поднять вместе со стеком: `docker compose up -d` (сервис `coturn`, `network_mode: host`).

Проверка: клиент за Symmetric NAT — ICE candidate `typ relay`; без TURN часто только `host`/`srflx` и тишина.

## Установка (после явной команды на прод)

```bash
# на сервере
mkdir -p /opt/asgard-livekit /var/lib/asgard-thing/recordings
cp ops/livekit/* /opt/asgard-livekit/
# сгенерировать keys: docker run --rm livekit/generate ...
# подставить TURN_SECRET / external-ip в turnserver.conf и livekit.yaml
docker compose -f /opt/asgard-livekit/docker-compose.yml up -d
# firewall: UDP 3478 + 40000-49900
# nginx: include snippet, reload
# systemctl restart asgard-crm
curl -s http://127.0.0.1:3000/api/thing/health
```

## Health

- `GET /api/thing/health` → `{ livekit: true }`
- `livekit-cli list-rooms` / join smoke 2 клиента

## Запись

Egress пишет в `/var/lib/asgard-thing/recordings/{slug}/`. Retention — cron (P4): удалять старше N дней.
