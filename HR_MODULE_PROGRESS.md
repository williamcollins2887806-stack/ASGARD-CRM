# HR Module v2 — Журнал прогресса
Последнее обновление: 2026-06-04 ~05:00 UTC
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
- [ ] commit: [ожидает]
- [ ] push origin mobile-v3

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

### Как запустить тест-сервер для проверки
```bash
# На сервере (SSH root@92.242.61.184):
kill $(lsof -t -i:3001) 2>/dev/null; true
cd /var/www/asgard-crm && DB_NAME=asgard_crm_test DB_HOST=localhost DB_PASSWORD=123456789 DB_USER=asgard PORT=3001 nohup node src/index.js > /tmp/hr_test_server.log 2>&1 &
sleep 5
curl -s http://localhost:3001/api/health  # должен вернуть 200

# Smoke-тесты:
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"test_director","password":"Test123!"}' | node -e "process.stdin||(d='');process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")
for ep in "staff/readiness" "staff-requests/pending" "timesheet/global/2026/6" "payroll-dashboard/summary/2026/6" "payroll-dashboard/pm-balance" "training/pending"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/$ep)
  echo "$ep → $CODE"
done

# Остановить:
kill $(lsof -t -i:3001) 2>/dev/null
```
