# 05 — Schema-drift валидация (Фиксер #5)

Дата: 2026-06-23. Режим: read-only. SSH/SCP не использовался.

## 1. correspondence.js:744 — `pt.assigned_to`

✅ **VERIFIED.** Read строки 740–747:
- Line 746: `EXISTS (SELECT 1 FROM pre_tender_requests pt WHERE pt.id = c.pre_tender_id AND pt.assigned_to = $${idx})`
- Комментарий 744–745: «канон поля — `pre_tender_requests.assigned_to`, колонки `assigned_pm_id` в схеме pre_tender_requests НЕТ — schema-drift убран».
- Старого `assigned_pm_id` в этом блоке нет.

## 2. COALESCE(w.object_name, w.city, w.tender_region) — счёт по файлам

Grep `COALESCE\(w\.object_name`:

| Файл | Заявлено | Найдено | Статус |
|---|---|---|---|
| field-logistics.js | 3 | 3 (597, 642, 667) | ✅ |
| field-pm.js | 4 | 4 (136, 143, 192, 253) | ✅ |
| field-worker.js | 5 | 5 (68, 179, 349, 739, 761) | ✅ |
| field-gamification.js | 1 + GROUP BY | 1 (1599) + GROUP BY на 1612 содержит `w.city, w.tender_region` | ✅ |

✅ **VERIFIED.** Все 13 мест присутствуют, в field-gamification GROUP BY корректно расширен.

## 3. Голый `w.city` без COALESCE — что осталось

Grep `w\.city` по `src/routes` минус COALESCE-результаты:

🟡 **Незакрытые места (вне scope фиксера #5, но реальный schema-drift):**
- `src/routes/field-checkin.js:916` — `SELECT … w.work_title, w.city, w.object_name FROM field_checkins fc LEFT JOIN works w …` (история чекинов работника). Голый `w.city`, fallback на object_name/tender_region отсутствует.
- `src/routes/mimir.js:1313` — `SELECT ea.date_from, ea.date_to, ea.role, w.work_title, w.work_number, w.customer_name, w.work_status, w.city FROM employee_assignments ea JOIN works w …` (история работ сотрудника для Мимира). Голый `w.city`.

В 4 заявленных файлах (field-logistics, field-pm, field-worker, field-gamification) **голых `w.city` НЕТ** — все вхождения внутри COALESCE. ✅

Дополнительно: `w.city` встречается в `src/services/*` (achievementChecker, procurement-bot, mimir-collector, mimir-conductor) — 9 вхождений. Не в scope этого фиксера.

## 4. EmployeeWorkHistory.jsx:114 — fallback

✅ **VERIFIED.** Line 114:
`<td>{w?.object_name || w?.city || w?.tender_region || w?.object_address || ''}</td>`
Цепочка: object_name → city → tender_region → object_address → ''. Покрывает все варианты schema-drift.

## Итог

✅ Все 4 заявленных пункта фиксера #5 подтверждены на 100%.
🟡 Найдены 2 дополнительных голых `w.city` (field-checkin.js:916, mimir.js:1313) — НЕ в scope #5, но это реальный schema-drift риск. Рекомендация: добавить в ledger как новый D-NN либо передать следующему фиксеру.
