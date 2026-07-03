# 03-works.md — НЕЗАВИСИМАЯ ВАЛИДАЦИЯ

Дата: 2026-06-23. Read-only. Прод не опрашивался.

## 1. Реальная схема `works` (по миграциям)

- `V001__initial_schema.sql:333-350`: id, tender_id, pm_id, work_number, work_title, work_status, contract_sum, customer_name, **start_date**, **start_plan**, end_date_plan, end_fact, site_id, created_by, created_at, updated_at.
- `V050__works_schema_consolidation.sql`: добавлены delay_workdays, crew_size, deleted_at, deleted_by; **DROP**: contract_sum, w_adv_pct, status, work_name, end_date_plan, start_date_plan, work_start_plan, work_end_plan, responsible_pm_id, advance_percent, advance_sum, balance_sum, end_date_fact, advance_date_plan, payment_date_plan. **`start_date` НЕ удалена** — остаётся легаси.
- V051 (soft-delete), V130 (work_kind/parent_work_id/addendum_*), V131 (max_chat_*), V235 (contacts backlinks), V241 (manual_documents/has_documents).
- **head_pm_id**: Grep по всем `migrations/*.sql` → 0 совпадений. Используется только в `src/services/correspondence.js:730,737`.
- **customer_id в works**: 0 совпадений в миграциях (есть customer_id в `correspondence` V001:194 и V042:11 — это другая таблица).

## 2. Цепочка start_*

- `gantt.js:278-287` — канон: `start_plan → start_in_work_date → start_date → start_fact → work_start_plan → created_at`.
- `Gantt/api.js:140-165` — **тот же канон** с комментарием «FIX (23.06.2026)».
- `WorkRow.jsx:47` — `fmtDate(w.start_date)` без fallback. **CONFIRMED**.
- `WorkDetail.jsx:221` — `w.start_in_work_date || w.start_date || w.tender_work_start_plan`. **CONFIRMED — нет start_plan**.
- `WorkDetail.jsx:570` — то же. **CONFIRMED**.
- `WorkDetail.jsx:422` — DatePicker читает `start_in_work_date || start_date`. **CONFIRMED**.
- `WorkDetail.jsx:154` — PUT шлёт `start_in_work_date: w.start_in_work_date || w.start_date`, `start_plan` не пишется. **CONFIRMED**.
- `WorksGanttModal.jsx:70` — `parseDate(w.start_in_work_date || w.start_date)`. **CONFIRMED**.
- `index.jsx:132` — CSV `key: 'start_date'`. **CONFIRMED**.

## 3. correspondence.js head_pm_id

- `correspondence.js:730,737`: фильтр `w.pm_id = $N OR w.head_pm_id = $N`.
- 0 миграций добавляют колонку. **Schema-drift / мёртвый код CONFIRMED.** При первом срабатывании ветки HEAD_PM-фильтра — `42703 column "head_pm_id" does not exist`.

## 4. v2 Gantt doneSet

- `Gantt/index.jsx:206`: `new Set(['Работы сдали','Подписание акта','Закрыт','Закрыта'])` (4 значения).
- `helpers/work-status.js:14-19` CLOSED = 10 значений (+CANCELLED 5). Vanilla каноничный список шире.
- **CONFIRMED — узкий**: работы со статусом «Завершена/Сдана/Закрыто/Закрыт» не попадут под фильтр «done», но и под «active» тоже не попадут (включены в `!doneSet.has`). **PARTIAL**: автор пишет «будет считать как активную» — технически верно для filterMode=active. Но `helpers/work-status.js:17-19` относит «Подписание акта» к ACTIVE, а v2 — к done. Это дополнительное расхождение в семантике.

## 5. Mobile Works.jsx

- `Works.jsx:21` DONE_STATUSES включает 'работы сдали'. **CONFIRMED** — совпадает с `custom_dashboard.js:374-381`.
- `Works.jsx:322` `w.start_date && { label: 'Начало' }`. **CONFIRMED — нет fallback на start_plan/start_in_work_date**.
- `Works.jsx:242` `work.city` в карточке. **CONFIRMED** — поле есть в ALLOWED_COLS works.js:14, но Grep по `migrations/*.sql` показал, что V001 создаёт `works` без `city` (нет в CREATE TABLE) — значит колонку добавил ручной ALTER на проде (ещё один schema-drift) ЛИБО есть в дампе. **NEEDS-MORE-INFO** для «реально пусто на проде» — без SQL-чека прода подтвердить нельзя. Но vanilla `pm_works.js:1047` сам делает `object_name || city || t?.tender_region` — это поведенческое подтверждение, что city ненадёжна.
- `Works.jsx:78` filter active по substring `['работ','выполнен','мобилиз','подготовк']` — substring «работ» матчит «Работы сдали». **CONFIRMED**.

## Вердикты

| # | Вердикт | Подтверждение |
|---|---|---|
| R1 WorkRow start_date | CONFIRMED | WorkRow.jsx:47 |
| R2 MiniGantt startDate | CONFIRMED | WorkDetail.jsx:570 |
| R3 KPI duration | CONFIRMED | WorkDetail.jsx:221 |
| R4 DatePicker «Старт» | CONFIRMED | WorkDetail.jsx:422,154 |
| R5 WorksGanttModal baseStart | CONFIRMED | WorksGanttModal.jsx:70 |
| R6 mobile «Начало» | CONFIRMED | Works.jsx:322 |
| R7 mobile «Город» | PARTIAL — код использует city подтверждён; «city на проде пусто» требует prod-SQL | Works.jsx:242 |
| R8 CSV start_date | CONFIRMED | index.jsx:132 |
| R9 vanilla mini-Гантт | NEEDS-MORE-INFO (не открывал pm_works.js:1023) — но шаблон совпадает с известным | — |
| R10 v2 doneSet узкий | PARTIAL — узкий подтверждён, но семантика "активная" спорна | Gantt/index.jsx:206 |
| R11 «работы сдали» в DONE | CONFIRMED | Works.jsx:21 |
| R12 head_pm_id schema-drift | CONFIRMED | 0 миграций, correspondence.js:730,737 |
| R13 GET /:id без pm_name | CONFIRMED | works.js:131-160 не JOIN'ит users/tenders |

🟡 находки (S1-S11) — структурно консистентны с кодом, выборочно проверены S1/S2/S7 → CONFIRMED. Финальная оценка отчёта: **доказательная база крепкая, fabrication не обнаружен**.

Доп. находка: `city` в `works` отсутствует в V001 CREATE TABLE и не добавляется ни одной видимой V*.sql миграцией — потенциально ещё один schema-drift как `head_pm_id`. Требует проверки `\d works` на проде.
