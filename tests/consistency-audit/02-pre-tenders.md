# Аудит консистентности — модуль ЗАЯВКИ / PreTenders / PersonalKanban

Дата: 23.06.2026 · Только чтение, без правки кода. Прод-БД недоступна — схема
выведена из `migrations/V*.sql`.

ВАЖНО: **таблицы `pre_tenders` НЕ существует** — фронт ТЗ и реальный код
работают с **`pre_tender_requests`** (V001). Также НЕТ полей `customer_id`,
`ai_warnings`, `tz_gaps`, `mimir_status`, `work_proposal_flag`, `head_pm_id`,
`pm_id`, `pos_x`, `pos_y` — это формулировка задачи, не реальная схема.
Реальные поля приведены ниже.

────────────────────────────────────────────────────────────────────────
## 1. СХЕМА БД (источник правды)

### 1.1 `pre_tender_requests` (V001:1076-1106 + V236 + V223-V250-неучтённые ALTERы)
Поля по миграциям:
- `id` SERIAL PK
- `email_id` INT (без FK в V001 — отличие от V001:1078)
- `source_type` VARCHAR(50) — `phone|meeting|email|referral|website|manual|other`
  (валидируется только в `src/routes/pre_tenders.js:656`)
- `customer_name` VARCHAR(500) (**плоское поле**, НЕ FK на `customers`)
- `customer_email`, `customer_inn`, `contact_person`, `contact_phone`,
  `work_description`, `work_location`, `work_deadline`, `estimated_sum`
- `ai_summary`, `ai_color` (gray|green|yellow|red, дефолт `'gray'`),
  `ai_recommendation`, `ai_work_match_score` NUMERIC
- `status` VARCHAR(50) DEFAULT `'new'` — V046 (CHECK на pre_tender)
- `created_by`, `decision_by`, `decision_at`, `decision_comment`, `reject_reason`
- `created_tender_id` INT FK → tenders
- `assigned_to` INT FK → users  ← **ЕДИНСТВЕННОЕ поле владения; никакого `pm_id` нет**
- `response_email_id`, `manual_documents` JSONB, `has_documents` BOOL
- `created_at`, `updated_at`
- **V236 ADD:** `cost_planned`, `kp_price_without_vat`, `kp_price_with_vat`,
  `vat_rate_pct`, `margin_planned_pct`, `last_status_change_at`
- **V250 не трогает pre_tender_requests.source_kind** — это поле есть только
  в `tenders` и в `inbox_applications`! См. далее 🔴.
- **Schema-drift (только в проде, миграции НЕТ):** `approval_requested_by`,
  `approval_requested_at`, `approval_comment` — backend `personal-kanban.js:2284-2290`
  и `:2316` пишет/читает их, но в репо `migrations/V*.sql` они не созданы
  (есть только в `backup_pre_kanban_20260617-0941.sql:8086-8088`). Это типичная
  ручная ALTER-операция на проде без commited миграции.

#### CHECK status (V046)
По комментарию `personal-kanban.js:38` — есть CHECK; разрешённые значения
(см. константу `CANONICAL_MAIN_STATUSES.pre_tender`,
`src/routes/personal-kanban.js:51-55`):
```
new, in_review, need_docs, accepted, rejected, expired,
pending_approval, approved, pending_payment, paid,
cash_issued, cash_received, expense_reported
```

### 1.2 `inbox_applications` (V001:1026-1058 + V223 + V235)
- `id`, `email_id` → emails(id), `source` VARCHAR(100), `source_email`,
  `source_name`, `subject`, `body_preview`, `attachment_count`
- `status` VARCHAR(50) — CHECK обновлён V223:31:
  `new | ai_processed | under_review | assigned | accepted | rejected | archived`
- `ai_classification` VARCHAR(100) — текстовое (8 значений из AI prompt:
  `direct_request | platform_tender | tender_invitation | addendum_response |
  commercial_offer | information | spam | personal | other` —
  `src/services/ai-email-analyzer.js:221`). В imap.js:418-454 пишется через
  cast `::jsonb` ИЛИ как text — self-healing helper. То есть тип столбца
  на проде может быть text ИЛИ jsonb.
- `ai_color` VARCHAR(50) — `green|yellow|red` (red также для spam) +
  бывает NULL/gray.
- `ai_summary`, `ai_recommendation`, `ai_work_type`, `ai_estimated_budget`,
  `ai_estimated_days`, `ai_keywords` TEXT[], `ai_confidence` NUMERIC,
  `ai_raw_json` JSONB, `ai_analyzed_at`, `ai_model`, `workload_snapshot` JSONB,
  `ai_report`
- `decision_by`, `decision_at`, `decision_notes`, `rejection_reason`,
  `linked_tender_id`, `created_at`, `updated_at`
- **V223 ADD:** `assigned_pm_id` INT FK → users (NB: называется иначе чем в
  pre_tender_requests — `assigned_to`! см. 🔴 далее),
  `assigned_by`, `assigned_at`, `forwarded_by_user_id`, `forwarded_from_email`,
  `source_kind` TEXT NOT NULL DEFAULT `'unknown'` — CHECK:
  `unknown | corporate_forward | external_direct | platform | manual`,
  `needs_review` BOOL, `original_sender_email`, `original_sender_name`
- **V235 ADD:** `customer_inn`, `customer_name`, `contact_person`,
  `contact_phone`, `customer_email`, `customer_city`, `customer_address`
- **V224** — UNIQUE constraint на (email_id) WHERE NOT NULL (дедуп).

### 1.3 `personal_kanban_cards` (V221:55-71)
- `id`, `owner_user_id` (FK users) — кто видит карту в своём канбане
- `flow_type` TEXT — CHECK: `application | tender | pre_tender | work`
- `entity_kind` TEXT — CHECK: `inbox_application | tender | pre_tender | work`
- `entity_id` INT — ссылка на сущность в её таблице (NB: НЕ FK с CASCADE)
- `current_main_status` TEXT — синхронизируется с источником через
  side-effect в `/cards/:id/transition` (`src/routes/personal-kanban.js:2162-2184`)
- `current_substage_id` (FK kanban_substages SET NULL),
  `transferred_from_user_id`, `transferred_prev_substage_label`,
  `transferred_at`, `last_moved_at`, `is_closed` BOOL, `version` INT,
  `created_at`, `updated_at`
- **UNIQUE** `(owner_user_id, entity_kind, entity_id)` — `uq_pk_cards_owner_entity`
- **`v3_column` НЕ хранится** — это computed через `pk_v3_column(flow_type,
  current_main_status)` функцию V238 + V250, доступно через VIEW
  `v_unified_kanban_cards`.

### 1.4 9-колоночный канбан — функция `pk_v3_column` (V250)
(точная копия из миграции V250:69-94)

| flow_type    | main_status                                  | v3_column |
|--------------|----------------------------------------------|-----------|
| application  | new, ai_processed, under_review, assigned    | new       |
| application  | accepted                                      | calc      |
| application  | rejected, archived                            | lose      |
| pre_tender   | new, need_docs                                | new       |
| pre_tender   | in_review                                     | calc      |
| pre_tender   | pending_approval                              | approval  |
| pre_tender   | approved                                      | kp_prep   |
| pre_tender   | rejected, expired                             | lose      |
| tender       | Черновик, Новый, На анализе                   | new       |
| tender       | Отправлено на просчёт, Согласование ТКП       | calc      |
| tender       | ТКП согласовано                               | approval  |
| tender       | Готово к отправке КП                          | kp_prep   |
| tender       | КП отправлено                                 | sent      |
| tender       | Дозапрос                                      | addendum (V250 9-я колонка) |
| tender       | Выиграли                                       | win       |
| tender       | Проиграли, Не подходит                        | lose      |
| work         | (любой)                                       | work      |
| ELSE         | —                                             | new       |

NB: для **pre_tender** статусы `accepted, pending_payment, paid, cash_issued,
cash_received, expense_reported` НЕ покрыты функцией → попадают в `'new'`
по ELSE (`personal-kanban.js:1911`). См. 🔴 D-2.

────────────────────────────────────────────────────────────────────────
## 2. BACKEND endpoints — что отдают

### 2.1 `GET /api/pre-tenders/` (`pre_tenders.js:101-168`)
- SELECT `pt.*` + LEFT JOIN emails (subject/from_*/email_date) + JOIN users
  (decision_by_name, assigned_to_name)
- Поля карточки — все `pt.*` ПЛЮС `email_*`, плюс `assigned_to_name`.
- Фильтры: status, ai_color, search (по customer_name/work_description/
  customer_email/e.subject), sort, order, limit/offset, **`unassigned=1`**
  (маркетплейс) + автоматический ASC.
- RBAC: PM/TO видят `assigned_to=user.id OR created_by=user.id`;
  директорские роли — без фильтра (`:119-125`).
- По умолчанию исключает `status='expired'` (`:131-133`). NB:
  **`rejected` НЕ исключён** — попадает в выдачу.

### 2.2 `GET /api/pre-tenders/:id` (`pre_tenders.js:547-611`)
- SELECT `pt.*` + email_* + LEFT JOIN inbox_applications (та же email_id)
  с алиасами `ia.ai_*` → `ia_ai_color`, `ia_ai_recommendation`, `ia_ai_summary`,
  плюс `ia.ai_report as full_ai_report`. То есть UI может смотреть НА ДВЕ копии
  AI-разбора (см. 🔴 D-3).
- Возвращает `{item, attachments, thread}`.

### 2.3 `GET /api/personal-kanban/board` (`personal-kanban.js:1859-1923`)
- SELECT из VIEW `v_unified_kanban_cards`, в каждую строку добавляется
  `v3_column` (computed), `substage_*`, `owner_name`, `code` ('#'||id).
- Полиморфный snapshot через `loadEntitySnapshotsBatch` → сплющивается:
  `const card = { ...(snap || {}), ...row, entity: snap }`
  (NB: `row` ПОБЕЖДАЕТ по конфликтным ключам, включая `id` и `entity_id`,
  см. комментарий `personal-kanban.js:1899-1904`).
  В частности — `card.status` (из snap) перекрывается `card.is_closed`/
  `row.entity_id` (нет одноимённых), но **`card.created_at` берётся из
  `personal_kanban_cards` (момент создания карты)**, а не из источника.
  ← см. 🔴 D-4.
- Группировка по 9 колонкам `{new, calc, approval, kp_prep, sent, addendum,
  win, lose, work}` (`:1906`). Колонка определяется через `row.v3_column`
  computed-функцией pk_v3_column, в ответе свойство называется `v3_column`.

### 2.4 `GET /api/inbox-applications/` (`inbox_applications_ai.js:36-76`)
- Возвращает `ia.*` + decision_by_name + created_by_name + `e.body_text`
  как `email_body_text`.
- Фильтр: `status`, `color` (=ai_color), `classification` (=ai_classification),
  search, sort, order.
- **БЕЗ RBAC-фильтра!** `preHandler:[fastify.authenticate]` — любой
  залогиненный (PM, кладовщик, бригадир) увидит ВСЕ заявки.
  См. 🔴 D-5.

────────────────────────────────────────────────────────────────────────
## 3. VANILLA FRONT (`public/assets/js/`)

### 3.1 `personal_kanban.js` (8235 LOC)
- Получает board → нормализует поле колонки:
  `:2724-2731` — backend отдаёт `card.v3_column`, vanilla дублирует в
  `card.col` (без этого ломались `_tkpStatus`, drag-checks, action-bar).
- Использует `card.col` повсюду для гейтов колонок (`:3230-3232` и т.д.).
- `card.current_main_status` читается только в фильтрах по подэтапам
  (`:691`, `:730`, `:965`, `:1304`).
- Drag → `POST /cards/:id/transition` с `to_v3_column` (`:2931`).
- `personal_kanban.js:6831,7609` — Quick / Conductor сами PATCH'ат
  карту в `approval` с `to_v3_column:'approval', confirm:true` —
  это обходит порог 50М₽ и проверку наличия ТКП в backend?
  Не обходит — backend всё равно проверит (`:2080-2104`), но фронт
  сам не предупреждает юзера до клика.

### 3.2 `director_inbox.js` (892 LOC)
- Один экран для двух режимов: `director` и `marketplace`
  (PM/HEAD_PM, `:14-16`).
- **Объединяет на одной странице 2 списка**: inbox_applications
  (через `/api/inbox-applications/`) + pre_tender_requests (через
  `/api/pre-tenders/`). Бакеты:
  - `new` → inbox статусы `{new, ai_processed, under_review}` +
    pt статусы `{new, in_review, need_docs}`
  - `working` → inbox `{assigned, accepted}` + pt `{pending_approval,
    approved, accepted}`
  - `archive` → inbox `{rejected, archived}` + pt `{rejected, expired}`
- В режиме `marketplace` тянет `/api/pre-tenders/?unassigned=1` FIFO ASC.

────────────────────────────────────────────────────────────────────────
## 4. REACT v2 (`public/desktop-v2-src/src/pages/`)

### 4.1 `PersonalKanban/BoardV3.jsx`
- Читает поле `card.col` (`:305`, `:311`, `:350`, `:473`, `:490-519`,
  `:584-585`, `:801-811`, `:828`). ← **Эта норма требует, что backend
  отдаёт `card.col`. На самом деле он отдаёт `v3_column`.** См. 🔴 D-1.
- Vanilla обходит баг patch'ем (`:2727-2731`), React v2 — НЕТ
  (см. `BoardV3.jsx:1-150` — никакой нормализации после `loadV3Board`).
- В `Card.jsx:11` использует `ent.title || `#${card.entity_id}`` —
  для inbox_application title = `subject AS title`, для pre_tender =
  `COALESCE(work_description, work_location, customer_name, '#'+id) AS title`
  (`personal-kanban.js:104-109`). То есть title pre_tender берётся НЕ из
  `customer_name` в первую очередь, а из `work_description` — UX-расхождение
  с vanilla, см. 🟡 D-6.

### 4.2 `DirectorsInbox/index.jsx`
- **Не объединяет inbox + pre_tender в один список** (в отличие от
  vanilla `director_inbox.js:127-150`). Показывает только
  `inbox_applications` через `loadList()` (`api.js:53-62`).
- Marketplace экран — ОТДЕЛЬНЫЙ `MarketplaceList.jsx`. См. 🔴 D-7.
- Бакет `unassigned` (`:45`) — `!it.assigned_pm_id && status in {new,
  ai_processed}` (не учитывает `under_review` без PM в отличие от vanilla).

### 4.3 `PersonalKanban/api.js`
- `MAIN_STATUSES.application` (`:42-49`) — 7 значений совпадает с CHECK
  inbox_applications (V223).
- `MAIN_STATUSES.pre_tender` (`:64-77`) — **13 значений**, включая
  `pending_payment, paid, cash_issued, cash_received, expense_reported` —
  но они НЕ покрыты `pk_v3_column` (V250) и попадают в `new` по ELSE
  на v3 канбане. См. 🔴 D-2.

────────────────────────────────────────────────────────────────────────
## 5. MOBILE (`public/mobile-app/src/`)

### 5.1 `pages/DirectorsInbox.jsx`
- Поддерживает ТОЛЬКО директорский режим — фильтры `{new, in_work,
  archive}` (`:28-32`), `canAssign` для ADMIN/DIRECTOR_*/HEAD_PM (`:73`).
- **PM/HEAD_PM на мобилке НЕ видят маркетплейс заявок** — отдельной
  страницы / режима нет.
  См. 🔴 D-8.
- Карточка показывает `item.ai_color, item.source_kind, item.ai_summary,
  item.ai_confidence, item.assigned_pm_id, item.needs_review,
  item.original_sender_email, item.forwarded_from_email` — всё это поля
  inbox_applications.

### 5.2 `widgets/PreTendersWidget.jsx`
- Фильтрует `r.status === 'new' || r.status === 'in_review'`,
  показывает top-3 (`:21-25`).
- **Использует поля, которых нет в `pre_tender_requests`:**
  `item.title` (есть только в backend-snapshot через personal-kanban
  endpoint — `/api/pre-tenders/` его НЕ отдаёт!), `item.ai_score`
  (правильно `ai_work_match_score`), `item.nmck/item.NMCK/item.nmck_amount`
  (нет таких полей вообще — есть `estimated_sum`). См. 🔴 D-9.

────────────────────────────────────────────────────────────────────────
## 🔴 РАСХОЖДЕНИЯ (доказанные)

### D-1: v2 BoardV3 читает `card.col`, backend отдаёт `card.v3_column` — БЕЗ НОРМАЛИЗАЦИИ
- Vanilla v1 нормализует:
  `public/assets/js/personal_kanban.js:2724-2731` —
  `if (!c.col) c.col = c.v3_column || colKey`
  и затем использует `card.col` повсеместно.
- v2: `public/desktop-v2-src/src/pages/PersonalKanban/BoardV3.jsx`
  использует `card.col` (`:305, 311, 350, 473, 490-519, 584-585, 801-811,
  828`), но в `:107-126` (функция `reload`) **никогда** не делает
  `card.col = card.v3_column`. В `api.js:327-330` `loadV3Board` тоже
  не нормализует.
- Эффект: в v2 канбане для всех карт `card.col === undefined`, поэтому
  все ветки `else if (card.col === 'calc')…` падают на default — секция
  ТКП заблокирована, кнопки контекста не показываются, бейджи
  win/lose/addendum не подсвечиваются.

### D-2: pre_tender статусы `accepted/pending_payment/paid/cash_*/expense_reported` НЕ маппятся в pk_v3_column
- `personal-kanban.js:CANONICAL_MAIN_STATUSES.pre_tender` (`:51-55`)
  объявляет 13 значений; они же продублированы в v2 `api.js:64-77`.
- Но `pk_v3_column` (V250:69-94) маппит только 7: `new/need_docs →new,
  in_review→calc, pending_approval→approval, approved→kp_prep,
  rejected/expired→lose`. Остальные 6 → `ELSE 'new'`.
- При этом backend `personal-kanban.js:1911` дополнительно фильтрует:
  `V3_COLUMNS.includes(row.v3_column) ? row.v3_column : 'new'`. Т.е. в
  колонке «Новые» висят оплаченные/прошедшие заявки. Юзер видит
  pre_tender со status='paid' в колонке «📥 Новые». 🔴

### D-3: дубль AI-разбора в `GET /api/pre-tenders/:id`
- `pre_tenders.js:556-583` — JOIN на `inbox_applications ia ON
  ia.email_id = pt.email_id` и возвращает ОДНОВРЕМЕННО `pt.ai_color,
  ai_summary, ai_recommendation` И `ia_ai_color, ia_ai_summary,
  ia_ai_recommendation, full_ai_report` от inbox_applications.
- Если письмо повторно AI-проанализировано (imap.js перезаписал
  inbox_applications.ai_*), а pre_tender_requests.ai_* остались
  старыми — UI покажет ДВЕ разные классификации.
- Vanilla v1 и v2 могут смотреть в разные поля (vanilla
  `personal_kanban.js:584` смотрит на `card.color` ← из personal-kanban
  snapshot pre_tender → `pt.ai_color`; директорский inbox в vanilla
  `director_inbox.js:172` тоже на `pt.ai_color`. Drawer pre-tender'а в
  модалке деталей может прочитать `ia_ai_color` отдельно).

### D-4: `card.created_at` в канбане — это создание КАРТЫ, не заявки
- `personal-kanban.js:1910` — `{ ...(snap || {}), ...row, entity: snap }`
  → `row.created_at` (из personal_kanban_cards) перекрывает `snap.created_at`
  (из pre_tender_requests). Поэтому fmtDate в Card.jsx будет показывать
  «когда карту положили в канбан», а не «когда заявка пришла». Vanilla
  `personal_kanban.js:1798-1872` использует тот же SELECT.
- Юзер увидит, что заявка от 23 июня, но в канбане она «появилась» 1 июня
  (когда PM забрал из маркетплейса). Метрики «дней в воронке» = days_since_card,
  не days_since_application.

### D-5: `GET /api/inbox-applications/` БЕЗ RBAC
- `inbox_applications_ai.js:36-38` — `preHandler: [fastify.authenticate]`,
  без `requireRoles`. Любой залогиненный пользователь (бригадир, кладовщик)
  может вытащить все 200 заявок через `/api/inbox-applications/?limit=200`.
- Для контраста: `/api/pre-tenders/` (`pre_tenders.js:101-103`) имеет
  `requireRoles(ALLOWED_ROLES)` + WHERE по `assigned_to=user.id OR
  created_by=user.id` для не-директоров.

### D-7: v2 DirectorsInbox показывает только inbox_applications, vanilla — ОБА списка
- Vanilla `director_inbox.js:114-151` параллельно тянет `/inbox-applications/`
  И `/pre-tenders/` для бакетов new/working/archive.
- v2 `DirectorsInbox/index.jsx:69-80` — только `loadList()` →
  `api('/api/inbox-applications/...')` (`api.js:53-62`).
- Эффект: директор в v2 не видит pre_tender_requests со status
  `pending_approval/approved/expired/accepted` на этой странице. Они есть
  только в личном канбане assigned PM или в общем pre-tenders list.

### D-8: PM/HEAD_PM на мобилке не имеют маркетплейса
- Desktop vanilla `director_inbox.js:14-16` — `PM_ROLES = ['PM','HEAD_PM']`,
  `_mode = 'marketplace'` для них.
- Desktop v2 `DirectorsInbox/api.js:114-118` — `inferModeFromRole` →
  marketplace для PM/HEAD_PM.
- Mobile `DirectorsInbox.jsx:73` — `canAssign` для директоров, иначе
  страница недоступна для действий. Marketplace-UI (claim/transfer/my-stats)
  на мобилке **отсутствует целиком**. PM на телефоне не сможет забрать
  заявку из маркетплейса.

### D-9: PreTendersWidget читает несуществующие поля
- `mobile-app/src/widgets/PreTendersWidget.jsx:62-115`:
  - `item.title` — `/api/pre-tenders/` не возвращает `title`; есть
    `customer_name, work_description, work_location`. (computed `title`
    есть только в `loadEntitySnapshotsBatch` через `/api/personal-kanban/board`.)
  - `item.ai_score` — нет такого поля; есть `ai_work_match_score`.
  - `item.nmck / item.NMCK / item.nmck_amount` — нет; есть `estimated_sum`.
- Итог виджет всегда показывает только статус-фильтр, но без названия
  заказчика, без AI-бейджа и без суммы.

### D-10: `inbox_applications.assigned_pm_id` vs `pre_tender_requests.assigned_to` — разные имена для одной концепции
- `inbox_applications.assigned_pm_id` (V223:11)
- `pre_tender_requests.assigned_to` (V001:1100)
- Все handlers вынуждены делать switch по `entity_kind` (`pre_tenders.js`
  для одной, `inbox_applications_ai.js:1141` для другой). Любой код,
  забывший один из двух кейсов, ломает консистентность владения.

### D-11: schema-drift `pre_tender_requests.approval_requested_by/_at/_comment`
- `personal-kanban.js:2284-2290` (UPDATE) и косвенно `:2316-2342`
  (notify): используют поля, которых **нет в `migrations/V*.sql`**.
- Найдены только в `backup_pre_kanban_20260617-0941.sql:8086-8088`
  (т.е. ALTER на проде, не в commited миграции).
- Эффект: при пересоздании БД с чистых миграций (тесты, dev) переход
  pre_tender→approval упадёт на `UPDATE pre_tender_requests SET
  approval_requested_by=$1 …` — column does not exist 42703. Прод выживает
  только потому, что ручной ALTER когда-то был сделан.

### D-12: `source_kind` существует в ДВУХ таблицах с разными CHECK
- `inbox_applications.source_kind` (V223:23) — `unknown | corporate_forward
  | external_direct | platform | manual`.
- `tenders.source_kind` (V250:42-50) — `manual | platform | email_invite
  | email_request | phone | pm_manual | to_manual`.
- В `pre_tender_requests` поля `source_kind` нет — у него есть `source_type`
  (V001:1079) без CHECK.
- UI/директорский экран (vanilla `director_inbox.js:43-49`) знает ТОЛЬКО
  inbox-вариант. Если в pre_tender (созданный из email_request тендера)
  захотят рендерить тот же бейдж — `source_kind` будет `undefined`.

────────────────────────────────────────────────────────────────────────
## 🟡 ПОДОЗРЕНИЯ (нужна проверка на проде)

### D-6: title pre_tender карты — `work_description` приоритетнее `customer_name`
- `personal-kanban.js:104-109` — COALESCE порядок:
  `work_description → work_location → customer_name → '#id'`.
- Vanilla канбан показывает `card.title` (work_description) как заголовок;
  v2 `Card.jsx:10-11` так же.
- Если PM ввёл длинное work_description («очистка резервуара РВС-5000 в
  Когалыме…») и короткий customer_name («ЛУКОЙЛ»), карта в канбане
  отображает работу, но в списке `/api/pre-tenders/` (vanilla
  `personal_kanban.js:1304`) — customer_name. UX-непаритет: одна и та же
  заявка по-разному называется в личном канбане и в директорском inbox.

### D-13: V250 поменял `pk_v3_column` без `REINDEX` на старых клонах
- V250:104-107 делает DROP+CREATE индекса `idx_pk_cards_v3_column`, но
  если на проде индекс уже стейл (старая копия V238 кэша значений) и
  миграция не докатилась — карты со status='Дозапрос' не находятся
  через WHERE pk_v3_column(...) = 'addendum' и не попадают в колонку
  `addendum` board'а. Vanilla `:2733-2736` пытается это компенсировать:
  `if (typeof _counts.addendum !== 'number') _counts.addendum = 0` —
  graceful fallback.
- v2 BoardV3 (`:118-120`) делает то же: `if (typeof c.addendum !== 'number')
  c.addendum = 0`.

### D-14: `inbox_applications.ai_classification` — тип непредсказуем
- `imap.js:418-454` (self-healing) пишет либо `::jsonb`, либо текст в
  зависимости от типа колонки на проде. Vanilla `director_inbox.js`
  читает как string (`item.ai_classification` в `:288`); v2
  `DirectorsInboxIndex.jsx:288` — то же.
- Если на проде где-то столбец jsonb, значение приходит как
  `"\"tender_invitation\""` (с экранированными кавычками) — UI покажет
  `· "tender_invitation"` со скобками.

### D-15: фильтр маркетплейса — `MARKETPLACE_ACTIVE_STATUSES` ≠ `MARKETPLACE_CLAIMABLE_STATUSES`
- `pre_tenders.js:27-28` — active = `[new, in_review, need_docs,
  pending_approval, approved, sent, kp_prep]`; claimable = `[new, in_review,
  need_docs]`.
- `kp_prep` и `sent` — это **v3-колонки, а не main_status pre_tender'а**!
  В CHECK pre_tender_requests.status таких значений нет.
- Лимит «5 активных» по факту никогда не учитывает kp_prep/sent → они
  считаются как 0, не блокируют claim. Возможно, костыль для поддержки
  смешанной воронки.

### D-16: `customer_name` нигде не нормализуется к таблице `customers`
- Все три таблицы (inbox_applications, pre_tender_requests, tenders, works)
  имеют ПЛОСКОЕ `customer_name` + `customer_inn` (V235). FK на `customers`
  не существует — только soft-link через INN.
- При переименовании клиента в `customers` (admin переименовал) —
  pre_tender_requests.customer_name НЕ обновится. UI покажет старое имя.
- Хотя в `pre_tenders.js:1703-1710` (при создании тендера) есть
  `INSERT INTO customers (inn, name) ... ON CONFLICT DO NOTHING` —
  это создаёт строку, но не подменяет имя.

### D-17: vanilla кнопка PUT pre_tender.status ограничена 3 значениями
- `pre_tenders.js:754` — `if (request.body.status && ['new','in_review',
  'need_docs'].includes(request.body.status))` — только эти разрешены через
  PUT.
- UPDATE через `personal-kanban /transition` ходит через
  `:2174-2178`: `UPDATE pre_tender_requests SET status = $1` — БЕЗ
  whitelist в transition-роуте. То есть transition может выставить
  `pending_approval/approved/rejected/expired` (которые в PUT запрещены).
- Несоответствие: фронт PUT-формы (drawer) ≠ drag-and-drop через канбан.

────────────────────────────────────────────────────────────────────────
## Резюме (10 главных)

| # | Серьёзность | Симптом | Где |
|---|-------------|---------|-----|
| D-1 | 🔴 BLOCKER | v2 канбан полностью без подсветки колонок и кнопок | `BoardV3.jsx` всё ещё ждёт `card.col`; нормализации нет |
| D-2 | 🔴 | pre_tender со статусом `paid/cash_*/expense_reported` → колонка «Новые» | `pk_v3_column` V250 покрывает 7/13 |
| D-3 | 🔴 | Двойной AI-разбор в GET /api/pre-tenders/:id (pt + ia_) | `pre_tenders.js:556-583` |
| D-4 | 🔴 | `card.created_at` = создание карты, не заявки | `personal-kanban.js:1910` |
| D-5 | 🔴 | `/api/inbox-applications/` без RBAC | `inbox_applications_ai.js:36-38` |
| D-7 | 🔴 | v2 DirectorsInbox не показывает pre_tender'ы | `DirectorsInbox/index.jsx:69-80` |
| D-8 | 🔴 | Mobile PM/HEAD_PM нет marketplace | `mobile-app/src/pages/DirectorsInbox.jsx` |
| D-9 | 🔴 | PreTendersWidget читает несуществующие поля | `mobile-app/src/widgets/PreTendersWidget.jsx:62-115` |
| D-10 | 🔴 | `assigned_pm_id` vs `assigned_to` — разные имена | inbox vs pre_tender |
| D-11 | 🔴 | `approval_requested_*` есть на проде, нет в migrations/ | schema-drift |

Полный список расхождений выше + 🟡 D-6/13/14/15/16/17 для последующей проверки.
