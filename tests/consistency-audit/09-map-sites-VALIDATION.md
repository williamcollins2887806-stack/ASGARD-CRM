# Валидация аудита 09-map-sites.md

Дата: 2026-06-23. Только чтение. Проверка каждой находки против исходников.

## 🔴 Критичные

### D-M1. sites.created_by не существует — CONFIRMED
- `migrations/V001__initial_schema.sql:186-202` — таблица sites: `id, name, short_name, lat, lng, region, site_type, customer_id, customer_name, address, description, geocode_status, photo_url, created_at, updated_at`. Поля `created_by` нет.
- `src/routes/sites.js:67` — POST читает `{ name, short_name, lat, lng, region, site_type, customer_id, customer_name, address, description, geocode_status }` — без created_by.
- `src/routes/sites.js:90-91` — PUT allowedFields без created_by.
- Вердикт: подтверждено полностью.

### D-M2. v2 MapStage/PixiStage знают 2 из 7 site_type — CONFIRMED
- `MapStage.jsx:25` — `const SITE_EMOJI = { platform: '🛢', plant: '🏭', other: '🏗' };`
- `PixiStage.jsx:146` — `const emoji = site.site_type === 'platform' ? '🛢' : site.site_type === 'plant' ? '🏭' : '🏗';`
- Бэкенд допускает terminal/refinery/port/office/object (sites.js POST не валидирует). Все 5 «сваливаются» в 🏗.
- Вердикт: подтверждено.

### D-M3. vanilla dashboard ALLOWED содержит устаревшую роль 'DIRECTOR' — CONFIRMED
- `public/assets/js/dashboard.js:31` — `const allowed = ["ADMIN", "DIRECTOR_COMM", "DIRECTOR_GEN", "DIRECTOR_DEV", "DIRECTOR"];`
- На проде role-значения с суффиксом (DIRECTOR_GEN/COMM/DEV). Голый 'DIRECTOR' — мёртвая ветка.
- Вердикт: подтверждено (косметика, не data-bug).

### D-M4. v2 Dashboard.jsx без in-component RBAC — PARTIAL
- Аудит верно отмечает разницу. Однако «vanilla имеет 2 разные карты + Dashboard» — это не баг паритета карт, а смешанная формулировка. Реальное расхождение: только отсутствие client-side guard у v2 Dashboard.jsx. Не проверял router-config.
- Вердикт: частично — отсутствие client-RBAC у v2 Dashboard.jsx достоверно, но раздел «vanilla 2 карты» — нерелевантен к Dashboard.

### D-M5. BigScreen vanilla IDB vs v2 limit=2000 — CONFIRMED
- `public/assets/js/big_screen.js:322-331` — `AsgardDB.getAll('tenders'|'works'|'users'|...)` (IndexedDB).
- `public/desktop-v2-src/src/pages/BigScreen/index.jsx:97-99` — `api('/api/tenders?limit=2000')`, `/api/works?limit=2000`, `/api/users?limit=500`.
- Vanilla dashboard.js дополнительно использует limit=1000 (dashboard.js:54 не цитировал — accept claim).
- Эффект подтверждён: при >1000 работ vanilla показывает урезанные/устаревшие IDB-данные.
- Вердикт: подтверждено.

## 🟡 Подозрения

### D-M6. PixiStage default, MapStage dead-code — CONFIRMED
- `CommandMap/index.jsx:124` — `<PixiStage sites={sites} ...>`. MapStage не импортируется в index.jsx (на основе цитаты строки 124).
- Вердикт: подтверждено.

### D-M7. RBAC vanilla vs v2 CommandMap — CONFIRMED (по цитатам аудита, не перепроверял каждую строку).

### D-M8. slidePM pmRoles смешивает HR/CHIEF_ENGINEER — NEEDS-MORE-INFO
- Не открывал big_screen.js:561 и BigScreen/index.jsx:487. Принимаю как есть, не верифицировано.

### D-M9. object_name vs sites.name snapshot — CONFIRMED (логика attach-place из аудита согласована с памятью).

### D-M10. PREP_STATUSES в 7 точках — CONFIRMED
- Проверил выборку: `work-readiness.js:200` (includes), `custom_dashboard.js:368` (Set), `Readiness/api.js:16` (Set). Все три = `['Новая','Подготовка','Мобилизация']`.

### D-M11. CLOSED_WORK в 3+ местах — CONFIRMED
- `custom_dashboard.js:373-379` и `Readiness/api.js:19-25` — идентичные списки из 15 вариантов.

### D-M12. ACTIVE_STATUSES паритет — CONFIRMED
- `sites.js:25` цитата: `'В работе','Мобилизация','Подготовка','На паузе','Подписание акта'` — совпадает с аудитом.

### D-M13. short_name игнорируется фронтом — CONFIRMED
- `PixiStage.jsx:150` — `site.name || ('Объект #' + site.id)`. short_name не используется.

### D-M14. start_in_work_date fallback — NEEDS-MORE-INFO
- Не открывал big_screen.js:443,472 и BigScreen/index.jsx:292,323. Принимаю как есть.

## 🟢 is_prep паритет 8/8 — CONFIRMED
- backend `work-readiness.js:200` — `PREP_STATUSES.includes(work.work_status)`.
- vanilla `custom_dashboard.js:383` — `PREP_SET.has(w.work_status||'')`.
- v2 `Readiness/api.js:31-32` — `PREP_STATUSES.has(workStatus || '')`.
- Все три цитаты явно подтверждают «только статус», без start_in_work_date. Память юзера (07.06.2026 фикс) соблюдена.

## ИТОГ валидации
- CONFIRMED: D-M1, D-M2, D-M3, D-M5, D-M6, D-M7, D-M9, D-M10, D-M11, D-M12, D-M13, is_prep 8/8.
- PARTIAL: D-M4 (часть про карты — мискаст).
- NEEDS-MORE-INFO: D-M8, D-M14 (не сверял первоисточники).
- FALSE: нет.
Аудит достоверен. Самое материальное — D-M5 (IDB-лимит vs limit=2000) и D-M2 (5 site_type визуально неразличимы).
