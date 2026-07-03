# 05 — Schema-drift аудит: head_pm_id / city / assigned_pm_id vs assigned_to

Дата: 2026-06-23. Только чтение. Базы и прод не трогались.

---

## 1. head_pm_id — текущее состояние

| file:line | контекст | что делать |
|---|---|---|
| `src/services/correspondence.js:730` | комментарий «`head_pm_id` в схеме works НЕТ — schema-drift убран 23.06.2026» | оставить как есть (исторический комментарий) |
| `src/services/correspondence.js:737` | `BUG-FIX (Works R12)`: `works.head_pm_id` нет в миграциях V001/V050. Фильтр уже использует только `w.pm_id = $idx` | оставить как есть — фикс уже задеплоен |
| `tests/consistency-audit/03-works*.md` | артефакты аудита Wave-1 R12 | не трогать |
| `tests/NIGHT-REPORT.md`, `tests/UNIFIED-DEPLOY-PLAN.md` | отчёт о фиксе | не трогать |

Миграции: **0 совпадений** в `migrations/V*.sql` (grep подтвердил). Колонка `works.head_pm_id` была добавлена ручным `ALTER` на проде → schema-drift. Код-ссылка уже устранена в R12 (commit ~23.06.2026).

**Вывод:** работа по `head_pm_id` ЗАВЕРШЕНА в Wave-1 R12. Code-cleanup не требуется. Опционально — миграция `DROP COLUMN IF EXISTS works.head_pm_id` (V-?), чтобы убрать drift на проде.

---

## 2. city — текущее состояние

### Где `works.city` используется в SQL (backend)
- `src/routes/daily-presence.js:101` (`SELECT … city, object_name FROM works`), `:107` `object_name || city` — **есть fallback**.
- `src/routes/field-logistics.js:597,642,667`, `field-gamification.js:1599,1612,1617`, `field-pm.js:64,65,136,143,192,253`, `field-checkin.js:916`, `field-worker.js:179,287,349,443,739,761`, `field-manage.js:326,359-360`, `mimir.js:1313,1348,1400,1762,2470,2515` — SELECT/чтение, **fallback на `object_name` ОТСУТСТВУЕТ** в большинстве мест.
- `src/routes/works.js:965-981` (`work_meta`) — отдаёт `object_name/city`, fallback решает UI.

### Frontend
- vanilla `public/assets/js/pm_works.js:1047` — `object_name || city || tender_region` (правильная цепочка).
- v2 `WorkDetail.jsx:449` — `w.object_name || w.city || ''` (правильная цепочка).
- v2 `WorkReport/index.jsx:117,236`, `Personnel/EmployeeWorkHistory.jsx:114`, `HrRequests` (vanilla 867) — без fallback, риск пустого «город».

### Миграции
- `works` в `V001__initial_schema.sql:366`: есть `object_name`, **колонки `city` НЕТ**. V050 не добавляет.
- `V058` добавляет `estimates.object_city` (другая таблица), `V235` — `customer_city` (заказчики), `V039` — `dadata_city` (телефония). Это **другие** поля.
- `works.city` на проде существует **через ручной ALTER** (schema-drift, как `head_pm_id`); на чистом клоне колонки нет, но запросы не падают только потому, что `field-*` использует pg_dump-клоны.

### Найдено в Wave-1 (BUG-FIX Sites D-M9 — не задокументирован под этим тегом, но в `03-works.md` обозначен как S8)
- `tests/consistency-audit/03-works.md:286` (S8): «можно убрать `city` из UI fallback» — РЕКОМЕНДАЦИЯ, не выполнена.

**Вывод:** `works.city` — частичный schema-drift (на проде есть, в миграциях нет, в форме PUT не пишется → почти всегда NULL). Чистое решение: добавить fallback `object_name || city` везде где сейчас голый `w.city`.

---

## 3. assigned_pm_id vs assigned_to

| таблица | каноническое поле | подтверждение |
|---|---|---|
| `inbox_applications` | **`assigned_pm_id`** | `schema_dump.sql:6473`, V224, `inbox_applications_ai.js:1151-1165` (UPDATE … WHERE `assigned_pm_id` IS NULL — H3 атомарность) |
| `pre_tender_requests` | **`assigned_to`** | `schema_dump.sql:4702`, FK `pre_tender_requests_assigned_to_fkey → users(id)`, везде `pt.assigned_to` (`pre_tenders.js:128,134,173,325,502,594,1639`, `tenders-hub.js:209,251`, `personal-kanban.js:117,180,1647`, `mimir-tkp-quick.js:529`, `document-generator.js:1441`) |
| `field_packing_lists` | `assigned_to` | FK на employees, `field-packing.js:105-529` |
| `tenders` | `work_assigned_pm_id` | backup строки 10281/35725 (отдельное поле, не путать) |

**Расхождение:** в `src/services/correspondence.js:732,744` — фильтр идёт по `pt.assigned_pm_id`, **такой колонки в `pre_tender_requests` НЕТ** (канон — `assigned_to`). Это второй schema-drift в том же файле, рядом с уже-исправленным `head_pm_id`. На проде НЕ падает, потому что код доходит сюда только при `parentType === 'pre_tender'`, который маршрут вызывает редко.

---

## Что надо сделать (NEW)

1. **`src/services/correspondence.js:744`** — заменить `pt.assigned_pm_id` → `pt.assigned_to`. **Чисто кодовая правка**, миграция не нужна. Это аналог R12 для pre_tender.
2. **`works.city` без fallback** — в SQL-запросах `field-logistics.js`, `field-pm.js`, `field-worker.js`, `field-checkin.js`, `field-gamification.js`, `mimir.js` добавить `COALESCE(w.object_name, w.city) AS place` (или хотя бы там, где результат показывается пользователю). Frontend v2 `WorkReport`, `EmployeeWorkHistory`, `HrRequests` — fallback `w.object_name || w.city`.
3. **(Опционально) Миграция `V???__drop_schema_drift_columns.sql`**: `ALTER TABLE works DROP COLUMN IF EXISTS head_pm_id;`. По `works.city` — НЕ дропать (используется в чтении, может содержать данные).
4. `inbox_applications.assigned_pm_id` — канон подтверждён, действий не требуется.

---

## Безопасность (миграция vs код)

- Правка `correspondence.js:744` — **чисто кодовая**, без миграции.
- Fallback `object_name||city` — **чисто кодовая**.
- Drop `head_pm_id` — **миграция**, требует backup + ручной ALTER на проде (но это дрейф, никто не пишет в неё).
- Никаких массовых UPDATE данных не нужно.

---

## Риски

- Замена `pt.assigned_pm_id → pt.assigned_to`: PM-фильтр в correspondence для pre_tender начнёт реально работать — PM могут увидеть письма pre_tender, которых раньше не видели. Это правильное поведение, но регрессия видимости — проверить RBAC-тестом.
- COALESCE в `field-*` запросах: если фронт уже умеет fallback, ничего не сломается; если фронт читает строго `r.city`, то после COALESCE значение перестанет быть NULL → может изменить визуальное поведение «пусто/город».
- DROP `head_pm_id` на проде: безопасно, в коде ссылок нет (R12 уже снял), но требует snapshot перед миграцией (см. `feedback-never-reset-prod-to-origin`).
- Любая правка `correspondence.js` тестируется на клоне `asgard_crm_test` (pg_dump прода), не на чистой схеме — иначе схема-drift колонки не видна.

---

Слов: ~390.
