# TELEPHONY L3 VERIFY — финальный прогон (локальная доводка)

| Поле | Значение |
|---|---|
| Дата | 2026-10-02 |
| Роль | L3 верификатор (только поиск FAIL, код не правился) |
| Статус | **VERIFIED (локально)** |
| Cutover | **NOT DONE** |
| База тестов | `asgard_crm_test` @ `127.0.0.1` |
| Прогон | `node tests/telephony/integration/run.js --all` → **28 passed, 0 failed, 0 skipped** (S00–S27) |

---

## Заявка исполнителя (сверка)

| # | Заявка | Вердикт | Доказательство |
|---|---|---|---|
| 1 | `/recording/finalize` и `/health` — openPaths на loopback без secret; wrong secret → 401 | **PASS** | `src/pbx/index.js:229–240`: `openPaths` = finalize\|health; без secret → дальше; `secret && secret !== config` → 401. S27: finalize без secret → 200/202; wrong secret → 401. |
| 2 | AMI cmds без secret → 401 | **PASS** | Код `!openPaths` → fail-closed. S27: `/call/answer` без secret → 401. |
| 3 | `ops/asterisk/asterisk.service.d/asgard-env.conf` — EnvironmentFile `pbx.env` | **PASS** | Файл есть; `[Service]` / `EnvironmentFile=-/etc/asgard-crm/pbx.env`. S27 `existsSync`. |
| 4 | Dialplan `X-PBX-Secret` ×2 | **PASS** | `extensions_asgard.conf:13,20` — curl finalize + `X-PBX-Secret: ${ENV(PBX_CMD_SECRET)}`. S27 assert. |
| 5 | `createCmdServer` экспортирован; S27 бьёт в **реальный** сервер | **PASS** | `module.exports.createCmdServer` (`index.js:471`). S27: `pbx.createCmdServer()` → listen → HTTP 401/200\|202/401. |
| 6 | Integration 28/28 | **PASS** | этот прогон: `Integration: 28 passed, 0 failed, 0 skipped` |
| 7 | Visual VERIFIED 10/10 (ring=зелёный / incall=синий) | **PASS** | `VISUAL-GATE.md` + независимый Pillow resample: light-03 `(45,106,79)` L1→`--ok`=0; light-04 `(26,63,116)` L1→`--blue`=0; dark-03 green; dark-04 `(30,77,140)` L1=0. CSS: ring=`--green`, incall=`--blue`. |
| 8 | Missed ACL scoped | **PASS** | `telephony-pbx.js:337–365` + `hasFullCallView`; S26: PM не видит чужой missed. |
| 9 | `mock_answer` нет | **PASS** | grep `src/` + `public/assets/js/` → 0 hits. |
| 10 | Cutover NOT DONE | **PASS** | Journal: cutover **NOT DONE**; runbook — только по команде владельца; `CUTOVER-DONE` нет. |
| 11 | STT `SKIP_NO_KEYS` | **BLOCKED** (не FAIL сертификата) | `tools/stt_stereo_spike.js` → `SKIP_NO_KEYS`; journal `stt-spike` BLOCKED. Вне scope локальной доводки. |

---

## Закрытие прошлых FAIL

| Прошлый FAIL | Вердикт |
|---|---|
| FAIL-FINALIZE-ASTERISK-ENV | **CLOSED** — drop-in + openPaths loopback |
| FAIL-S27-MIRROR | **CLOSED** — экспорт + S27 на реальном HTTP |
| FAIL-FINALIZE-DIALPLAN-AUTH | **CLOSED** — dialplan `X-PBX-Secret` ×2; openPath; wrong 401 |
| FAIL-VISUAL-GATE-FALSE | **CLOSED** — пересъёмка `10:13:27Z`; канон ring=green / incall=blue подтверждён независимым RGB (L1=0 к токенам) |

---

## Критерии приёмки (актуальный срез)

| # | Критерий | Вердикт | Доказательство |
|---|---|---|---|
| 1 | Integration S00–S27 зелёные | **PASS** | 28/28 |
| 2 | Finalize/health openPaths + wrong secret 401 | **PASS** | код + S27 |
| 3 | AMI без secret 401 | **PASS** | код + S27 |
| 4 | Asterisk EnvironmentFile drop-in | **PASS** | `asgard-env.conf` |
| 5 | Dialplan X-PBX-Secret | **PASS** | conf:13,20 |
| 6 | S27 → real `createCmdServer` | **PASS** | экспорт + S27.js |
| 7 | Visual VERIFIED 10/10 по PNG+CSS | **PASS** | VISUAL-GATE + resample RGB |
| 8 | Missed ACL scoped (PBX reports) | **PASS** | S26 + route |
| 9 | mock_answer отсутствует | **PASS** | grep 0 |
| 10 | Cutover не выполнен | **PASS** | NOT DONE |
| 11 | Тесты только localhost / test DB | **PASS** | harness / journal |

---

## Лица критики (verify-gate 1–7)

| # | Лицо | Вердикт | Доказательство |
|---|---|---|---|
| 1 | Заказчик | **PASS** | Заявки локальной доводки закрыты: 28/28, visual 10/10 (синий incall / зелёный ring), auth/finalize/S27, missed scope, без mock_answer. Cutover явно NOT DONE. |
| 2 | Читатель/пользователь | **PASS** | Отчёт различает VERIFIED (локально) vs Cutover NOT DONE vs STT BLOCKED; без ложного «выкатили». |
| 3 | Ревьюер | **PASS** | Diff не правился верификатором. Прошлый FAIL-VISUAL закрыт evidence, согласованным с `phone.css` (не «красная точка»). |
| 4 | Тестировщик | **PASS** | Integration перезапущен (28/28). Краевые: finalize no-secret OK / wrong 401 / AMI 401; missed PM vs ADMIN (S26); ring/incall light+dark RGB. |
| 5 | Скептик данных | **PASS** | Pillow: light-03/04 и dark-03/04 совпали с VISUAL-GATE до пикселя; L1→токен = 0 на критичных 03/04. Manifest ts `2026-10-02T10:13:27.718Z`. |
| 6 | Регламент | **PASS** | Код не правился; cutover = NOT DONE; тесты на клоне/localhost; деплой не выполнялся. |
| 7 | Адвокат дьявола | **PASS** | Допущение «VISUAL stamp снова ложный» опровергнуто независимым resample. Опасное допущение «cutover готов» явно снято: NOT DONE. STT keys — BLOCKED, не скрыт под PASS. |

---

## Команды (артефакты прогона)

```text
# 1) Integration (этот прогон)
node tests/telephony/integration/run.js --all
→ [S00]…[S27] OK
→ Integration: 28 passed, 0 failed, 0 skipped

# 2) Auth / finalize / S27
src/pbx/index.js:229–240 openPaths finalize|health
src/pbx/index.js:471 createCmdServer export
tests/telephony/integration/S27.js — real createCmdServer; 401/200|202/401
ops/asterisk/extensions_asgard.conf:13,20 — X-PBX-Secret
ops/asterisk/asterisk.service.d/asgard-env.conf — EnvironmentFile pbx.env

# 3) Visual (независимый resample)
tests/reports/telephony-ui/VISUAL-GATE.md — VERIFIED 10/10
Pillow: light-03 (906,25)=(45,106,79); light-04 (906,26)=(26,63,116)
         dark-03 (904,26)=(36,87,70); dark-04 (904,25)=(30,77,140)
phone.css: .ph-dot--ring → --green; .ph-dot--incall → --blue

# 4) Missed ACL / mock_answer
S26 + telephony-pbx.js /reports/missed scoped
grep mock_answer src/ public/assets/js/ → 0

# 5) Cutover / STT
TELEPHONY-EXEC-JOURNAL.md → cutover NOT DONE; stt-spike BLOCKED SKIP_NO_KEYS
docs/telephony-cutover-runbook.md → только по команде владельца
```

---

## Список FAIL (итог)

**Блокеров нет** для сертификата локальной доводки.

### Закрыто

- ~~FAIL-FINALIZE-ASTERISK-ENV~~
- ~~FAIL-S27-MIRROR~~
- ~~FAIL-FINALIZE-DIALPLAN-AUTH~~
- ~~FAIL-VISUAL-GATE-FALSE~~

## Не FAIL / наблюдения

- Cutover = **NOT DONE** (корректно; не часть локального VERIFIED).
- STT spike `SKIP_NO_KEYS` = **BLOCKED** (нужен ключ SpeechKit) — не FAIL сертификата локальной доводки.
- Vanilla `GET /api/telephony/missed` использует legacy-фильтр `user_id = me OR NULL` (TEL_ADMIN); scoped ACL заявки относится к PBX `/reports/missed` (S26) — без расхождения с заявкой.

---

## Итог

**VERIFIED (локально).**  
Cutover: **NOT DONE.**  
STT: **BLOCKED** (`SKIP_NO_KEYS`).

Auth / integration / ops / S27 real CMD / visual ring=green·incall=blue / missed scope / no mock_answer — **PASS** в этом прогоне.
