# Аудит консистентности — Карта · Объекты (sites) · Big Screen · Custom Dashboard

Дата: 2026-06-23. Только чтение. Цель — найти расхождения между БД, vanilla и React v2 по
модулям /command-map, /object-map, /big-screen, /dashboard, /my-dashboard.

---

## 1. Схема БД

### Таблица `sites` (migrations/V001__initial_schema.sql:185-202)
```
id            SERIAL PK
name          VARCHAR(500) NOT NULL
short_name    VARCHAR(255)
lat, lng      NUMERIC
region        VARCHAR(255)
site_type     VARCHAR(100) DEFAULT 'object'
customer_id   VARCHAR(12)            -- ИНН заказчика, НЕ FK к customers.id
customer_name VARCHAR(500)
address       TEXT
description   TEXT
geocode_status VARCHAR(50) DEFAULT 'pending'
photo_url     VARCHAR(1000)
created_at, updated_at TIMESTAMP
```

🔴 **В sites НЕТ колонки `created_by`** (migrations/V001__initial_schema.sql:185-202).
Промпт задачи спрашивал «id, name, lat, lng, address, customer_id, created_by» — `created_by`
не существует. POST /api/sites (src/routes/sites.js:64-79) тоже её не вставляет.

### works.site_id ↔ sites.id (works.js:14-17)
- `works.site_id INTEGER` (без FK declaration в V001) — связь работы с объектом.
- `works.object_name VARCHAR` — текстовое название места (свободный текст).
- Обе колонки заполняются параллельно через `ensureSiteByPlace` (src/routes/works.js:193-308)
  и `attach-place` (src/routes/works.js:443-493) с COALESCE(NULLIF(object_name,''), $place).

---

## 2. Endpoints (backend)

### /api/sites (src/routes/sites.js)
- `GET  /` — все объекты с агрегатами (works_count, tenders_count, active_works);
  sort `updated_at DESC`. ACTIVE_WORKS = `('В работе','Мобилизация','Подготовка','На паузе','Подписание акта')` (sites.js:25).
- `GET  /:id` — один объект + works + tenders.
- `POST /` — RBAC `ADMIN/PM/HEAD_PM/DIRECTOR_GEN` (sites.js:65). НЕ ставит `created_by`.
- `PUT  /:id` — allowedFields БЕЗ created_by (sites.js:90-91).
- `DELETE /:id` — только ADMIN.
- `POST /geocode` — Nominatim прокси (без API-ключа).

### /api/command-map (src/routes/command-map.js)
RBAC: `ADMIN, DIRECTOR_GEN/COMM/DEV, HEAD_PM, HEAD_TO` (command-map.js:12).
- `GET /` — sites (LIMIT 500) + active works + crew counts + on_shift today. Гард 0/0 lat/lng
  → null (command-map.js:96-98).
- `GET /flights` — `field_logistics` типов ticket_to/back/flight/train/transfer за ±7 дней.
- `GET /medical` — `field_trip_stages` stage_type='medical'.
- `GET /site/:id/crew` — экипаж объекта поимённо со статусом (medical>waiting>transit>warehouse>home>site).
- `GET /readiness` — «дружина дома» (employees.readiness_status, не на активной работе).
- `GET /live` — кто где сегодня (users + staff_plan + active_calls + presence-activity + SSE online).
- `GET /worker/:id` — полная карточка рабочего.
- `GET /office-user/:id` — полная карточка офисного сотрудника + role-specific KPI.

❌ **Endpoint `/api/command-map/live`, упомянутый в промпте «какие колонки + агрегации» —
   это НЕ карта sites**, а live-сводка офиса по users/staff_plan (command-map.js:368-447).
   Колонок sites там нет вообще.

---

## 3. Vanilla фронт

### public/assets/js/command-map.js (374 строк)
- Источники: `/api/command-map`, `/api/command-map/flights`, `/api/director-summary`,
  `/api/command-map/live` (command-map.js:273-283).
- Рендер карты — PIXI (CDN из index.html). Фолбэк-карточки, если нет PIXI/гео.
- Site emoji: platform→🛢, plant→🏭, иначе→🏗 (command-map.js:139,146).

### public/assets/js/object_map.js (~664 строк)
- Leaflet + OpenStreetMap + MarkerCluster.
- SITE_TYPES: `platform, terminal, refinery, port, plant, office, object` (object_map.js:519-525).
- `getSiteStatus` — pending/active/tender/done/unknown (object_map.js:26-32).

### public/assets/js/big_screen.js (772 строки)
- 9 слайдов, ротация 60с, refresh 5мин.
- Данные: AsgardDB.getAll(tenders/works/users/employees/cash/permits/permit_types) + API
  `/api/pre-tenders/stats`, `/api/equipment/balance-value`, `/api/works/analytics/team`,
  `/api/work-readiness/summary?ids=`.
- PREP_STATUSES для слайда «Подготовка» — inline literal `['Новая','Подготовка','Мобилизация']`
  (big_screen.js:354,394).
- CLOSED_WORK Set — 15 вариантов (big_screen.js:21-26).

### public/assets/js/custom_dashboard.js
- `PREP_SET = new Set(['Новая','Подготовка','Мобилизация'])` (custom_dashboard.js:368).
- `_isPrep(w) = PREP_SET.has(w.work_status)` (custom_dashboard.js:383) — **только статус**,
  start_in_work_date НЕ используется (комментарий 382 явно подтверждает фикс из памяти).
- `_isClosedWork` — толерантный (trim+lower), 15 вариантов (custom_dashboard.js:374-381).

### public/assets/js/dashboard.js
- ALLOWED: `ADMIN, DIRECTOR_COMM/GEN/DEV, DIRECTOR` (dashboard.js:31) — есть устаревшая роль
  `'DIRECTOR'` без суффикса (см. 🟡 ниже).
- Год работы: `start_fact || start_plan || start_in_work_date || created_at` (dashboard.js:89,154).

---

## 4. React v2

### public/desktop-v2-src/src/pages/CommandMap/
- `api.js` — обёртки cmapMap/cmapFlights/cmapLive/cmapSummary/cmapMedical/cmapPresenceBoard.
- `MapStage.jsx` — SVG-карта (заменяет PIXI). `SITE_EMOJI = { platform:🛢, plant:🏭, other:🏗 }`
  (MapStage.jsx:25). 5 site_type из 7 (terminal/refinery/port/office) сваливаются в «other».
- `PixiStage.jsx` — реализация с PIXI (если подгружен). site emoji: platform/plant/иначе
  (PixiStage.jsx:146).
- `index.jsx` — 5 секций: карта · live · рейсы · сводка · объекты. Использует PixiStage
  (line 124) по умолчанию.

### public/desktop-v2-src/src/pages/BigScreen/index.jsx
- Endpoints: `/api/tenders?limit=2000` (НЕ 1000 как vanilla), `/api/works?limit=2000`,
  `/api/users?limit=500`, `/api/data/employees|cash_requests|permits|permit_types`,
  `/api/pre-tenders/stats`, `/api/equipment/balance-value`, `/api/works/analytics/team`,
  `/api/work-readiness/summary?ids=`.
- CLOSED_WORK Set одинаков с vanilla (BigScreen/index.jsx:31-36).
- PREP filter — inline literal `['Новая','Подготовка','Мобилизация']` (BigScreen/index.jsx:119,431).
- Год работы: `start_fact || start_plan || start_in_work_date || created_at` (BigScreen/index.jsx:292,323).

### public/desktop-v2-src/src/pages/ObjectMap/index.jsx
- Leaflet+OSM. SITE_TYPES: 7 типов как vanilla (ObjectMap/index.jsx:72-80).
- VIEW_ROLES + WRITE_ROLES inline (ObjectMap/index.jsx:42-48) — паритет с backend sites.js.
- `getSiteStatus` зеркало vanilla (ObjectMap/index.jsx:82-88).

### public/desktop-v2-src/src/pages/Dashboard.jsx
- DONE_SET 15 вариантов (Dashboard.jsx:9-15), isDone толерантный.
- Год работы: `start_fact || start_plan || start_in_work_date` БЕЗ created_at fallback
  (Dashboard.jsx:102,146,401) **в отличие от** vanilla dashboard.js:89,154 (которые тоже
  без created_at, **но в filter добавлен `!w.tender_id && !d && w.created_at` fallback**
  dashboard.js:95). v2 Dashboard.jsx:108 имеет тот же fallback → паритет ок.

### public/desktop-v2-src/src/pages/MyDashboard/index.jsx
- ALLOWED полный список (MyDashboard/index.jsx:35).
- `PREP_SET = new Set(['Новая','Подготовка','Мобилизация'])` (MyDashboard/index.jsx:63) — паритет.

### public/desktop-v2-src/src/pages/Readiness/api.js
- `PREP_STATUSES = new Set(['Новая','Подготовка','Мобилизация'])` (Readiness/api.js:16).
- `isPrep(workStatus)` — Readiness/api.js:31-32 — паритет с vanilla.

### public/desktop-v2-src/src/pages/PmWorks/api.js
- `PREP_STATUSES = ['Новая','Подготовка','Мобилизация']` массив (PmWorks/api.js:38) — паритет
  по содержанию, но **тип отличается** (Array vs Set в Readiness) — это безопасно, оба
  поддерживают `.includes()`/`.has()`.

---

## 5. 🔴 Расхождения

### 🔴 D-M1. Промпт ссылается на несуществующее поле `sites.created_by`
- БД схема (migrations/V001__initial_schema.sql:185-202) **не содержит** `created_by`.
- src/routes/sites.js:67,99 не пишет/не отдаёт `created_by`.
- v2 ObjectMap (ObjectMap/index.jsx) и vanilla object_map.js поле не показывают.
- **Вывод:** атрибут `created_by` в реальности отсутствует. Если нужен (для audit-trail),
  это отдельная фича — миграция + изменение POST + UI.

### 🔴 D-M2. v2 CommandMap/MapStage.jsx обрабатывает только 2 из 7 site_type
- MapStage.jsx:25: `SITE_EMOJI = { platform: '🛢', plant: '🏭', other: '🏗' }`.
- PixiStage.jsx:146: тот же подход.
- БД допускает `terminal/refinery/port/office/object` (sites.js POST принимает любое).
- vanilla object_map.js знает все 7 (object_map.js:519-525) и v2 ObjectMap/index.jsx:72-80
  тоже все 7, но именно карта команд (CommandMap) сваливает 5 типов в эмодзи 🏗.
- **Эффект:** Морская платформа и НПЗ выглядят одинаково на /command-map.
  Не влияет на данные, только на визуал.

### 🔴 D-M3. vanilla `/dashboard` использует устаревшую роль `'DIRECTOR'` без суффикса
- public/assets/js/dashboard.js:31: `["ADMIN","DIRECTOR_COMM","DIRECTOR_GEN","DIRECTOR_DEV","DIRECTOR"]`.
- На проде `users.role` для директоров — `DIRECTOR_GEN/COMM/DEV`, плоский `DIRECTOR` не
  выдаётся (см. backend; роли в settings.js — нет такой).
- В v2 Dashboard.jsx нет такого ALLOWED (раздел открыт через router, без role check).
- **Эффект:** мёртвая ветка, никого не пускает по `'DIRECTOR'` и никого не отрезает.
  Косметика, но порождает confusion.

### 🔴 D-M4. v2 ObjectMap отдельная страница, vanilla имеет 2 разные карты
- vanilla: `/command-map` (PIXI, экипаж, live) + `/object-map` (Leaflet, CRUD объектов).
- v2: `/command-map` (PixiStage + SVG-fallback) + `/object-map` (Leaflet).
  Файлы: `public/desktop-v2-src/src/pages/CommandMap/index.jsx`,
        `public/desktop-v2-src/src/pages/ObjectMap/index.jsx`.
- Паритет по числу страниц есть. **НО** v2 не имеет страницы Dashboard для директоров —
  есть `public/desktop-v2-src/src/pages/Dashboard.jsx` без папки и без RBAC-гейта внутри
  компонента (для сравнения vanilla:31 отрезает не-директоров). RBAC у v2 теперь только
  через router → если маршрут открыт для всех, виджеты будут грузиться при 403.

### 🔴 D-M5. BigScreen — vanilla читает через AsgardDB.getAll, v2 — через /api/* limit=2000
- vanilla big_screen.js:323-331 — IDB-кэш (AsgardDB.getAll).
- v2 BigScreen/index.jsx:97-107 — `/api/tenders?limit=2000` напрямую.
- vanilla dashboard.js:54: `limit=1000`. v2 Dashboard.jsx:81-83: `limit=2000`. v2 видит больше
  записей.
- **Эффект:** на проде с >1000 работ vanilla big-screen покажет урезанные данные из IDB
  (если IDB sync отстал — еще и устаревшие). v2 — точные свежие.

---

## 6. 🟡 Подозрения

### 🟡 D-M6. v2 CommandMap index.jsx default = PixiStage, MapStage остаётся в репо но не используется
- CommandMap/index.jsx:124 импортирует и рендерит `PixiStage` (а не `MapStage`).
- MapStage.jsx (с SVG-fallback) фактически dead-code на /command-map.
- Если PIXI не загрузится (CDN заблокирован), v2 покажет пустой блок (PixiStage не делает
  SVG-fallback внутри себя — нужно проверить отдельно). Проверять рендер на проде.

### 🟡 D-M7. /api/command-map/live и /api/command-map/medical — RBAC для HEAD_PM/HEAD_TO
- backend command-map.js:12 MAP_ROLES включает HEAD_PM/HEAD_TO.
- v2 CommandMap api.js:4 ALLOWED_ROLES — те же 6 ролей.
- vanilla command-map.js не делает client-side role-check (полагается на 401/403).
- v2 делает (CommandMap/index.jsx:67-72 — редирект на /home при non-allowed).
- **Эффект:** PM/TO/BUH в vanilla попадают на страницу и видят пустой стейдж, в v2 — toast
  «Раздел для директоров» + редирект. Поведенческая разница, не data-bug.

### 🟡 D-M8. Big Screen vanilla допускает роль `HEAD_TO`, slidePM фильтрует pm_id из works
- big_screen.js:48 ALLOWED включает HEAD_TO.
- BigScreen/index.jsx:27 ALLOWED тот же. Паритет.
- slidePM собирает «руководителей проектов»: pmRoles `{PM,HEAD_PM,DIRECTOR_DEV,DIRECTOR_GEN,
  CHIEF_ENGINEER,HR}` (big_screen.js:561, BigScreen/index.jsx:487). HEAD_TO видит, но НЕ в
  списке. HR/CHIEF_ENGINEER считаются «РП» только если на них висит хотя бы одна работа
  (pmIds set). Безобидно, но смешивает технических владельцев с настоящими РП.

### 🟡 D-M9. `works.object_name` vs `sites.name` — двойной источник, нет единого UI-правила
- attach-place (works.js:472-478): сохраняет ОБА — site_id + object_name=COALESCE(NULLIF(object_name,''), place).
- ensureSiteByPlace (works.js:193-208): объект может прийти из тендера/родителя, тогда
  object_name тянется отдельно.
- Vanilla pm_works.js, all_works.js, work_report.js используют `w.object_name` или
  `w.customer_name` в большинстве мест — НЕ присоединяют `sites.name`.
- В CommandMap / map endpoints (command-map.js GET /:131) JOIN `sites` → отдаёт `s.name`.
- **Расхождение:** на /command-map и /object-map в карточке объекта показывается
  `sites.name`. В /pm-works/<id> карточке работы — `works.object_name`. Если РП после
  attach-place отредактирует name объекта в /object-map, в карточке работы останется
  старое object_name (snapshot времени привязки). Это by design в backend, но UI нигде
  не предупреждает.

### 🟡 D-M10. PREP_STATUSES определён в 4 местах
- backend: `src/routes/work-readiness.js:267` + неявно в `command-map.js:13` ACTIVE_STATUSES.
- vanilla: big_screen.js:354, custom_dashboard.js:368, pm_works.js:155.
- v2: BigScreen/index.jsx:119,431, MyDashboard/index.jsx:63, Readiness/api.js:16, PmWorks/api.js:38.
- Все 7 точек определяют ОДИНАКОВЫЙ литерал `['Новая','Подготовка','Мобилизация']` →
  паритет ОК, но fragile: добавление статуса (например, «Заморожена») потребует 7 правок.

### 🟡 D-M11. CLOSED_WORK Set определён в 3+ местах
- big_screen.js:21-26 (15 вариантов).
- custom_dashboard.js:374-381.
- BigScreen/index.jsx:31-36, MyDashboard/index.jsx:56-62, Dashboard.jsx:9-15.
- Содержимое идентично. Тот же риск дрейфа. backend (src/helpers/work-status.js — упомянут
  в комменте big_screen.js:18) — отдельная истина 8-я.

### 🟡 D-M12. ACTIVE_STATUSES в sites.js и command-map.js
- sites.js:25: `('В работе','Мобилизация','Подготовка','На паузе','Подписание акта')` — 5 шт.
- command-map.js:13 ACTIVE_STATUSES: те же 5. Паритет ок.
- reports.js:471, hints.js:404 — те же 5. Все backend-таблицы синхронны.

### 🟡 D-M13. v2 CommandMap не показывает site.short_name
- backend command-map.js:24,100 возвращает `short_name`.
- v2 PixiStage.jsx:150 рендерит `site.name || ('Объект #' + site.id)`. short_name игнор.
- vanilla command-map.js — то же поведение.
- **Эффект:** длинные названия объектов на карте обрезаются. short_name заведено в БД,
  но фронт не использует. Если короткие имена нужны — тривиальная правка `site.short_name || site.name`.

### 🟡 D-M14. Vanilla big_screen использует `start_in_work_date` в filter
- big_screen.js:443,472 — `start_fact || start_plan || start_in_work_date || created_at`.
- Память отмечает что start_in_work_date на проде почти не заполняется → fallback на
  created_at компенсирует. v2 BigScreen/index.jsx:292,323 идентично. Паритет ок, риск
  по-прежнему: год работы определяется по created_at если ни одна из трёх дат не задана.

---

## 7. Готовность для big-screen — паритет `is_prep`

| Источник | Файл:строка | Определение | Совпадает? |
|---|---|---|---|
| Backend истина | src/routes/work-readiness.js:197-200 | `PREP_STATUSES.includes(work.work_status)` — **только статус** | ✅ canonical |
| Backend `in_prep` | work-readiness.js:249 | `inPrep` из 197 | ✅ |
| Vanilla big_screen | big_screen.js:354,394 | inline `['Новая','Подготовка','Мобилизация'].includes(w.work_status)` | ✅ |
| Vanilla custom_dashboard `_isPrep` | custom_dashboard.js:383 | `PREP_SET.has(w.work_status\|\|'')` | ✅ |
| Vanilla pm_works `isPrepWork` | pm_works.js:155-156 | только статус (комментарий 155) | ✅ |
| v2 BigScreen | BigScreen/index.jsx:119,431 | inline `['Новая','Подготовка','Мобилизация'].includes(w.work_status)` | ✅ |
| v2 Readiness `isPrep` | Readiness/api.js:31-32 | `PREP_STATUSES.has(workStatus\|\|'')` | ✅ |
| v2 PmWorks `isPrepWork` | PmWorks/api.js:51-52 | `PREP_STATUSES.includes(work?.work_status)` | ✅ |
| v2 MyDashboard PREP_SET | MyDashboard/index.jsx:63 | `new Set([...])` | ✅ |

**ИТОГ:** is_prep корректно использует **только work_status**, нигде start_in_work_date
не используется как признак подготовки. Память подтверждается — фикс 07.06.2026 закреплён
в обоих фронтах.

---

## 8. Custom Dashboard — какие виджеты и источники

(public/assets/js/custom_dashboard.js — vanilla; v2-аналог `public/desktop-v2-src/src/pages/MyDashboard/index.jsx`)

| Виджет | Vanilla file:line | Backend endpoint | v2 паритет |
|---|---|---|---|
| Мои проекты (готовность) | custom_dashboard.js:430 `renderMyReadiness` | `/api/work-readiness/summary?ids=`, `/api/works/:id/financial-summary` | MyDashboard/index.jsx readiness state (73) |
| Готовность по РП (директор) | custom_dashboard.js:532 `renderDirectorReadiness` | `/api/work-readiness/summary?ids=` | ⚠️ В v2 MyDashboard нет — есть отдельная страница `/readiness-board` (Readiness/ReadinessBoardPage.jsx) |
| Drawer этапов | custom_dashboard.js:496 `openReadinessDrawer` | `/api/work-readiness/:id`, POST/DELETE override | v2 Readiness/index.jsx drawer |
| Последние звонки | (recentCalls state в v2) | `/api/telephony/calls?limit=5` | MyDashboard/index.jsx:74 |
| Мой кассовый баланс | | `/api/cash/my-balance` | MyDashboard/index.jsx:75 |
| Мои задачи | | `/api/tasks/todo` | MyDashboard/index.jsx:76 |
| Заявки ТО (PreTenders) | | `/api/pre-tenders/stats` | MyDashboard/index.jsx:77 |
| Почта-стат | | `/api/my-mail/stats` | MyDashboard/index.jsx:78 |
| Академия | | `/api/office-academy/lessons` | MyDashboard/index.jsx:79 |

🟡 **Виджет «Готовность по РП»** для директора в vanilla лежит на /custom-dashboard
(custom_dashboard.js:532), а в v2 вынесен на отдельный URL /readiness-board. Если кто-то из
директоров ищет его на дашборде — может не найти.

---

## 9. Big Screen — паритет слайдов

| # | Слайд | vanilla big_screen.js | v2 BigScreen/index.jsx | Паритет |
|---|---|---|---|---|
| 1 | KPI Overview | slideKPI (440) | slideKPI (288) | ✅ |
| 2 | Финансы | slideFinance (471) | slideFinance (321) | ✅ |
| 3 | Воронка тендеров | slideFunnel (506) | slideFunnel (361) | ✅ |
| 4 | **Подготовка проектов** | slidePreparation (391) | slidePreparation (428) | ✅ |
| 5 | PM Performance | slidePM (560) | slidePM (486+) | ✅ |
| 6 | Active Works | slideActiveWorks (595) | (есть) | ✅ |
| 7 | Overdue | slideOverdue (628) | (есть) | ✅ |
| 8 | Team & Permits | slideTeamAndPermits (666) | (есть) | ✅ |
| 9 | Pre-Tenders & Equipment | slidePreTendersAndEquipment (728) | (есть) | ✅ |

Источник истины для виджетов: tenders/works/users — `AsgardDB.getAll` (vanilla) или
`/api/{tenders,works,users}?limit=2000` (v2). Готовность — `/api/work-readiness/summary?ids=`.
Pre-tenders — `/api/pre-tenders/stats`. Активы — `/api/equipment/balance-value`.
Звонки/кадры — отдельные endpoints, доступны только REPORT_ROLES.

---

## ИТОГ

- **🔴 5 расхождений** (D-M1…D-M5). Самые материальные:
  - D-M1 несуществующее поле `sites.created_by` (промпт vs реальность).
  - D-M2 v2 CommandMap MapStage/PixiStage знают 2 из 7 site_type (косметика).
  - D-M5 vanilla big-screen лимит 1000 vs v2 — 2000; vanilla читает из IDB-кэша.
- **🟡 9 подозрений** (D-M6…D-M14). Все — fragile patterns / mild UX, не data-corruption.
- **`is_prep` паритет 8/8** — все 8 точек используют ТОЛЬКО `work_status` ∈
  `{Новая, Подготовка, Мобилизация}`. Память «не использовать start_in_work_date как признак»
  соблюдена.
- **`object_name` vs `sites.name`** — backend сохраняет ОБА, UI карты смотрит на sites.name,
  карточка работы — на object_name. Snapshot времени привязки сохраняется в works.
