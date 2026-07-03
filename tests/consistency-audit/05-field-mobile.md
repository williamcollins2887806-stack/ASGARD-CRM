# Аудит консистентности — Полевой модуль + Приложение рабочих

Дата: 2026-06-23 (read-only).
Источники: бэкенд `src/routes/field-*.js`, миграции `V060/V061/V063/V183/V228`, vanilla `public/assets/js/field-tab.js`, React v2 `public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/`, мобильное приложение `public/mobile-app/src/pages/field/`.

---

## 1. employee_assignments

### Схема БД (V060 + V228)
- `field_role VARCHAR(30) DEFAULT 'worker'` — без CHECK; де-факто используется набор `{worker, shift_master, senior_master}` (см. ниже).
- `tariff_id INTEGER REFERENCES field_tariff_grid(id)`, `tariff_points`, `combination_tariff_id`, `per_diem DECIMAL(10,2)`.
- `shift_type VARCHAR(20) DEFAULT 'day'` (нет CHECK).
- `is_active BOOLEAN DEFAULT TRUE`, `departure_date`, `return_date`, `date_from`, `date_to`.
- `sms_sent BOOLEAN DEFAULT FALSE`, `sms_sent_at`.

### Backend (источник истины по field_role)
- `src/routes/field-checkin.js:299` — `field_role = 'worker'`.
- `src/routes/field-checkin.js:310,579,710,836` — `field_role IN ('shift_master','senior_master')`.
- `src/routes/field-photos.js:278` — мастер = `shift_master|senior_master`.
- `src/routes/field-stages.js:139` — `field_role IN ('shift_master','senior_master')` (мастер).
- `src/routes/field-manage.js:247,254` — POST upsert принимает любое значение (`field_role || 'worker'`, валидации нет).

Канон: `worker | shift_master | senior_master`. Значения `object_master` и `pm` в БД-запросах не встречаются.

### Vanilla — `public/assets/js/field-tab.js:52-56`
```
ROLES = [
  { value: 'worker', label: 'Рабочий' },
  { value: 'shift_master', label: 'Мастер смены' },
  { value: 'senior_master', label: 'Ст. мастер' },
]
```
Совпадает с backend.

### v2 — `public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/constants.js:16-21`
```
ROLES = [
  { value: 'worker', label: 'Рабочий' },
  { value: 'shift_master', label: 'Мастер смены' },
  { value: 'object_master', label: 'Мастер объекта' },   // ← нет в БД
  { value: 'pm', label: 'РП' }                            // ← нет в БД
]
```

### Mobile — `public/mobile-app/src/pages/field/FieldCrew.jsx:10`
```
ROLE_LABELS = { senior_master: 'Ст. мастер', shift_master: 'Мастер', worker: 'Рабочий' }
```
Совпадает с backend.

### 🔴 РАСХОЖДЕНИЕ R-FIELD-01 — роли v2 ≠ backend/vanilla/mobile
**Файл:** `public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/constants.js:16-21`
**Симптом:** Выбор `object_master` или `pm` в селекте v2 запишет в `employee_assignments.field_role` значение, которого нет ни в одном WHERE-фильтре бэкенда (`field-checkin.js`, `field-pm.js`, `field-photos.js`, `field-stages.js`, `field-reports.js`, `field-worker.js`). Сотрудник пропадёт из счётчиков бригады, не получит квест-прогресс «crew_all_checked_in», не пройдёт preHandler мастера в `/stages/my-crew/*`.
**Поведение mobile:** `FieldCrew.jsx:215` отобразит «Рабочий» (fallback), потому что в `ROLE_LABELS` нет ключа `object_master|pm`.

---

## 2. field_logistics

### Схема БД (V060 + V183 + V186 + V209)
- `item_type VARCHAR(30) NOT NULL` (без CHECK; де-факто 13 значений, см. `src/routes/field-logistics.js:62-76`):
  `ticket_to | ticket_back | flight | train | transfer | hotel | housing | hostel | directive_mo | training | certification | visa | insurance`.
- `status VARCHAR(30) DEFAULT 'pending'` — переходы из бэкенда: `pending → purchased (V183) → ready (после /attach) → sent (после /send)`.
- `purchased_at`, `purchased_by` (V183), `sent_at`, `sent_to_employee BOOLEAN`, `expense_id`, `document_id`, `deleted_at` (V209), `referral_at|hotel_address|driver_phone` (V186), `departure_at|arrival_at|transport_no`.

### Backend
- `src/routes/field-logistics.js:162` — INSERT `status='pending'`.
- `src/routes/field-logistics.js:484` — `/attach` → `status='ready'`.
- `src/routes/field-logistics.js:549` — `/send` → `status='sent'`.
- `src/routes/field-logistics.js:577` — `/purchased` → `status='purchased'`.

### Vanilla — `public/assets/js/field-tab.js:62-68`
`LOG_TYPES = [ticket_to, hotel, ticket_back, visa, insurance]` (5 значений; 8 типов из бэка опущены — не рисуются в матрице, но если приходят с бэкенда, не отображаются).
- Строка 943: `badge.textContent = item.status === 'confirmed' ? '✅' : item.status === 'sent' ? '📨' : item.status === 'booked' ? '📋' : '⏳'`.

### v2 — `constants.js:31-48`, `tabs/Logistics.jsx`
- `LOG_TYPES` 7 значений (добавлены `transfer`, `medical`), `LOG_MATRIX_TYPES` 5 значений (как vanilla).
- `LOG_STATUS_LABELS = { pending:'⏳ Не куплено', purchased:'💳 Куплено', ready:'📋 Готово', sent:'📨 Отправлено' }` — совпадает с backend.

### Mobile — `FieldLogistics.jsx:6-31`
- `TYPE_CONFIG` 13 значений — полный набор бэкенда (✅).
- `STATUS_LABELS = { confirmed:'Подтверждено', sent:'Отправлено', pending:'Ожидает', ready:'Готово' }` — **нет `purchased`**, есть несуществующий `confirmed`.

### 🔴 R-FIELD-02 — vanilla показывает невалидные статусы логистики
**Файл:** `public/assets/js/field-tab.js:943`
**Симптом:** Vanilla показывает `'✅'` при `status === 'confirmed'` и `'📋'` при `status === 'booked'`. Ни одно из значений бэкенд не записывает в `field_logistics.status` (`pending|purchased|ready|sent`). Реальный `purchased` → fallback `⏳` (как pending). Невыкупленный билет и купленный билет выглядят одинаково.

### 🔴 R-FIELD-03 — mobile теряет статус «Куплено»
**Файл:** `public/mobile-app/src/pages/field/FieldLogistics.jsx:31`
**Симптом:** `STATUS_LABELS` не содержит `purchased`. На карточке отрисуется сырой `item.status` («purchased» латиницей) или цвет '#6b7280' (STATUS_COLORS:30 тоже не содержит). Рабочий получит билет со статусом `purchased` и увидит непереведённое английское слово.

### 🔴 R-FIELD-04 — vanilla матрица не покрывает 8 типов
**Файл:** `public/assets/js/field-tab.js:62-68`
**Симптом:** Если backend/v2/mobile создают `flight|train|transfer|housing|hostel|directive_mo|training|certification`, в матрице vanilla этих ячеек нет — РП в vanilla не увидит направление на медосмотр / обучение, хотя в v2 (`LOG_TYPES`) и mobile они есть.

### 🟡 ПОДОЗРЕНИЕ — `medical` в v2 LOG_TYPES
**Файл:** `constants.js:38` — `{ value: 'medical', label: '⚕️ Мед.осмотр' }`.
Бэк (`src/routes/field-logistics.js:62-76` map) не имеет `medical`. Если v2 создаст логистику с item_type='medical', INSERT пройдёт (нет CHECK), но `buildMessages` свалит на дефолт `📌 Документ`, `expenseTypeFor` отдаст `'other'`, и в `work-readiness.js:32-34` запись не попадёт ни в одну категорию (TICKET/HOUSING/LOGISTICS_TYPES). Правильный ключ — `directive_mo`.

---

## 3. field_trip_stages (этапы)

### Схема БД (V063 + V220 + V253)
- `stage_type` — список валидных: `medical | travel | waiting | warehouse | day_off | object` (`src/routes/field-stages.js:33` STAGE_TYPES).
- `status` — `planned | active | completed | approved | adjusted | rejected` (де-факто из field-stages.js + field-checkin.js:261 `status='completed'`).
- `date_from`, `date_to`, `days_count`, `days_approved`, `tariff_id`, `tariff_points`, `rate_per_day`, `amount_earned`, `logistics_id`, `source` (`auto | manual`), `entered_by_user_id`.

### Backend STAGE_LABELS — `src/routes/field-stages.js:57-64`
```
medical: 'Медосмотр', travel: 'Дорога', waiting: 'Ожидание',
warehouse: 'Склад', day_off: 'Выходной', object: 'Объект'
```

### Vanilla — `field-tab.js:2482-2493`
`STAGE_COLORS / STAGE_LABELS_DT / STAGE_ICONS_DT` — все 6 ключей совпадают с бэком. ✅

### v2 — `constants.js:86-102`
`STAGE_COLORS / STAGE_LABELS` — все 6 ключей совпадают. ✅

### Mobile — `FieldStages.jsx:7-14`
`STAGE_CONFIG` — все 6 ключей совпадают. ✅
**Но** `FieldHome.jsx:99-101`:
```
STAGE_LABELS = { medical, travel, waiting, warehouse, day_off }  // ← нет object
STAGE_COLORS = { medical, travel, waiting, warehouse, day_off }  // ← нет object
STAGE_ICONS  = { medical, travel, waiting, warehouse, day_off }  // ← нет object
```

### 🟡 R-FIELD-05 — FieldHome не имеет object stage
**Файл:** `public/mobile-app/src/pages/field/FieldHome.jsx:99-101`
**Симптом:** Использование защищено `currentStage.stage_type !== 'object'` в строке 642 — то есть object-стадия не рендерится баннером (это by-design: object — это «на объекте», своя логика). Не баг, но если бэк когда-нибудь отдаст `current` с `stage_type='object'`, баннер не падёт, а отрисует сырое `currentStage.stage_type`. Низкий риск.

---

## 4. assembly_orders

### Схема БД (V053)
- `type CHECK IN ('mobilization','demobilization','transfer')`.
- `status CHECK IN ('draft','confirmed','packing','packed','in_transit','received','returned','closed')`.

### Backend (`field-assembly.js`)
- `/my` исключает `'closed','returned'`.
- Переходы: `draft → confirmed → packing → packed → in_transit → received → closed`.

### Mobile — `FieldAssembly.jsx:12-20`
```
TYPE_META = { mobilization, demobilization, transfer }                                  ✅
STATUS_LABEL = { draft, confirmed, packing, packed, in_transit, received, returned, closed } ✅
```
Покрытие 100%.

### work-readiness (PM-сторона) — `src/routes/work-readiness.js:139`
`DONE = new Set(['in_transit', 'received', 'closed'])` — корректно (готово = уже в пути или принято).

---

## 5. packing_lists (`field_packing_lists`, V061)

### Схема: `status VARCHAR(30) DEFAULT 'draft'` — переход `draft → sent → in_progress → completed → shipped` (V061:84-85).
### items: `status VARCHAR(20) DEFAULT 'pending'` — `pending | packed | shortage | replaced` (V061:119; field-tab.js:2401).

### Vanilla — `field-tab.js:2246-2247`
`PACK_STATUS_LABELS = { draft, sent, in_progress, completed, shipped }` — ✅

### v2 — `tabs/Packing.jsx:43-49`
`PACK_STATUS_LABELS = { draft, sent, in_progress, completed, shipped }` — ✅

### Mobile — `FieldPacking.jsx:244`
`{(list.status === 'active' || list.status === 'sent') && (...)}` — статус `'active'` бэк никогда не записывает.

### 🟡 R-FIELD-06 — мёртвая ветка `status === 'active'`
**Файл:** `public/mobile-app/src/pages/field/FieldPacking.jsx:244`
**Симптом:** Условие `'active'` никогда не сработает (валидные — `draft|sent|in_progress|completed|shipped`). Дублирование sent | 'active' выглядит как остаточный код от прежней схемы. Не блокирует, но смущает аудит.

---

## 6. field_master_funds (подотчёт)

### Схема: `status VARCHAR(30) DEFAULT 'issued'` — переход `issued → confirmed → reporting → closed` (V061:22-23).

### Backend (`field-funds.js`)
- 169: `→ confirmed` после `/confirm`.
- 138: `→ closed` после закрытия.
- 166: гард «нельзя подтвердить если уже не issued».
- (`reporting` встречается в payload `:292` — статусный переход к отчётности).

### Vanilla — `field-tab.js:2008-2010`
```
FUND_STATUS_LABELS = { issued, confirmed, reporting, closed } ✅
```

### v2 — `constants.js:76-81`
```
FUND_STATUS_LABELS = { issued: 'Выдано', spent: 'Потрачено', returned: 'Возвращено', closed: 'Закрыто' }
```

### Mobile — `FieldFunds.jsx:9-14`
```
STATUS_MAP = { issued, confirmed, reporting, closed } ✅
```

### 🔴 R-FIELD-07 — v2 показывает фантомные статусы фондов
**Файл:** `public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/constants.js:76-81`
**Симптом:** Backend никогда не пишет в `field_master_funds.status` значения `'spent'` или `'returned'` (это **колонки** в той же таблице, а не значения status). Когда бэк отдаёт реальные `'confirmed'`/`'reporting'`, v2 показывает сырой английский ключ. Когда фонд закрыт — корректно. Никакого «Потрачено»/«Возвращено» не будет.
**Где используется:** `tabs/Funds.jsx` через импорт `FUND_STATUS_LABELS`.

---

## 7. field_photos (фото)

### Backend (`src/routes/field-photos.js`)
- Поля: `filename`, `original_name`, `mime_type`, `size`, `photo_type` (default `'work'`), `caption`, `lat/lng`, `taken_at`.
- Отдаётся в API как `{ url: '/uploads/field/{work_id}/{filename}' }` (строки 206, 330).

### Mobile — `FieldPhotos.jsx`
- Загрузка: `POST /api/field/photos/upload` с FormData ключом `photo`.
- Чтение: `photo.photo_type`, `photo.url` через img src.

Расхождений в схеме нет. ✅

---

## 8. work-readiness (7 этапов)

### Backend — `src/routes/work-readiness.js:20-29`
```
personnel(0.25) · training(0.25) · procurement(0.20) · assembly(0.15) ·
tickets(0.06) · housing(0.06) · logistics(0.03)
```

### Источники по этапам (`work-readiness.js`)
| Этап | Источник | Done-условие |
|---|---|---|
| personnel | `staff_requests.status_v2='added_to_crew'` + active `employee_assignments` | `:70-71` hasCrewReq && assigned.length>0 |
| training | `worker_training.status` + `work_permit_requirements` | `:93` open === 0 |
| procurement | `procurement_requests.status NOT IN ('dir_rejected','cancelled')` | `:117` `'delivered'|'closed'` |
| assembly | `assembly_orders WHERE type='mobilization' AND status<>'draft'` | `:139` `in_transit|received|closed` |
| tickets | `field_logistics WHERE item_type IN ('ticket_to','ticket_back','flight','train')` | `LOGI_DONE=['purchased','sent']` |
| housing | `field_logistics WHERE item_type='hotel'` | `LOGI_DONE` |
| logistics | `field_logistics WHERE item_type='transfer'` | `LOGI_DONE` |

### 🟡 R-FIELD-08 — housing-этап считает только 'hotel'
**Файл:** `src/routes/work-readiness.js:33` `HOUSING_TYPES = ['hotel']`
**Симптом:** v2 и mobile принимают `housing | hostel` как самостоятельные типы (`constants.js:LOG_TYPES`? — там нет; но в backend buildMessages:69-70 они есть). Если РП через `directive_mo` API создаст `housing`/`hostel`, в кольцо готовности они НЕ попадут.

---

## 9. Shift type (день/ночь/качающаяся)

### Backend `field_checkins.shift VARCHAR(20) DEFAULT 'day'` (V060), `employee_assignments.shift_type` тоже без CHECK.
- `field-checkin.js:221` авто-детект: `(hour>=4 && hour<16) ? 'day' : 'night'`. `'swing'` бэк не использует.

### Vanilla — `field-tab.js:57-60`: `day | night | swing`.
### v2 — `constants.js:23-27`: `day | night | swing`.
### Mobile FieldShift — берёт `data.project.shift_type` как-есть.

### 🟡 R-FIELD-09 — swing не имеет авто-разрешения
**Файл:** vanilla/v2 предлагают `swing` в селекте, но `src/routes/field-checkin.js:221` авто-детект отдаст `'day' | 'night'` независимо от того, что выбрано в assignment. По факту swing-вахтовик ловит auto-detect и пишет в `field_checkins.shift = 'day'|'night'`. Не баг — design choice, но рассогласование UX vs бэк.

---

## 10. field_checkins.status

### Схема: `status VARCHAR(20) DEFAULT 'active'` — `active | completed | cancelled` (V060:56, V086 unique).
### Backend: `field-checkin.js:230,261,304,407,463,623` — переходы `active → completed` после checkout, `cancelled` при отмене.
### Memory доводит, что **финансовые агрегаты считаются ТОЛЬКО из `completed`** (V072a).

Все три фронта показывают активную смену корректно. Расхождений нет.

---

## ИТОГОВАЯ СВОДКА — 🔴 КРИТИЧНЫЕ РАСХОЖДЕНИЯ

| ID | Файл | Симптом |
|---|---|---|
| R-FIELD-01 | `desktop-v2-src/.../FieldTab/constants.js:16-21` | v2 предлагает `object_master`, `pm` — невалидные `field_role`, ломают мастер-фильтры бэка |
| R-FIELD-02 | `public/assets/js/field-tab.js:943` | vanilla мапит несуществующие статусы `'confirmed'`, `'booked'` логистики; реальный `purchased` падает в fallback |
| R-FIELD-03 | `public/mobile-app/.../FieldLogistics.jsx:30-31` | mobile не знает статус `purchased` → рабочий видит латинское «purchased» |
| R-FIELD-04 | `public/assets/js/field-tab.js:62-68` | vanilla матрица не покрывает `flight/train/transfer/housing/hostel/directive_mo/training/certification` |
| R-FIELD-07 | `desktop-v2-src/.../FieldTab/constants.js:76-81` | v2 FUND_STATUS_LABELS показывает `spent/returned` (это **колонки**, не статусы); реальные `confirmed/reporting` отдаются как сырой ключ |

## 🟡 ПОДОЗРЕНИЯ

| ID | Файл | Что |
|---|---|---|
| R-FIELD-05 | `mobile-app/.../FieldHome.jsx:99-101` | STAGE_LABELS без `object` — низкий риск (защищено условием выше) |
| R-FIELD-06 | `mobile-app/.../FieldPacking.jsx:244` | Мёртвая ветка `status === 'active'` (валидные draft/sent/in_progress/completed/shipped) |
| R-FIELD-08 | `src/routes/work-readiness.js:33` | Кольцо «Жильё» считает только `hotel`, игнорирует `housing/hostel` |
| R-FIELD-09 | vanilla `field-tab.js:60` + v2 `constants.js:25` + mobile | `swing` в селекте, но `field-checkin.js:221` авто-перезаписывает на `day|night` |
| R-FIELD-medical | `desktop-v2-src/.../FieldTab/constants.js:38` | v2 LOG_TYPES имеет `medical` — backend этого ключа не маппит (canon = `directive_mo`); запись пройдёт без CHECK, но выпадет из work-readiness и шаблонов SMS |

---

## Что НЕ найдено / совпадает

- Статусы `assembly_orders` — все три слоя (backend/work-readiness/mobile FieldAssembly) синхронны. ✅
- `stage_type` — backend/vanilla/v2/mobile FieldStages совпадают на полном наборе из 6 значений. ✅
- `field_logistics.item_type` в mobile FieldLogistics покрывает все 13 серверных значений. ✅
- `field_packing_lists.status` в vanilla и v2 покрывают полный набор. ✅
- `field_master_funds.status` в vanilla и mobile корректны; промах только в v2.
- `field_photos`: схема URL единообразна (`/uploads/field/{work_id}/{filename}`).
