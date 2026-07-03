# 04-timesheet — Независимая валидация (2026-06-23)

Read-only. Без правок и деплоя.

## R-01. shift='half' — CONFIRMED

Backend `src/routes/timesheet-v2.js:38`:
`const SHIFT_TYPES = new Set(['day', 'night']);`

`cellTypeFromShift` (`timesheet-v2.js:171-176`): различает только
`night / road|travel / standby|waiting`, **'half' не упомянут** → возврат
`'day'` (fallback на строке 175). То есть «полдня» отрендерится как
полная ☀️ с полными `tariff_points` (строка 657).

`typeAllowedForMode` (`timesheet-v2.js:158`):
`if (mode === 'global') return SHIFT_TYPES.has(type) || STAGE_TYPES.has(type);`
→ PUT entry с type='half' через `/api/timesheet/v2/entry` отдаст 403.

Vanilla `public/assets/js/field-tab.js:1545` пишет `value:'half'`. React
v2 `desktop-v2-src/.../FieldTab/tabs/timesheetUtils.js:9` — то же. Эти
фронты создают `field_checkins.shift='half'`, которые единый табель
покажет как полный «день». Утверждение аудита корректно.

## R-02 — три формулы total_earned — CONFIRMED

- **Bookkeeper** `timesheet-v2.js:1005-1008`:
  `earned = max(0, earnedFromShifts + bonus(!=cancelled) − penalty(!=cancelled))`
  где `bpRows` фильтр `status != 'cancelled'` (строка 840) → **pending bonus входит**.
- **SSoT мобилка** `worker-finances.js:172`:
  `totalEarned = totalFot + totalPerDiemAccrued + rootBonusPaid − rootPenalty`
  где `rootBonusPaid` собирается только из `paid|confirmed` (см. строка 167
  + контракт). Pending bonus **НЕ входит**.
- **Мобилка помесячно** `field-earnings.js:112`:
  `total_earned = m.fot + m.per_diem_accrued` — без bonus/penalty вообще.

Три РАЗНЫЕ формулы для одного периода. Pending bonus виден буху, не виден
рабочему — подтверждено.

## R-03 vs R-04 — V145 'waiting' vs код 'standby' — CONFIRMED

`migrations/V145__checkin_types_extension.sql:6`:
`'day','night','road','warehouse','medical','waiting'` — план.

Реальный INSERT: `field-tab.js:1547` пишет `value:'standby'` (не 'waiting').
Backend (`timesheet-v2.js:166-176`) трактует 4 значения: day/night/road/standby.
`warehouse`/`medical` в `field_checkins.shift` не используются — живут в
`field_trip_stages.stage_type`. Аудит точен.

## FIX #3 (tariff_points vs day_rate) — CONFIRMED

`timesheet-v2.js:651-657`: `points = c.tariff_points` (через
`ftg.points AS tariff_points`, JOIN на строке 459). Комментарий 653-656
прямо называет FIX #3 и поясняет «НЕ day_rate (это рубли)». Источник
points = `field_tariff_grid.points`. Корректно.

## V230 payment_method='auto' — CONFIRMED

`migrations/V230__fot_auto_payment_method.sql:76, 85`: INSERT и UPDATE
явно ставят `payment_method='auto'`. Backfill (строка 99-100):
`UPDATE work_expenses SET payment_method='auto' WHERE source_table='field_checkins_agg' AND payment_method='cash' AND category='fot'`.
Утверждение точное.

## TYPE_META паритет 6 типов — PARTIAL

Глобальный список 6 типов (`day/night/warehouse/medical/travel/waiting`)
действительно общий. Но React v2 `MODE_ALLOWED_TYPES` для PM включает
`['day','night','waiting']` (vanilla строки 56-62) — `travel/warehouse/medical`
PM-у не доступны через табель. Это уже отмечено в аудите (раздел 4) как
ограничение режима, не разрыв TYPE_META. Сам словарь меток/иконок
совпадает — паритет подтверждён.

## paid_salary_total — CONFIRMED

`timesheet-v2.js:1158-1178` отдаёт `paid_salary_total = salary+advance+bonus`
(без суточных). Vanilla/React v2 Grid/Dashboard используют его для колонки
«Выплачено». Утверждение точное.

## worker_payments CHECK — CONFIRMED

`migrations/V067__worker_payments.sql:10`:
`type CHECK IN ('per_diem','salary','advance','bonus','penalty')`. Строка 40:
`status CHECK IN ('pending','paid','confirmed','cancelled')`. БД блокирует
другие значения.

## Итог

Все 4 🔴 и проверенные 🟡 — CONFIRMED. Аудит точен, галлюцинаций не
найдено. Главный риск: half-shift молча превращается в полный день с
полными баллами.
