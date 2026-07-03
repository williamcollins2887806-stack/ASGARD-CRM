# 07 — ВАЛИДАЦИЯ АУДИТА ВЫПЛАТ

**Дата:** 2026-06-23
**Режим:** READ-ONLY (Bash/Edit запрещены)
**База:** `tests/consistency-audit/07-payouts.md`

---

## 🔴 CRITICAL (5)

### R1 — Mobile FieldMoney детальный экран НЕ через SSoT
**Вердикт:** CONFIRMED.
- `src/routes/field-worker.js:532-534` — `WHEN type IN ('advance') THEN -amount` И `status = 'paid'` (БЕЗ confirmed). Цитата:
  `SUM(CASE WHEN type IN ('salary','per_diem','bonus') THEN amount WHEN type IN ('advance') THEN -amount ELSE 0 END) … status = 'paid'`.
- `src/lib/worker-finances.js:63` — `WHERE wp.status IN ('paid','confirmed')`, а advance суммируется как `advance_paid` через `+` (line 127: `salary_paid + per_diem_paid + bonus_paid + advance_paid`).
- Семантика advance действительно противоположная (− vs +). `payroll_items` действительно источник для bonus/penalty (line 526-527), `stages_earned` добавлен (line 561).
- `FieldMoney.jsx:76` рендерит «−Выплачено (авансы)» → пользователь видит другую сумму, чем на главной (через `/worker/finances` SSoT).

### R2 — payment_method 'auto'/'se_transfer' в SELECT, но запрещены валидаторами
**Вердикт:** CONFIRMED.
- `src/routes/worker-payments.js:245` и `:435` — `validMethods = ['cash', 'card', 'transfer']`.
- `src/routes/director-payments.js:25` — `VALID_METHODS = ['cash', 'card', 'transfer']`.
- `src/routes/timesheet-v2.js:873-874` — `SUM(... payment_method IN ('transfer','card','auto') OR payment_method IS NULL ...) AS paid_transfer` — `'auto'` ожидается на чтении.
- `public/desktop-v2-src/src/pages/DirectorPayments/api.js:30` — `auto: 'Авто'` в METHOD_LABEL.
- Триггер `V230 sync_field_checkin_to_expense` действительно пишет `payment_method='auto'` в `work_expenses` (по памяти). Но **никакой API-путь не INSERT'ит `'auto'` в worker_payments** — значит, либо мёртвый код ожидания, либо в БД есть исторические/ручные записи. Inconsistency реальная. `'se_transfer'` упоминается в FieldMoney (по аудиту line 628) — нужна доп. проверка, что это не enum, а text-литерал в UI.

### R3 — grand_total НЕ вычитает advance
**Вердикт:** CONFIRMED.
- `src/routes/worker-payments.js:924` — `grand_total: totalSalary + totalPerDiem + totalBonus - totalPenalty` (без −advance).
- `public/assets/js/payments-report.js:178` (per row) вычисляет net `= salary + per_diem + bonus − penalty − advance` (по аудиту).
- Семантика расходится: backend `grand_total` = «полная ведомость без удержания аванса», UI per-row = «к доплате». Любой v2-консумер `totals.grand_total` получит сумму, не сходящуюся со строками. CONFIRMED inconsistency.

### R4 — payroll-grid статусы IN ('completed','closed','confirmed') vs SSoT 'completed'
**Вердикт:** CONFIRMED.
- `src/routes/worker-payments.js:1283` — `checkinParams = … ['completed', 'closed', 'confirmed'] …`. Line 1296 — `fc.status = ANY($3)`.
- `src/lib/worker-finances.js:44` — `AND fc.status = 'completed'`.
- Это прямо нарушает контракт SSoT (память: «field_checkins.status='completed' для финансов»). Сетка-ведомость покажет смены, которых нет в SSoT-балансе.

### R5 — director-payments фикс 23.06 (employee_fio + employee_name)
**Вердикт:** CONFIRMED (фикс корректный, не баг).
- `src/routes/director-payments.js:202-206` — комментарий «Фикс (23.06.2026): React v2 ожидает employee_name…» и SELECT `e.fio AS employee_fio, e.fio AS employee_name`.
- `DirectorPayments/index.jsx:217` (по аудиту) — fallback `it.employee_fio || it.employee_name || it.fio || #ID` — обе ветки покрыты. Сама запись RBAC-RAC (line 220 аудита) тоже корректна: DIRECTOR_*/ADMIN видит всех, PM-фильтра нет (директор не PM). FALSE как «находка-баг», но описание в аудите само помечает её «не баг».

---

## 🟡 SUSPICIOUS (12) — кратко

- **🟡-1** v2 PayWorkerModal не ловит 409 duplicate_payment — CONFIRMED. `PayWorkerModal.jsx:86-88` ловит только generic `e?.serverMsg`, нет ветки `confirm_duplicate: true`. Backend `director-payments.js:97-107` возвращает 409 с `requires_confirmation`.
- **🟡-2** v2 шлёт лишний `paid_by_role: 'director'` — CONFIRMED. `api.js:53` подмешивает, backend (line 122) хардкодит сам — поле тихо игнорится.
- **🟡-3** `MAX(wp.status) AS payment_status` — CONFIRMED. `worker-payments.js:894` + GROUP BY. Лексикографически `'pending' > 'paid' > 'confirmed' > 'cancelled'` — колонка всегда покажет худший статус.
- **🟡-4** `loadEmployees()` без пагинации — CONFIRMED. `api.js:77` — `limit=2000`. Аналогично history.
- **🟡-5** `paid_by_name` не рендерится — CONFIRMED. Backend (line 208) отдаёт, фронт игнорирует.
- **🟡-6** `point_value` fallback 500 — PARTIAL. `FieldMoney.jsx:103` использует `data.tariff.point_value || 500`, `worker-payments.js:1272` — `JSON.parse(... || 500)` из settings. Несогласованность fallback есть, но воспроизводимый сценарий требует point_value NULL в `field_tariff_grid` — NEEDS-MORE-INFO по реальной частоте.
- **🟡-7** «Полный ФОТ» в UI ≠ grand_total — CONFIRMED. `payments-report.js:143` (по аудиту) считает `fot+tax`, backend `grand_total` (line 924) = `salary+per_diem+bonus−penalty`. Разные смыслы.
- **🟡-8** `se_payee_name` в CashAdmin — NEEDS-MORE-INFO. Не проверил `src/routes/cash.js` SELECT, но JSX-условие `req.se_payee_name ? ...` безопасно при undefined.
- **🟡-9** `STATUS_LABELS` без `'rejected'` — CONFIRMED. Возможные статусы в БД — `pending|paid|confirmed|cancelled` (lines 24 audit). `'rejected'` не существует — мёртвая защита, не баг.
- **🟡-10** `se_payee_id` не пишется в worker_payments — CONFIRMED. POST-роуты (worker-payments.js:139,426; director-payments.js:38) `se_payee_id` не читают. Учёт идёт через отдельные `se_transfers` — by design, но нет колонки `se_transferred_to_payee_id` в worker_payments.
- **🟡-11** tooltip с per_diem в timesheet-v2 — CONFIRMED. `public/assets/js/timesheet-v2.js:824` — `paidTotalWithPerDiem = Number(emp.paid_total || 0)` и рендерится отдельно (line 831-833). UX-риск, по контракту корректно.
- **🟡-12** `se_payee_*` vs `use_se_payee` в Cash — CONFIRMED как риск путаницы имён. Не функциональный баг.

---

## ИТОГ

- **CONFIRMED:** R1, R2, R3, R4 + 10 из 12 жёлтых.
- **FALSE (не баг):** R5 (сам аудит так помечен).
- **PARTIAL:** 🟡-6 (несогласованность есть, частота NEEDS-MORE-INFO).
- **NEEDS-MORE-INFO:** 🟡-8 (cash.js SELECT не проверен).

**Главные блокеры подтверждены:**
1. R1 — рабочий видит разные суммы в моб. приложении (главный экран vs детальный).
2. R4 — РП-сетка и SSoT расходятся по статусам field_checkins.
3. R2 — теневой путь записи `payment_method='auto'` либо мёртвый ожидающий код.
4. R3 — backend `grand_total` семантически не совпадает с UI-net.
