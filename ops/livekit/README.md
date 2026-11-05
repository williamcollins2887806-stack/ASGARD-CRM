# ASGARD Тинг — LiveKit ops

Жизненный цикл: SFU → webhook → БД. Без webhook комнаты «живут» вечно (D16/Q01).

## Что изменилось в рыночном паритете (2026-11)

| Было | Стало |
|------|-------|
| `:latest` у всех образов | Зафиксированные теги (D21) |
| Секреты в git | Рендер из `/etc/asgard-crm/thing.env` через `envsubst` (D20) |
| webhook только у Huginn | Второй URL `/api/thing/livekit/webhook` (Q01) |
| coturn без TLS, relay 30000–39900 vs README 40000–49900 | TLS 5349/443, единый диапазон 30000–39900 (D23) |
| Egress на локальный диск | S3/MinIO + backup + лимит 4h (D22) |
| Нет sweeper | Cron каждые 5 минут (Q02) |

## Рендер конфигов

Секретов в репозитории нет. Один раз на сервере:

```bash
# /etc/asgard-crm/thing.env
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
TURN_SECRET=...
TURN_HOST=turn.asgard-crm.ru
TURN_EXTERNAL_IP=92.242.61.184
S3_ENDPOINT=https://s3.asgard-crm.ru
S3_REGION=ru-central-1
S3_BUCKET=asgard-ting-recordings
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
```

Перед стартом стека:

```bash
set -a; . /etc/asgard-crm/thing.env; set +a
cd /opt/asgard-livekit
envsubst < livekit.yaml           > livekit.rendered.yaml
envsubst < turnserver.conf        > turnserver.rendered.conf
envsubst < egress.yaml            > egress.rendered.yaml
envsubst < sip.yaml               > sip.rendered.yaml
docker compose up -d
```

Файлы `*.rendered.*` в `.gitignore`; в git лежат только шаблоны с `${VAR}`.

## TURN/TLS — обязателен, а не «при необходимости» (Q03)

Корпоративные сети часто режут весь UDP, кроме 443. Без TURN/TLS гость
из такого офиса не подключится вообще, и это выглядит как «Тинг не работает».

1. Сертификат `asgard-crm.ru` уже есть (letsencrypt) → монтируется в coturn.
2. Порты: UDP 3478 (listen), TCP 5349 и 443 (TLS), UDP 30000–39900 (relay).
3. Порт 443 на том же IP конфликтует с nginx → нужен отдельный IP для TURN
   или SNI-роутинг. Пока отдельного IP нет, TURN-TLS работает на 5349;
   сети, где разрешён только 443, останутся неподключёнными — это записанный риск.
4. Relay-диапазон открывать в **двух** фаерволах: у провайдера и на хосте.
   Иначе открыт только 3478, а релей мёртв — самая частая причина «не подключается».

Проверка (обязательно из чужой сети, не с сервера):

```
# в браузере
await new Promise(r => { const pc = new RTCPeerConnection({ iceServers: [{urls:'turn:turn.asgard-crm.ru:3478?transport=udp', username:'...', credential:'...'}] }); pc.onicecandidate = e => { if (e.candidate) console.log(e.candidate.type); }; pc.createDataChannel('x'); pc.createOffer().then(o => pc.setLocalDescription(o)); setTimeout(r, 5000); });
# ждём candidate.type === 'relay'
```

Затем звонок с LTE и из офиса: `iceTransportPolicy: 'relay'` должен работать.

## Firewall

| Порт | Протокол | Назначение |
|------|----------|------------|
| 7880 | TCP | LiveKit API/WS |
| 7881 | TCP | LiveKit RTC over TCP |
| 3478 | UDP | TURN |
| 5349, 443 | TCP | TURN/TLS |
| 30000–39900 | UDP | TURN relay |
| 50000–60000 | UDP | LiveKit RTC |
| 10000–20000 | UDP | Asterisk RTP (не пересекать) |

## Health и мониторинг

- `GET /api/thing/health` → `{ ok, livekit, db, rooms, recordings_active, disk }`
- Алерты: `disk.free_mb < 5000`, `recordings_active` не падает после встреч,
  рост `rooms.live` без участников (значит webhook/sweeper не работают).
- `POST /api/thing/sweep` (ADMIN) — ручной прогон sweeper.

## Запись

Egress пишет в S3 (`S3_BUCKET`), локальный путь — только staging.
Скачивание — `GET /api/thing/rooms/:id/recordings/:recId/download` (только участники комнаты).
Retention: удалять объекты старше N дней (политика хранения — фаза 7).

## Масштаб (важно не обещать лишнего)

Комната LiveKit целиком живёт на одной ноде. Кластер добавляет **комнаты**, а не
размер комнаты. Официальный бенчмарк 150×150 — это 16 ядер и ~744 Мбит/с.

| Режим | Реальность |
|-------|-----------|
| 2–8 с камерой | одна нода тянет |
| 9–12 с камерой | верхняя граница, нужен замер |
| 13–40 | только 3–6 видео + аудио/аватар (`max_video` применяется) |
| 40 с видео | второй медиа-узел, отдельный бюджет |
