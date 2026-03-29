# ASGARD Field Module — МАСТЕР-ПРОМПТ (конвейер 10 сессий)

> **Инструкция:** Это конвейерный промпт. Каждая сессия — самодостаточный блок. Выполняй текущую сессию, записывай результат в `FIELD_PROGRESS.md`, переходи к следующей. Между сессиями Claude Code может перезапускаться — поэтому ВСЕ контексты включены в промпт.

---

## ПРОГРЕСС-ТРЕКЕР

Перед началом работы прочитай файл `FIELD_PROGRESS.md` в корне проекта. Если его нет — создай. После каждой сессии обновляй:

```markdown
# ASGARD Field — Прогресс

## Сессия 1: [✅ DONE / 🔄 IN PROGRESS / ⬜ TODO]
- Миграция V047: ✅
- field-auth.js: ✅  
- Тесты: 8/8 pass
- Коммит: abc1234

## Сессия 2: [⬜ TODO]
...
```

**Определи текущую сессию** по прогресс-файлу и выполняй ТОЛЬКО ЕЁ.

---

## АРХИТЕКТУРА ПРОЕКТА

```
/root/ASGARD-CRM/
├── src/
│   ├── routes/           # Fastify route files
│   │   ├── field-auth.js      # [NEW] SMS авторизация
│   │   ├── field-worker.js    # [NEW] API рабочего
│   │   ├── field-checkin.js   # [NEW] Чекины
│   │   ├── field-reports.js   # [NEW] Отчёты мастера
│   │   ├── field-photos.js    # [NEW] Фотоотчёты
│   │   ├── field-manage.js    # [NEW] Управление проектом (РП)
│   │   ├── field-logistics.js # [NEW] Логистика (офис-менеджер)
│   │   ├── staff.js           # Существующий — сотрудники
│   │   ├── works.js           # Существующий — работы
│   │   ├── travel.js          # Существующий — командировки
│   │   ├── payroll.js         # Существующий — ведомости ЗП
│   │   └── push.js            # Существующий — Push уведомления
│   ├── services/
│   │   ├── mango.js           # MangoService — УЖЕ есть sendSms()
│   │   └── notify.js          # createNotification() — УЖЕ есть
│   └── app.js                 # Регистрация routes — добавить field-*
├── migrations/
│   └── V047__field_module.sql # [NEW]
├── public/
│   ├── field/                 # [NEW] Отдельная точка входа для Field PWA
│   │   ├── index.html
│   │   ├── ds-field.js        # Design System (подмножество DS.js)
│   │   ├── components.js      # F.* компоненты
│   │   ├── core.js            # Router, API, Utils для Field
│   │   ├── app.js             # Init, auth guard, shell
│   │   ├── sw.js              # Service Worker
│   │   ├── pages/
│   │   │   ├── login.js
│   │   │   ├── home.js
│   │   │   ├── shift.js
│   │   │   ├── money.js
│   │   │   ├── logistics.js
│   │   │   ├── history.js
│   │   │   ├── profile.js
│   │   │   ├── crew.js        # Только мастер
│   │   │   ├── report.js      # Только мастер
│   │   │   └── incidents.js   # Только мастер
│   │   └── manifest.json
│   └── assets/
│       └── img/
│           ├── asgard_emblem.png  # Существующий
│           ├── asgard_logo.png    # Существующий
│           └── watermark.svg      # Существующий
├── nginx.conf                 # Добавить location /field
└── tests/
    └── field/                 # [NEW]
        ├── field-auth.test.js
        ├── field-checkin.test.js
        ├── field-reports.test.js
        └── field-manage.test.js
```

---

## КОДОВЫЕ КОНВЕНЦИИ (ОБЯЗАТЕЛЬНО)

### Backend (Node.js / Fastify / PostgreSQL)

```javascript
// Паттерн route-файла:
async function routes(fastify, options) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');
  
  // preHandler для авторизации:
  // Обычный CRM: fastify.authenticate (JWT из users)
  // Field: fieldAuthenticate (JWT из field_sessions, employee из employees)
  
  fastify.get('/endpoint', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    const employee = req.fieldEmployee; // { id, fio, phone, ... }
    // ...
  });
}
module.exports = routes;
```

**Правила:**
- НЕ используй ES6 import — только `require()`
- Prefix `/api/field/` для всех endpoints
- Параметризованные запросы `$1, $2` — никакого string concat в SQL
- `try/catch` на каждый endpoint
- Ошибки: `{ error: 'Текст ошибки по-русски' }`
- Даты: PostgreSQL `TIMESTAMP` / `DATE`, в JSON — ISO 8601
- Деньги: `DECIMAL(15,2)`, в JSON — число (не строка)

### Frontend (Vanilla JS, DS.js)

```javascript
// Паттерн страницы Field:
const FieldHomePage = {
  async render() {
    const el = Utils.el;
    const t = DS.t;
    const page = el('div', { className: 'field-page field-home' });
    
    // Компоненты используют F.* namespace
    page.appendChild(F.Header({ title: 'Главная', logo: true }));
    
    // Данные загружаются fire-and-forget
    setTimeout(() => loadData(page), 0);
    
    return page; // render() возвращает DOM-элемент СИНХРОННО
  }
};
Router.register('/field/home', FieldHomePage);
```

**Правила фронтенда:**
- `render()` ОБЯЗАН быть синхронным — возвращает DOM-элемент
- Данные загружаются через `setTimeout(() => load(), 0)` — fire-and-forget
- Используй `Utils.el(tag, props, ...children)` для создания DOM
- `container.replaceChildren(newContent)` для обновления
- Цвета: ТОЛЬКО через `DS.t.*` токены — НИКАКИХ hardcoded hex
- Шрифты: ТОЛЬКО через `DS.font('scale')` — hero/xl/lg/md/base/sm/xs/label
- Отступы: `DS.spacing.*` или `var(--sp-*)` — xxs(4) xs(8) sm(12) md(14) base(16) lg(20) xl(24) xxl(32) page(20)
- Скругления: `DS.radius.*` или `var(--r-*)` — xs(4) sm(8) md(12) lg(14) xl(18) xxl(20) hero(20) pill(44)
- Анимации: `DS.anim(delay)` для slideUp, `DS.animPop(delay)` для popUp
- CSS изоляция: весь CSS Field — инлайн или в `<style>` внутри field/index.html. НИКОГДА не подключай app.css или theme.css

---

## СУЩЕСТВУЮЩИЕ ТАБЛИЦЫ (справочник)

### employees
```
id, fio, phone, email, role_tag, skills, rating_avg, is_active, user_id,
city, position, inn, snils, birth_date, address, salary, rate, day_rate,
naks, naks_number, naks_stamp, naks_date, naks_expiry, imt_number, imt_expires,
permits (jsonb), is_self_employed, bank_name, bik, account_number, card_number,
passport_series, passport_number, contract_type, department, brigade, notes,
-- НОВЫЕ (добавляем в V047):
phone_verified, field_pin, field_last_login, clothing_size, shoe_size
```

### employee_assignments
```
id, employee_id, work_id, date_from, date_to, role, created_at, updated_at
-- НОВЫЕ (добавляем в V047):
field_role ('worker'|'shift_master'|'senior_master'),
tariff_id → field_tariff_grid(id),        -- основной тариф
tariff_points,                              -- баллы (снимок на момент назначения)
combination_tariff_id → field_tariff_grid(id), -- совмещение (+1 балл) если есть
per_diem, shift_type, is_active, sms_sent, sms_sent_at
```

### field_tariff_grid (НОВАЯ — тарифная сетка, утверждена 01.10.2025)
```
id, category ('mlsp'|'ground'|'ground_hard'|'warehouse'|'special'),
position_name, points, rate_per_shift (= points × 500),
point_value (500.00), sort_order, is_active, is_combinable, requires_approval,
notes, approved_by ('Кудряшов О.С.'), approved_at

Категории:
  МЛСП: новичок 14б(7000₽) → мастер ответственный 21б(10500₽)
  Земля: слесарь 11б(5500₽) → мастер ответственный 14б(7000₽)
  Земля тяжёлые: слесарь 13б(6500₽) → мастер ответственный 16б(8000₽)
  Склад: слесарь 10б(5000₽) → мастер 12б(6000₽)
  Спецставки: выходной 6б, дорога 6б, обучение 7б, пайковые 1000₽/сут
```

### works
```
id, work_title, work_status, city, address, object_name, pm_id, contact_person, contact_phone,
contract_sum, cost_plan, cost_fact, start_date_plan, end_date_plan, is_vachta, rotation_days,
staff_ids_json (jsonb), site_id, ...
```

### payroll_items
```
id, sheet_id, employee_id, employee_name, work_id, role_on_work,
days_worked, day_rate, base_amount, bonus, overtime_hours, overtime_amount,
penalty, penalty_reason, advance_paid, deductions, deductions_reason,
accrued, payout, payment_method, is_self_employed, comment
```

### employee_rates
```
id, employee_id, role_tag, day_rate, shift_rate, overtime_rate,
effective_from, effective_to, comment, created_by
```

### business_trips
```
id, work_id, inspection_id, status, date_from, date_to, employees_json (jsonb),
transport_type, need_advance, advance_amount, ticket_details,
author_id, sent_to_office_manager, notes
```

### MangoService (src/services/mango.js)
```javascript
// УЖЕ реализовано:
async sendSms(fromExtension, toNumber, text) {
  return this.request('commands/sms', {
    from_extension: String(fromExtension),
    to_number: String(toNumber),
    text
  });
}
// fromExtension — внутренний номер АТС (использовать process.env.MANGO_SMS_EXTENSION)
```

---

## ВИКИНГСКИЕ ЦИТАТЫ ДЛЯ ПОЛЕВЫХ РАБОЧИХ

**Для экрана приветствия (утро, начало смены):**
```javascript
const FIELD_QUOTES_MORNING = [
  'Один мудрый сказал: «Рано встал — уже победил»',
  'Новый день — новый поход за славой!',
  'Руки крепкие, дух несгибаемый — вперёд!',
  'Кто первый на объекте — тот ведёт за собой',
  'Настоящий воин не ждёт команды — он готов',
  'Пусть каждая труба покорится твоей воле',
  'Сегодня мы делаем то, что другие не могут',
  'Рассвет принадлежит тем, кто не боится работы',
  'Один за всех, все за Асгард!',
  'Воин не жалуется — воин действует',
];
```

**Для начала смены (после чекина):**
```javascript
const FIELD_QUOTES_SHIFT_START = [
  '⚔️ Славной смены, воин! Вальхалла гордится тобой',
  '⚔️ В бой! Пусть этот день будет легендой',
  '⚔️ Надевай каску — сегодня мы творим историю',
  '⚔️ Щит поднят, меч наточен — смена началась!',
  '⚔️ Ты на передовой. Асгард за твоей спиной',
  '⚔️ Время показать, из чего сделаны воины!',
  '⚔️ Руны удачи начертаны. Вперёд!',
  '⚔️ Битва за качество начинается. Не подведи!',
];
```

**Для завершения смены (после чекаута):**
```javascript
const FIELD_QUOTES_SHIFT_END = [
  '🛡 Достойная битва! Отдыхай — ты заслужил',
  '🛡 Смена окончена. Скальды споют о твоих делах',
  '🛡 {hours}ч на посту — настоящий берсерк!',
  '🛡 Щит опущен. Завтра — новый подвиг',
  '🛡 Молот положен. Восстанавливай силы, воин',
  '🛡 Один видит твои труды. Покой заслужен',
  '🛡 Ещё один день в копилку славы!',
  '🛡 Рабочий день — позади. Рог мёда — впереди!',
];
```

**Для фотоотчёта:**
```javascript
const FIELD_QUOTES_PHOTO = [
  '📷 Руны зафиксированы! Летопись пополнена',
  '📷 Запечатлено! История не забудет',
  '📷 Фото добавлено в хроники Асгарда',
];
```

**Для отчёта мастера:**
```javascript
const FIELD_QUOTES_REPORT = [
  '📜 Отчёт отправлен — скальды запомнят этот день!',
  '📜 Командир получил донесение. Хорошая работа!',
  '📜 Хроника битвы записана. РП уведомлён',
];
```

**Для получения билета/логистики:**
```javascript
const FIELD_QUOTES_LOGISTICS = [
  '✈️ Путь открыт! Проверь детали в ЛК',
  '🏨 Кров обеспечен! Детали в разделе «Билеты»',
  '📋 Новый документ — загляни в ЛК',
];
```

**Для финансов:**
```javascript
const FIELD_QUOTES_MONEY = [
  '💰 Казна пополнена! Трать с умом, воин',
  '💰 Золото Асгарда на твоём счету',
  '💰 Аванс зачислен. Работа вознаграждена!',
];
```

**Для достижений:**
```javascript
const FIELD_ACHIEVEMENTS = [
  { id: 'first_shift',    icon: '🔥', name: 'Первая смена',    desc: 'Отработал первый день', condition: 'shifts >= 1' },
  { id: 'iron_warrior',   icon: '⚡', name: 'Железный воин',   desc: '10 смен без пропусков', condition: 'consecutive >= 10' },
  { id: 'veteran',        icon: '🏆', name: 'Ветеран Асгарда', desc: '50+ смен в компании', condition: 'total_shifts >= 50' },
  { id: 'chronicler',     icon: '📷', name: 'Летописец',       desc: '100+ фото в отчётах', condition: 'photos >= 100' },
  { id: 'punctual',       icon: '⏰', name: 'Пунктуальный',    desc: '20 смен вовремя', condition: 'on_time >= 20' },
  { id: 'berserker',      icon: '🛡', name: 'Берсерк',         desc: '5 смен по 12+ часов', condition: 'long_shifts >= 5' },
  { id: 'all_weather',    icon: '🌧', name: 'Всепогодный',     desc: 'Работал при −20°C', condition: 'winter_shifts >= 1' },
  { id: 'mentor',         icon: '🎓', name: 'Наставник',       desc: 'Стал мастером смены', condition: 'was_master >= 1' },
  { id: 'traveler',       icon: '🗺', name: 'Странник',         desc: '5+ городов работы', condition: 'cities >= 5' },
  { id: 'golden',         icon: '💎', name: 'Золотой фонд',    desc: 'Рейтинг 5.0 от РП', condition: 'rating == 5' },
];
```

---

## СЕССИЯ 1: МИГРАЦИИ + SMS-АВТОРИЗАЦИЯ + ТЕСТЫ

### Шаг 1.1 — Создать миграцию `migrations/V047__field_module.sql`

Полный SQL (все 10 таблиц + ALTER существующих):

```sql
-- ═══════════════════════════════════════════════════════════
-- V047: ASGARD Field Module
-- ═══════════════════════════════════════════════════════════

-- 1. SMS auth codes
CREATE TABLE IF NOT EXISTS field_auth_codes (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    code VARCHAR(6) NOT NULL,
    employee_id INTEGER REFERENCES employees(id),
    attempts INTEGER DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_auth_phone ON field_auth_codes(phone, used, expires_at);

-- 2. Field sessions (JWT)
CREATE TABLE IF NOT EXISTS field_sessions (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    device_info TEXT,
    push_subscription JSONB,
    last_active_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_sessions_employee ON field_sessions(employee_id);
CREATE INDEX IF NOT EXISTS idx_field_sessions_token ON field_sessions(token_hash);

-- 3. Checkins
CREATE TABLE IF NOT EXISTS field_checkins (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    work_id INTEGER NOT NULL REFERENCES works(id),
    assignment_id INTEGER REFERENCES employee_assignments(id),
    checkin_at TIMESTAMP NOT NULL,
    checkin_lat DECIMAL(10,7),
    checkin_lng DECIMAL(10,7),
    checkin_accuracy DECIMAL(8,2),
    checkin_source VARCHAR(20) DEFAULT 'self',
    checkin_by INTEGER,
    checkout_at TIMESTAMP,
    checkout_lat DECIMAL(10,7),
    checkout_lng DECIMAL(10,7),
    checkout_accuracy DECIMAL(8,2),
    checkout_source VARCHAR(20),
    checkout_by INTEGER,
    hours_worked DECIMAL(5,2),
    hours_paid DECIMAL(5,2),
    day_rate DECIMAL(12,2),
    amount_earned DECIMAL(12,2),
    date DATE NOT NULL,
    shift VARCHAR(20) DEFAULT 'day',
    status VARCHAR(20) DEFAULT 'active',
    edit_reason TEXT,
    note TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_checkins_emp_date ON field_checkins(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_field_checkins_work ON field_checkins(work_id, date);

-- 4. Report templates
CREATE TABLE IF NOT EXISTS field_report_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    fields JSONB NOT NULL DEFAULT '[]',
    progress_unit VARCHAR(50),
    progress_field VARCHAR(50),
    progress_total INTEGER,
    work_type VARCHAR(100),
    is_default BOOLEAN DEFAULT FALSE,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Daily reports
CREATE TABLE IF NOT EXISTS field_daily_reports (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    date DATE NOT NULL,
    shift VARCHAR(20) DEFAULT 'day',
    author_id INTEGER NOT NULL REFERENCES employees(id),
    author_role VARCHAR(50),
    template_id INTEGER REFERENCES field_report_templates(id),
    report_data JSONB NOT NULL DEFAULT '{}',
    crew_snapshot JSONB,
    downtime_minutes INTEGER DEFAULT 0,
    downtime_reason TEXT,
    status VARCHAR(20) DEFAULT 'draft',
    accepted_by INTEGER,
    accepted_at TIMESTAMP,
    comment TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_reports_work ON field_daily_reports(work_id, date);

-- 6. Photos
CREATE TABLE IF NOT EXISTS field_photos (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    work_id INTEGER NOT NULL REFERENCES works(id),
    report_id INTEGER REFERENCES field_daily_reports(id),
    checkin_id INTEGER REFERENCES field_checkins(id),
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255),
    mime_type VARCHAR(50),
    size INTEGER,
    photo_type VARCHAR(30) DEFAULT 'work',
    caption TEXT,
    lat DECIMAL(10,7),
    lng DECIMAL(10,7),
    taken_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_photos_work ON field_photos(work_id, created_at);

-- 7. Incidents
CREATE TABLE IF NOT EXISTS field_incidents (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    reported_by INTEGER NOT NULL REFERENCES employees(id),
    incident_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP,
    duration_minutes INTEGER,
    severity VARCHAR(20) DEFAULT 'medium',
    status VARCHAR(20) DEFAULT 'open',
    resolution TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 8. SMS log
CREATE TABLE IF NOT EXISTS field_sms_log (
    id SERIAL PRIMARY KEY,
    work_id INTEGER REFERENCES works(id),
    employee_id INTEGER REFERENCES employees(id),
    phone VARCHAR(20) NOT NULL,
    message_type VARCHAR(50) NOT NULL,
    message_text TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'sent',
    mango_response JSONB,
    sent_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 9. Logistics
CREATE TABLE IF NOT EXISTS field_logistics (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    trip_id INTEGER REFERENCES business_trips(id),
    item_type VARCHAR(30) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    date_from DATE,
    date_to DATE,
    details JSONB DEFAULT '{}',
    document_id INTEGER REFERENCES documents(id),
    status VARCHAR(30) DEFAULT 'pending',
    sent_to_employee BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_logistics_work ON field_logistics(work_id);
CREATE INDEX IF NOT EXISTS idx_field_logistics_emp ON field_logistics(employee_id);

-- 10. Project settings
CREATE TABLE IF NOT EXISTS field_project_settings (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL UNIQUE REFERENCES works(id),
    is_active BOOLEAN DEFAULT TRUE,
    activated_at TIMESTAMP,
    activated_by INTEGER,
    report_template_id INTEGER REFERENCES field_report_templates(id),
    site_category VARCHAR(50) DEFAULT 'ground',
    -- 'mlsp' | 'ground' | 'ground_hard' | 'warehouse'
    -- определяет какие тарифы доступны при назначении бригады
    schedule_type VARCHAR(20) DEFAULT 'shift',
    shift_hours DECIMAL(4,1) DEFAULT 11.0,
    rounding_rule VARCHAR(20) DEFAULT 'half_up',
    rounding_step DECIMAL(3,1) DEFAULT 0.5,
    per_diem DECIMAL(10,2) DEFAULT 0,
    object_lat DECIMAL(10,7),
    object_lng DECIMAL(10,7),
    geo_radius_meters INTEGER DEFAULT 500,
    geo_required BOOLEAN DEFAULT FALSE,
    shift_start_reminder VARCHAR(5),
    daily_report_reminder VARCHAR(5),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 11. Тарифная сетка (утверждена Кудряшовым О.С. 01.10.2025)
CREATE TABLE IF NOT EXISTS field_tariff_grid (
    id SERIAL PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    -- 'mlsp' (МЛСП/морские платформы)
    -- 'ground' (земля, обычные объекты)  
    -- 'ground_hard' (земля, тяжёлые условия, временные посёлки)
    -- 'warehouse' (склад)
    -- 'special' (спецставки: дорога, обучение, выходной)
    position_name VARCHAR(255) NOT NULL,
    points INTEGER NOT NULL,           -- баллы
    rate_per_shift DECIMAL(10,2) NOT NULL, -- рублей за смену (points × 500)
    point_value DECIMAL(10,2) DEFAULT 500.00, -- стоимость 1 балла
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    is_combinable BOOLEAN DEFAULT FALSE,  -- можно ли добавить как совмещение (+1 балл)
    requires_approval BOOLEAN DEFAULT FALSE, -- требует согласования
    notes TEXT,
    approved_by VARCHAR(255) DEFAULT 'Кудряшов О.С.',
    approved_at DATE DEFAULT '2025-10-01',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed: МЛСП (морские платформы)
INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift, sort_order, notes) VALUES
('mlsp', 'Новичок на испытательном сроке', 14, 7000, 1, NULL),
('mlsp', 'Новичок по окончанию испытательного срока', 15, 7500, 2, NULL),
('mlsp', 'Слесарь-монтажник (первый заезд)', 16, 8000, 3, NULL),
('mlsp', 'Слесарь (полный функционал, от второго заезда)', 17, 8500, 4, NULL),
('mlsp', 'Слесарь/чистельщик (высокая нагрузка, персональная)', 18, 9000, 5, 'Ставка персональная'),
('mlsp', 'Мастер сменный (второй)', 19, 9500, 6, NULL),
('mlsp', 'Мастер ПТО', 19, 9500, 7, NULL),
('mlsp', 'Мастер ответственный (основной, первый)', 21, 10500, 8, NULL),
('mlsp', 'Трансфер на корабле', 12, 6000, 9, 'За трансфер'),
('mlsp', 'Трансфер на вертолёте', 6, 3000, 10, 'За трансфер');

-- Seed: Земля (обычные объекты)
INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift, sort_order) VALUES
('ground', 'Слесарь (полный функционал)', 11, 5500, 1),
('ground', 'Мастер сменный (второй)', 12, 6000, 2),
('ground', 'Мастер ответственный (основной, первый)', 14, 7000, 3);

-- Seed: Земля тяжёлые условия (временные посёлки)
INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift, sort_order) VALUES
('ground_hard', 'Слесарь (полный функционал)', 13, 6500, 1),
('ground_hard', 'Мастер сменный (второй)', 14, 7000, 2),
('ground_hard', 'Мастер ответственный (основной, первый)', 16, 8000, 3);

-- Seed: Склад
INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift, sort_order) VALUES
('warehouse', 'Слесарь (полный функционал)', 10, 5000, 1),
('warehouse', 'Мастер ответственный (основной, первый)', 12, 6000, 2);

-- Seed: Совмещения (+1 балл, по согласованию)
INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift, sort_order, is_combinable, requires_approval, notes) VALUES
('ground', 'Совмещение: сварщик/водитель/электрик', 1, 500, 10, TRUE, TRUE, '+1 балл к основному тарифу'),
('ground_hard', 'Совмещение: сварщик/водитель/электрик', 1, 500, 10, TRUE, TRUE, '+1 балл к основному тарифу'),
('warehouse', 'Совмещение: мастер/сварщик/водитель/электрик', 1, 500, 10, TRUE, TRUE, '+1 балл к основному тарифу');

-- Seed: Спецставки (общие для всех категорий)
INSERT INTO field_tariff_grid (category, position_name, points, rate_per_shift, sort_order, notes) VALUES
('special', 'Выходной в командировке (карантин, дорога, нерабочий день)', 6, 3000, 1, 'Применяется ко всем категориям'),
('special', 'Обучение / прохождение мед. осмотра', 7, 3500, 2, NULL),
('special', 'Дорога и ожидание', 6, 3000, 3, NULL),
('special', 'Пайковые (суточные)', 0, 1000, 4, '1000 руб/сут, не в баллах'),
('special', 'Переработка (сверх нормы)', 0, 0, 5, 'По согласованию с директором');

-- ALTER existing tables
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS field_pin VARCHAR(4);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS field_last_login TIMESTAMP;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS clothing_size VARCHAR(10);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shoe_size VARCHAR(10);

ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS field_role VARCHAR(30) DEFAULT 'worker';
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS tariff_id INTEGER REFERENCES field_tariff_grid(id);
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS tariff_points INTEGER;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS combination_tariff_id INTEGER REFERENCES field_tariff_grid(id);
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS per_diem DECIMAL(10,2);
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS shift_type VARCHAR(20) DEFAULT 'day';
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS sms_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS sms_sent_at TIMESTAMP;
```

### Шаг 1.2 — Запустить миграцию

```bash
cd /root/ASGARD-CRM
node migrations/run.js
```

Если run.js не поддерживает V047 — выполни SQL напрямую:
```bash
psql -U asgard -d asgard_crm -f migrations/V047__field_module.sql
```

### Шаг 1.3 — Создать `src/routes/field-auth.js`

```javascript
// Полная реализация SMS-авторизации для Field
// Endpoints:
// POST /request-code   — отправить SMS-код
// POST /verify-code    — проверить код, выдать JWT
// POST /refresh        — продлить сессию  
// POST /logout         — удалить сессию
// GET  /me             — текущий сотрудник (проверка токена)

// JWT: sign({ employee_id, type: 'field' }, secret, { expiresIn: '90d' })
// Token hash: crypto.createHash('sha256').update(token).digest('hex')
// SMS code: 4 цифры, срок 5 минут, макс 3 попытки
// Rate limit: 1 код на номер в 60 секунд

// fieldAuthenticate middleware:
// 1. Bearer token из Authorization header
// 2. Hash token → найти в field_sessions
// 3. Проверить expires_at
// 4. Загрузить employee из employees
// 5. req.fieldEmployee = employee
// 6. Обновить last_active_at
```

**КРИТИЧНО:** Зарегистрировать middleware `fieldAuthenticate` на уровне fastify instance в app.js:
```javascript
fastify.decorate('fieldAuthenticate', async function(request, reply) { ... });
```

И зарегистрировать роуты в app.js:
```javascript
fastify.register(require('./routes/field-auth'), { prefix: '/api/field/auth' });
```

### Шаг 1.4 — Тесты (`tests/field/field-auth.test.js`)

```
Тест 1: POST /api/field/auth/request-code с валидным номером → 200, отправка SMS
Тест 2: POST /api/field/auth/request-code с несуществующим номером → 404
Тест 3: POST /api/field/auth/request-code повторно < 60 сек → 429
Тест 4: POST /api/field/auth/verify-code с правильным кодом → 200, JWT token
Тест 5: POST /api/field/auth/verify-code с неправильным кодом → 401
Тест 6: POST /api/field/auth/verify-code 3+ попытки → 429 (код заблокирован)
Тест 7: GET /api/field/auth/me с валидным токеном → 200, employee data
Тест 8: GET /api/field/auth/me без токена → 401
```

Запуск: `npx playwright test tests/field/field-auth.test.js` или `node --test tests/field/field-auth.test.js`

### Шаг 1.5 — Записать прогресс

Обнови `FIELD_PROGRESS.md`, сделай коммит:
```bash
git add -A
git commit -m "feat(field): Session 1 — migrations V047 + SMS auth API + tests"
git push origin main
```

---

## СЕССИЯ 2: API РАБОЧЕГО (профиль, проекты, финансы, чекины)

### Шаг 2.1 — `src/routes/field-worker.js`

**Prefix:** `/api/field/worker` (все с `preHandler: [fastify.fieldAuthenticate]`)

```
GET /me
  → employee: { id, fio, phone, city, position, permits, naks, naks_expiry, 
     imt_number, imt_expires, clothing_size, shoe_size, is_self_employed,
     achievements: [...] }
  → Достижения рассчитываются на лету:
     SELECT COUNT(*) as total_shifts FROM field_checkins WHERE employee_id=$1 AND status='completed'
     
GET /active-project
  → Найти employee_assignment WHERE employee_id=$1 AND is_active=true AND NOW() BETWEEN date_from AND date_to
  → JOIN works (title, city, object_name)
  → JOIN field_project_settings (shift_hours, per_diem, schedule_type, site_category)
  → JOIN field_tariff_grid tg ON ea.tariff_id = tg.id (position_name, points, rate_per_shift)
  → LEFT JOIN field_tariff_grid ctg ON ea.combination_tariff_id = ctg.id (combo info)
  → PM: SELECT fio, phone FROM users WHERE id = works.pm_id (или employees через user_id)
  → Master: SELECT e.fio, e.phone FROM employee_assignments ea JOIN employees e ON ea.employee_id=e.id 
            WHERE ea.work_id=$1 AND ea.field_role IN ('shift_master','senior_master') AND ea.is_active=true
  → Today checkin: SELECT * FROM field_checkins WHERE employee_id=$1 AND date=CURRENT_DATE AND work_id=$2
  → day_rate = tg.rate_per_shift + COALESCE(ctg.rate_per_shift, 0)
  → Today earnings: day_rate + per_diem (если checkin есть и смена завершена)
  → Response включает: tariff: { position_name, points, rate_per_shift, combination?, total_rate }
  
GET /projects
  → SELECT ea.*, w.work_title, w.city, w.object_name,
           (SELECT fio FROM users WHERE id=w.pm_id) as pm_name,
           (SELECT COUNT(*) FROM field_checkins fc WHERE fc.employee_id=ea.employee_id AND fc.work_id=ea.work_id AND fc.status='completed') as shifts_count,
           (SELECT COALESCE(SUM(amount_earned),0) FROM field_checkins fc WHERE fc.employee_id=ea.employee_id AND fc.work_id=ea.work_id) as total_earned
    FROM employee_assignments ea
    JOIN works w ON w.id = ea.work_id
    WHERE ea.employee_id = $1
    ORDER BY ea.date_from DESC

GET /projects/:work_id
  → Детали проекта + табель по дням:
    SELECT date, checkin_at, checkout_at, hours_worked, hours_paid, amount_earned, status, shift
    FROM field_checkins WHERE employee_id=$1 AND work_id=$2 ORDER BY date

GET /finances
  → Сводка по всем проектам:
    current_project: { work_title, earned, per_diem, advances, to_pay }
    all_time: { total_earned, total_paid, total_pending }
  → Advance data: SELECT SUM(advance_paid) FROM payroll_items WHERE employee_id=$1 AND work_id=$2
  → One-time payments: SELECT SUM(amount) FROM one_time_payments WHERE employee_id=$1 AND status='paid'

GET /finances/:work_id
  → Детальная разбивка по проекту:
    - field_checkins → days_worked, total_hours, base_amount
    - field_project_settings → per_diem × calendar_days
    - payroll_items → advances, bonuses, penalties
    - one_time_payments → разовые
```

### Шаг 2.2 — `src/routes/field-checkin.js`

**Prefix:** `/api/field/checkin`

```
POST /
  Body: { work_id, lat?, lng?, accuracy?, note? }
  Логика:
  1. Проверить: есть assignment employee_id + work_id, is_active, NOW() в date_from..date_to
  2. Проверить: нет активного чекина за сегодня (date=CURRENT_DATE, status='active')
  3. Получить day_rate: 
     SELECT tg.rate_per_shift, ctg.rate_per_shift as combo_rate
     FROM employee_assignments ea
     JOIN field_tariff_grid tg ON tg.id = ea.tariff_id
     LEFT JOIN field_tariff_grid ctg ON ctg.id = ea.combination_tariff_id
     WHERE ea.employee_id=$1 AND ea.work_id=$2 AND ea.is_active=true
     → day_rate = tg.rate_per_shift + COALESCE(ctg.rate_per_shift, 0)
     Fallback (если нет tariff_id): employees.day_rate
  4. INSERT INTO field_checkins (employee_id, work_id, assignment_id, checkin_at, checkin_lat, checkin_lng, checkin_accuracy, checkin_source, date, shift, day_rate)
  5. Вернуть { checkin_id, checkin_at, day_rate, quote: random(FIELD_QUOTES_SHIFT_START) }

POST /checkout
  Body: { checkin_id, lat?, lng?, accuracy?, note? }
  Логика:
  1. Найти чекин, проверить employee_id === req.fieldEmployee.id
  2. Рассчитать hours_worked = (checkout_at - checkin_at) в часах
  3. Рассчитать hours_paid по rounding_rule из field_project_settings
  4. amount_earned = (hours_paid / shift_hours) * day_rate
  5. UPDATE field_checkins SET checkout_at, checkout_lat/lng/accuracy, hours_worked, hours_paid, amount_earned, status='completed'
  6. Вернуть { hours_worked, hours_paid, amount_earned, quote: random(FIELD_QUOTES_SHIFT_END).replace('{hours}', hours) }

POST /manual  (только для мастера/senior_master)
  Body: { employee_id, work_id, checkin_at, checkout_at?, date, reason }
  → checkin_source='master', checkin_by=req.fieldEmployee.id

GET /today?work_id=X
  → Все чекины за сегодня по проекту (для мастера — вся бригада)
  → Проверить: req.fieldEmployee имеет field_role IN ('shift_master','senior_master') на этом work_id
```

**Функция округления часов:**
```javascript
function roundHours(hours, rule, step) {
  if (rule === 'none') return hours;
  const rounded = Math[rule === 'ceil' ? 'ceil' : rule === 'floor' ? 'floor' : 'round'](hours / step) * step;
  return Math.max(0, rounded);
}
```

### Шаг 2.3 — Регистрация в app.js

```javascript
fastify.register(require('./routes/field-worker'), { prefix: '/api/field/worker' });
fastify.register(require('./routes/field-checkin'), { prefix: '/api/field/checkin' });
```

### Шаг 2.4 — Тесты

```
Тест 1: GET /worker/active-project с assignment → 200, project data + pm + master
Тест 2: GET /worker/active-project без assignment → 200, null
Тест 3: POST /checkin/ → 200, checkin_id, checkin_at  
Тест 4: POST /checkin/ повторно → 409 (уже отмечен)
Тест 5: POST /checkin/checkout → 200, hours_worked, amount_earned
Тест 6: Проверить округление: 10ч13мин с step=0.5 → hours_paid=10.5
Тест 7: GET /worker/finances → корректные суммы
Тест 8: GET /worker/projects → список с totals
Тест 9: POST /checkin/manual (мастер) → 200
Тест 10: POST /checkin/manual (рабочий) → 403
```

### Шаг 2.5 — Прогресс + коммит

```bash
git commit -m "feat(field): Session 2 — worker API + checkin/checkout + finances + tests"
```

---

## СЕССИЯ 3: API МАСТЕРА + РП + ЛОГИСТИКА

### Шаг 3.1 — `src/routes/field-reports.js`

**Prefix:** `/api/field/reports`

```
GET /template/:work_id
  → field_project_settings → report_template_id → field_report_templates.fields
  
POST /
  Body: { work_id, date, shift, report_data, crew_snapshot, downtime_minutes?, downtime_reason? }
  → Только для field_role IN ('shift_master', 'senior_master')
  → INSERT field_daily_reports
  → Уведомить РП: createNotification + Push

GET /?work_id=X&date_from=...&date_to=...
  → Список отчётов (мастер видит свои, РП — все по проекту)

PUT /:id/accept  (только РП через обычный authenticate)
  → status='accepted', accepted_by, accepted_at

POST /incidents
  Body: { work_id, incident_type, description, severity, started_at }
  → INSERT field_incidents
  → Уведомить РП: Push + SMS если severity='critical'
```

### Шаг 3.2 — `src/routes/field-photos.js`

**Prefix:** `/api/field/photos`

```
POST /upload
  → Multipart file + { work_id, photo_type, caption?, report_id?, checkin_id? }
  → sharp: resize 1920px max, quality 80, strip EXIF кроме GPS
  → Save to uploads/field/{work_id}/
  → INSERT field_photos

GET /?work_id=X&date=...
  → Список фото с thumbnail URLs
```

### Шаг 3.3 — `src/routes/field-manage.js`

**Prefix:** `/api/field/manage` (preHandler: `fastify.authenticate` — обычный CRM auth)
**Roles:** `ADMIN, PM, HEAD_PM, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV`

```
POST /projects/:work_id/activate
  Body: { report_template_id?, site_category: 'mlsp'|'ground'|'ground_hard'|'warehouse',
          schedule_type, shift_hours, per_diem, 
          geo_lat?, geo_lng?, geo_radius?, shift_start_reminder?, daily_report_reminder? }
  → INSERT/UPDATE field_project_settings (включая site_category)

GET /tariffs?category=ground
  → SELECT * FROM field_tariff_grid WHERE category=$1 AND is_active=true ORDER BY sort_order
  → Также возвращает спецставки: WHERE category='special'
  → Response: { tariffs: [...], specials: [...], point_value: 500 }

POST /projects/:work_id/crew
  Body: { employees: [{ employee_id, field_role, tariff_id, combination_tariff_id?, shift_type }] }
  → Для каждого сотрудника:
    1. Получить тариф: SELECT * FROM field_tariff_grid WHERE id=tariff_id
    2. Рассчитать ставку: tariff.rate_per_shift + (combination ? combination.rate_per_shift : 0)
    3. Получить пайковые из field_project_settings.per_diem (или из спецставки 1000₽/сут)
    4. UPSERT employee_assignments (field_role, tariff_id, tariff_points, combination_tariff_id,
       per_diem, shift_type, is_active=true)
    5. Также: employees.day_rate = рассчитанная ставка (для обратной совместимости)
  → Валидация: tariff.category должна совпадать с field_project_settings.site_category

POST /projects/:work_id/send-invites
  Body: { employee_ids? } (пустой = всем)
  → Для каждого: MangoService.sendSms → INSERT field_sms_log
  → SMS: "ASGARD: Вы назначены на проект {title}, {city}. Выезд {date}. Ваш ЛК: asgard-crm.ru/field"
  → UPDATE employee_assignments SET sms_sent=true, sms_sent_at=NOW()

POST /projects/:work_id/broadcast
  Body: { message, employee_ids?, channel: 'sms'|'push'|'both' }
  → Рассылка

GET /projects/:work_id/dashboard
  → { 
      online_now: [{ employee_id, fio, checkin_at }],
      today_count: 12, total_crew: 15,
      today_hours: 134.5,
      progress: { done: 2340, total: 6872, pct: 34, unit: 'трубок' },
      week_summary: [...],
    }

GET /projects/:work_id/timesheet?from=...&to=...&format=json|xlsx
  → Табель (JSON или Excel выгрузка)
  → Excel: формат совместимый с существующими табелями (day_rate × days, суточные, бонусы, авансы)

GET /projects/:work_id/progress
  → Агрегат из field_daily_reports: SUM(report_data->>progress_field)
```

### Шаг 3.4 — `src/routes/field-logistics.js`

**Prefix:** `/api/field/logistics`

```
POST /  (CRM auth, OFFICE_MANAGER / PM / ADMIN)
  Body: { work_id, employee_id, item_type, title, description?, details?, date_from?, date_to? }
  → INSERT field_logistics

POST /:id/attach
  → Multipart file → сохранить в documents, привязать document_id

POST /:id/send
  → MangoService.sendSms → UPDATE sent_to_employee=true
  → Push notification если есть подписка
  → SMS: "ASGARD: {item_description}. Подробности: asgard-crm.ru/field"

GET /?work_id=X
  → Матрица логистики: сотрудник × тип → статус

GET /my  (Field auth)
  → Все logistics для текущего employee (текущие + предстоящие)

GET /my/history (Field auth)  
  → Архив по всем проектам
```

### Шаг 3.5 — Report templates: заготовки

При создании проекта можно выбрать шаблон. Создать 4 дефолтных:

```sql
INSERT INTO field_report_templates (name, work_type, fields, progress_unit, progress_field, is_default) VALUES
('Гидромеханическая чистка', 'hydromechanical', 
 '[{"key":"apparatus","label":"Аппарат","type":"select","options":["1","2"],"required":true},
   {"key":"tubes_done","label":"Трубок пробурено","type":"number","required":true},
   {"key":"diameter","label":"Диаметр, мм","type":"select","options":["20","25","30","33"]},
   {"key":"notes","label":"Примечания","type":"text"}]',
 'трубок', 'tubes_done', NULL, TRUE),

('Химическая чистка', 'chemical',
 '[{"key":"stage","label":"Этап","type":"select","options":["Щелочная промывка","Кислотный цикл 1","Кислотный цикл 2","Пассивация","Промывка"],"required":true},
   {"key":"temperature","label":"Температура, °C","type":"number"},
   {"key":"ph","label":"pH","type":"number"},
   {"key":"concentration","label":"Концентрация, %","type":"number"},
   {"key":"notes","label":"Примечания","type":"text"}]',
 NULL, NULL, NULL, TRUE),

('Монтаж ОВиК', 'hvac',
 '[{"key":"section","label":"Участок","type":"text","required":true},
   {"key":"work_type","label":"Тип работ","type":"select","options":["Монтаж воздуховодов","Монтаж оборудования","Обвязка","Пусконаладка"]},
   {"key":"progress_pct","label":"Выполнение, %","type":"number"},
   {"key":"notes","label":"Примечания","type":"text"}]',
 '%', 'progress_pct', 100, TRUE),

('АВД / Гидродинамическая чистка', 'avd',
 '[{"key":"object_part","label":"Объект/участок","type":"text","required":true},
   {"key":"area_done","label":"Площадь, м²","type":"number","required":true},
   {"key":"pressure","label":"Давление, бар","type":"number"},
   {"key":"notes","label":"Примечания","type":"text"}]',
 'м²', 'area_done', NULL, TRUE);
```

### Шаг 3.6 — Тесты

```
Тест 1: POST /reports (мастер) → 200
Тест 2: POST /reports (рабочий) → 403
Тест 3: GET /manage/tariffs?category=ground → returns 3 tariffs + specials
Тест 4: GET /manage/tariffs?category=mlsp → returns 10 tariffs
Тест 5: POST /manage/projects/:id/crew с tariff_id → correct rate calculated
Тест 6: POST /manage/projects/:id/crew с combination_tariff_id → rate = base + combo
Тест 7: POST /manage/projects/:id/crew с tariff category mismatch → 400 error
Тест 8: POST /manage/projects/:id/send-invites → SMS sent, field_sms_log created
Тест 9: GET /manage/projects/:id/dashboard → correct counts
Тест 10: POST /logistics + POST /:id/send → SMS + status updated
Тест 11: GET /logistics/my (field auth) → employee's logistics
Тест 12: POST /photos/upload → file saved, record created
```

### Шаг 3.7 — Прогресс + коммит

```bash
git commit -m "feat(field): Session 3 — reports + manage + logistics + photos API + tests"
```

---

## СЕССИЯ 4: FIELD PWA — SHELL (index.html, DS, Router, Auth)

### Шаг 4.1 — Nginx config

Добавить в `nginx.conf`:
```nginx
# ASGARD Field PWA
location /field {
    alias /root/ASGARD-CRM/public/field;
    try_files $uri $uri/ /field/index.html;
}
```

`nginx -t && nginx -s reload`

### Шаг 4.2 — `public/field/index.html`

Минимальный HTML:
- Meta viewport, theme-color, apple-mobile-web-app-capable
- Подключить Inter шрифт (локальный из /assets/fonts/ если есть, иначе system fonts)
- `<link rel="manifest" href="/field/manifest.json">`
- `<script src="/field/ds-field.js"></script>`
- `<script src="/field/core.js"></script>`
- `<script src="/field/components.js"></script>`
- `<script src="/field/app.js"></script>`
- Все страницы: `<script src="/field/pages/login.js"></script>` и т.д.
- `<style>` с CSS Reset + базовые стили Field (НЕ подключать app.css/theme.css!)
- `<div id="field-app"></div>`
- Регистрация Service Worker

**КРИТИЧНО:** Nuclear CSS isolation:
```css
#field-app, #field-app * {
  all: revert !important; 
}
/* Затем наши стили */
#field-app { /* ... */ }
```

НЕТ, лучше — Field подключается ОТДЕЛЬНО, без основных CSS вообще. Путь /field/ не загружает desktop-файлы.

### Шаг 4.3 — `public/field/ds-field.js`

Подмножество DS.js: themes (dark + light), typography, spacing, radius, zIndex, font(), anim(), status(), setTheme(). Без кода desktop bridge (--bg0, --bg1 и т.д. не нужны).

Добавить Field-специфичные токены:
```javascript
// Gold accent для Field
goldGrad: 'linear-gradient(135deg, #C49A2A 0%, #D4A843 50%, #E8C560 100%)',
shiftActiveGrad: 'linear-gradient(135deg, #1A9F4A 0%, #34C759 100%)',  // зелёный для активной смены
dangerGrad: 'linear-gradient(135deg, #C62828 0%, #E53935 100%)',
```

Добавить CSS анимации:
```css
@keyframes fieldPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(196,154,42,0.4); }
  50% { box-shadow: 0 0 0 12px rgba(196,154,42,0); }
}
@keyframes fieldGlow {
  0%, 100% { filter: drop-shadow(0 0 8px rgba(196,154,42,0.3)); }
  50% { filter: drop-shadow(0 0 16px rgba(196,154,42,0.6)); }
}
@keyframes fieldCountUp { /* для анимации чисел */ }
@keyframes fieldSlideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fieldTimer {
  from { width: 100%; }
  to { width: 0%; }
}
```

### Шаг 4.4 — `public/field/core.js`

Упрощённый Router + API + Utils для Field:

```javascript
// Router: hash-based, простой
// API: { fetch(path, opts), getToken(), setToken(), clearToken(), extractRows() }
// Utils: { el(tag, props, ...children), formatDate(), formatMoney(), formatTime(), formatPhone(), debounce(), lockScroll(), unlockScroll() }
// Store: { get(key), set(key, val) } — localStorage обёртка
```

Token хранится в `localStorage.getItem('field_token')`.

API.fetch автоматически добавляет `Authorization: Bearer <token>` и `Content-Type: application/json`.

### Шаг 4.5 — `public/field/components.js`

F.* компоненты (начать с базовых, остальные добавлять в следующих сессиях):

```javascript
const F = (() => {
  const el = Utils.el;
  
  // F.Header({ title, logo?, back?, backHref?, callButton?: { name, phone } })
  // F.HeroBanner({ greeting, date, quote, emblemSrc })
  // F.BigButton({ label, icon?, onClick, variant: 'gold'|'green'|'red'|'secondary', pulse?, loading? })
  // F.MoneyCard({ amount, label, details?, gradient? })
  // F.Card({ title, subtitle?, badge?, badgeColor?, fields?, onClick?, animDelay? })
  // F.CallButton({ name, phone, icon? })
  // F.Toast({ message, type: 'success'|'error'|'info'|'warning' })
  // F.BottomSheet({ title, content, fullscreen? })
  // F.Skeleton({ type: 'card'|'hero'|'list', count? })
  // F.Empty({ text, icon })
  // F.StatusBadge({ text, color })
  
  return { Header, HeroBanner, BigButton, MoneyCard, Card, CallButton, Toast, BottomSheet, Skeleton, Empty, StatusBadge };
})();
```

**WOW-ДЕТАЛИ для компонентов:**

**F.HeroBanner:**
- Background: `heroGrad` с subtle animated gradient shift (CSS `background-size: 200% 200%` + animation)
- Watermark: «ASGARD» полупрозрачный справа (как в M.HeroCard)
- Эмблема: маленькая asgard_emblem.png (24px) с gold glow
- Цитата: italic, gold, с fade-in анимацией
- Приветствие зависит от времени суток + имя рабочего

**F.BigButton (⚔️ НАЧАТЬ СМЕНУ):**
- Высота 64px, border-radius pill (44px)
- Gradient: goldGrad для «Начать», dangerGrad для «Завершить»
- Пульсация: `fieldPulse` animation 3s infinite
- При нажатии: scale(0.95) → scale(1.02) → scale(1), haptic vibrate(50)
- Loading state: спиннер вместо текста
- Disabled state: полупрозрачная, без пульсации

**F.MoneyCard:**
- Сумма: DS.font('hero'), gold цвет, анимация countUp при появлении
- Разбивка формулы: DS.font('xs'), textSec
- Subtle gradient background: goldBg

**F.CallButton:**
- Rounded pill, иконка 📞 + имя
- `<a href="tel:+7...">`  
- При нажатии: green flash background

### Шаг 4.6 — `public/field/app.js`

```javascript
// Init:
// 1. DS.injectStyles() + DS.setTheme('dark')
// 2. Проверить token в localStorage
// 3. Если нет → Router.navigate('/field/login')
// 4. Если есть → GET /api/field/auth/me → если 401 → login, иначе → /field/home
// 5. Shell: #field-app → .field-shell (flex column, 100dvh) → .field-content (flex 1, scroll)
// 6. Нет tab bar — навигация через header back + home кнопка
```

### Шаг 4.7 — `public/field/pages/login.js`

**ДИЗАЙН (WOW!):**

1. Полноэкранный тёмный фон с subtle animated gradient
2. По центру — вертикальная стопка:
   - `asgard_emblem.png` (120px) с анимацией `fieldGlow` 3s infinite
   - «ASGARD» — DS.font('hero'), gold, letterSpacing: 4px
   - «ПОЛЕВОЙ МОДУЛЬ» — DS.font('label'), textSec
   - Разделитель: тонкая gold линия 40px, opacity 0.3
3. Поле телефона:
   - Large input (20px font), placeholder «+7 (___) ___-__-__»
   - Маска ввода: автоформат при наборе
   - Dark input background, gold border при фокусе
   - Автофокус при загрузке
4. Кнопка «ПОЛУЧИТЬ КОД» — goldGrad, полная ширина, DS.font('md')
5. После отправки кода:
   - 4 отдельных квадрата для цифр (как в банковских приложениях)
   - Автопереход между полями
   - При вводе 4й цифры → автоматический submit
   - Таймер повторной отправки: «Повторить через 0:47» → «Отправить ещё раз»
   - Ошибка: тряска полей (CSS shake animation), red border, text «Неверный код»
6. После успешной авторизации:
   - Зелёная анимация ✓ по центру (scale from 0 → 1 с bounce)
   - «Добро пожаловать, {имя}!» — fade in
   - 1 сек пауза → redirect на /field/home

### Шаг 4.8 — `public/field/manifest.json`

```json
{
  "name": "ASGARD Field",
  "short_name": "Field",
  "description": "Полевой модуль ASGARD CRM",
  "start_url": "/field/",
  "display": "standalone",
  "background_color": "#0D0D0F",
  "theme_color": "#C49A2A",
  "icons": [
    { "src": "/assets/img/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/assets/img/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/assets/img/icon-192-maskable.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### Шаг 4.9 — `public/field/sw.js`

```javascript
const SHELL_VERSION = '1.0.0';
const SHELL_CACHE = 'field-shell-' + SHELL_VERSION;
const DATA_CACHE = 'field-data-v1';

const SHELL_URLS = [
  '/field/', '/field/index.html',
  '/field/ds-field.js', '/field/core.js', '/field/components.js', '/field/app.js',
  '/field/pages/login.js', '/field/pages/home.js', '/field/pages/shift.js',
  '/field/pages/money.js', '/field/pages/logistics.js', '/field/pages/history.js',
  '/field/pages/profile.js', '/field/pages/crew.js', '/field/pages/report.js',
  '/assets/img/asgard_emblem.png', '/assets/img/asgard_logo.png',
];

// Install → cache shell
// Activate → clean old caches
// Fetch → Shell: cache-first, API: network-first с fallback
// Background Sync → field-checkin-queue, field-photo-queue, field-report-queue
```

### Шаг 4.10 — Проверка

```bash
# Проверить что /field/ доступен
curl -I https://asgard-crm.ru/field/
# Должен вернуть index.html

# Проверить на телефоне — открыть в браузере, должен показать login-экран
```

### Шаг 4.11 — Прогресс + коммит

```bash
git commit -m "feat(field): Session 4 — PWA shell, DS, router, login screen, SW"
```

---

## СЕССИЯ 5: HOME + SHIFT ЭКРАНЫ

### Шаг 5.1 — `public/field/pages/home.js`

Полная реализация главного экрана по спецификации из раздела «6.4 /field/home».

**WOW-элементы:**
- Hero banner с живым градиентом (animate background-position)
- Анимированный счётчик заработка (countUp от 0 до суммы за 900ms)
- Пульсирующая кнопка ⚔️ НАЧАТЬ СМЕНУ
- Живой таймер на кнопке «ЗАВЕРШИТЬ СМЕНУ — 8ч 42мин» (обновляется каждую секунду)
- Staggered animations: элементы появляются с задержкой 0.05s каждый
- Pull-to-refresh для обновления данных
- Кнопки звонка РП и мастеру — прямые `tel:` ссылки

**Логика:**
```javascript
async function loadHomeData(page) {
  const data = await API.fetch('/field/worker/active-project');
  if (!data) {
    // Нет активного проекта — показать Empty state
    // «На данный момент нет активных проектов. Отдыхай, воин!»
    return;
  }
  // Рендер: project card, call buttons, shift button, money card, quick actions
}
```

### Шаг 5.2 — `public/field/pages/shift.js`

Экран управления сменой (расширенный вид):
- Статус: «На объекте с 08:02» / «Не на объекте»
- Геолокация: запрос + отображение точности
- Таймер смены (большой, по центру): 08:42:15
- Кнопка checkout
- Лог сегодняшних событий (timeline): пришёл 08:02, фото 10:15, ...

### Шаг 5.3 — Тестирование на телефоне

Открыть `asgard-crm.ru/field` → login → home → нажать «Начать смену» → проверить чекин → проверить таймер → «Завершить смену».

### Шаг 5.4 — Прогресс + коммит

```bash
git commit -m "feat(field): Session 5 — home + shift screens with wow animations"
```

---

## СЕССИЯ 6: MONEY + LOGISTICS ЭКРАНЫ

### Шаг 6.1 — `public/field/pages/money.js`

По спецификации «/field/money». WOW: анимированные числа, gold акценты, прогресс-бар.

**Экраны:**
- /field/money — сводка (текущий проект + кнопка «вся история»)
- /field/money/:work_id — детали по проекту (табель + формула расчёта)

**ВАЖНО — отображение тарифа:**
Рабочий видит свою ставку через тарифную сетку:
- «Ваш тариф: Слесарь (полный функционал)»
- «11 баллов × 500₽ = 5 500₽/смену»
- Если совмещение: «+ Совмещение сварщик: +1 балл (+500₽) = 6 000₽/смену»
- Пайковые отдельной строкой: «Пайковые: 1 000₽/сут»
- Разбивка: { смены × ставка + пайковые × дни − авансы = к выплате }

Данные для тарифа берутся из:
```
GET /api/field/worker/active-project 
→ assignment.tariff_id → JOIN field_tariff_grid → position_name, points, rate_per_shift
→ assignment.combination_tariff_id → JOIN field_tariff_grid → combo position, combo points
→ assignment.per_diem (пайковые)
```

### Шаг 6.2 — `public/field/pages/logistics.js`

По спецификации «/field/logistics». Лента карточек с иконками ✈️🏨.
PDF скачивание через прямую ссылку (window.open).

### Шаг 6.3 — Прогресс + коммит

```bash
git commit -m "feat(field): Session 6 — money + logistics screens"
```

---

## СЕССИЯ 7: HISTORY + PROFILE ЭКРАНЫ

### Шаг 7.1 — `public/field/pages/history.js`

- /field/history — полный послужной список
- /field/history/:work_id — детали: табель по дням, фото, заработок

### Шаг 7.2 — `public/field/pages/profile.js`

- ФИО, аватар (первая буква в круге, gold), телефон
- Допуски: НАКС, ИМТ, промбез — с датами истечения (red если < 30 дней)
- Достижения (бейджи) — серые если не получены, gold с glow если получены
- Размер спецодежды, обуви
- Кнопка переключения темы (dark/light)
- Кнопка выхода

### Шаг 7.3 — Прогресс + коммит

```bash
git commit -m "feat(field): Session 7 — history + profile with achievements"
```

---

## СЕССИЯ 8: МАСТЕР-ЭКРАНЫ (бригада, отчёт, инциденты)

### Шаг 8.1 — `public/field/pages/crew.js`

Список бригады с статусами (✅⏳❌), кнопки звонка, ручная отметка.

### Шаг 8.2 — `public/field/pages/report.js`

Динамическая форма из template.fields. Конструктор полей:
- type: 'text' → input
- type: 'number' → input number с крупными +/- кнопками
- type: 'select' → горизонтальные pill-кнопки (как FilterPills)
- type: 'photo' → камера + галерея

### Шаг 8.3 — `public/field/pages/incidents.js`

Форма инцидента: тип (select), описание (textarea), severity (3 кнопки), фото.

### Шаг 8.4 — Прогресс + коммит

```bash
git commit -m "feat(field): Session 8 — master screens: crew, reports, incidents"
```

---

## СЕССИЯ 9: DESKTOP CRM — ВКЛАДКА «ПОЛЕВОЙ МОДУЛЬ»

### Шаг 9.1 — Desktop UI: вкладка на карточке работы

В существующий `public/assets/js/` (desktop) добавить:
- Вкладка «⚔️ Полевой модуль» на странице pm_works (детали работы)
- При активации: выбор категории объекта (МЛСП / Земля / Земля тяжёлые / Склад)
- Категория определяет доступные тарифы из `field_tariff_grid`

**Блок «Бригада»** — таблица назначения:
| ФИО | Роль на проекте | Тариф (из сетки) | Баллы | Ставка ₽/смену | Совмещение | SMS |
| Выбор сотрудника | worker/master/senior | Dropdown из tariff_grid по category | авто | авто | +1 балл? | ✅/📨 |

- Dropdown тарифов фильтруется по `site_category` проекта
- При выборе тарифа — баллы и ставка подставляются автоматически
- Checkbox «Совмещение» → +1 балл, +500₽ (requires_approval → жёлтый badge «Требует согласования»)
- Пайковые задаются на уровне проекта (не сотрудника)
- Кнопка «Запустить Field» → модалка настроек
- Кнопка «📨 Отправить SMS бригаде»
- Дашборд: кто на объекте, прогресс

### Шаг 9.2 — Логистика для офис-менеджера

Матрица: строки = сотрудники, колонки = (билет туда / гостиница / билет обратно / документы).
Каждая ячейка: кнопка «+» → форма → загрузить PDF → «Отправить».

### Шаг 9.3 — Выгрузка табеля в Excel

`GET /api/field/manage/projects/:id/timesheet?format=xlsx`
→ ExcelJS генерация (как в payroll.js) → совместимый с существующим форматом табеля.

### Шаг 9.4 — Прогресс + коммит

```bash
git commit -m "feat(field): Session 9 — desktop CRM field tab + logistics matrix + xlsx export"
```

---

## СЕССИЯ 10: OFFLINE + POLISH + ФИНАЛЬНАЯ ПОЛИРОВКА

### Шаг 10.1 — Background Sync

```javascript
// В sw.js:
self.addEventListener('sync', (event) => {
  if (event.tag === 'field-checkin-sync') {
    event.waitUntil(syncCheckins());
  }
  if (event.tag === 'field-photo-sync') {
    event.waitUntil(syncPhotos());  
  }
});
```

IndexedDB:
- `pending_checkins` → retry при online
- `pending_photos` → очередь загрузки
- `cached_project` → offline-доступ к данным проекта

### Шаг 10.2 — Push уведомления

Интеграция с существующим Push API:
- При чекине рабочего → Push мастеру: «{Имя} отметился на объекте»
- При отчёте мастера → Push РП: «Отчёт за {дату}: {summary}»
- При добавлении билета → Push рабочему: «Новый билет в ЛК»

### Шаг 10.3 — PWA Install prompt

```javascript
// Показать баннер «Добавить на рабочий стол» при втором визите
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallBanner(); // красивый баннер с эмблемой Асгарда
});
```

### Шаг 10.4 — Финальная полировка

- [ ] Все анимации работают плавно (60fps)
- [ ] Dark + Light темы проверены
- [ ] Все Toast с викингскими цитатами
- [ ] Все экраны имеют Skeleton loading
- [ ] Все экраны имеют Empty state с иконкой
- [ ] Все экраны имеют Error state с retry
- [ ] Pull-to-refresh на главной
- [ ] Haptic feedback на кнопках (navigator.vibrate)
- [ ] Safe area insets (iPhone notch)
- [ ] Кнопки звонка работают (tel: ссылки)
- [ ] PDF билетов открываются
- [ ] Геолокация запрашивается корректно
- [ ] Offline mode: показывает cached данные + offline banner
- [ ] Service Worker обновляется (SHELL_VERSION bump)

### Шаг 10.5 — Smoke-тест на реальном телефоне

1. Открыть asgard-crm.ru/field в Chrome Android / Safari iOS
2. Авторизация по SMS
3. Добавить на рабочий стол
4. Начать смену → проверить чекин
5. Завершить смену → проверить расчёт
6. Посмотреть деньги → всё корректно
7. Посмотреть билеты → PDF открывается
8. Посмотреть историю → проекты, табели
9. Выключить интернет → проверить offline
10. Включить интернет → данные синхронизировались

### Шаг 10.6 — Финальный коммит

```bash
git commit -m "feat(field): Session 10 — offline, push, PWA install, final polish"
git push origin main
```

---

## КОНТРОЛЬНЫЕ ВОПРОСЫ ПЕРЕД КАЖДОЙ СЕССИЕЙ

Перед началом работы проверь:
1. `FIELD_PROGRESS.md` — какая сессия следующая?
2. `git status` — чистый ли рабочий каталог?
3. `node migrations/run.js` — миграции прошли?
4. Предыдущие тесты всё ещё проходят?

После каждой сессии:
1. Все тесты зелёные?
2. `FIELD_PROGRESS.md` обновлён?
3. Коммит + push сделан?
4. Записал что делать в следующей сессии если что-то не завершил?

---

**КОНЕЦ МАСТЕР-ПРОМПТА. НАЧИНАЙ С СЕССИИ 1.**
