# THING-UI-VERIFY — независимое UI-перепроверение ASGARD Ting

**Дата:** 2026-10-02  
**Роль:** independent re-verifier (код не правился)  
**SoT:** `prototypes/ting/index.html` (+ `rev-*.png`, `ting-v3-lobby.png`, `rev-ready.png`, `rev-protocol.png`)  
**Проверялось:** предыдущий FAIL-список (1–4). Полный icon-dock паритет in-call ↔ hub — только как KNOWN GAP при PASS 1–4.

**Уровень:** L3 (UI-сертификация по SoT)  
**Статус:** `VERIFIED` (предыдущие FAIL 1–4 → FIXED; KNOWN GAP зафиксирован)

---

## Итог по предыдущим FAIL

| # | Было | Сейчас | Доказательство |
|---|------|--------|----------------|
| 1 | Guest lobby ≠ SoT | **FIXED** | `public/ting/index.html`: Manrope, `--gold:#D4A843`, rune `ᚦ`, Nordic dark (`--bg0:#08090C` + radial), preview `<video>` + `getUserMedia` **до** join |
| 2 | Ready card «Тинг готов» | **FIXED** | `meetings_page.js`: после create → `showThingReady`; заголовок «Тинг готов»; ссылка; dial + hint «6 цифр»; primary «Скопировать ссылку» |
| 3 | Protocol document UI | **FIXED** | `openThingProtocol` → `GET /api/thing/rooms/:slug/protocol`; кнопка на карточке при `is_host && protocol_enabled`; бэкенд host-only в `src/routes/thing.js` |
| 4 | Meeting card Ting access | **FIXED** | блок на карточке: ссылка · код телефона · «Войти в Тинг» (+ статус / AI-протокол) |

**KNOWN GAP (не блокер для VERIFIED по FAIL 1–4):** in-call dock в CRM guest room — текстовые кнопки (`Микрофон` / `Камера` / `Экран` / `Выйти`), без SVG icon-dock как в SoT hub/room (`dock-item` + icons). Полный паритет dock с render hub **не** закрыт.

---

## FAIL 1 — Guest lobby

**Критерий:** Manrope, `--gold:#D4A843`, rune ᚦ, camera/mic PREVIEW before join, Nordic dark.

| Проверка | Результат | Где |
|----------|-----------|-----|
| Google Fonts Manrope + `--font: "Manrope"` | PASS | `public/ting/index.html` L7, L19 |
| `--gold: #D4A843` | PASS | L15 |
| Rune `ᚦ` в `.rune-badge` | PASS | L115 |
| Nordic dark bg | PASS | L10–14, L24 (`#08090C` / `#0D1117` / radial) |
| Preview DOM + controls | PASS | L121–132 (`#preview`, `#previewVideo`, `#preMic`, `#preCam`) |
| `getUserMedia` до join | PASS | `ensurePreview()` L202–222; вызов при показе формы L271; join L348+ |

**Косметика vs SoT (не FAIL по чеклисту):** emoji 🎤/📷 вместо SVG; нет `img/logo.png` рядом с руной. Структура lobby-card совпадает с SoT screen `lobby` / `ting-v3-lobby.png`.

**Вердикт FAIL1: FIXED**

---

## FAIL 2 — Ready card «Тинг готов»

**Критерий:** `showThingReady` после create; link + 6-digit dial + copy primary.

| Проверка | Результат | Где |
|----------|-----------|-----|
| Вызов после create | PASS | L602–603: `if (result?.thing?.url) showThingReady(...)` |
| Заголовок «Тинг готов» | PASS | L617, modal title L636 |
| Ссылка | PASS | L612–619 |
| Primary copy | PASS | L621 `btn primary` «Скопировать ссылку» |
| 6-digit dial | PASS | L624–629 + backend `generateDialCode` = ровно 6 цифр (`thing-codes.js`) |
| Rune strip | PASS | L616 `ᚦ ◆ ТИНГ` |

**Косметика vs SoT `rev-ready.png`:** нет QR, «Поделиться», dial-in телефон/PIN в ready-модалке. Чеклист предыдущего FAIL закрыт.

**Вердикт FAIL2: FIXED**

---

## FAIL 3 — Protocol document UI

**Критерий:** `openThingProtocol` грузит `/api/thing/.../protocol` для host; на карточке — доступ к протоколу / ting-access.

| Проверка | Результат | Где |
|----------|-----------|-----|
| `openThingProtocol(slug)` | PASS | L639–674 |
| Fetch path | PASS | `GET /api/thing/rooms/${slug}/protocol` + Bearer |
| Host gate UI | PASS | кнопка только при `thing.is_host && thing.protocol_enabled` (L286) |
| Host gate API | PASS | `thing.js` L319–324: 403 если не initiator |
| Рендер minutes + print | PASS | modal «Протокол Тинга», `window.print()` |

**Косметика vs SoT `rev-protocol.png`:** CRM — компактный modal со списком пунктов, не A4-документ с повесткой/резюме/таблицей поручений. По **предыдущему** FAIL-критерию (wire API + host UI) — закрыто; полный document-layout = отдельный gap вне списка 1–4.

**Вердикт FAIL3: FIXED**

---

## FAIL 4 — Meeting card Ting access

**Критерий:** link · dial · enter.

| Проверка | Результат | Где |
|----------|-----------|-----|
| Ссылка | PASS | L283 `Ссылка` + `origin + thing.url` |
| Dial | PASS | L284 `Код телефона` (host получает `dial_code` из `meetings.js` GET) |
| Enter | PASS | L281 «Войти в Тинг» |
| CSS class `ting-access` | **нет** | блок = `.card` с gold border; семантика SoT `.ting-access` соблюдена по содержанию |

Данные `thing` приходят из `GET /api/meetings/:id` (`meetings.js` L257–266).

**Вердикт FAIL4: FIXED** (класс имени не обязателен при наличии link·dial·enter)

---

## KNOWN GAP — in-call icon-dock

| | SoT (`prototypes/ting`) | CRM (`public/ting/index.html`) |
|--|-------------------------|--------------------------------|
| Dock | `.dock-item` + SVG icons (Мик/Камера/Экран/Ещё/Выйти) | 4 text `<button>`: Микрофон / Камера / Экран / Выйти |
| Hub parity | полный render hub в прототипе | guest room — урезанный dock |

По указанию заказчика: если FAIL 1–4 PASS → dock parity **KNOWN GAP**, не новый FAIL в этой верификации.

---

## Faces 1–7

| # | Лицо | Вердикт | Доказательство |
|---|------|---------|----------------|
| 1 | Заказчик | **PASS** | Все 4 пункта предыдущего FAIL-списка FIXED; dock = KNOWN GAP как разрешено |
| 2 | Читатель/пользователь | **PASS** | Lobby/ready/access понятны с первого взгляда; протокол открывается отдельной кнопкой для host |
| 3 | Ревьюер | **PASS** | Diff не смотрели (verify-only); реализации на месте в `public/ting` + `meetings_page.js` + routes |
| 4 | Тестировщик | **PASS** | Статический audit + сверка SoT PNG; краевые: pin wrap, ended room, waiting lobby_status, host-only protocol 403 в коде |
| 5 | Скептик данных | **PASS** | `--gold:#D4A843` байт-в-байт; dial = 6 цифр в `thing-codes.js`; API path совпадает с route |
| 6 | Регламент | **PASS** | Код не редактировался; отчёт в `tests/reports/`; деплой не трогался |
| 7 | Адвокат дьявола | **PASS** | Рискованное допущение «статический grep = runtime UI» — mitigated чтением полного lobby HTML + JS preview flow + wire к create/openMeeting; полный A4-протокол и icon-dock **осознанно** вынесены за скобки FAIL 1–4 |

---

## Финальный вердикт

```
VERIFIED
FAIL 1 FIXED | FAIL 2 FIXED | FAIL 3 FIXED | FAIL 4 FIXED
KNOWN GAP: CRM in-call icon-dock ≠ SoT hub/room icon-dock
```

**Артефакты проверки:** этот файл; скрипт `_d246_tmp/verify_ting_ui_recheck.py` (локальный probe, не часть продукта).
