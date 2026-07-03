# 07 — АУДИТ КОНСИСТЕНТНОСТИ: ВЫПЛАТЫ РАБОЧИМ

**Дата:** 2026-06-23
**Режим:** READ-ONLY
**Скоп:** worker_payments / director-payments / field finances / cash / payroll-dashboard / timesheet-v2 paid-агрегаты
**Источник истины (SSoT):** `src/lib/worker-finances.js` + контракт `worker-finances.contract.md`

---

## 1. СХЕМА БД (по миграциям, INSERT-стейтам и SELECT-ам)

### `worker_payments` — основная таблица выплат
Колонки, к которым обращаются роуты:
- `id`, `employee_id`, `work_id`, `type`, `amount`, `status`
- `payment_method`, `paid_by`, `paid_by_role`, `paid_at`
- `comment`, `pay_year`, `pay_month`
- `period_from`, `period_to`, `days`, `rate_per_day`
- `total_points`, `point_value`, `works_detail` (jsonb)
- `created_at`, `created_by`, `updated_at`
- `confirmed_by_worker`, `confirmed_at`

**type ∈** `per_diem | salary | advance | bonus | penalty`
**status ∈** `pending | paid | confirmed | cancelled`
**payment_method ∈** `cash | card | transfer` (валидация в коде) — НО в БД фактически встречается ещё `auto`, `se_transfer`, `NULL` (см. ниже 🔴-2).
**paid_by_role ∈** `pm | director | buh | …` (значения свободные; код знает только `'director'`).

### Связанные таблицы
- `field_checkins(status, employee_id, work_id, date, amount_earned, hours_paid)` — основа ФОТ. `status = 'completed'` — единственно валидный по контракту SSoT.
- `employee_assignments(employee_id, work_id, per_diem, is_active, tariff_id, combination_tariff_id)` — ставка per_diem.
- `employees(se_payee_id, is_se_payee, can_exceed_limit, se_yearly_used_initial, se_monthly_used_initial, is_self_employed, is_officially_employed)` — V240 add se_payee_id.
- `se_transfers(employee_id, year, month, transfer_amount, status, …)` — переводы СЗ.
- `work_expenses` — авто-зеркалируется триггерами V073/V230 из `worker_payments` и `field_checkins`.
- `payroll_items` — устаревшая? используется только в `field-worker.js GET /finances/:work_id` (см. 🔴-1).
- `worker_to_pm_handovers` — передачи нал РП.

---

## 2. BACKEND ENDPOINTS

### `src/routes/worker-payments.js` (1850 LOC)
**SSoT-агрегаты** (использует `getWorkerFinances`):
- `GET /api/worker-payments/employee-summary` (line 373) — per work breakdown.
- `GET /api/worker-payments/project/:work_id/summary` (line 729) — by-worker breakdown.
- `GET /api/worker-payments/my/balance` (line 830) — баланс полевого.

**CRUD:**
- `GET /` (line 79) — список с филтрами; SELECT: `wp.*, e.fio AS employee_name, w.work_title, cb.fio AS created_by_name, pb.fio AS paid_by_name`. Поля `employee_fio` нет.
- `POST /` (line 139) — создаёт `pending`.
- `PUT /:id` (line 200) — только если `status='pending'`.
- `PUT /:id/pay` (line 240) — `pending → paid`. Валидация `payment_method ∈ {cash,card,transfer}` (line 245-248).
- `DELETE /:id` (line 353) — `status='cancelled'`.
- `POST /pay-worker` (line 426) — defence от дубля (status `paid|confirmed`), валидация method `{cash,card,transfer}` (line 435-437).
- `POST /bulk-per-diem`, `POST /generate-salary/:y/:m`, `POST /pay-salary/:y/:m`.

**Reports** (DIRECTOR/BUH/ADMIN):
- `GET /reports/payroll/:y/:m` (line 878) — `status != 'cancelled'`, `MAX(wp.status) AS payment_status` (см. 🟡-3).
- `GET /reports/per-diem/:y/:m`, `GET /reports/labor-costs/:y/:m`.
- `GET /reports/worker/:id/year/:y`, `GET /reports/debts`.
- `GET /reports/payroll-grid/:y/:m` (line 1260) — НО fc.status = ANY(`['completed','closed','confirmed']`) (line 1283) — расходится с SSoT (см. 🔴-4).

### `src/routes/director-payments.js` (236 LOC)
- `POST /api/director-payments/` (line 38) — обязательно `paid_by_role='director'`, INSERT с status='paid' сразу.
- `GET /api/director-payments/history` (line 174) — фильтр `paid_by_role = 'director'`. SELECT возвращает `employee_fio` И `employee_name` (оба = `e.fio`) — фикс 23.06.2026 для v2 (line 202-217).

### `src/routes/field-worker.js`
- `GET /worker/finances` (line 431) — SSoT через `getWorkerFinances`.
- `GET /worker/finances/:work_id` (line 449) — 🔴 **НЕ SSoT** (см. 🔴-1).

### `src/routes/field-pm.js`
- `POST /field-pm/payments` (line 600) — INSERT в worker_payments (pending). Принимает `payment_method` без валидации значений (line 602-630).
- `PUT /field-pm/payments/:id/paid` (line 644) — отметить paid (своё дублирование с worker-payments).

### `src/routes/payroll-dashboard.js`
- `GET /summary/:y/:m` — paid-агрегаты per employee + per company.
- `GET /cash-coverage/:y/:m`, `GET /cash-calc/:y/:m`, `GET /se-transfers/:y/:m`, `GET /self-employed-limits`, `GET /pm-balance(/:pm_id)`, `GET /official-employees`.
- Использует `worker_payments` напрямую (не через SSoT), фильтр `payment_method IN ('transfer','card','auto')` (line 131,900) — корректный список (cash/card/transfer **+ auto**).

### `src/routes/timesheet-v2.js`
- `GET /:y/:m` — основной табель. Считает `paid_*` фичи (line 868-897):
  - `paid_cash` = method='cash'
  - `paid_transfer` = method IN ('transfer','card','auto') ИЛИ IS NULL
  - `paid_breakdown` = по type (per_diem/salary/advance/bonus)
  - `paid_total` = paid_cash + paid_transfer (включает per_diem)
  - `paid_salary_total` = paid_salary + paid_advance + paid_bonus (БЕЗ per_diem, фикс 23.06.2026, line 1178)
- summary возвращает `total_paid_salary_total` (line 1294).

### `src/routes/cash.js`
- Operations кассы (advance/loan/expense), агрегаты для PM-баланса.

---

## 3. VANILLA (старый фронт, источник истины поведения)

### `public/assets/js/payments-report.js` (287 LOC)
- `GET /api/worker-payments/reports/payroll/:y/:m`
- Рендерит: `r.employee_name`, `r.work_title`, `r.points`, `r.salary`, `r.per_diem`, `r.advance`, `r.bonus`, `r.penalty`, `r.payment_status` (line 165-174). 🟡-3.
- Net = `salary + bonus − penalty + per_diem − advance` (line 162-163, 178). Это «к получению на руки», включает per_diem.
- KPI: `tot.fot`, `tot.tax`, `tot.fot+tot.tax (Полный ФОТ)`, `tot.per_diem` (line 141-144).
- Labor tab: `r.worker_count`, `r.fot`, `r.tax`, `r.per_diem`, `r.full_cost`.

### `public/assets/js/payroll.js` (1304 LOC)
- payroll-grid через `/api/worker-payments/reports/payroll-grid/:y/:m` (line 1056, 1268, 1287).

### `public/assets/js/timesheet-v2.js`
- Колонка «📤 Выплачено ₽» = `emp.paid_salary_total` (line 818) с fallback на `paid_breakdown.salary+advance+bonus` (line 820-823). Фикс 23.06.2026.
- Tooltip всё ещё содержит `paid_total` (line 824) — paid_total включает per_diem.

### `public/assets/js/field-tab.js` (модалка платежей)
- `POST /api/worker-payments/pay-worker` (line 3320) с обработкой 409 duplicate.
- `GET /api/worker-payments/employee-summary` (line 3013).
- `PUT /api/worker-payments/:id/pay` (line 2981).

### `public/assets/js/cash.js` — заявки кассы РП, не выплаты per_diem.

### `public/assets/js/finances.js` — финансовая аналитика директор/буха (категории расходов через `work_expenses`/`office_expenses`, НЕ напрямую `worker_payments`).

---

## 4. REACT V2

### `public/desktop-v2-src/src/pages/DirectorPayments/`
- `index.jsx` (line 217): ФИО рабочего рендерится через fallback `it.employee_fio || it.employee_name || it.fio || #ID`.
- `PayWorkerModal.jsx`: типы (`per_diem|salary|advance|bonus|penalty`) и methods (`cash|card|transfer`) — совпадают с backend.
- `api.js` `loadHistory` нормализует ответ `d.items | d.payments | d` (line 42-46). Backend возвращает `{ payments, total_count, total_amount }` (worker-payments) — v2 это правильно резолвит как `d.payments`.
- `METHOD_LABEL` (api.js line 26-31) включает `auto: 'Авто'` — фронт **готов** к payment_method='auto', хотя POST в backend такой method не пускает (см. 🔴-2).

### `public/desktop-v2-src/src/pages/Cash/index.jsx`
- Заявки кассы РП (advance/loan), не worker_payments.

### `public/desktop-v2-src/src/pages/PmBalance/index.jsx` (295 LOC)
- Stage W секция «Ожидают передачи» подтягивает `/api/timesheet/v2/handovers/:y/:m` (line 73), filter `status='pending'`. Это handovers, не worker_payments.

### `public/desktop-v2-src/src/pages/Timesheet/Dashboard.jsx`, `TimesheetGrid.jsx`
- Используют `total_paid_salary_total` и `paid_salary_total` (зп+аванс+бонус без суточных).
- Fallback на `(salary+advance+bonus)` из `paid_breakdown` (Dashboard line 41-46, TimesheetGrid line 432-435).

### `public/desktop-v2-src/src/pages/CashAdmin/DetailModal.jsx`
- Условия `req.use_se_payee` + `req.se_payee_name` для UI «через получателя» — корректно.

### `public/desktop-v2-src/src/pages/Personnel/EditEmployeeModal.jsx`
- Управление `se_payee_id`, `is_se_payee`, ФИО/телефон/ИНН родственника. ОК.

---

## 5. MOBILE (FieldMoney и WorkerProfile)

### `public/mobile-app/src/pages/field/FieldMoney.jsx` (915 LOC)
- `GET /worker/finances` (line 380) — SSoT (через `getWorkerFinances`).
- `GET /worker/finances/:workId` (line 48) — детальный endpoint, **НЕ SSoT**. См. 🔴-1.
- Hero (line 472): `cur.total_earned` — поле SSoT.
- Tariff card: `tariff.position_name`, `tariff.points`, `tariff.point_value`, `tariff.rate_per_shift`. Эти поля есть ТОЛЬКО в детальном `/finances/:work_id`, но рендерится в Hero — берётся из `/worker/active-project` (line 381).
- `PerDiemBalanceCard` — функция объявлена (line 160) но в новом дизайне НЕ вызывается (line 520 явный комментарий «УДАЛЕНА 25.05.2026»). Мёртвый код.
- «Заработок на объекте» (line 549-561): `cur.fot`, `cur.per_diem_accrued`, `cur.per_diem_rate`, `cur.days_worked` — поля SSoT.
- В `MoneyDetail` (line 43-150): `data.base_amount`, `data.per_diem_total`, `data.per_diem_days`, `data.per_diem_rate`, `data.bonuses`, `data.stages_earned`, `data.penalties`, `data.total_earned`, `data.total_paid`, `data.remaining`, `data.payroll_items[].advance_paid`, `.comment`, `.payout`. Имена полей — **из старого endpoint**, ни одно не совпадает с SSoT-полями `by_work[].fot/per_diem_accrued/salary_paid/advance_paid/bonus_paid/penalty/total_earned/total_paid/total_pending`.

### `public/mobile-app/src/pages/WorkerProfile.jsx`
- Просмотр профиля. Не пишет/не показывает payouts напрямую.

---

## 6. 🔴 РАСХОЖДЕНИЯ (CRITICAL)

### 🔴-1. Mobile FieldMoney детальный экран — НЕ через SSoT, формулы расходятся
**Файл:** `src/routes/field-worker.js:449-588` (endpoint `GET /worker/finances/:work_id`).
**Потребитель:** `public/mobile-app/src/pages/field/FieldMoney.jsx:48-52` (`MoneyDetail`).

Расхождения с SSoT (`src/lib/worker-finances.js`):
1. **`status='paid'`** (field-worker.js:534) против **`status IN ('paid','confirmed')`** (worker-finances.js:63) → confirmed-выплаты НЕ учитываются в детальном экране. Если рабочий подтвердил получение через `POST /my/:id/confirm` (status `paid → confirmed`), сумма выпадает из `total_paid` на детальном экране → balance растёт, рабочий видит «к выплате X», хотя X уже получил.
2. **`total_paid = SUM(salary+per_diem+bonus) − SUM(advance)`** (line 532-538) против SSoT `total_paid = salary_paid + per_diem_paid + bonus_paid + advance_paid` (worker-finances.js:127, 173). Семантика advance прямо ПРОТИВОПОЛОЖНАЯ: SSoT считает аванс как выплаченное (+), детальный — как удержание (−).
3. **`bonus/penalty/advance` берутся из `payroll_items`** (line 525-527, 561) — это устаревшая ведомость, в worker-finances.js НЕ участвует. Реальные премии/штрафы лежат в `worker_payments(type='bonus'|'penalty')`.
4. **`totalEarned = baseAmount + perDiemTotal + totalBonuses − totalPenalties + stagesEarned`** (line 561) — добавлен `stagesEarned` (предобъектные этапы из `field_trip_stages`), которого нет в SSoT (worker-finances.js считает только field_checkins.amount_earned + per_diem_rate*days).
5. **Per_diem days** = `COUNT(DISTINCT date) WHERE status='completed'` (line 496-499) — то же поле что и `days_worked`, но дублируется отдельным запросом. Совпадает с SSoT, но логика дублирована.

→ Рабочий на главном экране FieldMoney видит одну сумму (через SSoT), а кликая на проект — ДРУГУЮ сумму того же проекта.

### 🔴-2. payment_method 'auto' и 'se_transfer' принимаются БД, но отвергаются валидатором
**Файлы:**
- `src/routes/worker-payments.js:245,436` — `validMethods = ['cash', 'card', 'transfer']`.
- `src/routes/director-payments.js:25` — `VALID_METHODS = ['cash', 'card', 'transfer']`.
- `src/routes/field-pm.js:602` — НЕ валидирует (берёт `'transfer'` по умолчанию, но пропустит любую строку).

При этом:
- `migrations/V230` (sync_field_checkin_to_expense) пишет `payment_method='auto'` в work_expenses, и SELECT'ы в `payroll-dashboard.js:131,900` и `timesheet-v2.js:873` ОЖИДАЮТ `payment_method IN ('transfer','card','auto')` в `worker_payments`.
- `public/mobile-app/src/pages/field/FieldMoney.jsx:628` упоминает `payment_method='se_transfer'` (бухгалтер выплатил через СЗ-перевод).
- `public/desktop-v2-src/src/pages/DirectorPayments/api.js:31` хранит label `auto: 'Авто'`.

→ Никаких API не пишут в `worker_payments` с method='auto' или 'se_transfer' — но логика их чтения предполагает их наличие. **Откуда они появляются?** Либо ручной INSERT в БД, либо отсутствующий код-путь, либо мёртвый ожидающий код. **Это inconsistency.**

### 🔴-3. Vanilla `payments-report.js` и Reports endpoint используют разные определения «итого»
**Файл:** `src/routes/worker-payments.js:921-924` (totals в reports/payroll):
```
fot: totalSalary + totalBonus − totalPenalty
grand_total: totalSalary + totalPerDiem + totalBonus − totalPenalty   // НЕТ advance!
```
**Файл:** `public/assets/js/payments-report.js:178` (net в UI):
```
netTotal = salary + bonus − penalty + per_diem − advance
```

→ Backend `grand_total` НЕ вычитает advance; vanilla UI ВЫЧИТАЕТ. Если рабочему выплачен аванс 50K из ЗП 100K, backend покажет grand_total=100K, UI покажет net=50K. Для строк (`rows[i]`) UI считает свой net и игнорирует backend-totals. Для шапки KPI — берёт `tot.fot`, `tot.tax`, и не использует grand_total.

Это не баг рендера — это противоречие в семантике API. Любой v2-консумер `totals.grand_total` получит другую сумму.

### 🔴-4. payroll-grid и worker-finances SSoT расходятся по статусам field_checkins
**Файл:** `src/routes/worker-payments.js:1283,1296`:
```
checkinParams: ['completed', 'closed', 'confirmed']
WHERE fc.status = ANY($3)
```
**Файл:** `src/lib/worker-finances.js:44`:
```
WHERE fc.status = 'completed'
```

→ Сетка-ведомость покажет рабочему смены в статусе `closed`/`confirmed`, **которых нет в его SSoT-балансе**. Память юзера явно говорит: `status='completed' для зачёта в ФОТ`. Сетка нарушает это правило.

Также trigger `V230 sync_field_checkin_to_expense` фильтрует `status IN ('closed','confirmed','completed') OR checkout_at IS NOT NULL` (V230:51) — отличается от SSoT.

### 🔴-5. director-payments `GET /history` фильтр работ — без RBAC по PM
**Файл:** `src/routes/director-payments.js:174-233`. Любой DIRECTOR_*/ADMIN видит ВСЕ выплаты. Это правильно для директора. Но `GET /api/worker-payments/` (line 79) ограничивает PM своими работами через `WHERE w.pm_id=$N`. На v2 в `DirectorPayments/index.jsx` нет проверки роли PM (только ALLOWED_ROLES=DIRECTOR_*, ADMIN) — окей. Это не баг.

Но: `POST /api/director-payments/` тоже только DIRECTOR_*/ADMIN, но `POST /api/worker-payments/pay-worker` дополнительно проверяет `c.pm_id === userId` для PM/HEAD_PM (worker-payments.js:455-458). У director-payments этот код отсутствует — корректно (директор не PM). Логика согласована.

---

## 7. 🟡 ПОДОЗРЕНИЯ (suspicious, needs runtime verify)

### 🟡-1. v2 DirectorPayments PayWorkerModal **НЕ** обрабатывает 409 duplicate_payment
**Файл:** `public/desktop-v2-src/src/pages/DirectorPayments/PayWorkerModal.jsx:65-91`.

В `submit()` нет ветки для `error === 'duplicate_payment'` + повторного запроса с `confirm_duplicate: true`. Backend (director-payments.js:97-107) возвращает 409 с `requires_confirmation: true`, но v2 покажет это как обычную ошибку (`e?.serverMsg`). Vanilla `field-tab.js:3313-3360` корректно ловит и предлагает подтвердить.

### 🟡-2. v2 DirectorPayments отправляет `paid_by_role: 'director'` в body
**Файл:** `public/desktop-v2-src/src/pages/DirectorPayments/api.js:53` — `body: { ...payload, paid_by_role: 'director' }`.

Backend `director-payments.js:38-167` принимает только `employee_id, work_id, type, amount, payment_method, comment, pay_year, pay_month, confirm_duplicate` (line 40-43). `paid_by_role` тихо игнорируется и backend сам хардкодит `'director'` в INSERT (line 122). Не баг, но лишний — может ввести в заблуждение, что фронт что-то реально шлёт.

### 🟡-3. `reports/payroll` отдаёт `payment_status = MAX(wp.status)` — не имеет смысла
**Файл:** `src/routes/worker-payments.js:894`:
```
MAX(wp.status) AS payment_status
```
GROUP BY employee_id, work_id (line 899). У одного работника за месяц могут быть выплаты разных типов в разных статусах. `MAX('confirmed','paid','pending')` лексикографически = `'pending'`. Vanilla `payments-report.js:174` рендерит это в колонку «Статус» — она будет показывать `pending` даже если 4 из 5 выплат `confirmed`.

### 🟡-4. v2 DirectorPayments `loadEmployees()` тянет ВСЕХ сотрудников
**Файл:** `public/desktop-v2-src/src/pages/DirectorPayments/api.js:66-80`. На больших базах (>2000) будет медленно/обрежется лимитом. История 12 месяцев тянется одним SELECT без пагинации в `loadHistory`.

### 🟡-5. v2 DirectorPayments не показывает `paid_by_name`
**Файл:** `public/desktop-v2-src/src/pages/DirectorPayments/index.jsx:215-225` рендерит дату/ФИО/работу/тип/способ/сумму/комментарий. Backend (director-payments.js:208) уже отдаёт `u.name AS paid_by_name` (какой именно директор выплатил) — фронт игнорирует. Полезно для аудита (Кудряшов vs Андросов vs …).

### 🟡-6. Mobile FieldMoney `tariff.point_value` дефолт 500 разный
**Файл:** `FieldMoney.jsx:429` — `pointValue = tariff.point_value || 500`.
**Файл:** `field-worker.js:470` SELECT возвращает реальный `point_value`.
**Файл:** `worker-payments.js:1272` — `pointValue = JSON.parse(... || 500)` (из settings).

Если в settings установлен point_value=600, но конкретная позиция в `field_tariff_grid` не имеет point_value (NULL), мобилка покажет 500, а РП-табель — 600. Несогласованный fallback.

### 🟡-7. Vanilla `payments-report.js` шапка KPI — Полный ФОТ = fot+tax, не включает per_diem
**Файл:** `public/assets/js/payments-report.js:143`:
```
Полный ФОТ = (tot.fot||0) + (tot.tax||0)
```
Но backend (worker-payments.js:925) `grand_total` = `salary + per_diem + bonus − penalty`. Имя «Полный ФОТ» в UI vs «grand_total» в API означают разные вещи. UI не использует backend grand_total — пересчитывает свой, тоже не совпадающий ни с одним backend-показателем.

### 🟡-8. v2 DetailModal для CashAdmin читает `se_payee_name`
**Файл:** `public/desktop-v2-src/src/pages/CashAdmin/DetailModal.jsx:274`. Поле `se_payee_name` не показано в исследованной части backend SELECT — нужно проверить что cash.js действительно отдаёт это поле. Если нет — UI покажет пустую скобку «(undefined)» (хотя JSX рендерит `''` если поле undefined через `req.se_payee_name ? \` (...)\` : ''`).

### 🟡-9. `worker_payments.payment_method` ввода cash/card/transfer — но vanilla payments-report `STATUS_LABELS` не имеет `'rejected'`
**Файл:** `payments-report.js:14-17`. Возможные статусы `pending|paid|confirmed|cancelled` — все есть. Это OK, но защита от мусора (показ raw value `r.payment_status||'—'`) на случай новых статусов — есть.

### 🟡-10. se_payee_id в платёжной логике нигде не используется при создании выплаты
**Файлы:** `worker-payments.js` (POST /pay-worker, POST /), `director-payments.js` (POST /). НИ ОДИН не читает `employees.se_payee_id`. Однако:
- `payroll-dashboard.js` и `timesheet-v2.js` (line 909-953) — суммируют лимиты payee'ев и расчёт `pay_type='self_employed_payee'`.
- `Personnel/EditEmployeeModal.jsx` сохраняет связку.

→ Выплата проводится на исходного работника (employee_id), но visible-учёт идёт через payee. Если бухгалтер реально шлёт деньги родственнику, в `worker_payments` это не отражено. Нет колонки `se_transferred_to_payee_id`, нет реквизита. Может быть by design (НПД-учёт ведётся через `se_transfers`), но как минимум нужно подтвердить.

### 🟡-11. paid_total tooltip в timesheet-v2 содержит per_diem
**Файл:** `public/assets/js/timesheet-v2.js:824` — `paidTotalWithPerDiem` рендерится в tooltip. Юзер может увидеть в tooltip сумму большую, чем в основной ячейке, и принять за баг. Это не баг по контракту (paid_total = всё, paid_salary_total = без per_diem), но UX-риск.

### 🟡-12. v2 Cash и Cash CreateRequestModal используют `use_se_payee` + `se_payee_employee_id`
**Файл:** `public/desktop-v2-src/src/pages/Cash/CreateRequestModal.jsx:148-149`. Это другая логика — заявка на нал РП с маркером «через СЗ» — не путать с `worker_payments`. Но имя поля `se_payee_*` похоже → риск путаницы в код-обзорах.

---

## 8. ИТОГИ

**🔴 Critical (5):** 1 крупное расхождение SSoT vs детальный endpoint мобилки (FieldMoney), 1 расхождение в принимаемых payment_method, 1 расхождение totals в reports/payroll, 1 расхождение по статусам field_checkins в сетке-ведомости, 1 окей-но-стоит-задокументировать.

**🟡 Suspicious (12):** UX-несоответствия, отсутствующий duplicate_payment-flow в v2-модалке директора, неиспользованные backend-поля (`paid_by_name`), мёртвый код (`PerDiemBalanceCard`), несогласованный fallback `point_value` 500.

**Главные риски:**
1. **🔴-1** — рабочий видит разные суммы заработка в мобильном приложении на разных экранах. Это блокер.
2. **🔴-4** — РП и SSoT расходятся по тому, какие смены считаются. Если у работника есть `closed` смена, она попадёт в сетку-ведомость, но НЕ в SSoT-баланс этого же работника → конфликт при согласовании.
3. **🔴-2** — БД содержит payment_method='auto' (явно по triggers) и 'se_transfer' (упоминается в UI), но валидаторы это запрещают на запись. Значит, либо есть теневой путь записи, либо часть бизнес-сценариев сломана.
4. **🟡-1** — directors при попытке повторной выплаты получат непонятную ошибку вместо UX-диалога «подтвердить дубль».
