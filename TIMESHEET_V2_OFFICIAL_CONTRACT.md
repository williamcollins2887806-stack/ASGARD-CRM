# Stage U — Официальная выплата в табеле (бух vs директор)

## Контекст
- **Бухгалтер** платит официальным через банк по ТК (оклад/несгораемая)
- **Директор** платит остаток налом из табельной кассы
- Директор в табеле должен видеть: «бух уже заплатил X → мне осталось Y налом»

## Формула выплаты официально устроенному (новая)

```js
if (is_officially_employed) {
  const nonBurnable = Number(official_non_burnable || 0);
  const salary      = Number(official_salary || 0);

  if (official_status === 'unpaid_leave') {
    deduct_salary  = 0;       // бух не платит в отпуске за свой счёт
    transfer       = 0;
    cash_payout    = 0;
  } else {
    // Бух платит несгораемую если задана, иначе полный оклад
    deduct_salary  = nonBurnable > 0 ? nonBurnable : salary;
    transfer       = deduct_salary;                        // безналом, бухгалтер
    cash_payout    = Math.max(0, earned - deduct_salary);  // налом, директор
  }
}
```

## Edge cases (для тестов)
| Сценарий | earned | salary | non_b | status | transfer | cash | Комментарий |
|---|---:|---:|---:|---|---:|---:|---|
| A | 80k | 60k | 30k | active | **30k** | **50k** | Бух платит несгораемую 30k, директор остаток 50k налом |
| B | 80k | 60k | 0   | active | **60k** | **20k** | Бух платит полный оклад 60k, директор остаток 20k |
| C | 20k | 60k | 30k | active | **30k** | **0**  | Бух гарантирует 30k несгораемой, директор 0 (earned<deduct) |
| D | 0   | 60k | 30k | active | **30k** | **0**  | Простой: бух всё равно платит несгораемую 30k |
| E | 0   | 60k | 30k | unpaid_leave | **0** | **0** | В отпуске за свой счёт никто не платит |
| F | 0   | 60k | 0   | active | **60k** | **0**  | Простой: бух платит полный оклад (нет несгораемой) |

## Новые поля

### Per emp (response)
```js
{
  // existing: earned, transfer_amount, cash_payout, ...
  
  deduct_official: 30000,        // что бух платит (для UI)
  pay_responsibility: 'buh',      // 'buh' (бух банком), 'director' (директор налом), 'mixed'
}
```

### Summary
```js
{
  // existing: total_earned, total_transfer, total_cash_payout, ...
  
  // U — оф-блок
  total_official_count: 5,                   // сколько официальных в табеле
  total_official_to_pay_by_buh: 150000,      // сумма deduct_salary всех оф
  total_official_paid_by_buh: 0,             // SUM worker_payments type='salary' status IN paid,confirmed
  total_official_remaining_by_buh: 150000,   // max(0, to_pay - paid)
}
```

## Frontend изменения

### 1. Колонка «На карту ₽» — подкраска по типу

В оф-строке (если deduct_official > 0):
- Фон ячейки: индиго `#E8EAF6` (свет) / `rgba(63,81,181,0.15)` (тёмная)
- Текст: `#1A237E` (свет) / `#9FA8DA` (тёмная)
- Префикс: «🏢» 
- Tooltip: «Платит бухгалтер через банк (оклад/несгораемая)»

В СЗ-строке оставить как сейчас (зелёное/нейтральное).

В колонке «Из кассы ₽» оф-строка тоже:
- Если cash_payout > 0 → оранжевый бейдж (как сейчас), tooltip «Платит директор налом сверх оклада»
- Если cash_payout = 0 → прочерк

### 2. Подсказки в шапке колонок (mode='global')

```jsx
<th title="Что уходит на карту:
СЗ — на карту самого СЗ (или получателя НПД)
Оф — оклад/несгораемая, платит бухгалтер
Нал — 0 (нет банковской выплаты)">На карту ₽</th>

<th title="Что отдаёт директор налом из табельной кассы:
СЗ — превышение годового/месячного лимита
Оф — что заработал сверх оклада (премия наличными)
Нал — всё earned">Из кассы ₽</th>
```

### 3. Мини-блок в дашборде «🏢 Официально устроены»

После блока «📤 Уже выплачено в поле», ПЕРЕД блоком «🏦 Касса»:

```
┌─ 🏢 Официально устроены (5 чел) ─────────────────────┐
│  К выплате бухом:        150 000 ₽                   │
│  Уже выплачено бухом:      0 ₽                       │
│  ────────────────────────────────                     │
│  Осталось бух:           150 000 ₽                   │
└──────────────────────────────────────────────────────┘
```

Если `total_official_count === 0` — блок не показывать.

Цвета: индиго (свет `#E8EAF6` / тёмн `rgba(63,81,181,0.10)`)

## Файлы

- `src/routes/timesheet-v2.js` — формула + summary
- `src/routes/payroll-dashboard.js` — то же в /summary, /cash-calc
- `public/assets/js/timesheet-v2.js` — UI колонки + блок + tooltip шапки
- `public/desktop-v2-src/src/pages/Timesheet/Dashboard.jsx` — блок
- `public/desktop-v2-src/src/pages/Timesheet/TimesheetGrid.jsx` — UI колонки + tooltip
- `public/desktop-v2-src/src/pages/Timesheet/timesheet.css` — стили
