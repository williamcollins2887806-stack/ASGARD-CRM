# Аудит консистентности данных — модуль ТЕНДЕРЫ

Дата: 2026-06-23
Локальный репо: `C:\Users\Nikita-ASGARD\ASGARD-CRM`
Метод: только Read/Grep по миграциям, backend-роутам и UI-исходникам.
Прод-БД недоступна → схема собрана из `migrations/V*.sql`.

---

## 1. Реальная схема БД (таблица `tenders`)

### 1.1 Базовые поля (V001 + V049 + V075 + V117 + V118)
Источник: `migrations/V001__initial_schema.sql:205-226`

| Колонка                          | Тип            | Источник миграции             | Семантика                                                                                  |
|----------------------------------|----------------|-------------------------------|--------------------------------------------------------------------------------------------|
| `id`                             | SERIAL PK      | V001                          | первичный ключ                                                                             |
| `customer_name`                  | VARCHAR(500)   | V001                          | **плоское** имя заказчика (строка, не FK)                                                  |
| `customer_inn`                   | VARCHAR(12)    | V001                          | ИНН (FK-связь с `customers.inn` неявная)                                                   |
| `tender_title`                   | VARCHAR(500)   | V001                          | **наименование тендера** (НЕ `tender_name` и НЕ `tender_number`)                           |
| `tender_type`                    | VARCHAR(100)   | V001                          | `commercial` / `state` / `addendum`                                                        |
| `tender_status`                  | VARCHAR(100)   | V001 default `'Новый'`        | русский string. БЕЗ CHECK (V250:5 явно подтверждено)                                       |
| `period`                         | VARCHAR(10)    | V001                          | `YYYY-MM`                                                                                  |
| `docs_deadline`                  | DATE           | V001                          | **дедлайн подачи** — единственная колонка дедлайна                                         |
| `tender_price`                   | NUMERIC        | V001                          | НМЦК                                                                                       |
| `responsible_pm_id`              | INTEGER → users| V001                          | ответственный РП (тот кто считает)                                                         |
| `group_tag`                      | VARCHAR(255)   | V001                          | старый тег (V064 ввёл `tag_id`)                                                            |
| `purchase_url`                   | VARCHAR(1000)  | V001                          | ссылка на ЭТП                                                                              |
| `comment_to` / `comment_dir`     | TEXT           | V001                          | комменты ТО и директора                                                                    |
| `reject_reason`                  | TEXT           | V001                          | при `tender_status='Проиграли'`                                                            |
| `site_id`                        | INTEGER → sites| V001                          | объект                                                                                     |
| `handoff_at`                     | TIMESTAMP      | V001                          | время передачи в работу                                                                    |
| `created_by`                     | INTEGER → users| V001                          | автор                                                                                      |
| `created_at` / `updated_at`      | TIMESTAMP      | V001                          | служебные                                                                                  |

### 1.2 Расширения (V049+)
- **V049** `tender_description, ai_report, ai_cost_estimate, ai_cost_report, work_start_plan DATE, work_end_plan DATE, created_by_user_id, assigned_by_user_id, handoff_by_user_id, distribution_requested_at, distribution_assigned_at, distribution_assigned_by_user_id`. (`migrations/V049__tender_bugfix_columns.sql:5-16`)
- **V064** `tag_id INT → tender_tags(id)`. (`migrations/V064__tender_tags.sql:34`)
- **V075** `archived_at, archived_by, archive_reason VARCHAR(100), archive_comment TEXT`. (`migrations/V075__tender_archive_and_author.sql:5-8`)
- **V106** `estimate_value NUMERIC(15,2)` — сумма согласованного просчёта. (`migrations/V106__logistics_amount_vat_directives.sql:17-18`)
- **V117** `won_at, won_by_user_id, lost_at, lost_by_user_id, lose_cover_letter, winner_name, work_assigned_pm_id, work_assigned_at, work_assigned_by_user_id`. (`migrations/V117__tenders_win_lose_workflow.sql:9-18`)
- **V118** `deleted_at TIMESTAMPTZ`. (`migrations/V118__tenders_soft_delete.sql:11-12`)
- **V206** `calculator_kind VARCHAR(10) CHECK (NULL|'pm'|'to'), calculator_user_id INTEGER → users`. (`migrations/V206__tender_calculator_kind.sql:10-12,22`)
- **V235** `contact_person, contact_phone, customer_email, customer_city, customer_address, source_inbox_application_id, source_pre_tender_id`. (`migrations/V235__contacts_backlinks.sql:17-26`)
- **V236** `cost_planned, kp_price_without_vat, kp_price_with_vat, vat_rate_pct DEFAULT 20, margin_planned_pct, last_status_change_at TIMESTAMPTZ DEFAULT NOW(), kp_sent_at TIMESTAMPTZ`. (`migrations/V236__kanban_financial_fields.sql:15-22`)
- **V241** `manual_documents JSONB, has_documents BOOLEAN DEFAULT false`. (`migrations/V241__works_tenders_manual_documents.sql:9,13`)
- **V250** `source_kind VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK IN (manual, platform, email_invite, email_request, phone, pm_manual, to_manual)`. (`migrations/V250__tender_addendum_and_source.sql:32-52`)

### 1.3 Поля которых **НЕТ** в таблице `tenders` (важно!)
- ❌ `status_v2` — не существует. (Канбановский маппинг живёт в функции `pk_v3_column(flow_type, main_status)` через `personal_kanban_cards`, V250:68-94 + V238.)
- ❌ `win_status` — нет. Состояние «выиграл/проиграл» определяется по `tender_status IN ('Выиграли','Проиграли','Не подходит')` + наличию `won_at`/`lost_at`.
- ❌ `col` — нет (опять же — функция).
- ❌ `customer_id` (INTEGER) — нет; связь с `customers` строится по `customer_inn` (`customers.inn` — PRIMARY KEY, V001:77).
- ❌ `head_pm_id` — нет. (HEAD_PM роль работает через `responsible_pm_id`.)
- ❌ `responsible_user_id` — нет. Есть только `responsible_pm_id`, `calculator_user_id`, `work_assigned_pm_id`.
- ❌ `tkp_id` — нет. Связь обратная: `tkp.tender_id`.
- ❌ `tender_invitation` — нет колонки. Это **значение** `ai_classification` в email-analyzer (`src/services/ai-email-analyzer.js:221,1120`), а не атрибут тендера.
- ❌ `tender_number` — нет. (Только bind-параметр в POST-схеме как алиас → `tender_title`, см. `src/routes/tenders.js:449,481-482`.)
- ❌ `source` (без `_kind`) — нет. (См. ниже расхождение в tenders-hub.js.)
- ❌ `deadline_at` / `deadline` / `response_deadline` / `won_at` (НЕТ) / `lost_at` (НЕТ — V117 ввёл `won_at`/`lost_at`, но НЕ `deadline_at`).

---

## 2. Backend endpoints — что SELECT'ят

### 2.1 GET `/api/tenders` (список)
`src/routes/tenders.js:98-216`
```
SELECT t.*, u.name as pm_name,
       (SELECT COUNT(*) FROM estimates e WHERE e.tender_id = t.id) as estimates_count,
       (SELECT COUNT(*) FROM works w WHERE w.tender_id = t.id) as works_count
FROM tenders t LEFT JOIN users u ON t.responsible_pm_id = u.id
WHERE t.deleted_at IS NULL AND (t.tender_title IS NULL OR t.tender_title NOT ILIKE 'Auto-tender%')
```
`t.*` отдаёт **все** колонки → значит UI получает: `customer_name, customer_inn, tender_title, tender_status, period, docs_deadline, tender_price, responsible_pm_id, group_tag, purchase_url, source_kind, calculator_kind, calculator_user_id, won_at, lost_at, archived_at, archive_reason, work_start_plan, work_end_plan, created_at, updated_at, last_status_change_at, kp_sent_at, contact_person, ...`, **но НЕ `pm_id`, НЕ `tender_name`, НЕ `deadline_at`, НЕ `customer_display`**.

### 2.2 GET `/api/tenders/:id` (карточка)
`src/routes/tenders.js:365-373`
```
SELECT t.*, u.name as pm_name,
       COALESCE(c.name, t.customer_name) as customer_display
FROM tenders t
LEFT JOIN users u ON t.responsible_pm_id = u.id
LEFT JOIN customers c ON t.customer_inn = c.inn
WHERE t.id = $1
```
Возвращает `customer_display` (предпочитает свежее имя из справочника `customers.name`), но дополнительные поля `addenda[]`, `estimates[]`, `works[]`, `contract_value_main/_addenda/_total` (`tenders.js:425-433`).

### 2.3 GET `/api/tenders-hub/feed`
`src/routes/tenders-hub.js:158-189` (UNION ALL по 4 источникам, унифицированная схема 19 полей: `id, kind, source_label, customer_name, customer_inn, title, status, type_label, deadline_days, nmck, responsible_user_id, ai_confidence, addendum_flag, docs_count, event_at, work_id, work_code, work_pm_name, work_status`).

**Маппинг tender-источника**:
- `title = COALESCE(t.tender_title, t.tender_number)` — `t.tender_number` НЕ существует → если `tender_title` IS NULL, выражение в COALESCE сравнит NULL с несуществующей колонкой → **SQL ERROR `column "tender_number" does not exist`**.
- `source_label = COALESCE(t.source_kind, t.source, 'manual')` — `t.source` НЕ существует → **SQL ERROR**.
- WHERE search: `t.customer_name ILIKE ... OR t.tender_title ILIKE ... OR t.tender_number ILIKE ...` — **SQL ERROR**.
- WHERE source filter: `(t.source_kind = $X OR t.source = $X)` — **SQL ERROR**.
- `deadline_days = (t.docs_deadline - CURRENT_DATE)::int` — корректно.
- `nmck = t.tender_price` — корректно.
- `addendum_flag = (t.tender_status = 'Дозапрос')` — корректно (V250).

### 2.4 POST/PUT `/api/tenders` (записываемые поля)
`src/routes/tenders.js:500-507` (allowedCols):
`customer_name, customer_inn, tender_title, tender_type, tender_status, period, docs_deadline, tender_price, tender_price_with_vat, vat_pct, submission_price, submission_price_with_vat, responsible_pm_id, group_tag, tag_id, purchase_url, comment_to, comment_dir, reject_reason, created_by, created_at, calculator_kind, calculator_user_id`.
Алиасы (`:478-489`): `customer→customer_name`, `tender_number→tender_title`, `deadline→docs_deadline`, `tag→group_tag`, `docs_link→purchase_url`.

### 2.5 GET `/api/approval/estimates/*`
Согласуется через `approval_status` ∈ `{draft, sent, approved, rework, question, rejected}` (см. `head_to_approvals.js:33-51`, `to_calcs.js:96-108`). HEAD_TO согласует estimates только тех тендеров где `calculator_kind = 'to'` (`head_to_approvals.js:36`).

---

## 3. Vanilla v1 UI — какие поля рендерит

| Файл / строка                                                | Поле БД                            | Назначение                                       |
|--------------------------------------------------------------|------------------------------------|--------------------------------------------------|
| `public/assets/js/tenders.js:574, 578, 622, 1702-1703`       | `t.docs_deadline`                  | дедлайн в таблице/канбане/KPI                    |
| `public/assets/js/tenders.js:1773, 1782-1783`                | `x.docs_deadline ‖ x.deadline_days`| feed-таблица (нормальный fallback для UNION)     |
| `public/assets/js/tenders.js:603, 1828`                      | `t.source_kind`                    | бейдж источника                                  |
| `public/assets/js/tenders.js:604, 656, 1772, 2274 и ~50+`    | `t.tender_status`                  | бейдж статуса, фильтры, переходы                 |
| `public/assets/js/tenders.js:946, 2368-2497, 4180-4181`      | `t.calculator_kind`                | TO/PM шильдик и блокировка изменения после старта|
| `public/assets/js/tenders.js:575, 633`                       | `t.archive_reason`, `t.archive_comment`| блок «отсев» в архиве                        |
| `public/assets/js/tenders.js:1434`                           | `it.docs_deadline`                 | напоминание                                      |
| `public/assets/js/head_to_approvals.js:36, 99`               | `t.calculator_kind='to'`, `t.customer_name`, `t.tender_title`| очередь HEAD_TO            |
| `public/assets/js/to_calcs.js:44-46, 121, 153`               | `t.calculator_kind='to'`, `t.calculator_user_id ‖ created_by_user_id ‖ created_by`, `t.docs_deadline`, `t.tender_title` | inbox ТО |
| `public/assets/js/funnel.js:285`                             | `t.customer_name ‖ t.customer_display ‖ t.customer` | воронка                          |
| `public/assets/js/pre_tenders.js:618-643`                    | `it.status` ∈ {new,in_review,need_docs,accepted,rejected} | канбан pre-tender'ов          |

Вывод: vanilla **корректно** читает `docs_deadline` / `tender_title` / `customer_name` / `source_kind` / `calculator_kind`.

---

## 4. React v2 UI — какие поля рендерит

| Файл / строка                                                                          | Поле / выражение                                            | Назначение                                                |
|----------------------------------------------------------------------------------------|-------------------------------------------------------------|-----------------------------------------------------------|
| `public/desktop-v2-src/src/pages/Tenders/TenderRow.jsx:81-84,102`                      | `t.tender_status`                                           | бейдж + data-status (OK)                                  |
| `public/desktop-v2-src/src/pages/Tenders/TenderRow.jsx:89-90, 131`                     | `t.deadline_at ‖ t.deadline`                                | DeadlinePill (БАГ — см. §6)                               |
| `public/desktop-v2-src/src/pages/Tenders/TenderRow.jsx:116`                            | `t.customer_name`                                           | имя заказчика — НЕ использует `customer_display`          |
| `public/desktop-v2-src/src/pages/Tenders/TenderRow.jsx:117-118`                        | `t.tender_name`                                             | подзаголовок (БАГ — см. §6)                               |
| `public/desktop-v2-src/src/pages/Tenders/TenderRow.jsx:122`                            | `t.source_kind`                                             | SourceBadge (OK)                                          |
| `public/desktop-v2-src/src/pages/Tenders/TendersList.jsx:150, 229`                     | `t.deadline_at`                                             | CSV-экспорт + Th sort key (БАГ — см. §6)                  |
| `public/desktop-v2-src/src/pages/Tenders/TendersList.jsx:149`                          | `pmsById[t.pm_id]?.name`                                    | имя РП в CSV (БАГ — `pm_id` не существует, есть `responsible_pm_id`) |
| `public/desktop-v2-src/src/pages/Tenders/TendersList.jsx:230`                          | `Th k="pm_id"`                                              | sort key (БАГ)                                            |
| `public/desktop-v2-src/src/pages/Tenders/index.jsx:227, 239`                           | `Number(t.pm_id) === uid`, `String(t.pm_id) === filters.pm` | RBAC-фильтр / pm-фильтр (БАГ)                             |
| `public/desktop-v2-src/src/pages/Tenders/index.jsx:228-231`                            | `t.responsible_pm_id`, `t.calculator_user_id`, `t.created_by`, `t.author_user_id` | OR-цепочка, `author_user_id` не существует (NULL — игнор)|
| `public/desktop-v2-src/src/pages/Tenders/index.jsx:261-263`                            | `t.deadline_at ‖ t.deadline`                                | KPI burn (БАГ)                                            |
| `public/desktop-v2-src/src/pages/Tenders/modals/TenderEditor.jsx:114, 302-303, 688, 849`| state.`deadline_at` → payload `docs_deadline`               | редактор: form ↔ payload (OK), но prefill из API возвращает `docs_deadline`, не `deadline_at` → форма стартует пустой (БАГ — см. §6) |
| `public/desktop-v2-src/src/pages/Tenders/modals/TenderEditor.jsx:847`                  | payload `tender_title: state.tender_name`                   | при сохранении читает `tender_name` (state), но при загрузке (`:696` spread `...t`) state получит `tender_title` из БД — поле `tender_name` останется пустым → перезапись через PUT пошлёт null (БАГ — см. §6) |
| `public/desktop-v2-src/src/pages/Tenders/modals/TenderCardModal.jsx:77`                | `tender.docs_deadline ‖ tender.deadline_at`                 | карточка (OK — fallback правильный)                       |
| `public/desktop-v2-src/src/pages/Tenders/modals/TenderCardModal.jsx:81`                | `tender.tender_title ‖ tender.tender_name`                  | карточка (OK)                                             |
| `public/desktop-v2-src/src/pages/Tenders/panels/WinAssignPanel.jsx:218-219`            | `t.customer_name`, `t.tender_name`                          | подпанель Выиграны (БАГ — `tender_name` пустое)           |
| `public/desktop-v2-src/src/pages/Tenders/panels/WinAssignPanel.jsx:220-223`            | `t.work_start_plan`, `t.work_end_plan`                      | плановые даты (OK — V049)                                 |
| `public/desktop-v2-src/src/pages/Tenders/panels/KpReadyPanel.jsx:66`                   | `t.tender_name`                                             | (БАГ)                                                     |
| `public/desktop-v2-src/src/pages/HeadToApprovals/api.js:18-19`                         | `t.calculator_kind === 'to'`                                | очередь HEAD_TO (OK)                                      |
| `public/desktop-v2-src/src/pages/ToCalcs/api.js:33, 93-99`                             | `t.calculator_kind`, `t.tender_status`                      | бакеты ТО (OK)                                            |
| `public/desktop-v2-src/src/pages/ToCalcs/index.jsx:59-64`                              | `t.calculator_user_id ‖ t.created_by_user_id ‖ t.created_by`| RBAC TO (OK, 1:1 с vanilla)                               |

---

## 5. Mobile UI

Поиск по `public/mobile-app/src/pages/` — **отдельной тендерной страницы нет**.
Файлы вокруг тендеров на мобиле упоминаются только косвенно (например `Procurement.jsx` для закупок). Полный модуль /tenders не реплицирован в мобилке (что соответствует MEMORY.md «офисная мобилка» — там только Procurement/Field-related).

---

## 6. 🔴 Расхождения (баги)

| # | Что показано в UI                                                | Где (file:line)                                              | Что должно быть / реальная БД                                                | Почему критично                                                                                                                                                  |
|---|------------------------------------------------------------------|--------------------------------------------------------------|------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | React v2 список читает `t.deadline_at` для отображения дедлайна  | `Tenders/TenderRow.jsx:89-90, 131`<br>`Tenders/TendersList.jsx:150, 229`<br>`Tenders/index.jsx:261-262` | DB-колонка — `docs_deadline` (V001:213). Backend GET `/api/tenders` отдаёт `t.*` → поля `deadline_at` нет. | DeadlinePill **всегда** `—`, KPI «горит ≤3 дней» **всегда 0**, сортировка по «Дедлайн» (Th k="deadline_at") не работает, CSV экспортирует пустую колонку. Vanilla же читает `docs_deadline` корректно — **разные значения дедлайна на двух UI**. |
| 2 | React v2 список показывает `t.tender_name` как подзаголовок      | `Tenders/TenderRow.jsx:117-118`<br>`Tenders/panels/WinAssignPanel.jsx:219`<br>`Tenders/panels/KpReadyPanel.jsx:66` | DB-колонка — `tender_title` (V001:209). `tender_name` существует только как название формы в TenderEditor. | Подзаголовок «название тендера» всегда **пустой** в v2. Vanilla показывает `t.tender_title` (`tenders.js:99`). На двух UI у одного и того же тендера название видно только в v1. |
| 3 | TenderEditor: редактируешь тендер → дата дедлайна и название стартует пустыми | `Tenders/modals/TenderEditor.jsx:114, 302-303, 688, 696` | Backend GET `/api/tenders/:id` возвращает `docs_deadline` и `tender_title`. Spread `...t` (`:696`) не переименовывает их в `deadline_at` / `tender_name`. | При открытии существующего тендера форма **теряет** дедлайн и название, а при сохранении PUT шлёт `docs_deadline: null` и `tender_title: ''` → **необратимая потеря данных**. Vanilla корректно мапит `t.docs_deadline → CRDatePicker e_docs_deadline` (`tenders.js:2976`). |
| 4 | tenders-hub feed: SELECT/WHERE по `t.tender_number` и `t.source` | `src/routes/tenders-hub.js:146, 156, 162-165`                | Таких колонок нет в `tenders`. Должно быть только `t.tender_title` и `t.source_kind`. | Любой запрос `/api/tenders-hub/feed?tab=tenders` (а это **главная страница хаба тендеров**) валится с PostgreSQL ERROR `column "tender_number" does not exist` либо `column "source" does not exist`. Возможно, на проде уже есть ручной ALTER (см. CLAUDE.md «schema-drift» предупреждение), но в свежем клоне из миграций — **feed не работает**. |
| 5 | React v2 RBAC и сортировка по полю `pm_id`                        | `Tenders/TendersList.jsx:149-150, 230`<br>`Tenders/index.jsx:227, 239` | DB-колонка — `responsible_pm_id` (V001:215). `pm_id` существует на `works`, но не на `tenders`. | RBAC fallback на `pm_id` молча `undefined === undefined → false`. Но фильтр `filters.pm` сравнивает только `String(t.pm_id)` → **никогда не находит ничего**. CSV-колонка «РП» — пустая. Сортировка по столбцу «РП» не работает. Vanilla такой ошибки не делает (`tenders.js:120` использует `responsible_pm_id`). |
| 6 | React v2 TenderRow выводит `t.customer_name`, не `customer_display` | `Tenders/TenderRow.jsx:116`<br>`Tenders/modals/TenderCardModal.jsx:49` | GET `/api/tenders/:id` отдаёт `COALESCE(c.name, t.customer_name) as customer_display` (`tenders.js:368`). | Если справочник `customers` обновили (нашли в Dadata актуальное имя «ООО Ромашка-2026»), карточка/строка v2 продолжают показывать старое `t.customer_name`. На разных страницах CRM (где-то customer_display) и в v2 — **разные имена одного заказчика**. |
| 7 | Vanilla игнорирует `customer_display` в списке                   | `tenders.js:575, 622, 945, 953` (читает только `t.customer_name`) | Тот же `customer_display` доступен только в GET `/:id`, в GET `/` его нет. | Минорно, но в v1 и в funnel.js разная логика: `funnel.js:285` использует `customer_name ‖ customer_display ‖ customer`. В реестре `/tenders` — только `customer_name`. |

---

## 7. 🟡 Подозрения (нужна валидация на прод-БД)

1. **`t.author_user_id` в RBAC-фильтре v2** (`Tenders/index.jsx:231`). Такой колонки нет ни в V001, ни в последующих миграциях. Соответствующее поле — `created_by_user_id` (V049:11) или `created_by` (V001:223). PM-фильтр в OR-цепочке формально включает несуществующий ключ — это «no-op», но если кто-то добавит `WHERE author_user_id=...` в SQL — упадёт.
2. **`t.contract_value`** в CSV (`Tenders/TendersList.jsx:147`). На `tenders` такого поля нет — оно у `works`. В fallback `tender_price ‖ contract_value` всегда выберется `tender_price` (если он есть). Если же `tender_price` NULL — будет показано `undefined`.
3. **`t.kp_sent_at`** записывается через `Tenders/panels/KpReadyPanel.jsx:44` (PUT `/api/tenders/:id` с `kp_sent_at`), но `kp_sent_at` НЕ входит в `allowedCols` в `src/routes/tenders.js:500-507` для PUT — будет молча отброшен. Поле существует в БД (V236:22), но через API не записывается. Проверить, не идёт ли запись через другой роут или триггер.
4. **`source_kind` фильтр на subtab='platforms'** в v2 (`Tenders/index.jsx:222`) — `t.source_kind === 'platform' || 'email_invite'`. На вкладке хаба «📡 Площадки» — но V250-комментарий перечисляет 7 значений включая `pm_manual`/`to_manual`. Если ТО создаёт тендер вручную, `source_kind='to_manual'` → подвкладка «Площадки» его не покажет (хотя его руками тоже надо разобрать). Может быть by-design (платформ-only), но стоит подтвердить.
5. **`pre_tender_requests.status`** в pre_tenders канбане (`pre_tenders.js:640-643`) — 4 колонки: `new, in_review, need_docs, accepted`. Backend hub-feed маппит **9 значений** статуса pre_tender (`tenders-hub.js:229-238`: new, in_review, need_docs, pending_approval, approved, accepted, rejected, pending_payment, paid). Те заявки что в `pending_approval`/`approved`/`pending_payment`/`paid` — **не отображаются** в канбане pre_tenders.js, но появляются в хабе. Скорее всего by-design (часть статусов перешла в тендеры/работы), но рассинхрон есть.
6. **`tender_status='Дозапрос'`** — V250 добавил 9-ю колонку в `pk_v3_column` и в `TENDER_TRANSITIONS` (`tenders.js:19-20`), но `HEAD_TO_TRANSITIONS` (`tenders.js:36-37`) тоже содержит `Дозапрос`. Однако `funnel.js` / прочие могут не знать про этот статус — у `to_calcs.js:82-91` `statusBadge` colors map **не содержит** `Дозапрос` → fallback `#6c757d` (серый). Минорный визуальный рассинхрон.
7. **`won_at` / `lost_at` vs `last_status_change_at`** — какая дата считается «датой победы»? V117 определяет `won_at` (NOW() при POST `/win`), но `last_status_change_at` (V236, триггер `:30-32`) обновляется автоматом при ЛЮБОЙ смене статуса. Если тендер «Выиграли»→«Проиграли»→«Выиграли» — `won_at` сохранит первое значение, `last_status_change_at` — последнее. UI читает только `t.created_at` (для KPI «выиграно за месяц», `Tenders/index.jsx:259`), но это **дата создания**, не победы. KPI «Выиграно за месяц» считает по `created_at`, а должен по `won_at` — **скрытый смысловой баг**, см. отдельной волной.

---

## 8. Сводка

- ВСЕ перечисленные баги — **локальные**, не связаны с миграциями (миграции консистентны).
- 🔴 №1, №2, №3 — данные в v2 **теряются или показываются неверно** при штатной работе.
- 🔴 №4 — фундаментально **ломает /api/tenders-hub/feed** на чистом клоне; на проде, видимо, скомпенсировано ручным `ALTER TABLE tenders ADD COLUMN source` (см. CLAUDE.md про schema-drift).
- 🔴 №5, №6 — silent breakage RBAC/сортировки в v2.
- 🟡 №7 — гипотезы, нужны прод-проверки.

Vanilla v1 в целом строго следует схеме БД, React v2 — нет. Главные точки расхождения сосредоточены в `TenderRow.jsx`, `TendersList.jsx`, `index.jsx`, `TenderEditor.jsx` пакета `public/desktop-v2-src/src/pages/Tenders/`.
