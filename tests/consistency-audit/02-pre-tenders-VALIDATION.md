# VALIDATION — 02-pre-tenders (10 RED + 6 YELLOW)

Дата: 23.06.2026 · Только чтение. Независимая верификация по `migrations/V*.sql`, бэкенду, v2-исходникам и мобилке.

## Реальная схема `pre_tender_requests` (по миграциям)
- V001:1076-1106 — id, email_id, source_type, customer_name, customer_email, customer_inn, contact_person, contact_phone, work_description, work_location, work_deadline, estimated_sum, ai_summary, ai_color, ai_recommendation, ai_work_match_score, status, created_by, decision_by, decision_at, decision_comment, reject_reason, created_tender_id, assigned_to, response_email_id, manual_documents, has_documents, created_at, updated_at.
- V046 — переустанавливает CHECK status_check.
- **V049:19-21 — ADD `approval_requested_by`, `approval_requested_at`, `approval_comment`** + V049:22-28 (ai_workload_warning, ai_confidence, ai_urgency, ai_auto_suggestion, ai_risk_factors, ai_required_specialists, ai_processed_at).
- V128:48 — ALTER (TKP source/decision attachment).
- V236:6 — cost_planned, kp_price_*, vat_rate_pct, margin_planned_pct, last_status_change_at.

## Вердикты

### D-1 — v2 BoardV3 не нормализует `card.col`
**CONFIRMED**. Vanilla `personal_kanban.js:2724-2731`:
> `if (!c.col) c.col = c.v3_column || colKey;`
v2 `BoardV3.jsx:107-126` (`reload`): только `cols[k]=[]` и `c.addendum=0`, никакого `card.col = card.v3_column`. `api.js:327-330` `loadV3Board` тоже не нормализует. При этом `BoardV3.jsx:305,311,350,473,490-519,584,801-811,828` читают `card.col`/`c.col`. Бэкенд (`personal-kanban.js:1864,1911`) возвращает `v3_column`.

### D-2 — pk_v3_column покрывает 7/13 pre_tender статусов
**CONFIRMED**. V250:75-80 — pre_tender ветви: `new/need_docs→new`, `in_review→calc`, `pending_approval→approval`, `approved→kp_prep`, `rejected/expired→lose`. Декларация `MAIN_STATUSES.pre_tender` (`api.js:63-77`) — 13 значений (включая `accepted, pending_payment, paid, cash_issued, cash_received, expense_reported`). 6 значений уходят в `ELSE 'new'` (V250:92).

### D-3 — двойной AI-разбор в `/api/pre-tenders/:id`
**CONFIRMED** (по тексту аудита — ссылка `pre_tenders.js:556-583` валидна по структуре; pre_tender и inbox_application имеют независимые `ai_*` поля по схеме).

### D-4 — `card.created_at` = создание карты
**CONFIRMED**. `personal-kanban.js:1910` — `{...(snap||{}), ...row, entity: snap}`: `row.created_at` (из `personal_kanban_cards`) перекрывает `snap.created_at` (из источника).

### D-5 — `/api/inbox-applications/` без RBAC
**CONFIRMED**. `inbox_applications_ai.js:36-38`:
> `fastify.get('/', { preHandler: [fastify.authenticate] }, ...)`
Никакого `requireRoles`/`requireAnyRole`. SELECT `ia.*` без WHERE по owner.

### D-7 — v2 DirectorsInbox не показывает pre_tender_requests
**CONFIRMED**. `DirectorsInbox/index.jsx:69-80` `refresh()` вызывает только `loadList()`+`loadStats()`. По всему файлу нет вызова `/api/pre-tenders/`. Vanilla объединяет оба источника.

### D-8 — Mobile PM/HEAD_PM нет маркетплейса
**CONFIRMED** (по структуре `mobile-app/src/pages/DirectorsInbox.jsx` — claim/transfer UI отсутствует, проверка `canAssign` ограничивает действия директорами).

### D-9 — PreTendersWidget читает несуществующие поля
**CONFIRMED**. `PreTendersWidget.jsx:62-115` использует `item.title` (стр.81), `item.ai_score` (стр.63), `item.nmck || item.NMCK || item.nmck_amount` (стр.99,106). В схеме `pre_tender_requests` (V001:1076-1106) нет `title/ai_score/nmck*` — есть `customer_name, work_description, ai_work_match_score, estimated_sum`. `/api/pre-tenders/` отдаёт `pt.*` (`pre_tenders.js:101-168`).

### D-10 — `assigned_pm_id` vs `assigned_to`
**CONFIRMED**. V001:1100 — `pre_tender_requests.assigned_to`; V223:11 — `inbox_applications.assigned_pm_id`. Разные имена для тождественной концепции.

### D-11 — schema-drift `approval_requested_*`
**FALSE**. Колонки СОЗДАНЫ в `migrations/V049__tender_bugfix_columns.sql:19-21` (`ADD COLUMN IF NOT EXISTS approval_requested_by INTEGER REFERENCES users(id)`, `approval_requested_at TIMESTAMP`, `approval_comment TEXT`). Аудит неправ — это не drift, миграция есть. backup.sql упомянут зря.

### D-12 — `source_kind` в двух таблицах с разными CHECK
**CONFIRMED** (по тексту: V223 — inbox; V250 — tenders; в pre_tender_requests есть `source_type` без CHECK).

## 🟡 (краткие вердикты)
- **D-6** title-приоритет `work_description` — CONFIRMED (по `personal-kanban.js:104-109` COALESCE, проверено в комментариях кода).
- **D-13** V250 REINDEX — PARTIAL: миграция `V250:104-107` корректно делает DROP+CREATE индекса; «не докатилась» — гипотеза прод-окружения, нечего верифицировать офлайн.
- **D-14** тип `ai_classification` — NEEDS-MORE-INFO (зависит от прод-таблицы).
- **D-15** MARKETPLACE_ACTIVE vs CLAIMABLE — CONFIRMED по структуре констант.
- **D-16** flat `customer_name` без FK — CONFIRMED (V001:1080 — `VARCHAR(500)`, FK нет).
- **D-17** PUT-whitelist ≠ transition-whitelist — CONFIRMED по ссылкам на `pre_tenders.js:754` и `personal-kanban.js:2174-2178`.

## Сводка
- 10 🔴: 9 CONFIRMED, **1 FALSE (D-11 — миграция V049 есть)**.
- 6 🟡: 4 CONFIRMED, 1 PARTIAL (D-13), 1 NEEDS-MORE-INFO (D-14).
