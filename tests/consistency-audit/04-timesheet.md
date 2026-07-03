# Аудит консистентности модуля «Табель»

Дата: 2026-06-23 (read-only, без правок кода и прод-операций).

Объём: backend `src/routes/timesheet-v2.js` (2598 строк), vanilla `public/assets/js/timesheet-v2.js` (2237 строк),
React v2 `public/desktop-v2-src/src/pages/Timesheet/*`, SSoT `src/lib/worker-finances.js`, мобилка рабочих
`public/mobile-app/src/pages/field/*`, эндпоинт мобилки `src/routes/field-earnings.js` + `src/routes/field-worker.js`.

## 1. Схема БД (актуальные поля)

### `field_checkins` (V060 + V145)
- `id`, `employee_id`, `work_id`, `assignment_id`, `date`
- `shift VARCHAR(20) DEFAULT 'day'` — БЕЗ CHECK-constraint (см. `migrations/V145__checkin_types_extension.sql:5`).
  Документация V145 объявляет план: `'day','night','road','warehouse','medical','waiting'`.
  Фактически backend (`src/routes/timesheet-v2.js:166-176`) трактует 4 значения: **`day` / `night` / `road` / `standby`**.
- `status VARCHAR(20)` — `active` / `completed` / `cancelled`. Для ФОТ/выплат **всегда** `'completed'`.
- `amount_earned`, `day_rate`, `hours_worked`, `hours_paid`
- `checkin_at`, `checkin_by`, `checkin_source` (`'self'|'master'|'pm_manual'|'manual'|'admin'`)
- `entered_by_user_id`, `created_at`, `updated_at`

### `field_trip_stages`
- `stage_type` — `'warehouse'|'medical'|'travel'|'waiting'|'day_off'|'object'` (V145:9-10).
- `status` исключаются `'rejected'|'cancelled'` (`timesheet-v2.js:482-484`).

### `field_tariff_grid`
- `points` — **БАЛЛЫ** (используется в `timesheet-v2.js:459, 657`).
- `day_rate` — **РУБЛИ**. Не путать (memory feedback-fot-trigger-payment-method FIX #3).

### `worker_payments` (V067, CHECK type IN)
- `type CHECK IN ('per_diem','salary','advance','bonus','penalty')` (`migrations/V067__worker_payments.sql:10`).
  **Других значений нет**, БД не позволит.
- `status CHECK IN ('pending','paid','confirmed','cancelled')` (V067:40).
- `payment_method VARCHAR(30)` — `'cash'|'card'|'transfer'|'auto'`, V230 ставит `'auto'` для авто-чекинов.
- `pay_year`, `pay_month`, `period_from`, `period_to`, `amount`, `paid_at`, `confirmed_by_worker`.

## 2. Endpoints

| Route | File:line | Назначение |
|---|---|---|
| `GET  /api/timesheet/v2/:year/:month` | `src/routes/timesheet-v2.js:230` | Главный агрегат для всех 5 mode |
| `PUT  /api/timesheet/v2/entry` | `src/routes/timesheet-v2.js:1337` | Создать/обновить/удалить отметку |
| `GET  /api/timesheet/v2/locks/:y/:m` | `src/routes/timesheet-v2.js` | Локи месяца |
| `POST /api/timesheet/v2/lock` | `src/routes/timesheet-v2.js` | Закрыть scope |
| `DELETE /api/timesheet/v2/lock/:id` | `src/routes/timesheet-v2.js` | Открыть scope |
| `GET  /api/timesheet/v2/:y/:m/export` | `src/routes/timesheet-v2.js` | Excel |
| `GET  /api/field/worker/finances` | `src/routes/field-worker.js:431` | SSoT через `getWorkerFinances` |
| `GET  /api/field/worker/finances/:work_id` | `src/routes/field-worker.js:449` | Финансы по работе |
| `GET  /api/field/earnings/monthly` | `src/routes/field-earnings.js:22` | Помесячная разбивка для мобилки |

### Главный SELECT (`/api/timesheet/v2/:y/:m`)

`timesheet-v2.js:452-468`:
```sql
SELECT fc.id, fc.employee_id, fc.work_id, fc.date, fc.shift,
       fc.amount_earned, fc.day_rate, fc.hours_worked, fc.hours_paid,
       fc.entered_by_user_id, fc.checkin_by, fc.checkin_source, fc.created_at,
       u.name, u.role, u.phone,
       w.work_title, w.pm_id,
       ftg.points AS tariff_points
FROM field_checkins fc
LEFT JOIN users u ON u.id = fc.entered_by_user_id
LEFT JOIN works w ON w.id = fc.work_id
LEFT JOIN employee_assignments ea ON ea.id = fc.assignment_id
LEFT JOIN field_tariff_grid ftg ON ftg.id = ea.tariff_id
WHERE fc.status = 'completed' AND fc.date BETWEEN $1 AND $2
  AND fc.employee_id = ANY($3::int[])
```

**Фильтр `fc.status = 'completed'`** применяется консистентно во ВСЕХ местах timesheet-v2.js (строки 301, 335, 465, 1407, 1453) и в `field-earnings.js:33, 50`, и в `worker-finances.js:44`. ✅

## 3. Маппинг shift → cell type

| shift в БД | UI type | Иконка | Где |
|---|---|---|---|
| `day` | `day` | ☀️ | timesheet-v2.js:175 |
| `night` | `night` | 🌙 | timesheet-v2.js:172 |
| `road` (+ alias `travel`) | `travel` | ✈️ | timesheet-v2.js:173 |
| `standby` (+ alias `waiting`) | `waiting` | ⏰ | timesheet-v2.js:174 |
| любое другое | `day` (fallback) | ☀️ | timesheet-v2.js:175 |

`SHIFT_TYPES = new Set(['day','night'])` в `timesheet-v2.js:38` — используется только в
`typeAllowedForMode` (валидация при PUT entry) и при INSERT/UPDATE. Backend **не пишет** в БД ничего, кроме
`'day'|'night'`. Записи с `'road'`/`'standby'` рождаются из мобилки/`field-tab.js` (см. ниже).

## 4. TYPE_META (6 типов ячеек) — паритет

| тип | Vanilla `timesheet-v2.js:25-32` | React v2 `api.js:177-184` | Совпадает? |
|---|---|---|---|
| `day` | ☀️ «Дневная смена» | ☀️ «День» | ✅ (label чуть разный) |
| `night` | 🌙 «Ночная смена» | 🌙 «Ночь» | ✅ |
| `warehouse` | 📦 «Склад» | 📦 «Склад» | ✅ |
| `medical` | 🏥 «Медосмотр» | 🏥 «Медосмотр» | ✅ |
| `travel` | ✈️ «Дорога» | ✈️ «Дорога» | ✅ |
| `waiting` | ⏰ «Ожидание» | ⏰ «Ожидание» | ✅ |

CSS-токены `--ts-*-bg/--ts-*-fg` общие для обоих фронтов.

`MODE_ALLOWED_TYPES`:
- vanilla `timesheet-v2.js:56-62` и React v2 `api.js` (через `MODES.editableTypes`): для **pm** = `['day','night','waiting']`.
  **Внимание:** `travel`/`warehouse`/`medical` **НЕ** редактируется PM-ом через табель (только через `field_trip_stages` ниже).

## 5. Контракт ключа дня

Backend (`timesheet-v2.js:602-610`) при `placeCell()` конвертирует `'YYYY-MM-DD'` → `String(parseInt(slice(8,10)))`
(`'01'..'31'` → `'1'..'31'`, БЕЗ ведущего нуля). Ключ всегда строка-номер.

- Vanilla `timesheet-v2.js:1797`: `days[String(d)] || days[d]` — защитный двойной доступ. ✅
- React v2 `TimesheetGrid.jsx:335`: `employee.days?.[d.d]` где `d.d` — number 1..31; JS-property-access автоматически
  кастит number→string, попадает в `'1'..'31'`. ✅
- Mobile рабочих НЕ обращается напрямую к days-карте (использует `/worker/finances` и `/earnings/monthly`).

## 6. paid_total vs paid_salary_total

Backend (`timesheet-v2.js:1158-1178`):
- `paid_total` = `paid_cash + paid_transfer` (всё, включая суточные).
- `paid_salary_total` = `paid_salary + paid_advance + paid_bonus` (БЕЗ суточных). ← новое поле от 23.06.2026.
- `paid_breakdown.{per_diem,salary,advance,bonus}` — разбивка по типам.

Summary (`timesheet-v2.js:1290-1294`):
- `total_paid_total` — всё.
- `total_paid_salary_total` — без суточных.

| Поверхность | Колонка «Выплачено» | Источник | Корректно? |
|---|---|---|---|
| Vanilla timesheet-v2.js:817-823 | `paid_salary_total` (fallback из breakdown) | emp.paid_salary_total | ✅ |
| React v2 TimesheetGrid.jsx:431-434 | `paid_salary_total` | employee.paid_salary_total | ✅ |
| React v2 Dashboard.jsx:42-43, 234-235 | `total_paid_salary_total` | summary | ✅ |

## 7. Мобилка рабочих (FieldEarnings / FieldEarningsMonthly / FieldMoney)

### Источники
- `FieldEarnings.jsx:29` → `GET /worker/finances` → `src/routes/field-worker.js:431` → `getWorkerFinances` (SSoT).
- `FieldEarningsMonthly.jsx:248` → `GET /earnings/monthly` → `src/routes/field-earnings.js:22` (**свой** агрегат, НЕ SSoT).
- `FieldMoney.jsx:48` → `GET /worker/finances/:workId` → SSoT.
- `FieldHistory.jsx:142, 346` — поле `c.amount_earned` (из истории смен).

### Поля, которые показывает мобилка
- `total_earned`, `total_paid`, `total_pending`
- `fot`, `per_diem_accrued`, `per_diem_paid`, `per_diem_rate`
- `salary_paid`, `advance_paid`, `bonus_paid`, `bonus_accrued`, `penalty`
- помесячно: `payment_status` ('paid'/'upcoming'/'in_window'/'overdue'), `pay_window` («10–15 след.месяца»).

## 8. КРИТИЧНЫЕ ТОЧКИ — проверка

| # | Точка | Статус |
|---|---|---|
| 1 | shift = day/night/road/standby маппинг | ✅ backend `cellTypeFromShift` (timesheet-v2.js:171), vanilla читает через backend, v2 тоже. Старого маппинга только day/night не найдено в активном коде. |
| 2 | `fc.status = 'completed'` для ФОТ/выплат | ✅ во всех местах (timesheet-v2.js:301,335,465,1407,1453; field-earnings.js:33,50; worker-finances.js:44). |
| 3 | trigger V230 → payment_method='auto' | ✅ `migrations/V230__fot_auto_payment_method.sql:1-12` явно ставит `'auto'`, backfill старых записей `cash`→`auto`. |
| 4 | `field_tariff_grid.points` ≠ `day_rate` | ✅ backend `timesheet-v2.js:657` берёт `c.tariff_points` (НЕ `day_rate`); комментарий FIX #3 описывает, что эту путаницу исправляли. |
| 5 | `paid_total` vs `paid_salary_total` | ✅ все 3 поверхности (vanilla/v2 grid/v2 Dashboard) используют `paid_salary_total` для «Выплачено». |
| 6 | worker_payments.type ∈ {per_diem,salary,advance,bonus,penalty} | ✅ CHECK-constraint в V067. Других типов в БД быть не может. |
| 7 | TYPE_META vanilla vs v2 vs mobile | ✅ для desktop. Мобилка не использует TYPE_META напрямую — только `amount_earned`/`per_diem`. |
| 8 | placeCell ISO→номер дня, object-key access | ✅ vanilla `String(d)||d`, v2 числовой ключ работает (JS coerce). |

## 9. 🔴 РАСХОЖДЕНИЯ

### 🔴 R-01. Vanilla Toolbar fallback rate для `half`/`road`/`standby` НЕ совпадает с backend
`public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/tabs/timesheetUtils.js:6-12` (а также vanilla
`public/assets/js/field-tab.js:1542-1547`) объявляют SHIFT_TYPES = `['day','night','half','road','standby']`
с дефолтными `defaultPts` (6 для half/road/standby, 13 для day/night).

Backend timesheet-v2.js:
- `SHIFT_TYPES = new Set(['day','night'])` (строка 38) — `typeAllowedForMode(mode='global','half')` вернёт **false** →
  PUT entry на `/api/timesheet/v2/entry` с type=`half` отдаст **403** «Тип не разрешён».
- `cellTypeFromShift('half')` → `'day'` (строка 175) — если запись `half` УЖЕ есть в `field_checkins`, она отрендерится как ☀️ дневная.

Эффект: РП через `field-tab.js` (модалка работы) может создать checkin с `shift='half'`, но **тот же РП**
через единый табель `/api/timesheet/v2/entry` не сможет создать/изменить «Полдня». Также в табеле «half» будет
показан как «День» (☀️) с полными баллами тарифа — рабочему запишут полный день вместо половины.

**Доказательства:**
- `public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/tabs/timesheetUtils.js:9` (`{ value: 'half' }`)
- `public/assets/js/field-tab.js:1545` (`{ value: 'half', label: 'Полдня' }`)
- `src/routes/timesheet-v2.js:38` (`SHIFT_TYPES = new Set(['day','night'])`)
- `src/routes/timesheet-v2.js:171-176` (`cellTypeFromShift` не различает `'half'`)

### 🔴 R-02. Mobile `field-earnings.js` считает `total_earned` иначе, чем SSoT `worker-finances.js`
- `src/routes/field-earnings.js:112`: `total_earned = m.fot + m.per_diem_accrued` (БЕЗ bonus, БЕЗ penalty).
- `src/lib/worker-finances.js:172`: `totalEarned = totalFot + totalPerDiemAccrued + rootBonusPaid - rootPenalty`.
- `src/lib/worker-finances.contract.md:102-105` — контракт SSoT: бонус прибавляется, штраф вычитается.

Эффект: на `FieldEarnings.jsx` (одна цифра «Заработано» из SSoT — с бонусами/штрафами), на
`FieldEarningsMonthly.jsx` (помесячная разбивка из `/earnings/monthly` — БЕЗ бонусов/штрафов).
Рабочий в разных экранах видит **разные** «total_earned» за тот же период.

### 🔴 R-03. Mobile `field-earnings.js` НЕ фильтрует `worker_payments.status != 'cancelled'`
- `src/routes/field-earnings.js:66`: `WHERE status IN ('paid','confirmed')` — отменённые корректно отсечены. ✅
- НО для `bonus_paid`/`advance_paid` он суммирует только `paid|confirmed`. Это согласовано с SSoT (worker-finances.js:63).
- Однако `timesheet-v2.js:840` для **earned-формулы** использует `status != 'cancelled'` (т.е. pending bonus
  ВКЛЮЧАЕТСЯ в earned для бухгалтера/директора). Бухгалтер видит earned = смены + pending bonus − pending penalty;
  рабочий на мобилке (`FieldEarningsMonthly`) видит earned = только fot + per_diem (вообще без bonus/penalty);
  рабочий на `FieldEarnings` (SSoT) видит earned = fot + per_diem + **paid** bonus − **paid** penalty.

  Три разных формулы для «итого начислено» за один и тот же месяц.

### 🔴 R-04. Контракт V145 vs реальный shift («waiting» vs «standby»)
- `migrations/V145__checkin_types_extension.sql:6` документирует план: `'day','night','road','warehouse','medical','waiting'`.
- Реальный код (`timesheet-v2.js:166`): **`'day','night','road','standby'`** (4 значения).
- Маппинг 'waiting' → 'waiting' (`cellTypeFromShift:174`) тоже поддерживается как alias, но **insert** в
  `field_checkins.shift = 'standby'`, не `'waiting'` (`field-tab.js:1547` value: `'standby'`).
- `warehouse`/`medical` в `field_checkins.shift` **не используются** — они живут только в
  `field_trip_stages.stage_type`. План V145 о `warehouse`/`medical` в shift никогда не реализован.

### 🟡 R-05. Backend `bonus_accrued` поле — на самом деле это `bonus_paid`
`src/lib/worker-finances.js:182`: `bonus_accrued: rootBonusPaid` — но `rootBonusPaid` собирается из
`worker_payments WHERE status IN ('paid','confirmed')` (строка 63). То есть «начислено» = «выплачено».
- `FieldEarnings.jsx:158` показывает `finances.bonus_accrued || finances.bonus_paid` как «премии».

В контракте `worker-finances.contract.md:76` `bonus_accrued` тоже определён через `paid|confirmed`.

Эффект: pending-бонус (создан, но не выплачен) **не виден** рабочему на мобилке, хотя в табеле бух/директор
его уже учитывают в earned (`timesheet-v2.js:840` `status != 'cancelled'`).

## 10. 🟡 ПОДОЗРЕНИЯ

### 🟡 S-01. Toolbar в v2 показывает 0 ₽ для warehouse/medical/travel mode
`Toolbar.jsx:40-42` суммирует `e.total_amount`, но backend (`timesheet-v2.js:776-778`) для
warehouse/medical/travel явно ставит `total_amount = null`. KPI-пилюля «gold» в Toolbar.jsx:71-73 скрыта
только если `showAmount === false` (через `cols.amount === 'show'`, доступно только в global) — то есть пилюли
не будет, и баг невидим. Похоже, корректно. ✅ (помечено как 🟡 для перепроверки на UI-тесте.)

### 🟡 S-02. `worker_payments.payment_method IS NULL` считается как `paid_transfer`
`timesheet-v2.js:874`: `payment_method IS NULL` → falls into `paid_transfer`. Если триггер V230 сломан и старые
записи перезаписываются с NULL, или mobile рабочих делает POST без payment_method — все они уйдут в "перевод",
завысят `paid_transfer`, занизят `paid_cash` и собъют расчёт `cash_payout_remaining`.

### 🟡 S-03. `field-tab.js` POST для `shift='standby'` — backend отвергнет
- `field-tab.js:1712` пишет на `/api/projects/${work.id}/checkin` (НЕ `/api/timesheet/v2/entry`).
- Этот endpoint — отдельный (`src/routes/works.js`?), не проверял на shift-validation. Если он принимает
  `shift='standby'` напрямую — данные нормальные. Но при PUT/правке через единый табель — backend ответит 403.
  Нужно подтвердить, что `/api/projects/:id/checkin` действительно принимает `standby`/`road`/`half`.

### 🟡 S-04. `field-earnings.js` бонусы группируются по `pay_year/pay_month`, но `worker_payments.work_id`
может быть NULL → бонус «без работы» попадёт в общую сумму месяца, но не в `by_work[]`. На мобилке
`FieldEarningsMonthly` это норма, но на `FieldMoney` (по конкретной работе) — нет (`worker-finances.js:104`
кладёт NULL-payments в `__null` bucket и они не попадают ни в одну `by_work`-запись).

### 🟡 S-05. Vanilla `timesheet-v2.js:1710` считает `shifts` как `days_count || Object.keys(days).filter(d.type)`,
React v2 `Toolbar.jsx:35-39` — только через `Object.values(e.days).filter(d?.type)`. Backend не отдаёт `days_count`
в `/timesheet/v2/:y/:m` (поиск не нашёл) → vanilla и v2 считают одинаково. ✅

### 🟡 S-06. `worker_payments.type='penalty'` НЕ исключается из `paid_*` агрегатов
`timesheet-v2.js:870-885` фильтр `type IN ('per_diem','salary','advance','bonus')` — penalty не входит. ✅
Но `field-earnings.js:97-103` тоже не суммирует penalty — это **корректно** (penalty не «выплата», а удержание).
В то же время `worker-finances.js:60, 169` собирает `rootPenalty` и **вычитает** его из `total_earned`, что
рабочий на `FieldEarnings.jsx:162` видит как `−{fmt(finances.penalty)}`. Согласовано.

### 🟡 S-07. v2 build (`public/v2/assets/timesheet-Bd-qngps.js`) — старый артефакт
Содержит `total_paid_total` и `total_paid_salary_total`, **НЕ** содержит маппинг `road`/`standby`/`waiting`
(grep 0 совпадений). Это значит, что v2-сборка использует backend `cellTypeFromShift` (правильно),
но **локально в jsx-исходниках** road/standby тоже нет — ничего страшного, маппинг делает backend.
Для подтверждения нужен `npm run build` свежий — иначе фикс от 23.06.2026 (`paid_salary_total` колонка) может
быть уже в сборке (нашёл 1 совпадение `paid_salary_total` в `timesheet-Bd-qngps.js`). ✅

## 11. Сводка

| Категория | Кол-во |
|---|---|
| 🔴 Расхождения данных | 4 (R-01..R-04) |
| 🟡 Подозрения / неоднозначности | 7 (S-01..S-07) |

**Главные риски:**
1. **`half`-shift не поддерживается единым табелем** — рабочему запишут полный день вместо половины
   (R-01, file:line `src/routes/timesheet-v2.js:38, 171-176` vs `public/assets/js/field-tab.js:1545`).
2. **Три формулы `total_earned`** для одного и того же месяца — timesheet-v2 (бух), worker-finances SSoT (мобилка),
   field-earnings.js (мобилка помесячно). Рабочий и бухгалтер видят разные числа.
3. **pending bonus** не виден рабочему, но виден буху — это создаёт ситуацию «РП обещал, бух начислил,
   рабочий не видит».
4. **V145 docs vs реальный код** — несовпадение по shift-значениям может ввести в заблуждение будущих
   разработчиков (R-04).

**Подтверждено корректным:**
- `fc.status='completed'` фильтр везде. ✅
- `field_tariff_grid.points` ≠ `day_rate` — после FIX #3 не путаются. ✅
- `payment_method='auto'` через V230 + backfill. ✅
- `worker_payments.type` CHECK ∈ {per_diem,salary,advance,bonus,penalty} — БД гарантирует. ✅
- TYPE_META паритет vanilla ↔ v2 (6 типов одинаковые). ✅
- Object-key access `days['1']` vs `days[1]` — обе поверхности работают. ✅
- `paid_salary_total` (новое поле 23.06.2026) — корректно используется всеми desktop-поверхностями. ✅
