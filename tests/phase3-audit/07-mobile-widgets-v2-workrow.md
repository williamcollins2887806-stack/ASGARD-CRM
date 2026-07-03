# 07. Mobile widgets + v2 WorkRow/WorkDetail — точечные правки

Сессия аудита: 23.06.2026. Только чтение.

## Часть А. Mobile widgets

### 📋 Что есть (33 виджета в реестре)

Все в `public/mobile-app/src/widgets/`, реестр — `index.js:34-66`.

| Виджет | file:line | Роль (из реестра) |
| --- | --- | --- |
| WelcomeWidget | `WelcomeWidget.jsx` (idx:35) | `*` |
| QuickActionsWidget | `QuickActionsWidget.jsx` (idx:36) | `*` |
| TodoWidget | `TodoWidget.jsx` (idx:37) | `*` |
| ApprovalsWidget | `ApprovalsWidget.jsx` (idx:38) | ADMIN/HEAD_PM/DIRECTOR_* |
| BankSummary, CashBalance, MoneySummary, MyCashBalance, ExpenseWallet, PayrollPending | финансовый блок (idx:39,42,47,48,53,63) | BUH/DIR/PM |
| BirthdaysWidget | (idx:40) | `*` |
| CalendarWidget | (idx:41) | `*` |
| EquipmentAlerts/EquipmentValue | склад/ТМЦ (idx:43,44) | ENG/WAREHOUSE |
| GanttMiniWidget | `GanttMiniWidget.jsx` (idx:45) — ближайшие дедлайны | PM/HEAD_PM/DIR |
| KpiSummary, MyWorks, OverdueWorks, TeamWorkload | работы (idx:46,50,52,58) | PM/DIR |
| MyMail, Notifications | коммуникации (idx:49,51) | `*` |
| PermitsExpiry | (idx:54) | HR/HEAD_TO |
| PlatformAlerts, PreTenders, TenderDynamics, TendersFunnel, CallAnalytics | тендеры (idx:55,56,60,61,62) | TO/HEAD_TO/DIR |
| ReceiptScannerWidget | (idx:57) | PM |
| TelephonyWidget | (idx:59) | mix |
| AcademyWidget | (idx:64) | `*` |
| DirectorApprovalsWidget | (idx:65) | DIR_* |

Главный экран — `public/mobile-app/src/pages/Home.jsx:22` (`Home`) собирает виджеты через `WIDGET_REGISTRY` + `getLayout(role)` + `roleMatch`.

### 🆕 Что добавить

1. **Фотовиджет «📸 Последние фото с объектов» (PM/HEAD_PM/DIR)**
   - Vanilla эталона **в pm_works/dashboard НЕТ** (Grep по `Последние фото`/`recent_photo` пусто).
   - Источник данных уже есть на бэке: `src/routes/field-photos.js:307` `GET /api/field/photos/crm/:work_id` (PM/HEAD_PM/DIR/ADMIN). Возвращает `{photos:[{id,filename,photo_type,taken_at,author_name,url}], LIMIT 500, ORDER BY created_at DESC}`.
   - Для виджета нужен новый эндпоинт-агрегат `GET /api/field/photos/recent?limit=12` (свежие по всем работам РП). Сейчас отдельного `/recent` нет — это новая ручка.
   - Параллель: `public/mobile-app/src/pages/field/FieldPhotos.jsx:561` уже умеет рендерить превью `url || /api/field/photos/:id/thumb` — реюз стилей.

2. **«Скоро дедлайн» виджет — УЖЕ ЕСТЬ**
   - `GanttMiniWidget.jsx:16-91` — сортировка по `end_plan ≥ now`, цвет по `getDeadlineColor(days)`. Vanilla эталон: `custom_dashboard.js:1063` `renderGanttMini` (та же логика, top-6). Дублировать НЕ нужно.
   - Дозаписать: бейдж «<7 дней» (vanilla `custom_dashboard.js:1079` уже считает `days`).

## Часть Б. v2 WorkRow / WorkDetail — точечные правки

### Wave-1 уже закрыто (НЕ дублировать)
- `WorkRow.jsx:47-50` — **R1**: канон цепочки дат `start_plan → start_in_work_date → start_date → start_fact`.
- `WorkDetail.jsx:221-225` — **R3**: та же цепочка для KPI `duration`.
- `WorkDetail.jsx:424` — **R4**: цепочка в fallback-отображении дат.
- `WorkDetail.jsx:587` — **R2**: MiniGantt стартует от `start_plan`.

### Осталось точечно (TODO/gotoLegacy)

`WorkDetail.jsx:69-79` функция `gotoLegacy` уводит в vanilla. Маршруты вне `V2_NATIVE_ROUTES`:

| Кнопка | Линия | Vanilla эталон |
| --- | --- | --- |
| 🔍 Осмотр объекта | `:270` `gotoLegacy('object-map')` | vanilla `object-map.js` |
| 📈 Фин. отчёт | `:274` `gotoLegacy('work-report')` | в V2_NATIVE — теперь hash-роутинг, проверить страницу |
| 📊 Ведомость | `:281` `gotoLegacy('payroll-sheet')` | vanilla `payroll-sheet.js` |
| 📅 Гантт | `:287`,`:580` `gotoLegacy('gantt-works')` | vanilla `gantt.js`/`gantt_full.js` |
| 🛒 Закупки | `:315` `gotoLegacy('my-procurement')` | в V2_NATIVE — проверить |
| 📨 HR-requests (replace/question/create) | `:338,343,658,664` | vanilla `hr-requests.js` |
| 🔄 Переназначить РП | `:353` `gotoLegacy('pm-works', {reassign})` | vanilla `pm_works.js` модалка reassign |

Ни одного `TODO`/`FIXME` в `WorkRow.jsx`/`WorkDetail.jsx` — кодовая дисциплина чистая, только `gotoLegacy`. Фолбэки в `gotoLegacy:74` уже корректные (`console.warn` + `toast.warn`), точечно — добавить реальный 1:1 для object-map (frequent click) и hr-requests (модалка inline а не уход в vanilla).

### 🔗 API контракт
- `GET /api/works?...` (список) — пишет `start_plan/end_plan/end_fact/work_status` (works.js).
- `PUT /api/works/:id` — payload из `updateWork(w)` (`api.js`): 8 фин. полей + `crew_size` + `delay_workdays`.
- `POST /api/works/:id/attach-place` (`:128`) — баннер-сирота.
- `GET /api/work-readiness/:workId` — кольцо готовности (используется в `ReadyMini`).
- `GET /api/field/photos/crm/:work_id` — для будущего фотовиджета.

### ⚠ Риски
1. **НЕ трогать цепочку дат** — `start_plan → start_in_work_date → ...` уже закрыто R1-R4, повторная правка сломает MiniGantt.
2. **НЕ удалять `gotoLegacy`** — он — реальный фолбэк на работающую vanilla, заменять только при готовой v2-странице (после чего добавить в `V2_NATIVE_ROUTES`).
3. Фотовиджет требует **новой ручки `/recent`** — текущая `/crm/:work_id` не агрегирует все работы юзера.
4. **`GanttMiniWidget` уже есть** — добавление «скоро дедлайн» = риск дублирования, делать только мелкие фичи (бейдж <7 дн).
