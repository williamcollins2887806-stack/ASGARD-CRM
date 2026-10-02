# LiveKit ops for Тинг (ASGARD CRM)

## Цель

Self-hosted LiveKit на том же хосте CRM (`92.242.61.184`), нагрузка v1: **2–3 video + audio**.

## Порты (развести с Asterisk)

| Сервис | Порты | Примечание |
|--------|-------|------------|
| Asterisk RTP | UDP **10000–20000** | уже в `ops/asterisk/rtp.conf.snippet` |
| LiveKit RTC | UDP **50000–60000** | `rtc.port_range_start/end` в `livekit.yaml` |
| LiveKit API | 7880 | только localhost / nginx |
| LiveKit RTC TCP | 7881 | fallback |
| Redis | 6379 | localhost, отдельный db index |

**TURN** (если нужны гости за Symmetric NAT): coturn UDP 3478 + relay range вне обоих RTP.

## Файлы

- `livekit.yaml` — конфиг SFU
- `docker-compose.yml` — livekit + redis + egress
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
```

Подключать в `asgard-crm.service` через `EnvironmentFile=`.

## Установка (после явной команды на прод)

```bash
# на сервере
mkdir -p /opt/asgard-livekit /var/lib/asgard-thing/recordings
cp ops/livekit/* /opt/asgard-livekit/
# сгенерировать keys: docker run --rm livekit/generate ...
docker compose -f /opt/asgard-livekit/docker-compose.yml up -d
# nginx: include snippet, reload
# systemctl restart asgard-crm
curl -s http://127.0.0.1:3000/api/thing/health
```

## Health

- `GET /api/thing/health` → `{ livekit: true }`
- `livekit-cli list-rooms` / join smoke 2 клиента

## Запись

Egress пишет в `/var/lib/asgard-thing/recordings/{slug}/`. Retention — cron (P4): удалять старше N дней.
