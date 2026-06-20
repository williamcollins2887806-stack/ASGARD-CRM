# Stage S — учёт уже выплаченных через полевой модуль

## Контракт API (источник правды для всех агентов)

### Per emp (новые поля в response timesheet-v2 + payroll-dashboard)

```js
{
  // ...существующие поля (earned, bonus, penalty, transfer_amount, cash_payout)...
  
  // S — новые поля
  paid_cash: 15000,        // SUM worker_payments WHERE status IN ('paid','confirmed') AND payment_method='cash'
  paid_transfer: 70000,    // SUM ... payment_method IN ('transfer','card','auto')
  paid_total: 85000,       // paid_cash + paid_transfer
  
  // Разбивка по типам (для tooltip и Excel)
  paid_breakdown: {
    per_diem: 25000,
    salary: 0,
    advance: 5000,
    bonus: 70000
    // penalty не считается — это штраф, не «выплата»
  },
  
  // Сколько ОСТАЛОСЬ выплатить
  cash_payout_remaining: max(0, cash_payout - paid_cash),
  transfer_remaining: max(0, transfer_amount - paid_transfer)
}
```

### Summary (новые поля)

```js
summary: {
  // ...существующие (total_earned, total_transfer, total_cash_payout)...
  
  // S — новые
  total_paid_cash: 50000,           // SUM по всем emps
  total_paid_transfer: 130000,
  total_paid_total: 180000,
  total_cash_needed_remaining: max(0, total_cash_payout - total_paid_cash),
  total_transfer_remaining: max(0, total_transfer - total_paid_transfer)
}
```

### SQL для расчёта paid_cash / paid_transfer

```sql
SELECT employee_id,
  SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END)::numeric AS paid_cash,
  SUM(CASE WHEN payment_method IN ('transfer','card','auto') 
            OR payment_method IS NULL THEN amount ELSE 0 END)::numeric AS paid_transfer,
  -- разбивка по типам
  SUM(CASE WHEN type = 'per_diem' THEN amount ELSE 0 END)::numeric AS paid_per_diem,
  SUM(CASE WHEN type = 'salary'   THEN amount ELSE 0 END)::numeric AS paid_salary,
  SUM(CASE WHEN type = 'advance'  THEN amount ELSE 0 END)::numeric AS paid_advance,
  SUM(CASE WHEN type = 'bonus'    THEN amount ELSE 0 END)::numeric AS paid_bonus
FROM worker_payments
WHERE employee_id = ANY($1::int[])
  AND status IN ('paid', 'confirmed')
  AND type IN ('per_diem','salary','advance','bonus')
  AND COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $2
  AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $3
GROUP BY employee_id
```

### `/cash-coverage` обновить

```js
cash_needed (для проверки баланса)  → total_cash_needed_remaining (не total_cash_payout)
```

### Excel — новая колонка

Между «Заработано ₽» и «🎁 Премия ₽» добавить **«Выплачено ₽»** (paid_total) с фоном `#FFF3E0` (нежно-оранжевый) когда >0.

### Фронт дашборд — новый блок

Перед блоком «🏦 Касса» добавить:

```
┌─ 📤 УЖЕ ВЫПЛАЧЕНО В ПОЛЕ ─────────────────────────────┐
│  Налом (РП в поле):       25 000 ₽                    │
│  Переводом:              163 250 ₽                    │
│  ────────────────────────────────                     │
│  Всего:                  188 250 ₽                    │
│  💡 130k премии · 58k суточные                        │
└────────────────────────────────────────────────────────┘
```

Если `total_paid_total = 0` — блок не показывать.

### Фронт таблица — новая колонка

После «Заработано ₽» добавить **«Выплачено ₽»** с tooltip разбивки:
```
75 000 ₽
[hover: per_diem 5k + bonus 70k]
```

Цвет: оранжевый бейдж когда >0, прочерк когда 0.

### Защита от двойной выплаты (worker-payments.js)

В `POST /pay-worker`: перед INSERT проверить — есть ли paid строка того же типа за тот же месяц у того же employee:
```sql
SELECT id, amount FROM worker_payments
WHERE employee_id = $1 AND type = $2 
  AND status IN ('paid','confirmed')
  AND COALESCE(pay_year,  EXTRACT(YEAR  FROM created_at)::int) = $3
  AND COALESCE(pay_month, EXTRACT(MONTH FROM created_at)::int) = $4
```

Если результат непустой:
- Если в body `confirm_duplicate: true` → пропускаем (бух подтвердил)
- Иначе → 409 + `{ already_paid: [{id, amount, paid_at}], warning: 'Этот тип уже выплачен X ₽ N июня.' }`

Фронт PayWorkerModal: при 409 показать модалку «⚠ Уже выплачено X ₽. Точно ещё одна?» с кнопкой «Подтвердить (повторная выплата)».

## Файлы

- `src/routes/timesheet-v2.js` — paid_* + summary
- `src/routes/payroll-dashboard.js` — то же + /cash-coverage обновить
- `src/routes/worker-payments.js` — защита pay-worker
- `public/assets/js/timesheet-v2.js` — блок «Выплачено» + колонка
- `public/desktop-v2-src/src/pages/Timesheet/Dashboard.jsx` — блок
- `public/desktop-v2-src/src/pages/Timesheet/TimesheetGrid.jsx` — колонка
- `public/desktop-v2-src/src/pages/Timesheet/timesheet.css` — стили
- Excel — в `src/routes/timesheet-v2.js` (та же функция экспорта)
