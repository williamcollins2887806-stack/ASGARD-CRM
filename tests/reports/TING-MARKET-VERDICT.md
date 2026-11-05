# TING-MARKET-VERDICT — волна 1

Дата: 2026-11-05  
Раунд verifier-loop: 2 (после fix allocateCodes/open, PiP, lower-hand, token refresh, retention, consent UI)  
Источник порога: `TING-MARKET-ACCEPTANCE.md`  
Scorecard: `TING-SCORECARD.md`

## Вердикт

| Контур | Итог | Комментарий |
|--------|------|-------------|
| Машинные гейты (V1–V3) | **PASS** | code 62/62, ui 17/17, theme 6/6, tv_apk 12/12 |
| Scorecard P0 (код) | **почти** | блокируют только PENDING/PARTIAL с железом и замерами |
| Ручные протоколы (V4) | **PENDING** | нет подписанного `TING-MANUAL-*` |
| **MARKET_READY волны 1** | **НЕТ** | единогласный YES невозможен без V4 |

Честный статус продукта: **MACHINE_READY / MARKET_PENDING_MANUAL**.

Код волны 1 доведён до состояния, в котором машинные критерии закрываются.
Рыночная готовность по плану требует подписи людей на ТВ, NAT, iOS/Android и blind-сравнении.

## Машинные доказательства

| Гейт | Результат | Когда |
|------|-----------|-------|
| `node tests/ting/verifiers/code_verify.js` | VERIFIED 62/62 | 2026-11-05 |
| `node tests/ting/verifiers/ui_verify.js` | VERIFIED 17/17 | 2026-11-05 |
| `node tests/ting/verifiers/theme_verify.js` | VERIFIED 6/6 | 2026-11-05 |
| `node tests/ting/verifiers/tv_apk_verify.js` | VERIFIED 12/12 | 2026-11-05 |
| Self-check gaps (allocateCodes/PiP/hand/TTL/retention/docs) | 18/18 PASS | 2026-11-05 |

## Что закрыто в этом раунде (код)

- D16/dial: `allocateCodes` учитывает статус `open`
- T28: `huginn_ting.js` подключён в оболочку + CSS `body.ting-live`
- T09: `POST .../lower-hand` + UI + data `hand_force_lower`
- T31: guest primary TTL 30 мин, `expires_at` + `scheduleTokenRefresh`
- Q09/R01: модалка согласия по факту записи
- R02: DELETE записи + `sweepExpiredRecordings` (90 дней)

## Что блокирует MARKET_READY (только люди / прод-замеры)

| ID | Почему нельзя закрыть агентом |
|----|--------------------------------|
| Q05 | Windows camera handoff — нужен реальный ноутбук |
| Q03 | corp NAT / LTE / Wi-Fi ТВ — нужен выезд в сети |
| Q11 | Android TV 50″ + пульт + USB-камера |
| Q15 | Blind vs Телемост — 2 независимых оценщика |
| Q04 / T30 | `lk load-test` 12/25/40 на целевом сервере → `TING-CAPACITY.md` цифры |

Шаблон: `tests/reports/TING-MANUAL-2026-11-05.md`.

## Лица критики (машинный контур)

| Лицо | PASS/FAIL | Доказательство |
|------|-----------|----------------|
| Заказчик (волна 1 код) | PASS | scorecard T/C/Q/R код закрыт или честно PARTIAL |
| Читатель | PASS | SUPPORT/DEVICES/STATUS/COSTS на месте |
| Ревьюер | PASS | минимальные точечные фиксы, без stub |
| Тестировщик (машина) | PASS | 4 verifier VERIFIED |
| Скептик данных | PASS | capacity без вендорских цифр; MARKET_READY не заявлен |
| Регламент | PASS | план не правили; деплой не делали |
| Адвокат дьявола | FAIL→ожидаемо | без ручного ТВ/NAT «рынок» не доказан |

## Решение

```
MACHINE_READY = YES
MARKET_READY  = NO  (ждёт V4 + capacity numbers)
```

Следующий шаг человека: заполнить и подписать `TING-MANUAL-2026-11-05.md`, прогнать load на проде/стейдже, после этого пересчитать scorecard и сменить вердикт на `MARKET_READY`.
