# Валидация аудита 01-tenders.md
Дата: 2026-06-23. Метод: независимое чтение указанных file:line + Grep по `migrations/*.sql`.

## P0 (🔴)

### #1 `t.deadline_at` в React v2 → DeadlinePill всегда «—»
**CONFIRMED.** `TenderRow.jsx:89-90` (`t.deadline_at || t.deadline`), `:131` (`<DeadlinePill value={t.deadline_at||t.deadline}/>`), `TendersList.jsx:150` (CSV), `:229` (`<Th k="deadline_at">`), `index.jsx:261-262` (KPI burn). В БД — `docs_deadline` (V001:213, V236 не переименовывал). GET `/api/tenders` (`tenders.js:99` `SELECT t.*`) не отдаёт `deadline_at`. Vanilla `tenders.js:574` корректно читает `docs_deadline`.

### #2 `t.tender_name` в React v2 → подзаголовок всегда пуст
**CONFIRMED.** `TenderRow.jsx:117-119` (`{t.tender_name && <div>`), `WinAssignPanel.jsx:219`, `KpReadyPanel.jsx:66`. БД — `tender_title` (V001). Поле `tender_name` существует только в local-state TenderEditor.

### #3 TenderEditor: открыть существующий → форма пустая → PUT перезаписывает null
**CONFIRMED.** `TenderEditor.jsx:686-702`: `base = { tender_name:'', deadline_at:'' }`, затем `serverInitial = { ...base, ...t }`. Бэк (`tenders.js:365-373`) отдаёт `t.tender_title` и `t.docs_deadline` → они попадают в state КАК `tender_title`/`docs_deadline`, но форма биндится к `state.tender_name`/`state.deadline_at` (`:114`, `:222-302` и далее). На сабмите (`:847,849`): `tender_title: state.tender_name` (пусто), `docs_deadline: state.deadline_at || null`. **PUT шлёт `tender_title:''` и `docs_deadline:null` — необратимая потеря**. Vanilla корректно мапит при инициализации.

### #4 tenders-hub.js: `t.tender_number`, `t.source`, `t.customer` несуществующие колонки
**CONFIRMED.** `tenders-hub.js:146` (`source = $X OR t.source`), `:156` (`tender_number ILIKE`), `:162` (`COALESCE(source_kind, t.source)`), `:163` (`COALESCE(customer_name, t.customer)`), `:165` (`COALESCE(tender_title, t.tender_number)`). Grep по `migrations/V*.sql` для `ALTER TABLE tenders` — НЕТ ни одного `tender_number`, `source` (без `_kind`), `customer` (без `_name`). На чистом клоне — `column "tender_number" does not exist`. На проде, видимо, есть ручной ALTER (CLAUDE.md «schema-drift»).

### #5 `t.pm_id` в RBAC/sort React v2
**CONFIRMED.** `index.jsx:227` (`Number(t.pm_id)===uid`), `:239` (`String(t.pm_id)===filters.pm`), `TendersList.jsx:149` (CSV РП), `:230` (`<Th k="pm_id">`). В БД — `responsible_pm_id` (V001:215). `t.pm_id` существует только на `works`. OR-цепочка (`:228-231`) с `responsible_pm_id` спасает RBAC, но фильтр `filters.pm` (`:239`) и сортировка/CSV — silently broken.

### #6 TenderRow + TenderCardModal: `t.customer_name` вместо `customer_display`
**CONFIRMED.** `TenderRow.jsx:116`, `TenderCardModal.jsx:49`. GET `/api/tenders/:id` (`tenders.js:368`) возвращает `COALESCE(c.name, t.customer_name) AS customer_display` — fresh имя из справочника. v2 игнорирует.

### #7 Vanilla игнорирует `customer_display` в реестре
**PARTIAL.** Vanilla `tenders.js` — нет `customer_display` (Grep: 0 хитов). НО автор использует это как «расхождение между funnel.js и tenders.js». На самом деле GET `/api/tenders/` (`tenders.js:98-112`) **не возвращает** `customer_display` (только в `/:id`), так что vanilla физически НЕ МОЖЕТ его читать в реестре. Это не баг vanilla — это симптом backend-несоответствия двух эндпоинтов. Переквалифицировать как backend-finding.

## 🟡

### #1 `t.author_user_id`
**CONFIRMED.** `index.jsx:231`. Колонки нет ни в одной миграции. Сейчас no-op (NULL===uid=false), но мина.

### #2 `t.contract_value` в CSV
**CONFIRMED.** `TendersList.jsx:147`. На `tenders` нет, на `works` есть.

### #3 `kp_sent_at` не в allowedCols PUT
**CONFIRMED.** `tenders.js:500-507` — нет `kp_sent_at`. Колонка существует (V236:22). `KpReadyPanel.jsx:44` шлёт PUT с `kp_sent_at` — backend молча отбросит. (Время кэшируется триггером `last_status_change_at`, но не `kp_sent_at`.)

### #4 subtab 'platforms' пропускает pm_manual/to_manual
**CONFIRMED.** `index.jsx:222` — только `platform`/`email_invite`. V250 определяет 7 значений. By-design или баг — нужно подтверждение продукта.

### #5 pre_tenders канбан 4 колонки vs hub 9 статусов
**CONFIRMED.** `pre_tenders.js:639-644` — 4 (new/in_review/need_docs/accepted). Hub маппит больше.

### #6 `to_calcs.js` statusBadge нет `Дозапрос`
**CONFIRMED.** `to_calcs.js:82-92` — fallback серый.

### #7 KPI «Выиграно» по `created_at`, не `won_at`
**CONFIRMED.** `index.jsx:259,254-260`.

## Новые находки

- **N1 (🔴):** `tenders-hub.js:163` — `COALESCE(t.customer_name, t.customer)`. Колонка `customer` (без `_name`) НЕ существует. Автор перечислил `tender_number` и `source`, но `customer` пропустил. Тот же SQL ERROR на чистом клоне.
- **N2 (🟡):** `tenders-hub.js:171` — `responsible_user_id` через `COALESCE(responsible_pm_id, work_assigned_pm_id)` корректно, но фронт-консумер `responsible_user_id` есть только в hub-feed; на обычном `/api/tenders` поле отсутствует — потенциальный рассинхрон между двумя реестрами.

## Итог
- **6 из 6 🔴 подтверждены** (один PARTIAL — #7 надо переквалифицировать как backend).
- **7 из 7 🟡 подтверждены** (автор пометил 4 — на самом деле в его секции 7 пунктов, все валидны).
- **+2 новые** (`customer`, `responsible_user_id`).
- Автор не галлюцинирует. Приоритет правильный: P0 #3 и P0 #4 действительно блокирующие.
