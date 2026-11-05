# TING-SCORECARD — рыночный паритет (волна 1)

Дата: 2026-11-05 (round-2 после фаз 0–7 + verifier-loop)
Порог: см. `TING-MARKET-ACCEPTANCE.md`
Легенда: **PASS** = работает и доказано · **PARTIAL** = есть, но не полностью · **FAIL** = нет · **OUT** = не входит в волну 1 · **PENDING** = нужен ручной протокол

## T — паритет видеовстречи Яндекс.Телемоста

| ID | Приоритет | Фича | Статус | Доказательство |
|----|-----------|------|--------|----------------|
| T01 | P0 | Создать встречу, гостю — ссылка без регистрации | PASS | `src/services/thing-create.js`, `public/ting/index.html` |
| T02 | P1 | Запланировать + напоминания | PARTIAL | `scheduled_at` пишется (V455); ICS/email — через CRM meetings |
| T03 | P0 | Подключение гостя без аккаунта | PASS | `POST /api/thing/public/:code/guest-token` |
| T04 | P0 | Комната ожидания + впуск/отклонение | PASS | lobby admit/reject |
| T05 | P0 | PIN | PASS | `pin_code` + лимит; ключ по реальному IP (trustProxy) |
| T06 | P0 | Соорганизаторы | PASS | `POST /rooms/:id/roles`, `canModerateAsync` |
| T07 | P0 | Выключить микрофон одному / всем | PASS | mute kind=audio, mute-all |
| T08 | P0 | Выключить камеру одному / всем | PASS | mute kind=video |
| T09 | P1 | Опустить руку принудительно | PASS | `POST .../lower-hand` + data `hand_force_lower` |
| T10 | P0 | Остановить чужой screenshare | PASS | mute kind=screen |
| T11 | P1 | Запрет записи участникам | PASS | запись только `canModerateAsync` |
| T12 | P0 | Удалить из звонка + бан | PASS | remove + `banned_until` / guest_key |
| T13 | P0 | Завершить для всех | PASS | `POST /rooms/:id/end` + webhook |
| T14 | P1 | Демонстрация экрана | PASS | `setScreenShareEnabled` |
| T15 | P1 | Шумоподавление toggle (по умолчанию ON) | PASS | `noiseSuppression` + AudioCaptureOptions |
| T16 | P1 | Виртуальный фон + blur | PARTIAL | пресеты + blur; загрузки своего изображения нет |
| T17 | P1 | Скрыть видео участников локально | PASS | hide-remote-toggle |
| T18 | P1 | Реакции | PASS | data-channel |
| T19 | P1 | Поднять руку | PASS | data-channel + индикатор |
| T20 | P0 | Чат в звонке | PASS | CRM + guest API POST/header |
| T21 | P1 | Опросы | PASS | `thing_polls` + UI create/vote/close |
| T22 | P0 | Запись + уведомление всем | PASS | `/recording/start` + notification |
| T23 | P0 | Запись: скачивание организатором | PASS | `GET .../recordings/:id/download` |
| T24 | P1 | ИИ-конспект + расшифровка | PARTIAL | протокол в CRM; email-доставка — opt-in через pipeline |
| T25 | P1 | Pre-call проверка устройств | PASS | превью + mic meter + выбор устройств |
| T26 | P0 | Переподключение / качество сети | PASS | reconnect + quality chip |
| T27 | P0 | Сетка/спикер без потери участников | PASS | g1..g12 + «+N» |
| T28 | P1 | PiP при уходе в CRM | PASS | `huginn_ting.js` в `index.html` + `.ting-live` CSS |
| T29 | P0 | Mobile web join | PASS | `/m` Meetings → «Войти в Тинг» |
| T30 | P0 | Стабильно 40 участников | PARTIAL | `max_video` применяется; load 40 — PENDING замер |
| T31 | P0 | Безлимит по времени | PASS | guest primary TTL 30м; media refresh по `expires_at` |
| T32 | P2 | Light/dark в guest | PARTIAL | тема читается из CRM; отдельного переключателя в Тине нет |

## C — контроль конференции TrueConf (подмножество волны 1)

| ID | Приоритет | Фича | Статус | Доказательство |
|----|-----------|------|--------|----------------|
| C01 | P1 | Категории лобби | PASS | `lobby_policy` + UI select в people drawer |
| C02 | P0 | PIN + public guest | PASS | см. T05 |
| C03 | P0 | Модераторы / соорганизаторы | PASS | см. T06 |
| C04 | OUT | Podium / role-based | OUT | код есть (`conference_mode`), порог волны 1 — OUT |
| C05 | OUT | Webinar audience | OUT | код есть, порог волны 1 — OUT |
| C06 | OUT | Content share (image/PDF) | OUT | волна 3 |
| C07 | OUT | Аннотации | OUT | волна 3 |
| C08 | P1 | Запись pre-enable + during | PASS | `recording_mode` auto/manual |
| C09 | P1 | Список записей + download | PASS | `GET /rooms/:id/recordings` |
| C10 | OUT | Analytics CSV | OUT | роут есть, порог волны 1 — OUT |
| C11 | OUT | PSTN prod | OUT | волна 3 |
| C12 | P1 | Пригласить во время звонка | PASS | ссылка + QR |
| C13 | P0 | Lock conference | PASS | `PATCH /rooms/:id` {locked} |
| C14 | OUT | Forced layout | OUT | волна 3 |
| C18 | OUT | Chat export | OUT | волна 3 |

## Q — качество и надёжность

| ID | Приоритет | Критерий | Статус | Доказательство |
|----|-----------|----------|--------|----------------|
| Q01 | P0 | Webhook LiveKit → thing_rooms | PASS | `POST /api/thing/livekit/webhook` |
| Q02 | P0 | Orphan sweeper | PASS | `sweepStaleRooms` + cron 5 мин |
| Q03 | P0 | TURN для LTE / corp NAT | PARTIAL | TLS в `turnserver.conf`; ручной NAT-протокол PENDING |
| Q04 | P0 | Media smoke 2/5/15/40 | PARTIAL | 2-peer есть; 12/25/40 — PENDING замер |
| Q05 | P0 | Windows camera handoff | PENDING | код `enableLocalCamera`; нужен ручной протокол |
| Q06 | P0 | Leave/end без зависания | PASS | parallel teardown |
| Q07 | P0 | Токен не в query | PASS | lobby-status POST, guest chat header |
| Q08 | P0 | Rate limit guest API | PARTIAL | глобальный 180/мин + PIN key fix |
| Q09 | P0 | Consent enforced | PASS | `POST /consent` + модалка по факту записи |
| Q10 | P0 | Zero CDN SPOF | PASS | LiveKit + QR self-hosted |
| Q11 | P0 | TV 50" hardware smoke | PENDING | APK/статика VERIFIED; железо — ручной протокол |
| Q12 | P0 | Mobile `/m` вход в комнату | PASS | Meetings.jsx «Войти в Тинг» |
| Q13 | P0 | Audit log критичных действий | PASS | `thing_audit_events` |
| Q14 | P0 | Health + disk egress | PASS | `/api/thing/health` + funnel |
| Q15 | P0 | Blind visual vs Телемост | PENDING | ручной протокол 2 оценщика |
| Q16 | P1 | Egress S3 + backup + limits | PASS | `egress.yaml` storage.s3 + session_limits 4h |
| Q17 | P1 | Мониторинг/SLO | PARTIAL | `docs/TING-STATUS.md` + health; алерты — ops |
| Q18 | P1 | max_video применяется | PASS | `videoSlotsAvailable` + canPublishSources |
| Q19 | P1 | Двойной egress исключён | PASS | hasActiveRecording + listEgress |
| Q20 | P1 | Воркер без гонок | PASS | FOR UPDATE SKIP LOCKED |

## R — рынок: юр, поддержка, метрики

| ID | Приоритет | Критерий | Статус | Доказательство |
|----|-----------|----------|--------|----------------|
| R01 | P0 | Согласие на запись + отзыв | PASS | consents table + UI modal + revoke |
| R02 | P0 | Retention и удаление записей | PASS | DELETE recording + `sweepExpiredRecordings` (90д) |
| R03 | P0 | ПДн гостя, локализация | PARTIAL | UI/русификация; политика ПДн — документ поддержки |
| R04 | P0 | Поддержка: runbook + FAQ | PASS | `docs/TING-SUPPORT.md` |
| R05 | P0 | Метрики продукта (воронка входа) | PASS | `health.funnel_24h` |
| R06 | P0 | Стоимость минуты | PASS | `docs/TING-COSTS.md` (структура; ставки из биллинга) |
| R07 | P1 | Онбординг pre-call | PASS | mic meter + device select |
| R08 | P1 | Матрица поддержки устройств | PASS | `docs/TING-DEVICES.md` |
| R09 | P1 | Статус-страница | PASS | `docs/TING-STATUS.md` |
| R10 | P1 | Шаблоны приглашений с dial-in | PASS | dial-in в UI |
| R11 | P1 | Документация гостю | PARTIAL | FAQ в SUPPORT; отдельной guest-help страницы нет |
| R12 | P1 | Демо/лендинг не требуется | OUT | внутри CRM |

## Сводка (машинная оценка, без ручных PENDING)

| Блок | P0 PASS | P0 всего (в пороге) | P0 PENDING/PARTIAL блокирующие | P1 PASS | P1 всего |
|------|---------|---------------------|----------------------------------|---------|----------|
| T | 16 | 18 | T30 PARTIAL | 9 | 11 |
| C | 4 | 4 (C04/05 OUT) | 0 | 4 | 4 (волна 1 subset) |
| Q | 10 | 16 | Q03/Q04 PARTIAL; Q05/Q11/Q15 PENDING | 3 | 4 |
| R | 5 | 6 | R03 PARTIAL | 4 | 5 |

Машинные гейты: `code_verify` 62/62, `ui_verify` 17/17, `theme_verify` 6/6, `tv_apk_verify` 12/12 — **VERIFIED**.

Блок MARKET_READY волны 1 **не закрыт**, пока не подписаны ручные протоколы Q05/Q11/Q03/Q15 и не заполнены capacity-цифры (T30/Q04).
