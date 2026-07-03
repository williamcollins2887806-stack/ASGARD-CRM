# 03 — Аудит консистентности данных: модуль РАБОТЫ (Works / PmWorks)

Дата: 2026-06-23. Тип: read-only. Прод не трогался.

Источники анализа: `src/routes/works.js`, `src/routes/work-readiness.js`, `src/routes/worker-readiness.js`,
`migrations/V001__initial_schema.sql`, `migrations/V050__works_schema_consolidation.sql`,
`src/helpers/work-status.js`; vanilla `public/assets/js/{pm_works,gantt,gantt_full,kpi_works,all_works,custom_dashboard,big_screen}.js`;
React v2 `public/desktop-v2-src/src/pages/{PmWorks,Gantt}/*`; mobile `public/mobile-app/src/pages/Works.jsx`.

---

## 1. СХЕМА БД `works` (актуально на проде после V050)

### Реальные колонки (есть в коде, в `ALLOWED_COLS` works.js:8-24 и/или встречаются в SELECT/UPDATE):

| Колонка | Тип | Заполняется | Использование |
|---|---|---|---|
| `id` | serial | всегда | PK |
| `tender_id` | int FK tenders | если из тендера | works.js:99,176 |
| `pm_id` | int FK users | почти всегда | works.js:97-111 — owner-фильтр |
| `work_number` | varchar(100) | часто | works.js:744 |
| `work_title` | varchar(500) | обязательное | works.js:166 |
| `work_status` | varchar(100) | всегда | основной фильтр (см. §3) |
| `customer_name` | varchar(500) | **плоский, всегда заполнен** | works.js:99 в SELECT |
| `customer_inn` | text | редко | works.js:744 |
| `contract_value` | numeric | часто | финансы |
| `vat_pct` | numeric | редко | финансы |
| `cost_plan`, `cost_fact` | numeric | часто | финансы |
| `advance_pct`, `advance_received`, `advance_date_fact`, `balance_received`, `payment_date_fact`, `act_signed_date_fact` | mixed | редко | финансы (works.js:121-122) |
| `start_plan` | date | **часто** (из тендера) | КАНОНИЧЕСКАЯ дата старта-плана |
| `start_in_work_date` | date | **редко** (РП руками) | факт-входа в работу. memory подтверждает: «почти не заполняется» (work-readiness.js:198) |
| `start_date` | date | **легаси из V001**, активно НЕ заполняется | оставлено в ALLOWED_COLS works.js:10 + DATE_FIELDS:58 |
| `start_fact` | date | редко | fallback в gantt.js:283 |
| `end_plan` | date | часто | основная плановая дата конца |
| `end_fact` | date | по факту закрытия | works.js:432-442 |
| `started_at`, `completed_at` | timestamp | редко | works.js:743 (только SELECT, не в ALLOWED) |
| `object_name` | text | часто (введён РП «Усинск») | works.js:14 |
| `object_address`, `object_place` | text | редко | (object_place не в ALLOWED_COLS — это вход для геокода) |
| `city`, `address` | text | очень редко | works.js:14 |
| `site_id` | int FK sites | **обязательно с V185+** | works.js:226 — без него POST → 400 |
| `description`, `notes`, `comment`, `hr_comment` | text | редко | |
| `priority` | text | редко | |
| `is_vachta`, `rotation_days` | bool/int | редко | works.js:18 |
| `crew_size`, `delay_workdays` | int | редко | works.js:19 |
| `closeout_submitted_at/by`, `closed_at` | timestamp/int | при закрытии | works.js:20 |
| `customer_score` | int | при закрытии | works.js:21 |
| `work_kind` | enum 'main'/'addendum' | всегда (default 'main') | works.js:188 |
| `parent_work_id`, `addendum_*` | mixed | только аддендумы | works.js:23 (V130) |
| `staff_ids_json` | jsonb | редко | works.js:12 |
| `max_chat_id`, `max_invite_link`, `max_chat_created_at` | mixed | при включённом MAX | works.js:261-263 |
| `created_by`, `created_at`, `updated_at`, `deleted_at`, `deleted_by` | system | | |

### Колонки, которые ОЖИДАЛИСЬ в задаче но ОТСУТСТВУЮТ в схеме:

- **`customer_id`** — НЕТ. Заказчик хранится только плоским полем `customer_name`. JOIN customers в `src/routes/works.js` не используется (Grep по `customers` в works.js — 0 совпадений, кроме комментариев).
- **`head_pm_id`** — присутствует в коде только `src/services/correspondence.js:730,737` как фильтр. **В ALLOWED_COLS works.js НЕТ**, в V001 НЕТ, в V050 НЕТ. Скорее всего добавлено отдельной ручной ALTER на проде (schema-drift) или мёртвый ref.
- **`source_pre_tender_id`** — НЕТ в works (есть в `tenders` и `tkp` — V235). К работам не относится.
- **`calculator_kind`** — НЕТ в works (это поле `tenders.calculator_kind`, V206; в задаче перепутан модуль).

### Удалённые V050:

- `work_start_plan` → `start_plan`
- `work_end_plan` → `end_plan`
- `responsible_pm_id` → `pm_id`
- `status` → `work_status`
- `work_name` → `work_title`
- `contract_sum` → `contract_value`
- `end_date_plan/end_date_fact/start_date_plan` → `end_plan/end_fact/start_plan`
- `advance_percent/w_adv_pct/advance_sum/balance_sum`

`COL_ALIASES` в works.js:27-41 продолжает принимать эти имена как input (обратная совместимость), но в БД пишет в каноничные.

---

## 2. ENDPOINTS

### `GET /api/works` — works.js:96-129
```sql
SELECT w.*, t.customer_name AS customer, u.name AS pm_name
FROM works w
LEFT JOIN tenders t ON w.tender_id = t.id
LEFT JOIN users u ON w.pm_id = u.id
WHERE w.deleted_at IS NULL
  -- + RBAC PM: AND w.pm_id = :user.id
  -- + опц. tender_id/pm_id/status/kind
ORDER BY w.id DESC LIMIT ... OFFSET ...
```
- `customer` (без `_name`) — это `tenders.customer_name`, дублирует `w.customer_name`. **Фронты используют только `w.customer_name`**, поле `customer` не читается.
- `pm_name` — `users.name` (НЕ `login`).
- Финансовые поля **прячутся** для `TO/HEAD_TO/WAREHOUSE/OFFICE_MANAGER` (works.js:119).

### `GET /api/works/:id` — works.js:131-160
```sql
SELECT w.*, pw.work_title, pw.work_number, pw.contract_value, pw.work_status
FROM works w
LEFT JOIN works pw ON pw.id = w.parent_work_id
WHERE w.id = :id AND w.deleted_at IS NULL
```
- НЕ JOIN'ит users → `pm_name` отсутствует в `/:id`.
- НЕ JOIN'ит tenders → нет `t.customer_name`/`t.tender_title`.
- Возвращает `{work, expenses}` (work_expenses).

### `GET /api/works/:id/financial-summary` — works.js:735-1040
- Роли: `ADMIN, DIRECTOR_*, HEAD_PM, PM, BUH`.
- Возвращает: `{work_meta, crew, tender, estimate, revenue, expenses, vat, taxes, profit, timeline, payments}`.
- В `timeline` (works.js:951-956):
  ```js
  start_plan, end_plan,
  start_fact: work.start_fact || work.start_in_work_date || null,
  end_fact
  ```
- В `profit.net/margin` — после налогов.
- В `crew` — JOIN employee_assignments + field_checkins + field_tariff_grid.

### `GET /api/work-readiness/:workId` — work-readiness.js:300
- Возвращает 7-этапов готовности + `in_prep` (work-readiness.js:200: **«ТОЛЬКО work_status»**).
- 7 этапов: personnel / training / procurement / assembly / tickets / housing / logistics.

### `GET /api/work-readiness/summary?ids=` — work-readiness.js:314
- Батч, кэш 60с, slim-объект (overall_percent/blocker/in_prep/stages_done/stages_total/start_plan).

### POST/DELETE `/api/work-readiness/:workId/override[/:stage]` — work-readiness.js:350,380

---

## 3. МАППИНГ work_status (8 канонов + легаси)

### Канонические переходы — `STATUS_TRANSITIONS` (works.js:73-82 == vanilla pm_works.js:1-10 == v2 api.js:27-36):
```
Новая → Подготовка
Подготовка → Мобилизация/Новая
Мобилизация → В работе/Подготовка
В работе → Подписание акта/На паузе
На паузе → В работе
Подписание акта → Работы сдали
Работы сдали → Закрыт
Закрыт → []
```

### Группы:
- `PREP_STATUSES = ['Новая','Подготовка','Мобилизация']` — определено в:
  - work-readiness.js:16 (backend)
  - pm_works.js:154 (vanilla)
  - api.js:38 (v2)
  - custom_dashboard.js:373 (legacy widget)
  - big_screen.js:354 (Big Screen)
- `ACTIVE_STATUSES = ['В работе','На паузе']` (v2 api.js:39, vanilla неявно по фильтру).
- `CLOSEOUT_STATUSES = ['Подписание акта','Работы сдали']` (v2 api.js:40).
- `CLOSED_STATUSES` — РАСШИРЕННЫЙ список (см. § расхождений ниже):
  - **v2 api.js:44-49**: ['Закрыт','Закрыта','Закрыто','Завершена','Завершено','Завершен','Завершён','Сдан','Сдана','Сдано','Отменена','Отменено','Отменён','Отменен','Отмена'] (15 значений)
  - **vanilla custom_dashboard.js:374-378**: ['Закрыт','Закрыта','Закрыто','Работы сдали','Завершена',… 'Отмена'] (16 значений — добавлен «Работы сдали» — bug! Это closeout, не closed)
  - **helpers/work-status.js:14-23**: 12 значений (+CANCELLED_STATUSES отдельно), включая «Работы сдали»
  - **mobile Works.jsx:21**: ['работы сдали','завершена','закрыт','закрыто','отменено'] (5 значений, lowercase)

---

## 4. VANILLA

### `public/assets/js/pm_works.js`
- pm_works.js:155-158: **`isPrepWork(w) = PREP_STATUSES_SET.has(w.work_status)`** — корректно (только статус, как требует memory).
- pm_works.js:706-708: колонки таблицы — `customer_name/work_status/start_in_work_date`.
- pm_works.js:738-739: дни `diffDays(w.start_in_work_date || w.start_plan, w.end_plan/end_fact)`.
- pm_works.js:755,784,798: **рендер «Заказчик» = `w.customer_name || tender?.customer_name`** (плоское поле + fallback).
- pm_works.js:984-985 (Гантт): `start = w.start_plan || w.start_in_work_date || t?.work_start_plan || w.start_fact || w.created_at` — **новая цепочка от 23.06.2026 с приоритетом start_plan**.
- pm_works.js:1023-1024 (mini): **`start = w.start_in_work_date || t?.work_start_plan`** (старая логика — НЕ обновлена под новую цепочку, см. 🟡 ниже).
- pm_works.js:1047-1064: форма правки — `object_name || city || t?.tender_region` (fallback chain объекта).
- pm_works.js:1567-1569: PUT body — `work_status / start_in_work_date / end_plan / end_fact` (start_plan НЕ пишется через эту форму!).

### `public/assets/js/gantt.js`
- gantt.js:278-299: **универсальные `workStartIso/workEndIso`** с канонической цепочкой:
  - start: `start_plan → start_in_work_date → start_date → start_fact → work_start_plan(legacy) → created_at`
  - end: `end_plan → end_date → end_fact → work_end_plan(legacy) → start+30d`

### `public/assets/js/gantt_full.js`
- gantt_full.js:482-501, 745-747: используют `AsgardGantt.workStartIso/workEndIso(w, fallback)` — корректно.
- gantt_full.js:81: legacy fallback `it.start || it.start_in_work_date || it.start_plan || it.work_start_plan` — **порядок инвертирован** (start_in_work_date перед start_plan).

### `public/assets/js/kpi_works.js`
- kpi_works.js:126,150: `start = fmtDate(w.start_in_work_date || t?.work_start_plan)` — start_plan не учитывается.
- kpi_works.js:307-311 (Гантт): корректная цепочка с приоритетом start_plan.

### `public/assets/js/all_works.js`
- all_works.js:260: `toDate(w.start_in_work_date) || toDate(t?.work_start_plan) || toDate(w.created_at)` — старая.
- all_works.js:280-282: расчёт длительности по `start_in_work_date` (исключает работы без этой даты).
- all_works.js:570-573: Гантт-fallback корректный.

### `public/assets/js/custom_dashboard.js`
- custom_dashboard.js:382-383: `_isPrep(w) = PREP_SET.has(w.work_status)` — корректно.
- custom_dashboard.js:374-381: расширенный `_isClosedWork` — 16 значений (включая ошибочный «Работы сдали»).
- custom_dashboard.js:646: `d = x.start_fact || x.start_plan || x.start_in_work_date` — порядок отличается от Гант-цепочки.
- custom_dashboard.js:1045: `d = w.start_fact || w.start_plan || w.created_at` — без start_in_work_date.

### `public/assets/js/big_screen.js`
- big_screen.js:354,394: hardcoded `['Новая','Подготовка','Мобилизация']` — корректно (но не использует общую константу).
- big_screen.js:443,472: `dt = w.start_fact || w.start_plan || w.start_in_work_date || w.created_at` — корректно.

---

## 5. REACT v2

### `public/desktop-v2-src/src/pages/PmWorks/api.js`
- api.js:11-21 `WORK_STATUSES` — 9 значений (8 канон + 'Отменена'), value=label русский — корректно для БД.
- api.js:27-36 `WORK_STATUS_TRANSITIONS` — зеркало backend.
- api.js:38-49 группы — PREP/ACTIVE/CLOSEOUT/CLOSED (CLOSED расширенный).
- api.js:51-53 `isPrepWork` — корректно по статусу.
- api.js:160-164 `filterByQuery` — ищет в `customer_name / work_title / tender_name / id`.

### `public/desktop-v2-src/src/pages/PmWorks/index.jsx`
- index.jsx:83 RBAC: `String(w.pm_id) === String(user.id)` для PM.
- index.jsx:86-89: загрузка readiness — `loadReadinessSummary(prepIds)` по фильтру `isPrepWork`.
- index.jsx:126-133 CSV-экспорт: использует `customer_name / work_title / work_status / start_date / end_fact || end_plan || end_date`.
  - **🔴 Расхождение**: `start_date` (легаси) как основной столбец вместо `start_plan / start_in_work_date`. У большинства работ start_date = NULL, экспорт будет с пустыми «Старт».

### `public/desktop-v2-src/src/pages/PmWorks/WorkRow.jsx`
- WorkRow.jsx:42 `{w.customer_name || '—'}` — корректно.
- WorkRow.jsx:47 **`{fmtDate(w.start_date)} → {fmtDate(w.end_plan || w.end_date)}`** — **🔴 РАСХОЖДЕНИЕ**: используется ТОЛЬКО `start_date` без fallback на `start_plan / start_in_work_date`. Vanilla pm_works.js:755 даёт `w.start_in_work_date || w.start_plan || tender?.work_start_plan`. Список v2 у большинства работ покажет «—» в дате старта.

### `public/desktop-v2-src/src/pages/PmWorks/modals/WorkDetail.jsx`
- WorkDetail.jsx:128 POST attach-place — корректно.
- WorkDetail.jsx:152-156 PUT payload: `work_status / start_in_work_date (w.start_in_work_date || w.start_date) / end_plan / end_fact`. **`start_plan` НЕ передаётся в payload**. Backend `ALLOWED_COLS` его принимает, но v2 поле в форме не редактирует. **🟡 Подозрение**: если у работы только start_plan (из тендера), PM редактирует «Старт» через `<DatePicker value={w.start_in_work_date || w.start_date}>` (стр. 422-424) — записывается ТОЛЬКО в `start_in_work_date`, не синхронизируется со `start_plan`. То же поле в Гантт-цепочке имеет приоритет `start_plan` — расходится с тем что показывается «Старт» в форме (vanilla pm_works.js: тот же баг — стр. 1059-1060 пишет только start_in_work_date).
- WorkDetail.jsx:176 `object_name: w.object_name || placeInput` — корректно.
- WorkDetail.jsx:221-222 KPI duration: `start = w.start_in_work_date || w.start_date || w.tender_work_start_plan` — **🔴 НЕТ `start_plan`** в цепочке. Тендерное поле `tender_work_start_plan` тоже не существует на работе (это собственное поле tenders, не joinится в /:id).
- WorkDetail.jsx:437 `value={w.object_name || w.city || ''}` — корректно.
- WorkDetail.jsx:570-573 MiniGantt: `startDate={w.start_in_work_date || w.start_date || w.tender_work_start_plan}` — **🔴 НЕТ `start_plan`**. У работ из тендера start_plan заполнен — мини-Гантт покажет неправильную полосу.

### `public/desktop-v2-src/src/pages/Gantt/api.js`
- api.js:140-165 `workToRow` — **корректная** канон-цепочка `start_plan → start_in_work_date → start_date → start_fact → created_at`.

### `public/desktop-v2-src/src/pages/Gantt/index.jsx`
- index.jsx:138-139 `uniqStatuses(works, 'work_status')` — корректно.
- index.jsx:194-197: фильтр по `work_status` (e.tender_status для тендеров).
- index.jsx:206-208 `doneSet = ['Работы сдали','Подписание акта','Закрыт','Закрыта']` — **🟡 узкий список**, в проде есть «Завершена/Сдана/Закрыто/Закрыт» и т.п. Будет считать «Завершена» как активную.
- index.jsx:226-229 period-фильтр для работ: правильная цепочка.

### `public/desktop-v2-src/src/pages/PmWorks/modals/WorksGanttModal.jsx`
- WorksGanttModal.jsx:70 baseStart calc: `parseDate(w.start_in_work_date || w.start_date)` — **🔴 НЕТ `start_plan`**. Шкала будет рассчитываться от поздней / неправильной даты у работ с заполненным только start_plan.

---

## 6. MOBILE (`public/mobile-app/src/pages/Works.jsx`)

- Works.jsx:21 `DONE_STATUSES = ['работы сдали','завершена','закрыт','закрыто','отменено']` — lowercase + substring-match.
  - **🟡 Расхождение**: «работы сдали» здесь = «закрыто», но canonical считает это closeout-этапом (после неё статус ещё `Закрыт`). Совпадает с custom_dashboard.js:374 — общий легаси-баг.
- Works.jsx:78 filter `'active'`: substring `['работ','выполнен','мобилиз','подготовк']` — слишком широкий, ловит и «Работы сдали» (которая по `isDone` уже завершена).
- Works.jsx:222 заголовок: `work_title || customer_name || '#ID'`.
- Works.jsx:226 подзаголовок: `customer_name`.
- Works.jsx:242 город: **`work.city`** — но в БД `city` почти всегда NULL (вместо неё пишется `object_name`). См. pm_works.js:1047 (vanilla показывает `object_name || city || t?.tender_region`).
- Works.jsx:250 РП: `work.pm_name` — есть только в `GET /api/works` (JOIN users), отсутствует в `GET /api/works/:id`. Карточка-список покажет, деталь — нет.
- Works.jsx:315-324 fields в DetailSheet: `customer_name / object_name / pm_name / city / address / start_date / end_plan / end_fact`.
  - **🔴 РАСХОЖДЕНИЕ**: «Начало» = `w.start_date` (легаси). У работ из тендера фактически заполнен `start_plan / start_in_work_date`, поле будет пустым.
- Works.jsx:478 CreateWorkSheet POST: `start_in_work_date: startDate || null` (✅ канонический ключ, есть FIX-комментарий).

---

## 7. 🔴 РАСХОЖДЕНИЯ (требуют фикса)

| # | Место | Файл:строка | Проблема |
|---|---|---|---|
| R1 | v2 WorkRow «Старт» | `public/desktop-v2-src/src/pages/PmWorks/WorkRow.jsx:47` | Использует только `w.start_date` без fallback на `start_plan / start_in_work_date`. У большинства работ start_date=NULL → «—» в колонке «Сроки». Должно быть как vanilla pm_works.js:755: `w.start_in_work_date \|\| w.start_plan \|\| tender?.work_start_plan` либо `AsgardGantt.workStartIso(w)`. |
| R2 | v2 WorkDetail MiniGantt startDate | `public/desktop-v2-src/src/pages/PmWorks/modals/WorkDetail.jsx:570` | `w.start_in_work_date \|\| w.start_date \|\| w.tender_work_start_plan` — нет `start_plan`. Работа с заполненным только start_plan получит null → мини-Гантт «съезжает» к началу шкалы или скрывается. |
| R3 | v2 WorkDetail KPI duration | `public/desktop-v2-src/src/pages/PmWorks/modals/WorkDetail.jsx:221-222` | Та же цепочка без `start_plan`. KPI «₽/день», «₽/чел.день» считаются по неправильному периоду или = null. |
| R4 | v2 WorkDetail форма «Старт» | `public/desktop-v2-src/src/pages/PmWorks/modals/WorkDetail.jsx:422-424` | DatePicker «Старт» читает `w.start_in_work_date \|\| w.start_date`, при пустом старт_in_work_date поле пустое даже если start_plan заполнен. Запись идёт только в `start_in_work_date` (стр. 154), `start_plan` не пишется → отдельные источники истины расходятся. (vanilla pm_works.js:1059 ведёт себя так же — пишет start_in_work_date.) |
| R5 | v2 WorksGanttModal baseStart | `public/desktop-v2-src/src/pages/PmWorks/modals/WorksGanttModal.jsx:70` | `parseDate(w.start_in_work_date \|\| w.start_date)` — нет `start_plan` / `start_fact` / `created_at`. Шкала Гантта в модалке «📅 Гантт по работам» рассчитывается от неверной даты, работы могут уехать за пределы видимой области. |
| R6 | mobile Works detail «Начало» | `public/mobile-app/src/pages/Works.jsx:322` | `start_date` без fallback. У работ из тендера поле «Начало» = пусто, хотя в `start_plan / start_in_work_date` дата есть. |
| R7 | mobile Works «Город» | `public/mobile-app/src/pages/Works.jsx:242` | Использует `work.city` — это редко-заполняемое поле. Vanilla отображает `object_name \|\| city \|\| t.tender_region`. У большинства работ карточка не покажет место. |
| R8 | v2 PmWorks CSV-экспорт | `public/desktop-v2-src/src/pages/PmWorks/index.jsx:132-133` | Колонка «Старт» = `start_date`, «Конец» = `end_fact \|\| end_plan \|\| end_date`. У большинства работ «Старт» в CSV будет пустым. |
| R9 | vanilla pm_works mini-Гантт | `public/assets/js/pm_works.js:1023-1024` | `start = w.start_in_work_date \|\| t?.work_start_plan` — нет start_plan. Хотя основная цепочка в pm_works.js:984 уже исправлена на canonical chain, для openWork() мини-Гантт остался по старой логике. |
| R10 | v2 Gantt doneSet (узкий) | `public/desktop-v2-src/src/pages/Gantt/index.jsx:206-208` | doneSet = 4 значения; на проде также есть «Завершена/Сдана/Закрыто/Закрыт» (без 'а'). Фильтр «Только завершённые» не покажет работы с легаси-статусами. Vanilla `helpers/work-status.js` имеет полный список. |
| R11 | Mobile DONE_STATUSES включает «работы сдали» | `public/mobile-app/src/pages/Works.jsx:21` | «Работы сдали» — это closeout-этап (`Подписание акта → Работы сдали → Закрыт`), а не «done». Совпадает с багом vanilla `custom_dashboard.js:374`. |
| R12 | head_pm_id — schema-drift | `src/services/correspondence.js:730,737` | Код ожидает колонку `works.head_pm_id`, которой нет ни в V001, ни в V050, ни в ALLOWED_COLS. Это либо ручной ALTER на проде (нарушение feedback-deploy-strategy), либо мёртвый код, который при первом срабатывании даст 42703 column does not exist. |
| R13 | GET /:id без pm_name | `src/routes/works.js:131-160` | Не JOIN'ит users → mobile DetailSheet `w.pm_name` отсутствует (Works.jsx:316 `pm_name && { label: 'РП' }` тихо скрывает поле). Также нет JOIN tenders → tender_title недоступен из деталки. |

---

## 8. 🟡 ПОДОЗРЕНИЯ (требуют уточнения, но не критично)

| # | Место | Файл:строка | Проблема |
|---|---|---|---|
| S1 | Закрытые-статусы — 4 разных списка | helpers/work-status.js:14-23 / v2 api.js:44-49 / custom_dashboard.js:374-381 / Mobile Works.jsx:21 | Все 4 списка слегка отличаются (количество значений, наличие «Работы сдали», lowercase vs Pascal). Один источник истины → `helpers/work-status.js` (но `Работы сдали` там тоже в DONE — что концептуально неверно, см. R11). |
| S2 | gantt_full.js fallback инверсия | `public/assets/js/gantt_full.js:81` | `it.start \|\| it.start_in_work_date \|\| it.start_plan \|\| it.work_start_plan` — старый порядок (start_in_work_date перед start_plan). В том же файле основной рендер (стр. 482-501) уже исправлен на канон. Расхождение между функциями одного файла. |
| S3 | all_works.js fallback старый | `public/assets/js/all_works.js:260` | Длительность работы считается по start_in_work_date → в проде у большинства работ это NULL → попадают в категорию «без сроков». Решение: использовать `AsgardGantt.workStartIso`. |
| S4 | custom_dashboard fallback порядок | `public/assets/js/custom_dashboard.js:646,1045` | Цепочка `start_fact \|\| start_plan \|\| start_in_work_date` (стр. 646) и `start_fact \|\| start_plan \|\| created_at` (стр. 1045) — два разных порядка в одном файле. start_fact приоритет — это «факт начала», что концептуально верно для дашборда «когда работа стартовала», но шум среди других мест где start_plan первый. |
| S5 | kpi_works fallback старый | `public/assets/js/kpi_works.js:126,150,260,280-282` | Использует start_in_work_date без start_plan-fallback. KPI «средняя длительность работ» считается только по работам где РП руками ввёл start_in_work_date. Большая часть работ исключается из расчёта. |
| S6 | financial-summary work_meta нет start_in_work_date | `src/routes/works.js:965-981` | В work_meta отдаются `cost_plan/cost_fact/work_status/object_name/city/customer_name`, но НЕТ дат старт/конец. UI получает их отдельно из основной /:id. Не баг, но непоследовательно. |
| S7 | mobile filter active substring-логика | `public/mobile-app/src/pages/Works.jsx:78` | `['работ','выполнен','мобилиз','подготовк']` — substring-match. «Работы сдали» → matches «работ» → считается active, хотя по DONE_STATUSES она done. Конфликт двух фильтров. |
| S8 | object_name vs object_place vs city | `src/routes/works.js:14, 190-232` | В ALLOWED_COLS только `object_name/object_address`. `object_place` — вход для геокода (works.js:192), пишется в `object_name` (works.js:196). При этом `pm_works.js:1047` показывает `object_name \|\| city \|\| t?.tender_region` — но city на проде почти не пишется (нет в форме PUT). Можно убрать city из UI fallback. |
| S9 | start_date в ALLOWED_COLS | `src/routes/works.js:10,58` | Колонка осталась в V001, но фронты её не заполняют (кроме mobile CreateWorkSheet который пишет в start_in_work_date). Поле «мёртвое» в данных, но активно читается v2 (WorkRow.jsx:47, WorkDetail.jsx:221,422,570, mobile Works.jsx:322) как первичный источник. Если на каких-то старых работах start_date был заполнен — fallback корректен; но в массе работ — пусто. |
| S10 | source_pre_tender_id / calculator_kind | задача упоминала эти поля | Их в `works` нет (они в `tenders`/`tkp`). Возможно путаница в постановке задачи. |
| S11 | `work_kind` enum без CHECK | `migrations/V130__works_addendum.sql` | works.js:188 ставит default 'main', но БД-валидация на значения отсутствует — в коде встречаются также 'addendum'. |

---

## 9. Сводка по «in_prep» определению (специальный пункт из задания)

Memory `project-coverage-audit-plan` требует определять «в подготовке» **ТОЛЬКО по `work_status`**, не по `start_in_work_date`.

| Файл | Строка | Способ |
|---|---|---|
| `src/routes/work-readiness.js` | :200 | ✅ `PREP_STATUSES.includes(work.work_status)` (комментарий объясняет почему НЕ через start_in_work_date) |
| `public/assets/js/pm_works.js` | :155-158 | ✅ `PREP_STATUSES_SET.has(w.work_status)` |
| `public/assets/js/custom_dashboard.js` | :382-383 | ✅ `_isPrep(w) = PREP_SET.has(w.work_status)` |
| `public/assets/js/big_screen.js` | :354,394 | ✅ inline `['Новая','Подготовка','Мобилизация'].includes(w.work_status)` (×2) |
| `public/desktop-v2-src/src/pages/PmWorks/api.js` | :51-53 | ✅ `isPrepWork = PREP_STATUSES.includes(w.work_status)` |

🟢 **Все 5 мест корректны.** Регрессии по этому пункту нет.

---

## 10. Краткие выводы

- **Главная зона расхождений** — даты старта работы в v2 (PmWorks/WorkDetail/WorkRow/CSV/WorksGanttModal) и в mobile DetailSheet. Backend и vanilla уже унифицированы на канон-цепочку `start_plan → start_in_work_date → start_date → start_fact → created_at` (gantt.js:278-299). v2 и mobile в разных местах используют **только `w.start_date`**, которое в БД у большинства работ NULL → пустые поля у пользователя.
- **Маппинг work_status** канонически синхронизирован (works.js:73 == pm_works.js:1 == v2 api.js:27). Расходятся только списки «закрытых» (4 версии) и mobile substring-логика.
- **«Заказчик»** — везде плоское `customer_name`. JOIN customers не используется ни в backend, ни во фронтах.
- **«РП»** — `pm_id` + JOIN users.name в GET /api/works. В `/:id` JOIN отсутствует, mobile DetailSheet тихо скрывает поле.
- **Site/object** — `site_id` обязателен с V185, `object_name` — основное человекочитаемое поле, `city`/`address`/`object_place` практически мёртвые.
- **`head_pm_id`** — используется только в correspondence.js, в схеме нет (schema-drift или мёртвый код).
- **`source_pre_tender_id` / `calculator_kind`** — отсутствуют в `works` (это поля tenders/tkp).

---

_Отчёт сгенерирован read-only анализом по локальному репозиторию ASGARD-CRM (ветка mobile-v3). Прод не опрашивался._
