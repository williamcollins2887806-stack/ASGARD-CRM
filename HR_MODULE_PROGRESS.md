# HR Module v2 — Журнал прогресса
Последнее обновление: 2026-06-04 ~18:10 UTC
Сервер: 92.242.61.184 | Ветка: mobile-v3

---

## СЕССИЯ 1: Миграции + Backend

### Миграции
- [x] V141 worker_readiness — OK (readiness_status, readiness_date, readiness_reason, readiness_comment, readiness_updated_at, readiness_updated_by, last_pm_id, last_work_id + worker_readiness_log)
- [x] V142 staff_requests_v2 — OK (work_description, work_conditions, hr_user_id, taken_at, sent_to_pm_at, approved_at, added_to_crew_at, is_additional, parent_request_id, status_v2 + staff_request_positions + staff_request_assignments)
- [x] V143 worker_finance_fields — OK (is_self_employed, can_exceed_limit, is_officially_employed, official_salary, official_non_burnable, official_hire_date, official_status, official_leave_from/to + chk_employment_mode + official_salary_log + se_transfers)
- [x] V144 work_requirements_training — OK (worker_training таблица)
- [x] V145 checkin_types_extension — OK (settings: self_employed_monthly_limit=350000, self_employed_yearly_limit=2400000)

### Backend routes
- [x] worker-readiness.js — создан, зарегистрирован в index.js (prefix: /api/staff/readiness)
- [x] staff-requests-v2.js — создан, зарегистрирован в index.js (prefix: /api/staff-requests)
- [x] global-timesheet.js — создан, зарегистрирован в index.js (prefix: /api/timesheet)
- [x] payroll-dashboard.js — создан, зарегистрирован в index.js (prefix: /api/payroll-dashboard)
- [x] training.js — создан, зарегистрирован в index.js (prefix: /api/training)
- [x] field-worker.js — расширен (GET/PUT /readiness, GET /readiness/can-update)
- [x] admin-system.js — расширен (GET/PUT /settings/tariffs, GET/PUT /settings/finance-limits)

### Smoke тесты (HTTP статусы) — тест-БД asgard_crm_test, порт 3001
- GET /api/staff/readiness → 200 ✅
- GET /api/staff-requests/pending → 200 ✅
- GET /api/timesheet/global/2026/6 → 200 ✅
- GET /api/payroll-dashboard/summary/2026/6 → 200 ✅
- GET /api/payroll-dashboard/pm-balance → 200 ✅
- GET /api/training/pending → 200 ✅

### Примеры ответов
- staff/readiness: 534 рабочих, группировка по статусу, документы, лимиты СЗ
- payroll-dashboard/summary: year=2026, month=6, monthly_limit=350000, yearly_limit=2400000, total_earned=208500, by_mode={self_employed:4, official:0, cash:8}
- training/pending: [] (пусто — нет назначенных обучений)

### Git
- [x] commit 1: bf677c1 feat(hr-v2): сессия 1 — миграции V141-V145 + 5 API роутов
- [x] commit 2: 21a5eaf fix(hr-v2): employee_permits.valid_to → expiry_date

### Исправленные проблемы
1. **employee_permits.valid_to → expiry_date** — колонка в employee_permits называется `expiry_date`, не `valid_to`. Исправлено в worker-readiness.js (SELECT) и training.js (INSERT).
2. **psql -h localhost** — на сервере peer auth не работает для пользователя asgard, нужен TCP через `-h localhost`.
3. **CREATE DATABASE** — пользователь asgard не имеет CREATEDB, нужен `sudo -u postgres psql`.
4. **run.js DB_NAME** — миграционный раннер использует `DB_NAME` (не `PGDATABASE`).
5. **run.js vs psql** — run.js пытается запустить V002 (не в таблице migrations), поэтому миграции V141-V145 применены напрямую через psql.

### Тест-БД
- asgard_crm_test создана через pg_dump от asgard_crm
- 50 пользователей, 76+5=81 миграций
- Тест-сервер на порту 3001 — работает корректно
- Тест-сервер остановлен после верификации

### Известные проблемы / что не сделано
- Боевой сервер НЕ рестартован с новым кодом (только git pull, без restart)
- Миграции V141-V145 НЕ применены на боевой БД (только на тест-БД)
- Финальный деплой на прод — задача Сессии 3

---

## СЕССИЯ 2: Desktop Frontend

### Файлы — Desktop
- [x] personnel.js — переписан (группировка по 5 статусам, индикаторы документов, лимит СЗ, модалка статуса)
- [x] hr_requests.js — переписан (PM: draft save + 3 кнопки, HR: split-screen подбор, назначение сразу в DB)
- [x] global_timesheet.js — создан (таблица рабочие×дни, цветные ячейки, sticky, Excel export, auto-refresh 10s)
- [x] payroll_dashboard.js — создан (4 карточки, операции СЗ, agreement_transfer, годовые лимиты)
- [x] official_employees.js — создан (таблица, смена режима СЗ↔Офф, редактирование оклада)
- [x] training_board.js — создан (таблица обучения, загрузка сертификатов, завершение)
- [x] pm_balance.js — создан (список РП + детальная /:pm_id раскладка)
- [x] app.js — добавлены 5 маршрутов + 5 navItems в группу "personnel" + pm-balance/:pm_id
- [x] index.html — добавлены 5 script тегов (global_timesheet, payroll_dashboard, official_employees, training_board, pm_balance)
- [x] pm_works.js — удалена старая форма «Персонал (заявка HR)», заменена на 2 кнопки (📨 Запросить / 📋 Мои заявки)
- [x] SHELL_VERSION бамп: 20.13.46 → 20.13.47

### Также обновлено
- hr-requests маршрут: добавлены роли PM, HEAD_PM (раньше только HR/ADMIN/DIRECTOR)

### Проверки
- [x] Все 7 JS файлов существуют и имеют корректный размер
- [x] Ноль хардкодированных цветов (#hex, rgb, rgba) во всех новых файлах
- [x] Все window-объекты соответствуют TZ (AsgardPersonnelPage, AsgardHrRequestsPage, AsgardGlobalTimesheetPage, AsgardPayrollDashboard, AsgardOfficialEmployeesPage, AsgardTrainingBoard, AsgardPmBalancePage)
- [x] Все API endpoints соответствуют backend роутам Сессии 1

### Git
- [x] commit 1: a10ded9 feat(hr-v2): сессия 2 — 7 desktop страниц + маршруты + навигация
- [x] commit 2: 43b4285 fix(hr-v2): аудит фронтенда — P0+P1+P2 исправления
- [x] push origin mobile-v3

### Аудит фронтенда (43b4285)
Полный аудит 7 файлов, исправлено 15 проблем:
- P0: prompt() → модалка, window.confirm() → AsgardUI.confirm(), CSP (onmouseenter), style-дубли, toast сигнатура
- P1: crm-table → asg, inline стили форм убраны, --border → --brd, border-radius хардкоды → var()
- P2: 'use strict', debounce поиска, CSS hover вместо JS

### Известные проблемы / что не сделано
- Браузерное тестирование не проводилось (нет доступа к браузеру из CLI)
- Боевой сервер НЕ рестартован — только git push
- Миграции V141-V145 НЕ применены на боевой БД (только на тест-БД)
- Mobile React (Шаг 4) — НЕ делаем в этой сессии
- Cron (Шаг 5) — НЕ делаем в этой сессии
- Деплой (Шаг 6) — НЕ делаем в этой сессии

---

## ДЛЯ СЕССИИ 3 — что проверить перед началом работы

1. Прочитать этот файл
2. Проверить что файлы существуют:
   - src/routes/worker-readiness.js
   - src/routes/staff-requests-v2.js
   - src/routes/global-timesheet.js
   - src/routes/payroll-dashboard.js
   - src/routes/training.js
3. Прочитать src/index.js и убедиться в регистрации 5 новых роутов (строки 549-554)
4. Запустить smoke curl тесты — все должны быть 200 (не 404, не 500)
5. ЕСЛИ что-то не работает → НЕ начинать Шаг 3, сначала починить

---

## СЕССИЯ 3: Mobile + Cron + Deploy

### Верификация Сессий 1 и 2
- [x] Backend файлы существуют (6 route файлов)
- [x] Роуты зарегистрированы в index.js (6 совпадений)
- [x] Desktop JS файлы существуют (5 файлов)
- [x] SHELL_VERSION = 20.13.50
- [x] Тест-сервер на порту 3001 — все 6 endpoints → 200

### Mobile — Полевой рабочий
- [x] FieldReadiness.jsx — создан, маршрут /field/readiness (статус, DatePicker, причины, документы)
- [x] FieldHome.jsx — BottomSheet вопрос добавлен (при отсутствии проекта + unknown/on_site статус)
- [x] App.jsx — маршрут /field/readiness добавлен

### Mobile — Офисная мобилка
- [x] Personnel.jsx — переписан с группировкой по 5 статусам (on_site/approved/ready/not_ready/archive), кнопки HR
- [x] GlobalTimesheet.jsx — создан (горизонтальный скролл, sticky ФИО, цветные ячейки, Excel export)
- [x] PayrollDashboard.jsx — создан (4 StatCard, операции СЗ, agreement_transfer, годовые лимиты)
- [x] OfficialEmployees.jsx — создан (список карточек, BottomSheet редактирование оклада/статуса)
- [x] TrainingBoard.jsx — создан (список обучений, загрузка файлов, завершение)
- [x] StaffRequests.jsx — создан (PM: draft + submit, HR: take + approve, FAB создание, счётчики ролей)
- [x] PmBalance.jsx — создан (список РП с балансами, детальная раскладка в BottomSheet)
- [x] More.jsx — обновлён (+6 пунктов: staff-requests, global-timesheet, training-board, payroll-dashboard, official-employees, pm-balance)
- [x] App.jsx — обновлён (+7 маршрутов + 7 импортов)
- [x] rbac.js — обновлён (TO+personnel, HEAD_TO+finances, HR+finances, HR_MANAGER+finances, BUH+personnel, WAREHOUSE+personnel)
- [x] npm run build — OK (1.50s, 1555KB JS + 85KB CSS)
- [x] cp dist/* → ../m/ — OK

### Cron
- [x] readiness-cron.js — создан (3 задачи: monthly reminder 09:00 1-го, daily archive 06:00, daily departure 07:00 MSK)
- [x] Зарегистрирован в index.js (try/catch + onReady + onClose)

### Deploy
- [x] git commit: 3d4d744 feat(hr-v2): сессия 3 — mobile + cron + deploy (18 files, +4071/-187)
- [x] git push origin mobile-v3
- [x] Сервер: git fetch + reset → HEAD at 3d4d744f
- [x] Миграции V141-V145 применены на боевой БД (ранее были только на тест-БД)
- [x] systemctl restart asgard-crm → health OK
- [x] app_updates баннер: v20.14.0 «HR Module v2 — Управление персоналом» (9 пунктов)

### Финальные smoke тесты (прод, порт 3000)
- GET /api/staff/readiness → 200 ✅
- GET /api/staff-requests/pending → 200 ✅
- GET /api/timesheet/global/2026/6 → 200 ✅
- GET /api/payroll-dashboard/summary/2026/6 → 200 ✅
- GET /api/payroll-dashboard/pm-balance → 200 ✅
- GET /api/training/pending → 200 ✅

### Браузерные проверки (требуют ручной проверки)
- [ ] /m/personnel — группировка по статусам
- [ ] /m/global-timesheet — табель
- [ ] /m/payroll-dashboard — финансы + операции СЗ
- [ ] /m/official-employees — официальные
- [ ] /m/training-board — обучение
- [ ] /m/staff-requests — заявки PM/HR
- [ ] /m/pm-balance — баланс РП
- [ ] /m/field/readiness — статус готовности рабочего
- [ ] #/personnel — desktop группировка
- [ ] #/hr-requests — desktop draft save
- [ ] #/payroll-dashboard — desktop операции СЗ
- [ ] #/pm-balance — desktop баланс РП

### Известные проблемы / что не сделано
- Браузерное тестирование не проводилось (нет доступа к браузеру из CLI)
- SHELL_VERSION не бампнут (desktop JS не менялся в этой сессии)
- Дубли миграций V141/V142 (wa_group_columns, employees_wa_phones) — не применены, не конфликтуют

### СТАТУС МОДУЛЯ
✅ ЗАВЕРШЁН — все 3 сессии выполнены, код задеплоен, API работает на проде
