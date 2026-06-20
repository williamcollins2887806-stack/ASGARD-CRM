# Stage W — переделка кассы (контракт для 4 параллельных агентов)

## Бизнес-логика

1. **Касса** хранит нал для авансов РП, офисных расходов, выплат рабочим
2. **Любой сотрудник** → запрос на выдачу → **DIRECTOR_COMM** согласует (через mobile preferred) → **БУХ** выдаёт
3. **DIRECTOR_COMM** видит на мобилке: список запросов, тап = детали (кто/зачем/сколько/описание + баланс кассы сейчас и после), 1 тап = одобрить/отказать/уточнить
4. **Тип loan УБРАН ПОЛНОСТЬЮ** из UI и API
5. **12 категорий** + «Другое» с обязательным описанием
6. **Аванс РП через СЗ**: в форме создания cash_request галка «Использовать остаток лимита СЗ», выбор СЗ → бух переводит на СЗ вместо выдачи налом (создаётся agreement_transfer)
7. **Закрытие табеля → передача от рабочего к РП**: бух перевёл рабочему через СЗ → рабочий передал РП налом → РП отмечает в 3 местах одновременно: /timesheet вкладка + /pm-balance секция + mobile /field/money кнопка
8. **Баланс РП**: cash_in + se_cash + handovers_received − cash_exp − cash_ret − sal_cash
9. **Директор тоже выплачивает рабочему** на отдельной странице `/director-payments` (отражается в полевом модуле как paid_by_role='director')

## 12 категорий расходов авансового отчёта

```js
const CASH_CATEGORIES = [
  { code: 'fuel_service',    icon: '⛽', label: 'ГСМ служ.' },
  { code: 'fuel_personal',   icon: '⛽', label: 'ГСМ личн.' },
  { code: 'taxi',            icon: '🚕', label: 'Такси' },
  { code: 'accommodation',   icon: '🏨', label: 'Проживание' },
  { code: 'food_brigade',    icon: '🍲', label: 'Продукты бригаде' },
  { code: 'materials',       icon: '🧱', label: 'Материалы' },
  { code: 'tool',            icon: '🔧', label: 'Инструмент' },
  { code: 'tech_rent',       icon: '🚛', label: 'Аренда техники' },
  { code: 'communication',   icon: '📞', label: 'Связь/интернет' },
  { code: 'representational',icon: '🥂', label: 'Представительские' },
  { code: 'urgent_repair',   icon: '🚨', label: 'Срочный ремонт' },
  { code: 'other',           icon: '📦', label: 'Другое' }, // требует description
];
```

## БД — миграция V243

```sql
-- 1. cash_requests: убрать loan, добавить категории + СЗ-опцию
ALTER TABLE cash_requests DROP CONSTRAINT IF EXISTS chk_cash_request_type;
-- (если CHECK не было — пропускаем)
ALTER TABLE cash_requests 
  ADD COLUMN IF NOT EXISTS category VARCHAR(40),
  ADD COLUMN IF NOT EXISTS category_other_desc TEXT,
  ADD COLUMN IF NOT EXISTS use_se_payee BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS se_payee_employee_id INT REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS se_transfer_id INT REFERENCES se_transfers(id);

-- Backfill старых записей loan → advance
UPDATE cash_requests SET type='advance' WHERE type='loan';

-- 2. worker_to_pm_handovers — новая таблица
CREATE TABLE IF NOT EXISTS worker_to_pm_handovers (
  id SERIAL PRIMARY KEY,
  worker_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  pm_user_id INT NOT NULL REFERENCES users(id),
  work_id INT REFERENCES works(id) ON DELETE SET NULL,
  year INT NOT NULL CHECK (year >= 2020 AND year <= 2099),
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  source_se_transfer_id INT REFERENCES se_transfers(id) ON DELETE SET NULL,
  source_worker_payment_id INT REFERENCES worker_payments(id) ON DELETE SET NULL,
  expected_amount NUMERIC(12,2) NOT NULL CHECK (expected_amount >= 0),
  received_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','received','partial','not_received','cancelled')),
  received_at TIMESTAMP,
  received_by INT REFERENCES users(id),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_handover_source 
  ON worker_to_pm_handovers(source_se_transfer_id) WHERE source_se_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_handovers_pm_period 
  ON worker_to_pm_handovers(pm_user_id, year, month);
CREATE INDEX IF NOT EXISTS idx_handovers_worker_period 
  ON worker_to_pm_handovers(worker_id, year, month);
CREATE INDEX IF NOT EXISTS idx_handovers_status 
  ON worker_to_pm_handovers(status) WHERE status = 'pending';

-- 3. worker_payments: payment_method NOT NULL + paid_by_role
UPDATE worker_payments SET payment_method='cash' WHERE payment_method IS NULL;
ALTER TABLE worker_payments ALTER COLUMN payment_method SET NOT NULL;
ALTER TABLE worker_payments 
  ADD COLUMN IF NOT EXISTS paid_by_role VARCHAR(20) 
    CHECK (paid_by_role IN ('pm','director','buh','admin','field_master') OR paid_by_role IS NULL);
```

## БД — миграция V244 (баг #5: bonus в cost_fact)

```sql
-- Расширение триггера sync_worker_payment_to_expense чтобы bonus тоже создавал запись work_expenses
CREATE OR REPLACE FUNCTION sync_worker_payment_to_expense()
RETURNS TRIGGER AS $$
BEGIN
  -- per_diem остаётся как было
  IF NEW.type = 'per_diem' AND (OLD IS NULL OR OLD.type IS DISTINCT FROM NEW.type 
       OR OLD.amount IS DISTINCT FROM NEW.amount OR OLD.work_id IS DISTINCT FROM NEW.work_id) THEN
    -- ... (старая логика per_diem)
  END IF;
  
  -- НОВОЕ: bonus → work_expenses(category='fot', subcategory='bonus')
  -- Только если status='paid' или 'confirmed' (выплачено), и есть work_id
  IF NEW.type = 'bonus' AND NEW.status IN ('paid','confirmed') AND NEW.work_id IS NOT NULL THEN
    INSERT INTO work_expenses (
      work_id, category, amount, date, description, payment_method,
      source_table, source_id, source_key, created_by
    ) VALUES (
      NEW.work_id, 'fot', NEW.amount, COALESCE(NEW.paid_at::date, CURRENT_DATE),
      'Премия из worker_payments #' || NEW.id, 'auto',
      'worker_payments', NEW.id, 'wp_bonus:' || NEW.id, NEW.created_by
    )
    ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO UPDATE SET
      amount = EXCLUDED.amount,
      updated_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## API контракт

### Cash (изменения)

```
POST /api/cash/
body: {
  type: 'advance' | 'office' | 'other',  // ❌ loan убран
  amount, purpose, cover_letter,
  category,                  // одна из 12
  category_other_desc,       // обязательно если category='other'
  use_se_payee: false,       // если true:
  se_payee_employee_id: 123  // СЗ-получатель
}

PUT /api/cash/:id/approve
RBAC: DIRECTOR_COMM (главный), ADMIN/DIRECTOR_GEN/DIRECTOR_DEV (backup)

PUT /api/cash/:id/issue (БУХ)
если request.use_se_payee=true:
  → не пишет в cash_balance_log!
  → создаёт se_transfer (operation_type='agreement_transfer', planned status)
  → cash_requests.se_transfer_id = новый.id
  → status='money_issued' (но deноминирован как СЗ-перевод)
иначе:
  → старая логика (cash_balance_log + advisory_lock!)
```

### Handovers (новый модуль)

```
GET /api/handovers/?year=&month=&pm_id=
  → список передач

POST /api/handovers/
body: { worker_id, work_id, year, month, source_se_transfer_id?, 
        expected_amount, received_amount, status, note }

PUT /api/handovers/:id/confirm
body: { received_amount, status: 'received'|'partial'|'not_received', note }

GET /api/timesheet/v2/handovers/:y/:m
  → автоподтянуть ожидающие: SELECT все se_transfers (status='transferred', year, month)
     где у рабочего assignments.pm_id = current PM
     которые ещё не имеют записи в worker_to_pm_handovers
  → формат: [{worker_id, fio, work_id, expected_amount, source_se_transfer_id, existing_handover?}]
```

### Director Payments (новый модуль)

```
POST /api/director-payments/
RBAC: DIRECTOR_*, ADMIN
body: { employee_id, work_id, type, amount, payment_method, comment }
  → прокси на pay-worker с paid_by_role='director'

GET /api/director-payments/history?year=&month=
  → worker_payments где paid_by_role='director'
```

## Frontend

### Vanilla (`public/assets/js/`)

1. **cash.js** — CategoryGrid с 12 иконками, поле описания для 'other', чекбокс «Использовать СЗ-перевод» + выбор СЗ (autocomplete /api/employees?se=1)
2. **cash_admin.js** — в DetailModal: KV-строка «Баланс кассы сейчас: X / После выдачи: X−amount» (мерцающий цвет если в минус)
3. **pm_balance.js** — секция «📥 Ожидают передачи от рабочих» (handovers_pending)
4. **timesheet-v2.js** — вкладка «💵 Передачи от рабочих» в /timesheet PM-mode (только когда mode='pm') с кнопками «Получено в полной сумме» / «Частично N ₽» / «Не получено»

### v2 React (`public/desktop-v2-src/src/pages/`)

1. **Cash/** — убрать `<Segmented type>` с loan, новый `<CategoryGrid>` (12 кнопок), `<SeTransferSection>` если use_se_payee
2. **CashAdmin/** — в DetailModal: блок «Касса сейчас → После выдачи»
3. **PmBalance/** — секция handovers
4. **Timesheet/** — вкладка `<HandoverTab>` для PM-режима
5. **НОВАЯ `DirectorPayments/`** — список с фильтрами + кнопка «+ Выплатить» (открывает PayWorkerModal с paid_by_role='director')

### Mobile (`public/mobile-app/src/`)

1. **НОВАЯ `pages/director/Approvals.jsx`** — главный экран DIRECTOR_COMM:
   - Header: «X запросов ждут» + большой badge
   - Список: каждая заявка — карточка (автор, сумма, категория с иконкой, дата)
   - Тап → DetailSheet (кто/зачем/сколько/описание + «🏦 В кассе: 800k → После: 750k»)
   - 3 кнопки: ✅ Одобрить / ❌ Отказать / ❓ Уточнить (с текстом)
   - Push (через существующий механизм уведомлений)
   - Виджет на главной mobile для DIRECTOR_COMM

2. **pages/Cash.jsx** — убрать loan, 12 категорий-плиток
3. **pages/CashAdmin.jsx** — «после выдачи»
4. **pages/field/FieldMoney.jsx** — секция handovers + кнопки

## Светлая и тёмная тема — обязательно

Все новые блоки: отдельные цвета для светлой и тёмной (не инверсия).
- Категории: цветной grid 3×4 с пастельным background
- handovers: золотисто-оранжевый акцент `#FFF3E0 / rgba(255,152,0,.10)`
- director payments: индиго `#E8EAF6 / rgba(63,81,181,.10)`

## Файлы (распределение по агентам)

### Agent A (Backend) — владеет:
- `migrations/V243__cash_redesign_handovers.sql` (новая)
- `migrations/V244__bonus_to_cost_fact.sql` (новая)
- `src/routes/cash.js`
- `src/routes/payroll-dashboard.js`
- `src/routes/worker-payments.js`
- `src/routes/timesheet-v2.js` (только новый endpoint /handovers/:y/:m)
- `src/routes/handovers.js` (новый файл)
- `src/routes/director-payments.js` (новый файл)
- `src/index.js` (зарегистрировать 2 новых route)

### Agent B (Vanilla) — владеет:
- `public/assets/js/cash.js`
- `public/assets/js/cash_admin.js`
- `public/assets/js/pm_balance.js`
- `public/assets/js/timesheet-v2.js`

### Agent C (v2 React) — владеет:
- `public/desktop-v2-src/src/pages/Cash/` (все файлы)
- `public/desktop-v2-src/src/pages/CashAdmin/`
- `public/desktop-v2-src/src/pages/PmBalance/`
- `public/desktop-v2-src/src/pages/Timesheet/` (только новая вкладка)
- `public/desktop-v2-src/src/pages/DirectorPayments/` (новая, создать)
- `public/desktop-v2-src/src/App.jsx` (роутинг)

### Agent D (Mobile) — владеет:
- `public/mobile-app/src/pages/Cash.jsx`
- `public/mobile-app/src/pages/CashAdmin.jsx`
- `public/mobile-app/src/pages/director/Approvals.jsx` (новый файл)
- `public/mobile-app/src/pages/field/FieldMoney.jsx`
- `public/mobile-app/src/App.jsx` (роутинг)
- `public/mobile-app/src/widgets/DirectorApprovalsWidget.jsx` (новый)

## Деплой
- Бамп SHELL → 20.22.0
- Snapshot перед деплоем
- Сначала миграции на клоне test, потом прод
