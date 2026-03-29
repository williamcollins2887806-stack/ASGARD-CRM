# ASGARD Field — Полевой модуль CRM
## Техническая спецификация v1.0
### Дата: 29.03.2026

---

## 1. КОНЦЕПЦИЯ

**ASGARD Field** — мини-PWA для полевых сотрудников (рабочих и мастеров), доступный через SMS-ссылку. Не зависит от мессенджеров. Работает в браузере телефона, устанавливается на рабочий стол как приложение.

**Ключевой принцип:** Рабочий открывает ссылку из SMS → авторизуется по номеру телефона + SMS-код → получает личный кабинет со всей историей работ, финансами, билетами и отметками.

**Дух ASGARD:** Тёмная нордическая тема, логотип Асгард, викингские цитаты/кличи перед сменой, анимированный герой-баннер. Качество уровня Sber/Yandex.

---

## 2. СУЩЕСТВУЮЩИЕ СУЩНОСТИ CRM (используем как есть)

### Таблицы, которые уже работают:

| Таблица | Для чего используем |
|---------|-------------------|
| `employees` | Профиль рабочего: `fio`, `phone`, `day_rate`, `naks`, `naks_expiry`, `imt_number`, `imt_expires`, `permits`, `city`, `is_self_employed` |
| `employee_assignments` | Привязка сотрудник ↔ работа: `employee_id`, `work_id`, `role`, `date_from`, `date_to` — **роль на проекте уже здесь** |
| `employee_rates` | Ставки: `employee_id`, `role_tag`, `day_rate`, `shift_rate`, `overtime_rate`, `effective_from/to` |
| `works` | Проекты: `work_title`, `city`, `address`, `object_name`, `pm_id`, `contact_person`, `contact_phone`, `is_vachta`, `rotation_days` |
| `business_trips` | Командировки: `work_id`, `employees_json`, `date_from/to`, `transport_type`, `advance_amount` |
| `travel_expenses` | Расходы по поездке: `work_id`, `employee_id`, `expense_type`, `amount`, `date` |
| `payroll_sheets` / `payroll_items` | Ведомости: `work_id`, `employee_id`, `days_worked`, `day_rate`, `base_amount`, `bonus`, `advance_paid`, `payout`, `role_on_work` |
| `one_time_payments` | Разовые выплаты: `employee_id`, `work_id`, `amount`, `reason`, `status` |
| `work_expenses` | Расходы проекта: `work_id`, `category`, `amount`, `employee_id` |
| `documents` | Файлы (билеты, чеки): `type='travel'`, `tender_id` (=trip_id), `download_url` |
| `push_subscriptions` | Web Push подписки (уже работают) |

### Сервисы, которые уже работают:

| Сервис | Файл | Что используем |
|--------|------|----------------|
| `MangoService.sendSms()` | `src/services/mango.js` | Отправка SMS (авторизация, уведомления) |
| Push API | `src/routes/push.js` | Web Push уведомления с VAPID |
| Notifications | `src/services/notify.js` | `createNotification()` для in-app |

---

## 3. НОВЫЕ ТАБЛИЦЫ БД

### Миграция V047__field_module.sql

```sql
-- ═══════════════════════════════════════════════════════════
-- ASGARD Field — Полевой модуль
-- ═══════════════════════════════════════════════════════════

-- 1. SMS-авторизация (для field и потенциально для будущих модулей)
CREATE TABLE field_auth_codes (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    code VARCHAR(6) NOT NULL,
    employee_id INTEGER REFERENCES employees(id),
    attempts INTEGER DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_field_auth_phone ON field_auth_codes(phone, used, expires_at);

-- 2. Сессии полевых сотрудников (JWT токены)
CREATE TABLE field_sessions (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    device_info TEXT,
    push_subscription JSONB,
    last_active_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_field_sessions_employee ON field_sessions(employee_id);
CREATE INDEX idx_field_sessions_token ON field_sessions(token_hash);

-- 3. Отметки прихода/ухода
CREATE TABLE field_checkins (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    work_id INTEGER NOT NULL REFERENCES works(id),
    assignment_id INTEGER REFERENCES employee_assignments(id),
    
    -- Начало смены
    checkin_at TIMESTAMP NOT NULL,
    checkin_lat DECIMAL(10,7),
    checkin_lng DECIMAL(10,7),
    checkin_accuracy DECIMAL(8,2),  -- GPS accuracy в метрах
    checkin_source VARCHAR(20) DEFAULT 'self',  -- 'self' | 'master' | 'admin'
    checkin_by INTEGER,  -- если отметил мастер — его employee_id
    
    -- Конец смены
    checkout_at TIMESTAMP,
    checkout_lat DECIMAL(10,7),
    checkout_lng DECIMAL(10,7),
    checkout_accuracy DECIMAL(8,2),
    checkout_source VARCHAR(20),
    checkout_by INTEGER,
    
    -- Расчёт
    hours_worked DECIMAL(5,2),  -- рассчитывается при checkout
    hours_paid DECIMAL(5,2),    -- с округлением по правилам проекта
    day_rate DECIMAL(12,2),     -- ставка на момент фиксации
    amount_earned DECIMAL(12,2), -- = hours_paid / schedule_hours * day_rate
    
    -- Мета
    date DATE NOT NULL,  -- рабочий день (для группировки)
    shift VARCHAR(20) DEFAULT 'day',  -- 'day' | 'night' | 'full'
    status VARCHAR(20) DEFAULT 'active',  -- 'active' | 'completed' | 'cancelled' | 'edited'
    edit_reason TEXT,  -- если status='edited'
    note TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_field_checkins_employee_date ON field_checkins(employee_id, date);
CREATE INDEX idx_field_checkins_work ON field_checkins(work_id, date);
CREATE UNIQUE INDEX idx_field_checkins_unique ON field_checkins(employee_id, work_id, date, shift) 
    WHERE status != 'cancelled';

-- 4. Дневные отчёты (заполняет мастер)
CREATE TABLE field_daily_reports (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    date DATE NOT NULL,
    shift VARCHAR(20) DEFAULT 'day',
    
    -- Автор
    author_id INTEGER NOT NULL REFERENCES employees(id),  -- мастер
    author_role VARCHAR(50),  -- роль на проекте
    
    -- Данные отчёта (структура определяется шаблоном)
    template_id INTEGER REFERENCES field_report_templates(id),
    report_data JSONB NOT NULL DEFAULT '{}',
    -- Пример для КАО Азот: {"apparatus": 1, "tubes_done": 87, "diameter": 25, "notes": "..."}
    -- Пример для химчистки: {"stage": "acid_cycle_2", "temperature": 42, "ph": 1.5}
    
    -- Состав бригады (снимок на момент отчёта)
    crew_snapshot JSONB,
    -- [{"employee_id": 1, "fio": "Иванов", "status": "worked", "hours": 10.5}, ...]
    
    -- Простои
    downtime_minutes INTEGER DEFAULT 0,
    downtime_reason TEXT,
    
    -- Статус
    status VARCHAR(20) DEFAULT 'draft',  -- 'draft' | 'submitted' | 'accepted'
    accepted_by INTEGER,  -- РП
    accepted_at TIMESTAMP,
    
    comment TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_field_reports_work_date ON field_daily_reports(work_id, date);
CREATE UNIQUE INDEX idx_field_reports_unique ON field_daily_reports(work_id, date, shift, author_id);

-- 5. Шаблоны отчётов (настраивает РП под каждый тип работ)
CREATE TABLE field_report_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,  -- "Гидромеханика трубок", "Химическая чистка", "АВД"
    description TEXT,
    
    -- Поля шаблона
    fields JSONB NOT NULL DEFAULT '[]',
    -- [
    --   {"key": "apparatus", "label": "Аппарат", "type": "select", "options": ["1","2"], "required": true},
    --   {"key": "tubes_done", "label": "Трубок пробурено", "type": "number", "required": true},
    --   {"key": "diameter", "label": "Диаметр, мм", "type": "select", "options": ["20","25","30","33"]},
    --   {"key": "notes", "label": "Примечания", "type": "text"}
    -- ]
    
    -- Единица прогресса (для прогресс-бара в CRM)
    progress_unit VARCHAR(50),  -- "трубок" | "м²" | "шт" | null
    progress_field VARCHAR(50), -- ключ поля из fields, которое суммируется
    progress_total INTEGER,     -- общий план (6872 трубок)
    
    -- Применимость
    work_type VARCHAR(100),  -- 'hydromechanical' | 'chemical' | 'hvac' | 'avd' | null=универсальный
    is_default BOOLEAN DEFAULT FALSE,
    
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 6. Фотоотчёты
CREATE TABLE field_photos (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    work_id INTEGER NOT NULL REFERENCES works(id),
    report_id INTEGER REFERENCES field_daily_reports(id),
    checkin_id INTEGER REFERENCES field_checkins(id),
    
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255),
    mime_type VARCHAR(50),
    size INTEGER,
    
    photo_type VARCHAR(30) DEFAULT 'work',  -- 'work' | 'before' | 'after' | 'incident' | 'checkin'
    caption TEXT,
    lat DECIMAL(10,7),
    lng DECIMAL(10,7),
    taken_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_field_photos_work ON field_photos(work_id, created_at);

-- 7. Инциденты и простои
CREATE TABLE field_incidents (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    reported_by INTEGER NOT NULL REFERENCES employees(id),
    
    incident_type VARCHAR(50) NOT NULL,
    -- 'no_material' | 'equipment_failure' | 'weather' | 'no_permit' | 
    -- 'injury' | 'quality_issue' | 'other'
    
    description TEXT NOT NULL,
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP,
    duration_minutes INTEGER,
    
    severity VARCHAR(20) DEFAULT 'medium',  -- 'low' | 'medium' | 'high' | 'critical'
    status VARCHAR(20) DEFAULT 'open',  -- 'open' | 'resolved' | 'escalated'
    resolution TEXT,
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- 8. SMS-рассылки (лог)
CREATE TABLE field_sms_log (
    id SERIAL PRIMARY KEY,
    work_id INTEGER REFERENCES works(id),
    employee_id INTEGER REFERENCES employees(id),
    phone VARCHAR(20) NOT NULL,
    
    message_type VARCHAR(50) NOT NULL,
    -- 'auth_code' | 'assignment' | 'ticket' | 'schedule_change' | 
    -- 'reminder' | 'broadcast' | 'payroll'
    
    message_text TEXT NOT NULL,
    
    status VARCHAR(20) DEFAULT 'sent',  -- 'sent' | 'delivered' | 'failed'
    mango_response JSONB,
    
    sent_by INTEGER,  -- кто инициировал (РП, система, офис-менеджер)
    created_at TIMESTAMP DEFAULT NOW()
);

-- 9. Логистика проекта (билеты, гостиницы — привязка к сотруднику + проект)
CREATE TABLE field_logistics (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    trip_id INTEGER REFERENCES business_trips(id),
    
    item_type VARCHAR(30) NOT NULL,
    -- 'ticket_to' | 'ticket_back' | 'hotel' | 'transfer' | 'visa' | 'insurance'
    
    title VARCHAR(255) NOT NULL,  -- "S7-2541 Москва→Кемерово"
    description TEXT,
    
    date_from DATE,
    date_to DATE,
    
    -- Детали (зависят от типа)
    details JSONB DEFAULT '{}',
    -- Билет: {"flight": "S7-2541", "departure": "08:30", "arrival": "14:30", "seat": "12A"}
    -- Гостиница: {"hotel": "Кузбасс", "address": "ул. Ленина 42", "room": "304"}
    -- Трансфер: {"from": "Аэропорт", "to": "Гостиница", "driver_phone": "+7..."}
    
    -- Файл (PDF билета, бронь)
    document_id INTEGER REFERENCES documents(id),
    
    -- Статусы
    status VARCHAR(30) DEFAULT 'pending',  -- 'pending' | 'booked' | 'sent' | 'confirmed'
    sent_to_employee BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP,
    
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_field_logistics_work ON field_logistics(work_id);
CREATE INDEX idx_field_logistics_employee ON field_logistics(employee_id);

-- 10. Настройки проекта для Field-модуля
CREATE TABLE field_project_settings (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL UNIQUE REFERENCES works(id),
    
    -- Активация
    is_active BOOLEAN DEFAULT TRUE,
    activated_at TIMESTAMP,
    activated_by INTEGER,
    
    -- Шаблон отчёта
    report_template_id INTEGER REFERENCES field_report_templates(id),
    
    -- Правила расчёта
    schedule_type VARCHAR(20) DEFAULT 'shift',  -- 'shift' | 'hourly'
    shift_hours DECIMAL(4,1) DEFAULT 11.0,  -- нормативная смена
    rounding_rule VARCHAR(20) DEFAULT 'half_up',  -- 'half_up' | 'ceil' | 'floor' | 'none'
    rounding_step DECIMAL(3,1) DEFAULT 0.5,  -- шаг округления (0.5ч)
    per_diem DECIMAL(10,2) DEFAULT 0,  -- суточные за день
    
    -- Гео-ограничения (центр объекта + радиус)
    object_lat DECIMAL(10,7),
    object_lng DECIMAL(10,7),
    geo_radius_meters INTEGER DEFAULT 500,
    geo_required BOOLEAN DEFAULT FALSE,  -- обязательна ли геолокация
    
    -- Настройки уведомлений
    shift_start_reminder VARCHAR(5),  -- "07:30" — время напоминания о начале смены
    daily_report_reminder VARCHAR(5), -- "19:00" — напоминание мастеру об отчёте
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 4. РАСШИРЕНИЯ СУЩЕСТВУЮЩИХ ТАБЛИЦ

```sql
-- Добавляем поля в employees для Field-авторизации
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS field_pin VARCHAR(4);  -- необязательный быстрый PIN
ALTER TABLE employees ADD COLUMN IF NOT EXISTS field_last_login TIMESTAMP;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS clothing_size VARCHAR(10);  -- размер спецодежды
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shoe_size VARCHAR(10);

-- Расширяем employee_assignments для ролей на проекте
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS field_role VARCHAR(30) DEFAULT 'worker';
-- 'worker' | 'shift_master' | 'senior_master'
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS per_diem DECIMAL(10,2);
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS shift_type VARCHAR(20) DEFAULT 'day';
-- 'day' | 'night' | 'rotating'
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS sms_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS sms_sent_at TIMESTAMP;
```

---

## 5. API ENDPOINTS

### 5.1 Авторизация Field (`src/routes/field-auth.js`)

```
POST /api/field/auth/request-code
  Body: { phone: "+79296426955" }
  → Ищет employee по phone → генерирует 4-значный код → отправляет SMS
  → Response: { ok: true, expires_in: 300 }
  
POST /api/field/auth/verify-code
  Body: { phone: "+79296426955", code: "4521" }
  → Проверяет код → создаёт JWT (90 дней) → сохраняет field_session
  → Response: { token: "...", employee: { id, fio, phone } }

POST /api/field/auth/refresh
  Header: Authorization: Bearer <token>
  → Продлевает сессию
  
POST /api/field/auth/logout
  → Удаляет field_session
```

### 5.2 Данные рабочего (`src/routes/field-worker.js`)

```
GET /api/field/me
  → Профиль: fio, phone, permits, naks, допуски, фото, размеры
  
GET /api/field/me/active-project
  → Текущий активный проект (work + assignment + settings + pm + master info)
  → Включает: work_title, city, object_name, pm_fio, pm_phone, 
              master_fio, master_phone, day_rate, per_diem, 
              today_checkin (если есть), today_earnings
  
GET /api/field/me/projects
  → Все проекты сотрудника (история): work_title, city, date_from/to, 
    role, total_days, total_earned, pm_name
    
GET /api/field/me/projects/:work_id
  → Детали конкретного проекта: табель по дням, заработок, фото

GET /api/field/me/finances
  → Сводка по финансам:
    - current_project: { earned_total, per_diem_total, advances_paid, to_pay }
    - all_time: { total_earned, total_paid, total_pending }
    
GET /api/field/me/finances/:work_id
  → Финансы по конкретному проекту:
    - days_worked, day_rate, base_amount
    - per_diem_days, per_diem_rate, per_diem_total
    - bonuses, penalties, overtime
    - advances: [{ date, amount, method }]
    - total_earned, total_paid, remaining

GET /api/field/me/logistics
  → Все билеты/гостиницы (текущие и предстоящие)
  
GET /api/field/me/logistics/history
  → Архив логистики по всем проектам

GET /api/field/me/documents
  → Документы сотрудника: удостоверения, допуски, командировочные
```

### 5.3 Смены / чекины (`src/routes/field-checkin.js`)

```
POST /api/field/checkin
  Body: { work_id, lat?, lng?, accuracy?, note? }
  → Фиксирует начало смены (время = серверное NOW())
  → Проверяет: assignment есть и активный, не отметился уже сегодня
  → Response: { checkin_id, checkin_at, today_rate, message: "Славной смены, воин!" }

POST /api/field/checkout
  Body: { checkin_id, lat?, lng?, accuracy?, note? }
  → Фиксирует конец смены
  → Рассчитывает hours_worked, hours_paid (с округлением), amount_earned
  → Response: { hours_worked, hours_paid, earned_today, message }

-- Для мастера:
POST /api/field/checkin/manual
  Body: { employee_id, work_id, checkin_at, checkout_at?, reason }
  → Мастер отмечает рабочего вручную
  → checkin_source = 'master', checkin_by = master_employee_id

GET /api/field/checkins/today?work_id=X
  → Все отметки за сегодня по проекту (для мастера/РП)
```

### 5.4 Отчёты мастера (`src/routes/field-reports.js`)

```
GET /api/field/report-template/:work_id
  → Шаблон отчёта для данного проекта

POST /api/field/reports
  Body: { work_id, date, shift, report_data: {...}, crew_snapshot: [...] }
  → Создать дневной отчёт

GET /api/field/reports?work_id=X&date_from=...&date_to=...
  → Список отчётов (для мастера и РП)
  
POST /api/field/incidents
  Body: { work_id, incident_type, description, severity, photos? }
  → Зафиксировать инцидент/простой
```

### 5.5 Фото (`src/routes/field-photos.js`)

```
POST /api/field/photos/upload
  Multipart: file + { work_id, photo_type, caption?, report_id?, checkin_id? }
  → Загрузка фото (сжатие на сервере до 1920px, EXIF → lat/lng/timestamp)

GET /api/field/photos?work_id=X&date=...
  → Фото по проекту/дате
```

### 5.6 Управление проектом — для РП (`src/routes/field-manage.js`)

```
POST /api/field/projects/:work_id/activate
  Body: { report_template_id, schedule_type, shift_hours, per_diem, 
          geo_lat, geo_lng, geo_radius }
  → Активировать Field-модуль на проекте

POST /api/field/projects/:work_id/crew
  Body: { employees: [{ employee_id, field_role, day_rate, per_diem, shift_type }] }
  → Назначить бригаду (создаёт employee_assignments + field_role)

POST /api/field/projects/:work_id/send-invites
  Body: { employee_ids: [1,2,3] } или { all: true }
  → Отправить SMS-приглашения бригаде
  → SMS: "Вы назначены на проект {title}, {city}. Выезд {date}. 
          Ваш ЛК: asgard-crm.ru/field"

POST /api/field/projects/:work_id/broadcast
  Body: { message, employee_ids?, channel: 'sms'|'push'|'both' }
  → Рассылка бригаде (произвольное сообщение)

GET /api/field/projects/:work_id/dashboard
  → Дашборд: кто на объекте, часы, прогресс, расходы

GET /api/field/projects/:work_id/timesheet
  → Табель за период (с выгрузкой в Excel)

GET /api/field/projects/:work_id/progress
  → Прогресс по шаблону отчёта (сумма progress_field)
```

### 5.7 Логистика — для офис-менеджера (`src/routes/field-logistics.js`)

```
POST /api/field/logistics
  Body: { work_id, employee_id, item_type, title, details, date_from, date_to }
  → Добавить билет/гостиницу

POST /api/field/logistics/:id/attach
  Multipart: file (PDF билета)
  → Прикрепить документ

POST /api/field/logistics/:id/send
  → Отправить сотруднику SMS: "В ваш ЛК добавлен билет {title}. 
    Подробности: asgard-crm.ru/field"

GET /api/field/logistics?work_id=X
  → Список всей логистики проекта с матрицей статусов
```

---

## 6. ФРОНТЕНД — FIELD PWA

### 6.1 Архитектура

Отдельная точка входа: `public/field/index.html` — минимальный HTML, подключает:
- `field/ds-field.js` — подмножество DS.js (только токены + базовые хелперы)
- `field/components.js` — упрощённые M.* компоненты (10-12 вместо 38)
- `field/router.js` — простой hash-роутер
- `field/pages/*.js` — экраны
- `field/sw.js` — Service Worker с офлайн и Background Sync

**НЕ подключает** основные app.css/theme.css (283+267KB). Полная CSS-изоляция.

Nginx: отдельный `location /field` → обслуживает field/index.html для всех подпутей.

### 6.2 Дизайн-система Field

Базируется на DS.js mobile v3, но упрощённая. Только dark-тема по умолчанию (рабочие на объекте — тёмная тема лучше видна на солнце). Light доступна в настройках.

**Цвета:** Из DS.js — `heroGrad`, `gold`, `red`, `blue`, `green`. Акцентный — `gold` (викингское золото).

**Типографика:** DS.js `hero`, `lg`, `md`, `base`, `sm` — без изменений.

**Компоненты Field (на базе M.*):**

| Компонент | Основа из M.* | Отличия для Field |
|-----------|--------------|-------------------|
| `F.Header` | `M.Header` | + логотип Асгард слева, + кнопка звонка справа |
| `F.HeroCard` | `M.HeroCard` | Баннер с викингской цитатой + время/дата + боевой клич |
| `F.BigButton` | `M.FullWidthBtn` | Увеличенный (64px высота), крупный текст, haptic feedback |
| `F.Card` | `M.Card` | Без изменений |
| `F.MoneyCard` | новый | Карточка заработка: сумма крупным шрифтом gold, формула мелким |
| `F.Timeline` | `M.Timeline` | Лента отметок/событий за день |
| `F.CrewList` | новый | Список бригады с статусами (для мастера) |
| `F.ReportForm` | `M.Form` | Динамическая форма из template.fields |
| `F.PhotoGrid` | новый | Сетка фото 3 в ряд с полноэкранным просмотром |
| `F.CallButton` | новый | Кнопка «Позвонить РП/мастеру» — `tel:` ссылка |
| `F.Toast` | `M.Toast` | Викингские сообщения |
| `F.BottomSheet` | `M.BottomSheet` | Без изменений |

### 6.3 Экраны (маршруты)

```
/field                   → редирект на /field/login или /field/home
/field/login             → Авторизация по SMS
/field/home              → Главная (активный проект + быстрые действия)
/field/shift             → Управление сменой (чекин/чекаут)
/field/money             → Мои деньги (текущий проект + история)
/field/money/:work_id    → Финансы по конкретному проекту
/field/logistics         → Билеты и гостиницы
/field/history           → История всех работ
/field/history/:work_id  → Детали проекта (табель, фото, заработок)
/field/photos            → Фотоотчёты
/field/profile           → Мой профиль
/field/crew              → Состав бригады (только мастер)
/field/report            → Дневной отчёт (только мастер)
/field/incidents         → Инциденты (только мастер)
```

### 6.4 Детальное описание экранов

#### /field/login — Авторизация

Тёмный фон с `heroGrad`. По центру:
- Логотип `asgard_emblem.png` (128px) с мягким gold свечением
- «ASGARD» крупным `DS.font('hero')` шрифтом, gold
- «Полевой модуль» `DS.font('md')`, textSec

Поле ввода телефона: маска +7 (___) ___-__-__. Крупный шрифт (20px). 
Кнопка «Получить код» — gold градиент, полная ширина.

После отправки → поле ввода 4-значного кода, автофокус, авто-submit при 4 цифрах.
Таймер повторной отправки: 60 сек.

#### /field/home — Главная

**Hero-баннер** (полная ширина, `heroGrad`, скруглённые углы внизу):
- Приветствие: «Доброе утро, Рустам!» (DS.font('lg'), white)
- Дата: «понедельник, 9 апреля 2026» (DS.font('sm'), white 0.6)
- Викингская цитата дня (DS.font('sm'), gold, italic):
  
  Расширенный набор цитат (30+):
  ```
  «Не бойся медленного продвижения — бойся остановки»
  «Лучше быть волком один день, чем овцой всю жизнь»
  «В бурю кормчий познаётся»
  «Каждый день — поход за славой»
  «Кто рано встаёт, тому Один даёт»
  «Сильный духом побеждает сильного телом»
  «Дела говорят громче рун»
  «Мудрый путник далеко не заходит в одиночку»
  «Своё железо куй, пока горячо»
  «Даже Тор пахал прежде, чем метал молнии»
  «Слава приходит к тому, кто работает молча»
  «Валгалла ждёт тех, кто не сдаётся»
  «Рука помощи ближе, чем ты думаешь»
  «Один весло не сдвинет корабль»
  «Битва выиграна до рассвета — подготовкой»
  «Нет плохой погоды — есть слабые воины»
  «Щит ломается — дух крепчает»
  «Асгард строится каждый день»
  ...
  ```

**Карточка активного проекта** (surface, скруглённые углы):
- Название проекта (DS.font('md'), text)
- Город, объект (DS.font('sm'), textSec)
- Две кнопки звонка в ряд:
  - 📞 РП: Андросов Н.А. → `tel:+7...`
  - 📞 Мастер: Магомедов Р.Д. → `tel:+7...`

**Большая кнопка действия:**
- Если нет чекина сегодня: `[⚔️ НАЧАТЬ СМЕНУ]` — gold градиент, пульсирующая анимация
- Если есть чекин: `[🛡 ЗАВЕРШИТЬ СМЕНУ — 8ч 42мин]` — red, таймер тикает

**Сегодня заработано** (MoneyCard):
- «4 500 ₽» — DS.font('xl'), gold
- «8ч × 500₽/день + суточные 500₽» — DS.font('xs'), textSec

**Быстрые действия** (иконки в ряд):
- 💰 Деньги
- ✈️ Билеты  
- 📷 Фото
- 📋 История

**Если мастер — дополнительно:**
- 👥 Бригада (с badge: 12/15)
- 📝 Отчёт
- ⚠️ Инцидент

#### /field/money — Мои деньги

**Верхняя карточка (heroGradSoft):**
- «Текущий проект: КАО Азот»
- Общий заработок: «32 500 ₽» — hero-шрифт, gold
- Прогресс-бар: «Отработано 7 из 20 смен»

**Разбивка (секция):**
- Тариф: Слесарь (полный функционал) · 11 баллов
- Ставка: 7 смен × 5 500₽ = 38 500₽
- Совмещение (сварщик): 7 смен × 500₽ = 3 500₽
- Пайковые: 10 дней × 1 000₽ = 10 000₽
- **Итого начислено: 52 000₽**
- Авансы: −10 000₽ (05.04, карта)
- **К выплате: 42 000₽**

Тарифная сетка утверждена Кудряшовым О.С. 01.10.2025. 1 балл = 500₽.

Каждая строка — DS.font('base'), правая колонка жирная. Суммы итого — gold.

**Кнопка:** «Вся история доходов →» → /field/money/history

**История доходов (лента):**
Все проекты, от нового к старому:
- КАО Азот (текущий) — 32 500₽ (в процессе)
- АРХБУМ — 12 000₽ (выплачено ✅)
- НОВАТЭК — 87 300₽ (выплачено ✅)

При нажатии → детальная разбивка по проекту.

#### /field/logistics — Билеты и гостиницы

Лента карточек с иконками:

```
✈️ Билет Москва → Кемерово
   S7-2541 · 05.04.2026 · 08:30
   [📄 Скачать PDF]    [Статус: Получен ✅]

🏨 Гостиница «Кузбасс»
   05.04 — 28.04 · ул. Ленина 42
   [📍 На карте]

✈️ Билет Кемерово → Москва  
   S7-2542 · 29.04.2026 · 19:00
   [Статус: Ожидается ⏳]
```

Push + SMS при добавлении нового: «В ваш ЛК добавлен билет Москва → Кемерово. Рейс S7-2541, 05.04 в 08:30»

#### /field/history — История работ

Полный послужной список:

```
2026
───────
КАО Азот · Кемерово                    ▶ текущий
09.04 — 28.04 · Мастер смены · РП: Андросов Н.А.
7 смен · 32 500₽

АРХБУМ · Лешково  
28.03 — 31.03 · Рабочий · РП: Андросов Н.А.
4 смены · 12 000₽ ✅

2025
───────
НОВАТЭК · Усть-Луга
...
```

При нажатии → детали проекта: табель по дням, фотоотчёты, финансы.

#### /field/crew — Бригада (только мастер)

**Заголовок:** «Бригада · Смена день» + badge «12/15 на объекте»

**Список:**
```
✅ Иванов А.П.        08:02   [📞]
✅ Петров С.И.         08:05   [📞]
⏳ Сидоров В.Н.       —       [📞] [✏️ Отметить]
❌ Козлов М.А.        не вышел [📞] [✏️ Отметить]
```

Кнопка «✏️ Отметить» → мастер выбирает время прихода, причину (если не вышел).

Внизу: кнопка «📝 Дневной отчёт →»

#### /field/report — Дневной отчёт (мастер)

Динамическая форма из `field_report_templates.fields`:

Для КАО Азот:
```
Аппарат:           [1] [2]
Трубок пробурено:  [___87___]
Диаметр, мм:       [20] [25] [30] [33]
Примечания:        [_________________]

📷 Добавить фото (0)

[💾 СОХРАНИТЬ ЧЕРНОВИК]
[📤 ОТПРАВИТЬ РП]
```

После отправки → РП получает Push: «Мастер Магомедов отправил отчёт за 09.04. 87 трубок, аппарат 1.»

---

## 7. БОЕВОЙ ДУХ ASGARD — UI ДЕТАЛИ

### 7.1 Викингские микровзаимодействия

| Событие | Сообщение (Toast) |
|---------|------------------|
| Начал смену | «⚔️ Славной смены, воин! Вальхалла гордится тобой.» |
| Завершил смену (>10ч) | «🛡 Достойная битва! 10ч 30мин — воин Одина.» |
| Завершил смену (<8ч) | «🛡 Смена завершена. Отдыхай — завтра новый поход.» |
| Фото загружено | «📷 Руны зафиксированы!» |
| Отчёт отправлен | «📜 Отчёт отправлен — скальды запомнят этот день!» |
| Инцидент | «⚠️ Сигнал тревоги отправлен командиру.» |
| Получил билет | «✈️ Путь открыт! Билет ждёт тебя в ЛК.» |
| Аванс получен | «💰 Казна пополнена. Трать с умом, воин.» |

### 7.2 Достижения (бейджи в профиле)

- 🔥 «Первая смена» — отработал первый день
- ⚡ «Железный воин» — 10 смен подряд без пропусков
- 🏆 «Ветеран» — 50+ смен в компании
- 📷 «Летописец» — 100+ фото в отчётах
- ⏰ «Пунктуальный» — 20 смен с приходом до 08:05
- 🛡 «Берсерк» — 5 смен по 12+ часов

### 7.3 Логотип и брендинг

- Шапка каждой страницы: `asgard_emblem.png` (24px) + «ASGARD» (DS.font('md'), gold)
- Login-экран: `asgard_emblem.png` (128px) с CSS glow-эффектом
- Splash-screen PWA: `asgard_logo.png` на тёмном фоне
- favicon: существующий `favicon.ico`

---

## 8. ОФЛАЙН И SYNC

### Service Worker (`field/sw.js`)

**Стратегия кэширования:**
- Shell (HTML, JS, CSS, шрифты, лого) → Cache First
- API данные → Network First, fallback to cache
- Фото → Cache First после первой загрузки

**Background Sync очередь:**
- `field-checkin-queue` — отметки прихода/ухода
- `field-photo-queue` — фото (до 10 штук в очереди)
- `field-report-queue` — дневные отчёты

**IndexedDB хранилище (`field-offline-db`):**
- `pending_checkins` — отметки, ожидающие синхронизации
- `pending_photos` — фото в очереди
- `cached_project` — данные текущего проекта для офлайн-отображения
- `cached_finances` — последние финансовые данные

**Индикатор в UI:** В шапке рядом с логотипом:
- 🟢 «Онлайн» — скрыт (не отвлекает)
- 🟡 «Офлайн — данные сохранены» — видимый banner

---

## 9. SMS-ШАБЛОНЫ

| Тип | Шаблон | Канал |
|-----|--------|-------|
| Код авторизации | `ASGARD: ваш код {code}. Действует 5 мин.` | SMS |
| Назначение на проект | `Вы назначены на проект {title}, {city}. Выезд {date}. ЛК: asgard-crm.ru/field` | SMS |
| Билет добавлен | `В ваш ЛК добавлен билет {title}. Подробности: asgard-crm.ru/field` | SMS + Push |
| Гостиница добавлена | `Оформлено проживание: {hotel}, {dates}. Детали: asgard-crm.ru/field` | SMS + Push |
| Напоминание о смене | `Завтра смена в {time}. Объект: {object}. Удачного дня, воин!` | Push |
| Напоминание об отчёте | `Пора заполнить отчёт за {date}. Не забудь, мастер!` | Push |
| Изменение графика | `Внимание! Изменение по проекту {title}: {message}` | SMS |
| Аванс выплачен | `На ваш счёт зачислен аванс {amount}₽ по проекту {title}` | SMS + Push |
| Произвольная рассылка | `{message}` (РП вводит текст) | SMS/Push/оба |

---

## 10. ИНТЕГРАЦИЯ В DESKTOP CRM

### Карточка работы (works) — новая вкладка «Полевой модуль»

**Для РП:**
- Кнопка «🚀 Запустить Field» → мастер настройки проекта (шаблон, смена, ставки, гео)
- Формирование бригады: выбор сотрудников + роль + ставка + суточные
- Кнопка «📨 Отправить SMS бригаде»
- Дашборд: кто на объекте, табель, прогресс
- Выгрузка табеля в Excel (формат существующих 201-формульных табелей)

**Для офис-менеджера:**
- Раздел «Логистика» на карточке проекта
- Матрица: сотрудник × (билет туда / гостиница / билет обратно)
- Загрузка PDF + кнопка «Отправить сотруднику»

**Для директора:**
- Сводка по всем активным проектам с Field
- Общий ФОТ, суточные, прогресс по каждому проекту

---

## 11. ПЛАН РЕАЛИЗАЦИИ ПО СЕССИЯМ

| Сессия | Фокус | Результат |
|--------|-------|-----------|
| **S1** | Миграции + SMS-авторизация | V047 миграция, `field-auth.js`, `MangoService.sendSms()` интеграция, тесты |
| **S2** | API рабочего | `field-worker.js`, `field-checkin.js` — /me, /active-project, /finances, /checkin, /checkout. Тесты |
| **S3** | API мастера + РП | `field-reports.js`, `field-manage.js`, `field-logistics.js`, `field-photos.js`. Тесты |
| **S4** | Field PWA — Shell | index.html, ds-field.js, router, sw.js, login-экран. Тестирование на телефоне |
| **S5** | Field PWA — Home + Shift | Главная, чекин/чекаут, таймер, геолокация, викингские тосты |
| **S6** | Field PWA — Money + Logistics | Экран финансов, билеты/гостиницы, PDF-скачивание |
| **S7** | Field PWA — History + Profile | История работ, профиль, бейджи |
| **S8** | Field PWA — Master pages | Бригада, дневной отчёт, инциденты, ручные отметки |
| **S9** | Desktop CRM — вкладка «Полевой модуль» | UI формирования бригады, дашборд, SMS-рассылки, логистика |
| **S10** | Offline + Polish | Background Sync, IndexedDB, PWA install, push-уведомления, финальная полировка |

Каждая сессия: код → тесты → commit → push.

---

## 12. БЕЗОПАСНОСТЬ

- JWT токены для Field — отдельные от основного CRM (field_sessions)
- SMS-коды: 4 цифры, 5 минут, 3 попытки, rate limit: 1 код / 60 секунд на номер
- Рабочий видит ТОЛЬКО свои данные (зарплата, табель, фото)
- Мастер видит данные своей смены/бригады
- Гео-данные — опционально, не блокируют чекин
- Фото — сжатие до 1920px, strip EXIF (кроме GPS для отчётности)
- HTTPS only, cookie secure + httpOnly + sameSite

---

## 13. МЕТРИКИ УСПЕХА

- Время от назначения до первого входа рабочего < 10 мин
- Чекин за < 5 секунд (одна кнопка)
- 0 звонков «где мой билет?» и «сколько мне должны?»
- РП экономит 30+ мин/день на сборе данных
- Табель формируется автоматически на 95%+
