# THING-CODE-VERIFY — независимая re-верификация кода Тинг

**Дата:** 2026-10-02 (re-check после предыдущих FAIL)  
**Роль:** CODE verifier (anti-stub), без правок кода  
**Workspace:** `C:\Users\Nikita-ASGARD\ASGARD-CRM`  
**Статус исполнителя:** максимум REVIEW → итог ниже  
**Артефакты:** `tests/thing_emulation.js`, `tests/reports/THING-E2E.md` (Pass: 23/23, ALL PASS)

## Previous FAIL → re-check

### 1. Protocol initiator-only leak via `/api/meetings` minutes — **FIXED**

| Путь | Код | Доказательство |
|------|-----|----------------|
| Gate helpers | `meetings.js:82-97` | `thingProtocolGate` + `canSeeThingProtocol` (только `host_user_id` при `protocol_enabled`) |
| GET `/:id` | `meetings.js:240-287` | non-host: `minutes=[]`, `meeting.minutes=null`, `protocol_locked: true` |
| POST `/:id/minutes` | `meetings.js:719-722` | `!canSeeThingProtocol` → **403** |
| PUT `.../minutes/:id` | `meetings.js:764-767` | **403** |
| POST `.../create-task` | `meetings.js:805-808` | **403** |
| PUT `/:id/finalize` | `meetings.js:869-873` | non-host + `protocol_enabled` → **403** |
| E2E S21 | `THING-E2E.md` | `S21 \| PASS \| locked=true empty=true post=403` |

### 2. `/api/thing/dial-in/resolve` must REQUIRE secret — **FIXED**

| Условие | Ответ | Код |
|---------|-------|-----|
| `THING_DIALIN_SECRET` пуст | **503** | `thing.js:471-474` |
| заголовок `x-thing-dialin-secret` ≠ secret | **401** | `thing.js:475-477` |
| E2E S22 | `THING-E2E.md` | `S22 \| PASS \| status=401` (secret задан на рантайме; без header → 401) |

Опциональный bypass («пустой secret → пропустить проверку») **удалён**.

## Still PASS (подтверждено)

| Критерий | Вердикт | Доказательство |
|----------|---------|----------------|
| LiveKit `Room.connect` | PASS | `public/ting/index.html` — `await room.connect(creds.url, creds.token)` |
| dial 6 цифр | PASS | `V361__thing.sql` `CHAR(6)` + CHECK `^[0-9]{6}$`; `thing-codes.js` `generateDialCode`; E2E S01/S18 |
| `isProtocolOwner` на thing protocol | PASS | `thing.js:73-75`; GET `/rooms/:id/protocol` + POST generate → только host; E2E S10=403, S11=200 |
| нет call-analyzer | PASS | `thing-pipeline.js` imports: prompt/speechkit/ai-provider/notify; `require(...call-analyzer)` = false |
| V361 | PASS | `migrations/V361__thing.sql` (7714 B) + `_down.sql` (356 B) |
| `startTing` | PASS | `chat_groups.js:1903-1914` → POST `/api/thing/rooms` + `protocol_enabled: true` |
| `create_thing` | PASS | `meetings_page.js:570-594`; `meetings.js` create_thing path; E2E S02 |
| E2E S21/S22 | PASS | emulation + report 23/23 ALL PASS |

## Inventory (кратко)

| Путь | Вердикт |
|------|---------|
| `migrations/V361__thing.sql` / `_down.sql` | REAL |
| `src/routes/thing.js` (~22.9 KB) | REAL |
| `src/routes/meetings.js` (gates + 403) | REAL (фикс leak) |
| `src/services/thing-{codes,livekit,pipeline,create,sip}.js` | REAL |
| `public/ting/index.html` | REAL connect |
| `tests/thing_emulation.js` S00–S22 | REAL |
| `src/index.js` register `/api/thing` + SPA `/ting` | REAL |

## Residual risks (не валят критерии re-check)

- `GET /api/meetings` (list) всё ещё `SELECT m.*` — колонка `meetings.minutes` (финализированный текст) в списке не стрипается. Detail GET + write paths закрыты; S21 покрывает detail.
- `serializeRoom` отдаёт `dial_code` всем авторизованным, кто видит комнату через thing API (отдельно от meetings strip для non-host).

---

## Лица критики

| # | Лицо | Вердикт | Доказательство |
|---|------|---------|----------------|
| 1 | Заказчик | PASS | Оба предыдущих FAIL закрыты по коду; still-PASS список подтверждён; E2E 23/23 с S21/S22. |
| 2 | Читатель | PASS | Gate-комментарии и ошибки 403/503/401 явные; отчёт фиксирует FIXED vs residual. |
| 3 | Ревьюер | PASS | Diff-логика минимальна и точечна (gate helpers + dial-in hard require); нет stub-handlers. |
| 4 | Тестировщик | PASS | `THING-E2E.md`: S21 locked+empty+post=403; S22 status=401; S10 protocol 403; Pass 23/23. |
| 5 | Скептик данных | PASS | Source lines: meetings 82–97/240–287/719–873; thing 470–477; probe call-analyzer-require=false; DDL dial CHAR(6). |
| 6 | Регламент | PASS | Код не правился; обновлён только `tests/reports/THING-CODE-VERIFY.md`; деплой не трогался. |
| 7 | Адвокат дьявола | PASS | Допущение «minutes всё ещё текут через list `m.*`» — residual, не критерий прошлого FAIL (тот требовал detail strip + write 403 + dial-in secret). Критерии re-check закрыты. |

## Итог

VERIFIED
