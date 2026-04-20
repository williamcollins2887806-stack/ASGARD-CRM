# ASGARD CRM — Достижения / Глубокий аудит и архитектурный план

> Дата: 2026-04-20
> Ветка: `mobile-v3`
> Автор: Аудит кодовой базы + архитектурный план

---

## 1. Резюме

### Что можно сделать СЕЙЧАС

Кодовая база ASGARD CRM содержит **все необходимые данные** для реализации ~85% задуманных достижений. Существующие таблицы (`field_checkins`, `employee_assignments`, `worker_payments`, `works`, `field_photos`, `field_logistics`, `field_trip_stages`, `field_sessions`) покрывают категории "Вступление", "Дисциплина", "Выносливость", "Мастерство" и большую часть "Финансов" и "Командировок".

### Что потребует доработки

| Категория | Проблема | Решение |
|---|---|---|
| Командировки >1000 км | Нет поля `distance_km` в `field_logistics` / `business_trips` | Добавить колонку или считать через geo-координаты |
| PWA-аналитика (секретные) | `field_sessions` хранит `last_active_at`, но нет таблицы ежедневных визитов | Новая таблица `field_app_visits` |
| Рулетка Одина | Полностью новый функционал | 3 новые таблицы + API + фронт |

### Общая картина

- **47 достижений** в 7 категориях (включая 4 секретных)
- **6 новых таблиц** в миграции (achievements, employee_achievements, achievement_points_balance, odin_roulette_prizes, odin_roulette_spins, field_app_visits)
- **1 cron-задача** для ежедневной проверки
- **5 API endpoints** + 2 для рулетки
- **3 мобильных экрана** (витрина, детали, рулетка)
- **Оценка: 12 этапов по 40-60 минут**

---

## 2. Аудит кодовой базы

### 2.1. Таблицы и данные (что есть)

#### `field_checkins` (V060, ключевая таблица)
```
id SERIAL PK
employee_id INTEGER NOT NULL FK → employees
work_id INTEGER NOT NULL FK → works
assignment_id INTEGER FK → employee_assignments
checkin_at TIMESTAMP NOT NULL          -- время чекина (для "рано/вовремя")
checkout_at TIMESTAMP                  -- время чекаута
hours_worked DECIMAL(5,2)              -- фактические часы
hours_paid DECIMAL(5,2)                -- оплаченные часы
day_rate DECIMAL(12,2)                 -- дневная ставка
amount_earned DECIMAL(12,2)            -- заработок за смену
date DATE NOT NULL                     -- дата смены
shift VARCHAR(20) DEFAULT 'day'        -- 'day' | 'night'
status VARCHAR(20) DEFAULT 'active'    -- 'active','completed','cancelled'
checkin_source VARCHAR(20) DEFAULT 'self'  -- 'self','master','manual'
note TEXT
```
**Индексы**: (employee_id, date), (work_id, date)
**Уникальность** (V086): `(employee_id, date, work_id) WHERE status != 'cancelled'`

#### `employee_assignments` (V001 + V060 ALTER)
```
id, employee_id, work_id, date_from, date_to, role,
-- V060 additions:
field_role VARCHAR(30) DEFAULT 'worker'  -- 'worker','shift_master','senior_master'
tariff_id INTEGER FK → field_tariff_grid
tariff_points INTEGER
combination_tariff_id INTEGER
per_diem DECIMAL(10,2)
shift_type VARCHAR(20) DEFAULT 'day'  -- 'day','night'
is_active BOOLEAN DEFAULT TRUE
sms_sent BOOLEAN, sms_sent_at TIMESTAMP
```

#### `worker_payments` (V067)
```
id, employee_id, work_id,
type VARCHAR(30) CHECK ('per_diem','salary','advance','bonus','penalty')
period_from DATE, period_to DATE
pay_month INTEGER, pay_year INTEGER
amount NUMERIC(12,2) NOT NULL
days INTEGER, rate_per_day NUMERIC(10,2)
total_points NUMERIC(10,2), point_value NUMERIC(10,2)
payment_method VARCHAR(30)    -- 'cash','card','transfer'
status VARCHAR(20) CHECK ('pending','paid','confirmed','cancelled')
confirmed_by_worker BOOLEAN DEFAULT false
confirmed_at TIMESTAMP
```

#### `works` (V001 + расширения)
```
id, tender_id, estimate_id, pm_id,
work_title TEXT, work_status VARCHAR(100),
city VARCHAR(255), address TEXT, object_name VARCHAR(500),
customer_name VARCHAR(500), customer_inn VARCHAR(20),
is_vachta BOOLEAN DEFAULT false,  -- вахтовый метод
site_id INTEGER                   -- FK к sites
```
**Нет `customer_id` как FK** — заказчик хранится как `customer_name`/`customer_inn` (денормализовано).

#### `employees` (V001 + V060)
```
id, fio, phone, email, role_tag, is_active, user_id,
city, position, full_name,
day_rate NUMERIC(12,2),
phone_verified BOOLEAN, field_pin VARCHAR(4), field_last_login TIMESTAMP,
clothing_size VARCHAR(10), shoe_size VARCHAR(10),
naks, naks_expiry, imt_number, imt_expires,
rating_avg NUMERIC(4,2), rating_count INTEGER
```

#### `field_photos` (V060)
```
id, employee_id, work_id, report_id, checkin_id,
filename, photo_type VARCHAR(30) DEFAULT 'work', caption TEXT,
lat, lng, taken_at
```

#### `field_logistics` (V060)
```
id, work_id, employee_id, trip_id FK→business_trips,
item_type VARCHAR(30)  -- 'ticket','hotel','transfer','document'
title, description, date_from, date_to,
details JSONB, status VARCHAR(30)
```

#### `field_trip_stages` (V063)
```
id, employee_id, work_id, assignment_id,
stage_type VARCHAR(30)  -- 'medical','travel','waiting','warehouse','day_off','object'
date_from DATE, date_to DATE, days_count INTEGER,
tariff_id, tariff_points, rate_per_day, amount_earned,
status VARCHAR(20) -- 'active','completed','approved','adjusted','rejected'
```

#### `field_sessions` (V060)
```
id, employee_id, token_hash, device_info,
push_subscription JSONB,
last_active_at TIMESTAMP, expires_at TIMESTAMP
```

#### `business_trips` (V001)
```
id, inspection_id, work_id,
status VARCHAR(50), date_from, date_to,
employees_json JSONB,  -- [{ employee_id, ... }]
transport_type VARCHAR(50),
```

#### `field_tariff_grid` (V060)
```
id, category VARCHAR(50)  -- 'mlsp','ground','ground_hard','warehouse','special'
position_name VARCHAR(255),
points INTEGER, rate_per_shift DECIMAL(10,2),
is_combinable BOOLEAN, requires_approval BOOLEAN
```

#### `employee_reviews` (V001)
```
id, employee_id, work_id, pm_id,
rating INTEGER CHECK (1..10), comment TEXT
```

### 2.2. Роуты и сервисы

| Файл | Путь | Релевантность |
|---|---|---|
| `src/routes/field-worker.js` | `/api/field-worker/` | **Ключевой** — `/me` уже отдаёт `achievements[]` (8 штук, хардкод) |
| `src/routes/field-checkin.js` | `/api/field-checkin/` | Чекин/чекаут, `/today`, `/worker/my-work` |
| `src/routes/field-manage.js` | `/api/field-manage/` | Dashboard, timesheet, crew, tariffs |
| `src/routes/worker-payments.js` | `/api/worker-payments/` | `/my/balance`, generate-salary, reports |
| `src/routes/field-logistics.js` | `/api/field-logistics/` | Билеты, отели, документы |
| `src/routes/field-stages.js` | `/api/field-stages/` | Trip stages (дорога, медосмотр) |
| `src/routes/push.js` | `/api/push/` | subscribe, send, badge-count |
| `src/services/pushService.js` | — | `sendPush()`, `sendPushToMany()`, VAPID |
| `src/services/notify.js` | — | `createNotification()` → DB + SSE + Telegram + Push |
| `src/services/per-diem-cron.js` | — | Пример cron-задачи (node-cron, MSK timezone) |
| `src/services/mimir-cron.js` | — | Ещё пример cron (3 раза в день) |
| `src/lib/worker-finances.js` | — | SSoT баланс рабочего (CTE по field_checkins + worker_payments) |

**Важная находка**: В `field-worker.js` (строки 16-25) уже есть **прототип системы достижений**:

```javascript
const FIELD_ACHIEVEMENTS = [
  { id: 'first_shift',    icon: '🔥', name: 'Первая смена',    check: s => s.total_shifts >= 1 },
  { id: 'iron_warrior',   icon: '⚡', name: 'Железный воин',   check: s => s.consecutive >= 10 },
  { id: 'veteran',        icon: '🏆', name: 'Ветеран Асгарда', check: s => s.total_shifts >= 50 },
  { id: 'chronicler',     icon: '📷', name: 'Летописец',       check: s => s.photos >= 100 },
  { id: 'punctual',       icon: '⏰', name: 'Пунктуальный',    check: s => s.on_time >= 20 },
  { id: 'berserker',      icon: '🛡', name: 'Берсерк',         check: s => s.long_shifts >= 5 },
  { id: 'traveler',       icon: '🗺', name: 'Странник',         check: s => s.cities >= 5 },
  { id: 'mentor',         icon: '🎓', name: 'Наставник',       check: s => s.was_master >= 1 },
];
```

Эндпоинт `/me` считает `total_shifts`, `photos`, `cities`, `long_shifts`, `was_master`, `on_time` (<=08:05), `consecutive` (последние 30 дней). Это базовая логика, которую надо **расширить и вынести в отдельный сервис**.

### 2.3. Mobile frontend (паттерн, фреймворк)

**Два фронтенда:**

1. **React 18 PWA** (`/m/`) — `public/mobile-app/` (Vite + React Router + Zustand + Tailwind + Lucide icons)
   - Маршрутизация: `BrowserRouter`, basename `/m`, 50+ routes в `App.jsx`
   - Страницы: `public/mobile-app/src/pages/` (53 файла `.jsx`)
   - Виджеты дашборда: `public/mobile-app/src/widgets/` (31 виджет, ролевые фильтры)
   - Компоненты: `PageShell`, `PullToRefresh`, `BottomSheet`, `EmptyState`, `SkeletonKit`
   - API клиент: `@/api/client` (`api.get()`, `api.post()`)
   - Сторы: `authStore` (Zustand), `themeStore`
   - Хуки: `useHaptic`
   - Анимации: CSS keyframes (`fadeInUp`, `widgetScaleIn`, `widgetSlideLeft/Right`)
   - **Рабочие не используют этот фронтенд** (нет FIELD_WORKER роли в widget registry)

2. **Vanilla JS Field PWA** (`/field/`) — `public/field/` (lit-html-подобный, vanilla)
   - SW: `public/field/sw.js` (SHELL_VERSION 3.3.1)
   - Страницы: `login.js`, `home.js`, `shift.js`, `money.js`, `logistics.js`, `history.js`, `profile.js`, `crew.js`, `report.js`, `incidents.js`, `photos.js`, `funds.js`, `packing.js`, `stages.js`, `earnings.js`
   - Auth: SMS-код → JWT → `field_sessions`
   - **Это ЛК рабочих** — именно сюда нужно добавлять достижения

**Вывод**: Экран достижений нужно делать в **Field PWA** (vanilla JS, `/field/pages/achievements.js`), а не в React-приложении. Или — если планируется единый мобильный интерфейс — обсудить миграцию рабочих на React PWA.

> **РЕКОМЕНДАЦИЯ**: Учитывая, что React PWA значительно мощнее (компоненты, анимации, маршрутизация), и рулетка требует сложных анимаций — **стоит сделать в React PWA**, добавив маршруты для FIELD_WORKER роли. Но если это нереально в текущий дедлайн, можно сделать в vanilla.

### 2.4. Cron-механизмы

Проект использует `node-cron` (npm). Существующие cron-задачи в `src/index.js`:

| Cron | Файл | Расписание | Назначение |
|---|---|---|---|
| MimirCron | `services/mimir-cron.js` | `0 9`, `30 13`, `30 17` пн-пт MSK | AI-сводки |
| PerDiemCron | `services/per-diem-cron.js` | `30 9` пн-сб MSK | Уведомления PM о суточных |
| ReportScheduler | `services/report-scheduler.js` | Настраиваемый | Аналитика звонков |
| EscalationChecker | `services/escalation-checker.js` | setInterval | Эскалации |
| CleanupReminders | inline in index.js | setInterval 1h | Очистка напоминаний |
| EmailFolderSorter | inline | setInterval 5min | Сортировка email |
| CashReceiptChecker | inline | setInterval 30min | Проверка чеков |
| ProcurementMonitor | inline | setInterval 1h | Мониторинг закупок |

**Паттерн для achievements cron**: По аналогии с `per-diem-cron.js`:
```javascript
const cron = require('node-cron');
cron.schedule('0 2 * * *', () => checkAchievements(db, log), { timezone: 'Europe/Moscow' });
```

### 2.5. Push/SW

**Push-уведомления полностью работают:**
- Таблица `push_subscriptions` (user_id, endpoint, p256dh, auth)
- `pushService.js` — VAPID web-push, `sendPush(db, userId, payload)` с actions
- `notify.js` — `createNotification()` → DB + SSE + Telegram + Push
- SW (`public/sw.js`, `public/field/sw.js`) обрабатывает push-события

**Для достижений нужно:**
- При получении ачивки вызывать `createNotification()` или `pushService.sendPush()` с кастомным payload
- Рабочие используют `field_sessions` (не `users`), но у них есть `user_id` в `employees` (может быть NULL)
- Если `user_id` нет, push не пойдёт — нужен fallback на SMS или Telegram

**Field SW** (`public/field/sw.js`) уже обрабатывает push:
```javascript
self.addEventListener('push', (event) => { ... });
```

---

## 3. Матрица достижений (47 штук)

### Обозначения
- **Статус**: ✅ данные есть, SQL готов | ⚠️ нужна минимальная доработка | ❌ нет данных, нужна новая таблица

### 3.1. Вступление (7 достижений)

| # | Ачивка | Тир | Очки | Критерий | SQL | Источник | Статус |
|---|---|---|---|---|---|---|---|
| 1 | **Новый викинг** | Кубок | 10 | 1 завершённая смена | `SELECT COUNT(*) FROM field_checkins WHERE employee_id=$1 AND status='completed'` >= 1 | `field_checkins` | ✅ |
| 2 | **Страж Бифроста** | Кубок | 10 | Первый чекин до 08:00 | `SELECT COUNT(*) FROM field_checkins WHERE employee_id=$1 AND status='completed' AND EXTRACT(HOUR FROM checkin_at) < 8` >= 1 | `field_checkins.checkin_at` | ✅ |
| 3 | **Сын Одина** | Кубок | 10 | 5 завершённых смен | `...status='completed') >= 5` | `field_checkins` | ✅ |
| 4 | **Путь Валькирии** | Медаль | 25 | 10 завершённых смен | `>= 10` | `field_checkins` | ✅ |
| 5 | **Бывалый викинг** | Медаль | 25 | 30 завершённых смен | `>= 30` | `field_checkins` | ✅ |
| 6 | **Воин Асгарда** | Орден | 50 | 100 завершённых смен | `>= 100` | `field_checkins` | ✅ |
| 7 | **Хранитель саги** | Легенда | 100 | 300 завершённых смен | `>= 300` | `field_checkins` | ✅ |

**SQL для всей категории** (одним запросом):
```sql
SELECT COUNT(*) AS total_shifts
FROM field_checkins
WHERE employee_id = $1 AND status = 'completed';
```

---

### 3.2. Дисциплина (9 достижений)

| # | Ачивка | Тир | Очки | Критерий | SQL-логика | Статус |
|---|---|---|---|---|---|---|
| 8 | **Железный воин** | Медаль | 25 | 10 смен подряд без пропусков | Окно по дням: `date` без разрывов >1 дня | ✅ |
| 9 | **Мьёльнир** | Орден | 50 | 30 смен подряд | Аналогично | ✅ |
| 10 | **Неукротимый** | Легенда | 100 | 60 смен подряд | Аналогично | ✅ |
| 11 | **Чистая запись** | Медаль | 25 | 30 дней без штрафов | `NOT EXISTS (SELECT 1 FROM worker_payments WHERE employee_id=$1 AND type='penalty' AND created_at >= NOW()-INTERVAL '30 days' AND status!='cancelled')` | ✅ |
| 12 | **Ранняя пташка** | Кубок | 10 | 10 чекинов до 07:30 | `EXTRACT(HOUR FROM checkin_at)*60 + EXTRACT(MINUTE FROM checkin_at) <= 450` | ✅ |
| 13 | **Хранитель времени** | Орден | 50 | 50 смен с чекином до 08:05 | `<= 485` (минут от полуночи) | ✅ |
| 14 | **Без промаха** | Медаль | 25 | 20 смен подряд без опозданий (чекин до 08:05) | Оконный подсчёт по `on_time` streak | ✅ |
| 15 | **Кузнец судьбы** | Легенда | 100 | 100 смен подряд без пропуска | Оконный подсчёт | ✅ |
| 16 | **Щит дисциплины** | Орден | 50 | 90 дней без штрафов | Как #11 но 90 дней | ✅ |

**SQL для consecutive shifts** (уже реализовано в field-worker.js, нужно расширить лимит):
```sql
SELECT date FROM field_checkins
WHERE employee_id = $1 AND status = 'completed'
ORDER BY date DESC;
-- В коде: итерация по дням, считаем streak (diff <= 1 = продолжение)
```

**SQL для "без штрафов"**:
```sql
SELECT COALESCE(MAX(created_at), '2000-01-01') AS last_penalty
FROM worker_payments
WHERE employee_id = $1 AND type = 'penalty' AND status != 'cancelled';
-- penalty_free_days = NOW() - last_penalty
```

---

### 3.3. Выносливость (7 достижений)

| # | Ачивка | Тир | Очки | Критерий | SQL | Статус |
|---|---|---|---|---|---|---|
| 17 | **Ночной страж** | Кубок | 10 | 5 ночных смен | `SELECT COUNT(*) FROM field_checkins WHERE employee_id=$1 AND status='completed' AND shift='night'` >= 5 | ✅ |
| 18 | **Лунный воин** | Медаль | 25 | 20 ночных смен | >= 20 | ✅ |
| 19 | **Дух Фенрира** | Орден | 50 | 50 ночных смен | >= 50 | ✅ |
| 20 | **Хозяин Хеля** | Легенда | 100 | 100 ночных смен | >= 100 | ✅ |
| 21 | **Марафонец** | Медаль | 25 | 10 смен по 12+ часов | `SELECT COUNT(*) FROM field_checkins WHERE employee_id=$1 AND status='completed' AND hours_worked >= 12` >= 10 | ✅ |
| 22 | **Берсеркер** | Орден | 50 | 30 дней подряд (месяц без выходных) | Streak по датам >= 30 | ✅ |
| 23 | **Вечный огонь** | Орден | 50 | 20 смен по 12+ часов | >= 20 | ✅ |

**SQL для ночных**:
```sql
SELECT COUNT(*) AS night_shifts
FROM field_checkins
WHERE employee_id = $1 AND status = 'completed' AND shift = 'night';
```

> Поле `shift` VARCHAR(20) DEFAULT 'day' присутствует в `field_checkins`. Значения: 'day', 'night'.

---

### 3.4. Командировки (7 достижений)

| # | Ачивка | Тир | Очки | Критерий | SQL | Статус |
|---|---|---|---|---|---|---|
| 24 | **Путь на восток** | Кубок | 10 | 1 командировка (assignment на вахтовый проект) | `SELECT COUNT(DISTINCT ea.work_id) FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=$1 AND w.is_vachta=true` >= 1 | ✅ |
| 25 | **Странник миров** | Медаль | 25 | 3 разных объекта | `SELECT COUNT(DISTINCT w.object_name) FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=$1 AND w.object_name IS NOT NULL` >= 3 | ✅ |
| 26 | **Повелитель дорог** | Орден | 50 | 10 командировок | `is_vachta=true` COUNT >= 10 | ✅ |
| 27 | **Открыватель земель** | Медаль | 25 | 5 разных заказчиков | `SELECT COUNT(DISTINCT w.customer_name) FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=$1 AND w.customer_name IS NOT NULL` >= 5 | ✅ |
| 28 | **Мост через Бифрост** | Орден | 50 | Командировка >1000 км | Нет поля distance | ⚠️ |
| 29 | **Девять миров** | Легенда | 100 | 9 разных объектов | Аналогично #25 но >= 9 | ✅ |
| 30 | **Викинг пяти морей** | Орден | 50 | 5 разных городов | `SELECT COUNT(DISTINCT w.city) FROM employee_assignments ea JOIN works w ON w.id=ea.work_id WHERE ea.employee_id=$1 AND w.city IS NOT NULL` >= 5 | ✅ |

**Проблема #28 ("Мост через Бифрост")**:
- В `field_logistics` есть `details JSONB` — можно хранить `distance_km` в JSON
- В `business_trips` нет поля расстояния
- **Решение**: Добавить в `field_logistics.details` ключ `distance_km` при создании билета, или вычислять через координаты (`field_project_settings.object_lat/lng` ↔ `employees.city`)
- Альтернатива: заменить критерий на "командировка в другой регион" (`w.city != e.city`)

**SQL для городов** (уже реализовано в field-worker.js):
```sql
SELECT COUNT(DISTINCT w.city) AS cities
FROM employee_assignments ea
JOIN works w ON w.id = ea.work_id
WHERE ea.employee_id = $1;
```

---

### 3.5. Финансы (7 достижений)

| # | Ачивка | Тир | Очки | Критерий | SQL | Статус |
|---|---|---|---|---|---|---|
| 31 | **Золото Фафнира** | Кубок | 10 | Заработок >= 50 000 руб (кумулятивно) | `SELECT COALESCE(SUM(amount_earned),0) FROM field_checkins WHERE employee_id=$1 AND status='completed'` >= 50000 | ✅ |
| 32 | **Сокровищница Мидгарда** | Медаль | 25 | >= 200 000 руб | >= 200000 | ✅ |
| 33 | **Драконья казна** | Орден | 50 | >= 500 000 руб | >= 500000 | ✅ |
| 34 | **Богатство Валхаллы** | Легенда | 100 | >= 1 000 000 руб | >= 1000000 | ✅ |
| 35 | **Чистый счёт** | Медаль | 25 | Все авансы закрыты в срок (0 pending advances) | `SELECT COUNT(*) FROM worker_payments WHERE employee_id=$1 AND type='advance' AND status='pending'` = 0 AND total_advances > 0 | ✅ |
| 36 | **Бережливый ярл** | Орден | 50 | 5 месяцев без переплат/долгов | `worker_payments` аналитика по месяцам, balance ~0 | ⚠️ |
| 37 | **Первое золото** | Кубок | 10 | Первая выплата подтверждена | `SELECT COUNT(*) FROM worker_payments WHERE employee_id=$1 AND confirmed_by_worker=true` >= 1 | ✅ |

**SQL для кумулятивного заработка**:
```sql
SELECT COALESCE(SUM(amount_earned), 0) AS total_earned
FROM field_checkins
WHERE employee_id = $1 AND status = 'completed';
```

**Для "Бережливого ярла"** (⚠️ сложная логика):
```sql
WITH monthly AS (
  SELECT pay_year, pay_month,
    SUM(CASE WHEN type IN ('salary','per_diem','bonus') THEN amount ELSE 0 END) AS earned,
    SUM(CASE WHEN type = 'advance' THEN amount ELSE 0 END) AS advances,
    SUM(CASE WHEN type = 'penalty' THEN amount ELSE 0 END) AS penalties
  FROM worker_payments
  WHERE employee_id = $1 AND status != 'cancelled'
  GROUP BY pay_year, pay_month
)
SELECT COUNT(*) AS clean_months
FROM monthly
WHERE (earned - advances - penalties) BETWEEN -1000 AND 1000;
-- >= 5 для ачивки
```

---

### 3.6. Мастерство (6 достижений)

| # | Ачивка | Тир | Очки | Критерий | SQL | Статус |
|---|---|---|---|---|---|---|
| 38 | **Ученик** | Кубок | 10 | Первая роль на объекте (first assignment) | `SELECT COUNT(*) FROM employee_assignments WHERE employee_id=$1` >= 1 | ✅ |
| 39 | **Правая рука мастера** | Медаль | 25 | 20 смен как worker (помощник) | `SELECT COUNT(*) FROM field_checkins fc JOIN employee_assignments ea ON ea.id=fc.assignment_id WHERE fc.employee_id=$1 AND ea.field_role='worker' AND fc.status='completed'` >= 20 | ✅ |
| 40 | **Мастер ответственный** | Орден | 50 | Назначен мастером (shift_master или senior_master) | `SELECT COUNT(*) FROM employee_assignments WHERE employee_id=$1 AND field_role IN ('shift_master','senior_master')` >= 1 | ✅ |
| 41 | **Бригадир-викинг** | Орден | 50 | 50 смен в роли мастера | `SELECT COUNT(*) FROM field_checkins fc JOIN employee_assignments ea ON ea.id=fc.assignment_id WHERE fc.employee_id=$1 AND ea.field_role IN ('shift_master','senior_master') AND fc.status='completed'` >= 50 | ✅ |
| 42 | **Конунг работ** | Легенда | 100 | 100+ смен в роли мастера | >= 100 | ✅ |
| 43 | **Многоликий** | Медаль | 25 | Работал на 3+ категориях объектов (mlsp, ground, ground_hard, warehouse) | `SELECT COUNT(DISTINCT ftg.category) FROM employee_assignments ea JOIN field_tariff_grid ftg ON ftg.id=ea.tariff_id WHERE ea.employee_id=$1` >= 3 | ✅ |

---

### 3.7. Секретные (4 достижения)

| # | Ачивка | Тир | Очки | Критерий | SQL | Статус |
|---|---|---|---|---|---|---|
| 44 | **Око Хугина** | Орден | 50 | 100 открытий PWA | Нет таблицы app_visits | ❌ |
| 45 | **Руна Дагаз** | Легенда | 100 | 30 дней подряд вход в приложение | Нет таблицы app_visits | ❌ |
| 46 | **Летописец Асгарда** | Орден | 50 | 100+ фото в отчётах | `SELECT COUNT(*) FROM field_photos WHERE employee_id=$1` >= 100 | ✅ |
| 47 | **Избранный Одина** | Легенда | 100 | Все остальные ачивки получены | Проверка `employee_achievements` — все `achievement_id` кроме этого | ⚠️ |

**Решение для #44, #45**: Новая таблица `field_app_visits`:
```sql
CREATE TABLE field_app_visits (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  visit_date DATE NOT NULL,
  visits_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(employee_id, visit_date)
);
```
При каждом запросе `/api/field-worker/me` или при логине — `INSERT ON CONFLICT DO UPDATE SET visits_count = visits_count + 1`.

---

### 3.8. БОНУС: Дополнительные ачивки (на основе найденных данных)

| # | Ачивка | Тир | Очки | Критерий | Источник |
|---|---|---|---|---|---|
| B1 | **Морской волк** | Орден | 50 | 10+ смен на МЛСП (category='mlsp') | `employee_assignments.tariff_id` → `field_tariff_grid.category='mlsp'` |
| B2 | **Фотохроникёр** | Медаль | 25 | 50 фото | `field_photos` COUNT >= 50 |
| B3 | **Скорая помощь** | Кубок | 10 | Прошёл медосмотр (field_trip_stages.stage_type='medical') | `field_trip_stages` |
| B4 | **Дорожный воин** | Медаль | 25 | 10+ этапов "дорога" | `field_trip_stages.stage_type='travel'` COUNT >= 10 |
| B5 | **Складской ярл** | Кубок | 10 | 5+ дней на складе | `field_trip_stages.stage_type='warehouse'` COUNT >= 5 |
| B6 | **Обратная связь** | Кубок | 10 | Подтвердил 5 выплат | `worker_payments.confirmed_by_worker=true` COUNT >= 5 |
| B7 | **Верный воин** | Орден | 50 | 3+ года в компании | `employees.employment_date` + INTERVAL '3 years' <= NOW() |

---

## 4. Рулетка Одина

### 4.1. Концепция

**Механика:**
1. Рабочий зарабатывает **баллы (очки)** за ачивки (10/25/50/100 за тир)
2. Одно вращение рулетки стоит **N баллов** (настраиваемо, по умолчанию 30)
3. Рулетка содержит 8-12 секторов с призами
4. Результат определяется на сервере (weighted random), а на клиенте — красивая анимация
5. **Anti-abuse**: максимум 3 вращения в день, cooldown 1 минута между спинами

**Призы:**

| Тип | Пример | Вес (%) | Виртуальный? |
|---|---|---|---|
| `bonus_points` | +10 / +20 / +50 баллов | 30% | Да |
| `multiplier` | x2 / x3 следующая ачивка | 10% | Да |
| `merch` | Каска, шапка, толстовка, кубок, перчатки | 15% | Нет (физический) |
| `badge` | Эксклюзивный бейдж (визуальный) | 20% | Да |
| `empty` | "Локи украл!" | 25% | — |

### 4.2. Таблицы (DDL)

```sql
-- Справочник призов рулетки
CREATE TABLE odin_roulette_prizes (
    id SERIAL PRIMARY KEY,
    prize_type VARCHAR(30) NOT NULL,
    -- 'bonus_points','multiplier','merch','badge','empty'
    name VARCHAR(255) NOT NULL,
    description TEXT,
    value INTEGER DEFAULT 0,          -- кол-во баллов / множитель
    image_url VARCHAR(500),           -- иконка приза
    weight INTEGER NOT NULL DEFAULT 10, -- вес для weighted random (1-100)
    is_active BOOLEAN DEFAULT TRUE,
    max_wins INTEGER,                 -- лимит выигрышей (NULL = бесконечно)
    current_wins INTEGER DEFAULT 0,
    requires_delivery BOOLEAN DEFAULT FALSE, -- физический приз
    created_at TIMESTAMP DEFAULT NOW()
);

-- История вращений
CREATE TABLE odin_roulette_spins (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    prize_id INTEGER NOT NULL REFERENCES odin_roulette_prizes(id),
    points_spent INTEGER NOT NULL,     -- сколько баллов потрачено
    points_won INTEGER DEFAULT 0,      -- сколько баллов выиграно
    prize_type VARCHAR(30) NOT NULL,
    prize_name VARCHAR(255),
    is_delivered BOOLEAN DEFAULT FALSE, -- для физических призов
    delivered_at TIMESTAMP,
    delivered_by INTEGER,
    spin_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_roulette_spins_emp ON odin_roulette_spins(employee_id, spin_at DESC);
```

### 4.3. API

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/field-worker/roulette` | Состояние: баланс, доступных вращений сегодня, список призов |
| `POST` | `/api/field-worker/roulette/spin` | Вращение: списать баллы, weighted random, вернуть результат |
| `GET` | `/api/field-worker/roulette/history` | История вращений |

**POST /roulette/spin — серверная логика:**
```javascript
async function spin(db, empId) {
  // 1. Проверить баланс
  const { rows: [bal] } = await db.query(
    `SELECT points_balance FROM employee_achievements_summary WHERE employee_id=$1`, [empId]);
  if (!bal || bal.points_balance < SPIN_COST) throw new Error('Недостаточно баллов');

  // 2. Проверить лимит вращений сегодня
  const { rows: [todayCount] } = await db.query(
    `SELECT COUNT(*) AS cnt FROM odin_roulette_spins
     WHERE employee_id=$1 AND spin_at::date = CURRENT_DATE`, [empId]);
  if (parseInt(todayCount.cnt) >= MAX_SPINS_PER_DAY) throw new Error('Лимит вращений');

  // 3. Weighted random
  const { rows: prizes } = await db.query(
    `SELECT * FROM odin_roulette_prizes WHERE is_active=true
     AND (max_wins IS NULL OR current_wins < max_wins)`);
  const totalWeight = prizes.reduce((s, p) => s + p.weight, 0);
  let rand = Math.random() * totalWeight;
  let winner = prizes[0];
  for (const p of prizes) {
    rand -= p.weight;
    if (rand <= 0) { winner = p; break; }
  }

  // 4. Списать баллы, записать результат
  await db.query('BEGIN');
  await db.query(
    `UPDATE achievement_points_balance SET points_balance = points_balance - $1 WHERE employee_id=$2`,
    [SPIN_COST, empId]);

  let pointsWon = 0;
  if (winner.prize_type === 'bonus_points') pointsWon = winner.value;

  await db.query(
    `INSERT INTO odin_roulette_spins (employee_id, prize_id, points_spent, points_won, prize_type, prize_name)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [empId, winner.id, SPIN_COST, pointsWon, winner.prize_type, winner.name]);

  if (pointsWon > 0) {
    await db.query(
      `UPDATE achievement_points_balance SET points_balance = points_balance + $1 WHERE employee_id=$2`,
      [pointsWon, empId]);
  }

  await db.query(
    `UPDATE odin_roulette_prizes SET current_wins = current_wins + 1 WHERE id=$1`, [winner.id]);
  await db.query('COMMIT');

  return { prize: winner, points_won: pointsWon };
}
```

### 4.4. Призы и балансировка

**Стартовый набор призов:**

| ID | Тип | Название | Значение | Вес | Лимит |
|---|---|---|---|---|---|
| 1 | `bonus_points` | Дар Одина (+10) | 10 | 25 | - |
| 2 | `bonus_points` | Благословение Фрейи (+25) | 25 | 15 | - |
| 3 | `bonus_points` | Сокровище Нибелунгов (+50) | 50 | 5 | - |
| 4 | `multiplier` | Молот Тора (x2) | 2 | 8 | - |
| 5 | `badge` | Руна Иса | 0 | 12 | - |
| 6 | `badge` | Руна Тюр | 0 | 10 | - |
| 7 | `merch` | Каска "Асгард" | 0 | 3 | 50 |
| 8 | `merch` | Шапка "Викинг" | 0 | 4 | 100 |
| 9 | `merch` | Толстовка "Воин" | 0 | 2 | 30 |
| 10 | `merch` | Перчатки "Берсерк" | 0 | 3 | 200 |
| 11 | `merch` | Кубок "Валхалла" | 0 | 1 | 20 |
| 12 | `empty` | Локи украл! | 0 | 12 | - |

**Экономика баллов:**
- Средний рабочий получает ~3-5 ачивок в первый месяц (~70-120 очков)
- Стоимость спина: 30 очков → 2-4 вращения в первый месяц
- Математическое ожидание выигрыша: ~12 очков (при стоимости 30 = отрицательное EV, что правильно для вовлечения)

### 4.5. Frontend (Field PWA)

**Экран рулетки (`/field/pages/roulette.js` или React `Roulette.jsx`):**

Анимация рулетки — CSS `transform: rotate()` с `transition: cubic-bezier(0.17, 0.67, 0.12, 0.99)`:

```css
.odin-wheel {
  width: 300px; height: 300px;
  border-radius: 50%;
  background: conic-gradient(
    /* 12 секторов по 30 градусов, чередование цветов */
    #8B0000 0deg 30deg,
    #D4A843 30deg 60deg,
    /* ... */
  );
  transition: transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99);
  border: 4px solid #D4A843;
  box-shadow: 0 0 30px rgba(212,168,67,0.4);
}

.odin-wheel.spinning {
  transform: rotate(var(--spin-degrees));
}

.odin-pointer {
  /* Треугольник-указатель сверху */
  position: absolute; top: -10px; left: 50%;
  width: 0; height: 0;
  border-left: 12px solid transparent;
  border-right: 12px solid transparent;
  border-top: 20px solid #D4A843;
  transform: translateX(-50%);
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
}
```

**Логика анимации:**
1. Клиент отправляет `POST /roulette/spin`
2. Сервер возвращает `{ prize_id, sector_index }`
3. Клиент вычисляет `degrees = 360 * 5 + sector_index * (360 / totalSectors) + random_offset`
4. Устанавливает `--spin-degrees` → CSS transition крутит колесо 4 секунды
5. По окончании — popup с результатом (золотое свечение для хороших призов, красный дым для "Локи украл")

---

## 5. Архитектура

### 5.1. Схема БД (полный DDL миграции)

```sql
-- ═══════════════════════════════════════════════════════════════
-- V090: Система достижений + Рулетка Одина
-- ═══════════════════════════════════════════════════════════════

-- 1. Справочник достижений
CREATE TABLE IF NOT EXISTS worker_achievements (
    id VARCHAR(50) PRIMARY KEY,            -- 'new_viking', 'iron_warrior', ...
    category VARCHAR(30) NOT NULL,         -- 'onboarding','discipline','endurance','travel','finance','mastery','secret'
    tier VARCHAR(20) NOT NULL,             -- 'cup','medal','order','legend'
    points INTEGER NOT NULL DEFAULT 10,    -- 10/25/50/100
    name VARCHAR(100) NOT NULL,            -- 'Новый викинг'
    description TEXT NOT NULL,             -- 'Отработал первую смену'
    icon VARCHAR(10),                      -- эмодзи или код руны
    sort_order INTEGER DEFAULT 0,
    is_secret BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Полученные достижения
CREATE TABLE IF NOT EXISTS employee_achievements (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    achievement_id VARCHAR(50) NOT NULL REFERENCES worker_achievements(id),
    earned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    notified BOOLEAN DEFAULT FALSE,
    points_credited BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',           -- контекст: { shift_id, work_title, amount }
    UNIQUE(employee_id, achievement_id)
);
CREATE INDEX idx_emp_achievements_emp ON employee_achievements(employee_id);
CREATE INDEX idx_emp_achievements_earned ON employee_achievements(earned_at DESC);

-- 3. Баланс баллов (для рулетки)
CREATE TABLE IF NOT EXISTS achievement_points_balance (
    employee_id INTEGER PRIMARY KEY REFERENCES employees(id),
    points_balance INTEGER NOT NULL DEFAULT 0,
    points_earned_total INTEGER NOT NULL DEFAULT 0,   -- кумулятивно заработано
    points_spent_total INTEGER NOT NULL DEFAULT 0,    -- кумулятивно потрачено
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. Трекинг визитов PWA (для секретных ачивок)
CREATE TABLE IF NOT EXISTS field_app_visits (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    visit_date DATE NOT NULL,
    visits_count INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(employee_id, visit_date)
);
CREATE INDEX idx_app_visits_emp ON field_app_visits(employee_id, visit_date DESC);

-- 5. Справочник призов рулетки
CREATE TABLE IF NOT EXISTS odin_roulette_prizes (
    id SERIAL PRIMARY KEY,
    prize_type VARCHAR(30) NOT NULL
      CHECK (prize_type IN ('bonus_points','multiplier','merch','badge','empty')),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    value INTEGER DEFAULT 0,
    image_url VARCHAR(500),
    weight INTEGER NOT NULL DEFAULT 10,
    is_active BOOLEAN DEFAULT TRUE,
    max_wins INTEGER,
    current_wins INTEGER DEFAULT 0,
    requires_delivery BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 6. История вращений рулетки
CREATE TABLE IF NOT EXISTS odin_roulette_spins (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    prize_id INTEGER NOT NULL REFERENCES odin_roulette_prizes(id),
    points_spent INTEGER NOT NULL,
    points_won INTEGER DEFAULT 0,
    prize_type VARCHAR(30) NOT NULL,
    prize_name VARCHAR(255),
    is_delivered BOOLEAN DEFAULT FALSE,
    delivered_at TIMESTAMP,
    delivered_by INTEGER,
    spin_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_roulette_spins_emp ON odin_roulette_spins(employee_id, spin_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- Seed: 47 достижений
-- ═══════════════════════════════════════════════════════════════

INSERT INTO worker_achievements (id, category, tier, points, name, description, icon, sort_order, is_secret) VALUES
-- Вступление
('new_viking',       'onboarding', 'cup',    10, 'Новый викинг',       'Отработай первую смену',                        '🏆', 1,  false),
('bifrost_guard',    'onboarding', 'cup',    10, 'Страж Бифроста',     'Первый чекин до 08:00',                         '🌉', 2,  false),
('odin_son',         'onboarding', 'cup',    10, 'Сын Одина',          'Отработай 5 смен',                              '⚡', 3,  false),
('valkyrie_path',    'onboarding', 'medal',  25, 'Путь Валькирии',     'Отработай 10 смен',                             '🛡', 4,  false),
('seasoned_viking',  'onboarding', 'medal',  25, 'Бывалый викинг',     'Отработай 30 смен',                             '⚔️', 5,  false),
('asgard_warrior',   'onboarding', 'order',  50, 'Воин Асгарда',       'Отработай 100 смен',                            '🗡', 6,  false),
('saga_keeper',      'onboarding', 'legend', 100,'Хранитель саги',     'Отработай 300 смен',                            '📜', 7,  false),
-- Дисциплина
('iron_warrior',     'discipline', 'medal',  25, 'Железный воин',      '10 смен подряд без пропусков',                  '🔩', 10, false),
('mjolnir',          'discipline', 'order',  50, 'Мьёльнир',           '30 смен подряд без пропусков',                  '🔨', 11, false),
('indomitable',      'discipline', 'legend', 100,'Неукротимый',        '60 смен подряд без пропусков',                  '🌋', 12, false),
('clean_record',     'discipline', 'medal',  25, 'Чистая запись',      '30 дней без штрафов',                           '📋', 13, false),
('early_bird',       'discipline', 'cup',    10, 'Ранняя пташка',      '10 чекинов до 07:30',                           '🐦', 14, false),
('time_keeper',      'discipline', 'order',  50, 'Хранитель времени',  '50 смен с чекином вовремя',                     '⏰', 15, false),
('no_miss',          'discipline', 'medal',  25, 'Без промаха',        '20 чекинов подряд вовремя',                     '🎯', 16, false),
('fate_forger',      'discipline', 'legend', 100,'Кузнец судьбы',      '100 смен подряд без пропуска',                  '🔥', 17, false),
('discipline_shield','discipline', 'order',  50, 'Щит дисциплины',     '90 дней без штрафов',                           '🛡', 18, false),
-- Выносливость
('night_guard',      'endurance',  'cup',    10, 'Ночной страж',       '5 ночных смен',                                 '🌙', 20, false),
('moon_warrior',     'endurance',  'medal',  25, 'Лунный воин',        '20 ночных смен',                                '🌑', 21, false),
('fenrir_spirit',    'endurance',  'order',  50, 'Дух Фенрира',        '50 ночных смен',                                '🐺', 22, false),
('hel_master',       'endurance',  'legend', 100,'Хозяин Хеля',        '100 ночных смен',                               '💀', 23, false),
('marathoner',       'endurance',  'medal',  25, 'Марафонец',          '10 смен по 12+ часов',                          '🏃', 24, false),
('berserker',        'endurance',  'order',  50, 'Берсеркер',          '30 дней подряд без выходных',                   '🪓', 25, false),
('eternal_flame',    'endurance',  'order',  50, 'Вечный огонь',       '20 смен по 12+ часов',                          '🔥', 26, false),
-- Командировки
('east_path',        'travel',     'cup',    10, 'Путь на восток',     'Первая командировка (вахта)',                   '🧭', 30, false),
('world_wanderer',   'travel',     'medal',  25, 'Странник миров',     'Работал на 3 разных объектах',                  '🗺', 31, false),
('road_lord',        'travel',     'order',  50, 'Повелитель дорог',   '10 командировок',                               '🛣', 32, false),
('land_opener',      'travel',     'medal',  25, 'Открыватель земель', 'Работал у 5 разных заказчиков',                 '🏴', 33, false),
('bifrost_bridge',   'travel',     'order',  50, 'Мост через Бифрост', 'Командировка в другой регион',                  '🌈', 34, false),
('nine_worlds',      'travel',     'legend', 100,'Девять миров',       'Работал на 9 разных объектах',                  '🌍', 35, false),
('five_seas',        'travel',     'order',  50, 'Викинг пяти морей',  'Работал в 5 разных городах',                    '⚓', 36, false),
-- Финансы
('fafnir_gold',      'finance',    'cup',    10, 'Золото Фафнира',     'Заработал 50 000 руб.',                         '💰', 40, false),
('midgard_treasury', 'finance',    'medal',  25, 'Сокровищница Мидгарда','Заработал 200 000 руб.',                      '🏛', 41, false),
('dragon_hoard',     'finance',    'order',  50, 'Драконья казна',     'Заработал 500 000 руб.',                        '🐉', 42, false),
('valhalla_wealth',  'finance',    'legend', 100,'Богатство Валхаллы',  'Заработал 1 000 000 руб.',                     '👑', 43, false),
('clean_account',    'finance',    'medal',  25, 'Чистый счёт',        'Все авансы закрыты, нет долгов',                '✅', 44, false),
('thrifty_jarl',     'finance',    'order',  50, 'Бережливый ярл',     '5 месяцев без долгов',                          '🏺', 45, false),
('first_gold',       'finance',    'cup',    10, 'Первое золото',      'Подтвердил первую выплату',                     '🪙', 46, false),
-- Мастерство
('apprentice',       'mastery',    'cup',    10, 'Ученик',             'Первое назначение на объект',                   '📚', 50, false),
('right_hand',       'mastery',    'medal',  25, 'Правая рука мастера','20 смен помощником',                            '🤝', 51, false),
('master_resp',      'mastery',    'order',  50, 'Мастер ответственный','Назначен мастером',                            '🎖', 52, false),
('brigade_viking',   'mastery',    'order',  50, 'Бригадир-викинг',    '50 смен мастером',                              '⚔️', 53, false),
('work_king',        'mastery',    'legend', 100,'Конунг работ',       '100+ смен мастером',                            '👑', 54, false),
('shapeshifter',     'mastery',    'medal',  25, 'Многоликий',         'Работал на 3+ категориях объектов',             '🎭', 55, false),
-- Секретные
('hugin_eye',        'secret',     'order',  50, 'Око Хугина',         '???',                                           '👁', 90, true),
('dagaz_rune',       'secret',     'legend', 100,'Руна Дагаз',         '???',                                           '᛭', 91, true),
('chronicler',       'secret',     'order',  50, 'Летописец Асгарда',  '???',                                           '📷', 92, true),
('odin_chosen',      'secret',     'legend', 100,'Избранный Одина',    '???',                                           '✨', 93, true);

-- Seed: Призы рулетки (12 секторов)
INSERT INTO odin_roulette_prizes (prize_type, name, description, value, weight, requires_delivery) VALUES
('bonus_points', 'Дар Одина',              '+10 баллов',                 10, 25, false),
('bonus_points', 'Благословение Фрейи',    '+25 баллов',                 25, 15, false),
('bonus_points', 'Сокровище Нибелунгов',   '+50 баллов',                 50,  5, false),
('multiplier',   'Молот Тора',             'x2 следующая ачивка',          2,  8, false),
('badge',        'Руна Иса',               'Редкий бейдж — стойкость',    0, 12, false),
('badge',        'Руна Тюр',               'Редкий бейдж — воин',         0, 10, false),
('merch',        'Каска "Асгард"',         'Строительная каска с логотипом', 0,  3, true),
('merch',        'Шапка "Викинг"',         'Зимняя шапка с вышивкой',      0,  4, true),
('merch',        'Толстовка "Воин"',       'Толстовка с принтом Асгард',   0,  2, true),
('merch',        'Перчатки "Берсерк"',     'Рабочие перчатки премиум',     0,  3, true),
('merch',        'Кубок "Валхалла"',       'Термокружка "Зал Ярла"',       0,  1, true),
('empty',        'Локи украл!',            'В этот раз не повезло...',      0, 12, false);
```

### 5.2. Cron

**Файл**: `src/services/achievements-cron.js`

```javascript
'use strict';
const cron = require('node-cron');
let _task = null;

function start(db, log) {
  if (_task) return;
  // Каждый день в 02:00 MSK
  _task = cron.schedule('0 2 * * *', () => processAchievements(db, log), {
    timezone: 'Europe/Moscow',
  });
  log.info('[AchievementsCron] Started — daily 02:00 MSK');
}

async function processAchievements(db, log) {
  // 1. Получить всех активных рабочих (field_sessions за последние 90 дней)
  // 2. Для каждого рабочего:
  //    a) Собрать статистику (total_shifts, consecutive, night_shifts, etc.)
  //    b) Проверить каждое достижение из worker_achievements
  //    c) Если условие выполнено и ещё нет записи в employee_achievements → INSERT
  //    d) Начислить баллы в achievement_points_balance
  //    e) Отправить push-уведомление (если notified=false)
  // 3. Логировать результат
}
```

**Ночной запуск (02:00)** выбран потому что:
- Минимальная нагрузка на БД
- Не мешает рабочим процессам
- Все чекины за предыдущий день уже завершены

**Дополнительно**: при каждом checkout в `field-checkin.js` можно делать **inline check** для "моментальных" ачивок (Новый викинг, Страж Бифроста) — чтобы не ждать cron.

### 5.3. API endpoints

| Метод | Путь | Auth | Описание |
|---|---|---|---|
| `GET` | `/api/field-worker/achievements` | fieldAuth | Все достижения: полученные (ярко), неполученные (тёмно), секретные (???) |
| `GET` | `/api/field-worker/achievements/summary` | fieldAuth | Краткая сводка: earned/total, points_balance, last_3 |
| `GET` | `/api/field-worker/achievements/:id` | fieldAuth | Детали одного достижения + прогресс |
| `GET` | `/api/field-worker/roulette` | fieldAuth | Состояние рулетки: баланс, spins_today, prizes |
| `POST` | `/api/field-worker/roulette/spin` | fieldAuth | Вращение рулетки |
| `GET` | `/api/field-worker/roulette/history` | fieldAuth | История вращений (limit 50) |
| `POST` | `/api/field-worker/track-visit` | fieldAuth | Трекинг визита PWA (для секретных ачивок) |

**GET /achievements response:**
```json
{
  "summary": { "earned": 12, "total": 43, "points_balance": 145, "points_earned_total": 270 },
  "categories": [
    {
      "id": "onboarding",
      "name": "Вступление",
      "achievements": [
        { "id": "new_viking", "name": "Новый викинг", "tier": "cup", "points": 10,
          "earned": true, "earned_at": "2026-01-15T08:23:00Z",
          "progress": { "current": 1, "target": 1, "pct": 100 } },
        { "id": "odin_son", "name": "Сын Одина", "tier": "cup", "points": 10,
          "earned": false, "progress": { "current": 3, "target": 5, "pct": 60 } }
      ]
    }
  ],
  "secret": [
    { "id": "???", "name": "???", "description": "???", "earned": false },
    { "id": "hugin_eye", "name": "Око Хугина", "earned": true, "earned_at": "..." }
  ]
}
```

### 5.4. Mobile Frontend

#### Вариант 1: Field PWA (vanilla JS) — `/field/pages/achievements.js`

Плюсы: уже рабочая инфраструктура для рабочих, SW cached.
Минусы: сложнее делать рулетку, нет компонентной системы.

#### Вариант 2: React PWA — `/m/achievements` (РЕКОМЕНДУЕТСЯ)

Плюсы: компоненты, Zustand, анимации, Lucide, уже 53 страницы.
Минусы: рабочие пока не используют React PWA (нет FIELD_WORKER layout в виджетах).

**Рекомендуемый план:**
1. Добавить `FIELD_WORKER` layout в `widgets/index.js`
2. Создать `Achievements.jsx` — витрина по категориям
3. Создать `Roulette.jsx` — анимированная рулетка
4. Добавить маршруты `/achievements` и `/roulette` в `App.jsx`
5. Добавить виджет `AchievementsWidget.jsx` для дашборда (последние 3 ачивки)

**Структура экранов:**

```
/achievements
├── Header: "Достижения" + прогресс-бар (earned/total)
├── Points Badge: "145 ⚡" + кнопка "Рулетка Одина"
├── Categories (accordion):
│   ├── Вступление (3/7) ✅✅✅⬛⬛⬛⬛
│   ├── Дисциплина (2/9) ✅✅⬛⬛⬛⬛⬛⬛⬛
│   ├── ...
│   └── Секретные (0/4) ❓❓❓❓
└── Bottom: "Рулетка Одина 🎰"

/roulette
├── Header: "Рулетка Одина" + баланс "145 ⚡"
├── Wheel (CSS conic-gradient + rotation animation)
├── Spin Button: "Вращать (30 ⚡)" — disabled если мало баллов
├── Today spins: "Осталось вращений: 2/3"
└── History (collapsible list)
```

### 5.5. Push-уведомления

При получении ачивки — push через `pushService.sendPush()`:

```javascript
async function notifyAchievement(db, empId, achievement) {
  // 1. Попробовать через employees.user_id → pushService
  const { rows: [emp] } = await db.query(
    'SELECT user_id, fio FROM employees WHERE id=$1', [empId]);

  if (emp?.user_id) {
    await pushService.sendPush(db, emp.user_id, {
      title: `🏆 Новое достижение!`,
      body: `${achievement.name} — ${achievement.description}`,
      tag: `achievement-${achievement.id}`,
      url: '/field/#achievements',
      actions: [
        { action: 'view', title: '👀 Посмотреть' }
      ],
      data: { entityType: 'achievement', entityId: achievement.id }
    });
  }

  // 2. Также: createNotification для in-app уведомления
  if (emp?.user_id) {
    await createNotification(db, {
      user_id: emp.user_id,
      title: `Достижение: ${achievement.name}`,
      message: achievement.description,
      type: 'achievement',
      link: '#/achievements'
    });
  }

  // 3. Пометить как уведомлённое
  await db.query(
    `UPDATE employee_achievements SET notified=true WHERE employee_id=$1 AND achievement_id=$2`,
    [empId, achievement.id]);
}
```

**Проблема**: Многие рабочие могут не иметь `user_id` (нет аккаунта в users). Push и уведомления требуют `user_id` → нужен fallback:
- SMS через Mango (уже есть в `field_sms_log`, `MangoService`)
- Или показывать inline-уведомление при следующем визите в PWA

---

## 6. План этапов

### Этап 1: Миграция БД и seed данных (30 мин)
- [ ] Создать миграцию `V090__achievements_roulette.sql`
- [ ] 6 таблиц + seed 47 ачивок + seed 12 призов рулетки
- [ ] Применить на сервере (`psql -f`)
- **Критерий**: Таблицы созданы, seed вставлен, `SELECT count(*) FROM worker_achievements` = 47

### Этап 2: Сервис подсчёта статистики (45 мин)
- [ ] Создать `src/services/achievement-checker.js`
- [ ] Функция `getAchievementStats(db, empId)` — один SQL запрос для всех метрик
- [ ] Функция `checkAndGrant(db, empId, stats)` — проверка + INSERT в employee_achievements
- [ ] Функция `creditPoints(db, empId, points)` — начисление баллов
- **Критерий**: Unit-тест: передать stats → получить список новых ачивок

### Этап 3: API endpoints для достижений (40 мин)
- [ ] `GET /api/field-worker/achievements` — все с прогрессом
- [ ] `GET /api/field-worker/achievements/summary` — краткая сводка
- [ ] `POST /api/field-worker/track-visit` — трекинг визита
- [ ] Интеграция: при checkout вызывать inline check
- **Критерий**: curl тесты — 3 эндпоинта отвечают корректно

### Этап 4: API рулетки (40 мин)
- [ ] `GET /api/field-worker/roulette` — состояние
- [ ] `POST /api/field-worker/roulette/spin` — вращение (weighted random + transaction)
- [ ] `GET /api/field-worker/roulette/history` — история
- [ ] Anti-abuse: лимит 3/день, cooldown 60с
- **Критерий**: Тест: spin → баланс уменьшился, запись в spins, приз вернулся

### Этап 5: Cron-задача (30 мин)
- [ ] `src/services/achievements-cron.js` — ежедневная проверка
- [ ] Регистрация в `src/index.js`
- [ ] Push-уведомление при новой ачивке
- [ ] Backfill: однократный запуск для всех существующих рабочих
- **Критерий**: Ручной запуск cron → рабочие с >=1 сменой получили "Новый викинг"

### Этап 6: Мобильный экран "Достижения" (60 мин)
- [ ] `Achievements.jsx` — витрина по категориям
- [ ] Категории-аккордеон, тиры с цветами/свечением
- [ ] Прогресс-бар для незаработанных
- [ ] Секретные — "???" до получения
- [ ] Анимация появления (stagger, scale-in)
- **Критерий**: Скриншот экрана с тестовыми данными

### Этап 7: Мобильный экран "Рулетка Одина" (60 мин)
- [ ] `Roulette.jsx` — анимированное колесо
- [ ] CSS conic-gradient + rotation transition 4s
- [ ] Кнопка "Вращать" с cost badge
- [ ] Popup результата (gold glow / red smoke)
- [ ] Счётчик вращений
- **Критерий**: Видео-демо рулетки в действии

### Этап 8: Виджет дашборда + Профиль (40 мин)
- [ ] `AchievementsWidget.jsx` — последние 3 ачивки для Home
- [ ] Интеграция в `widgets/index.js` (role: FIELD_WORKER или *)
- [ ] Профиль: счётчик "12/47 достижений" + мини-прогресс
- [ ] Маршруты в `App.jsx`
- **Критерий**: Виджет отображается на дашборде

### Этап 9: Обновление field-worker.js (30 мин)
- [ ] Заменить хардкод `FIELD_ACHIEVEMENTS` на данные из БД
- [ ] `/me` — включить `achievements_summary` из `employee_achievements`
- [ ] Убрать старый inline подсчёт, делегировать `achievement-checker.js`
- **Критерий**: GET /me возвращает ачивки из БД вместо хардкода

### Этап 10: CSS-стили и визуал (45 мин)
- [ ] Тиры: бронзовый / серебро / золото / руна с пульсом
- [ ] Свечение: `box-shadow` + `@keyframes pulse-glow`
- [ ] Секретные: silhouette + "???" + shimmer
- [ ] Рулетка: conic-gradient, pointer, confetti при выигрыше
- [ ] Адаптация для dark/light theme
- **Критерий**: Visual QA — все 4 тира выглядят различимо

### Этап 11: Push-уведомления + Inline check (30 мин)
- [ ] Push при новой ачивке (через pushService или SMS fallback)
- [ ] Inline check при checkout (моментальные ачивки)
- [ ] Toast/banner в PWA при получении ачивки в реальном времени
- **Критерий**: Checkout → push приходит → в приложении banner

### Этап 12: Backfill + тестирование + деплой (45 мин)
- [ ] SQL-скрипт backfill для всех существующих рабочих
- [ ] E2E тесты: API (5+ тестов), Playwright скриншоты (3+)
- [ ] Деплой: миграция → backfill → рестарт → проверка
- [ ] SW version bump
- **Критерий**: 100% тестов зелёные, production данные корректны

---

## 7. Риски и открытые вопросы

### Риски

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| **Cron-нагрузка** — проверка всех ачивок для всех рабочих | Низкая | Средняя | Проверять только рабочих с активностью за последние 7 дней; batch по 50 |
| **Race condition** — два процесса пытаются выдать одну ачивку | Средняя | Низкая | `UNIQUE(employee_id, achievement_id)` + `ON CONFLICT DO NOTHING` |
| **Backfill** — первый запуск может создать тысячи записей | Средняя | Низкая | Запускать ночью, batch INSERT, отключить push для backfill |
| **Отмена ачивки** — смена удалена/отменена → ачивка уже выдана | Низкая | Средняя | Ачивки **не отзываются** (design decision). Если смена cancelled → при следующем cron ачивка останется. Это упрощает систему и избегает frustration. |
| **Push без user_id** — у многих рабочих нет user_id | Высокая | Средняя | При логине в Field PWA создавать user, или показывать inline-toast |
| **SW кэш** — старая версия PWA не видит новый экран | Средняя | Высокая | **SHELL_VERSION bump** (обязательно при деплое!) |
| **Рулетка abuse** — бот крутит рулетку | Низкая | Средняя | Rate limit 3/день + 60с cooldown + fieldAuth JWT |

### Открытые вопросы

1. **Field PWA или React PWA?** — Где делать UI? Рекомендация: React PWA (`/m/`), но нужно добавить FIELD_WORKER layout. Если рабочие используют только `/field/` — делать в vanilla.

2. **"Мост через Бифрост" (>1000 км)** — Откуда брать расстояние? Варианты:
   - (a) Ручной ввод при создании логистики
   - (b) Геокодинг city → coordinates → haversine
   - (c) Заменить на "работал в другом регионе" (проще)

3. **Физические призы рулетки** — Кто доставляет? PM на объекте? Нужен workflow:
   - Рабочий выиграл → `is_delivered=false` → PM видит в дашборде → вручает → `is_delivered=true`

4. **Множитель "Молот Тора" (x2)** — Как реализовать? Варианты:
   - (a) Следующая ачивка даёт x2 очков (нужен флаг `pending_multiplier`)
   - (b) Мгновенный бонус +N% от текущего баланса (проще)

5. **"Бережливый ярл" (5 мес без долгов)** — Как определить "долг"? Текущая логика `worker_payments` не имеет явного баланса "долг/переплата" по месяцам. Нужен расчёт через `getWorkerFinances()`.

6. **Эмодзи vs SVG иконки** — Для тиров/ачивок лучше использовать SVG-иконки (руны) вместо эмодзи, чтобы не зависеть от платформы. Можно использовать Lucide или кастомные SVG.
