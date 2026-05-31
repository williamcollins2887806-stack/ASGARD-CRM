# ⚠️ ИДЁТ АУДИТ. ПРИ КАЖДОМ ЗАПУСКЕ/СЖАТИИ КОНТЕКСТА — ПЕРВЫМ ДЕЛОМ:
#   1) прочитать audit-prep/findings/_AUDIT-MANDATE.md (правила и рамки),
#   2) прочитать audit-prep/findings/_PROGRESS-LEDGER.md (единственный источник истины по прогрессу),
#   3) продолжить с первого незавершённого пункта журнала.
# НЕ начинать заново. НЕ спрашивать пользователя. НЕ запускать параллельные волны агентов.

---

# ASGARD CRM — Навигация для Claude Code

> Этот файл читается автоматически при каждой новой сессии.
> **Перед началом работы** запусти `node sync-vault.js` — обновит карту файлов в Obsidian vault.

---

## Структура проекта

```
ASGARD-CRM/
├── src/
│   ├── routes/          ← 79 Backend роутов (Express)
│   ├── services/        ← Бизнес-логика, AI интеграции
│   ├── helpers/         ← Утилиты
│   └── lib/             ← Общие библиотеки
├── public/
│   ├── assets/js/       ← ~150 Desktop JS файлов (ES6+)
│   ├── assets/css/      ← CSS стили
│   ├── mobile-app/src/  ← ~209 Mobile React файлов (JSX/Hooks)
│   └── m/               ← Собранная мобилка (dist → сюда)
├── migrations/          ← 102 SQL миграции (V001..V131+)
├── sync-vault.js        ← Скрипт обновления Obsidian vault
└── CLAUDE.md            ← Этот файл
```

## Obsidian Vault (живая документация)

**Путь:** `C:\Users\Nikita-ASGARD\ASGARD-CRM-Vault\`

Vault содержит две категории файлов:

### Модульные заметки (писать вручную при изменениях)
Каждый модуль: Фронт → Бэк → БД со связями.
- `Тендеры.md`, `Работы.md`, `Оценки (Estimates).md`, `Акты и Счета.md`
- `Мимир (ИИ-аналитик).md`, `Академия.md`, `Гейификация.md`
- `Field PWA — Обзор.md`, `Field Checkin.md`, `Field Финансы.md`, `Field Управление.md`
- `Зарплата и Табель.md`, `Расходы.md`, `Касса.md`, `Чаты и MAX-мессенджер.md`
- `Кадры — Staff и HR.md`, `Оборудование.md`, `Заказчики.md`
- `Аутентификация.md`, `Согласование.md`, `Email.md`, `Телефония.md`
- `БД — Все таблицы.md` — полный список таблиц с миграциями
- `Роуты — Все маршруты.md` — 79 роутов вручную

### Авто-генерация (обновляются скриптом, не трогать)
`⚙️ Авто-генерация/` — запусти `node sync-vault.js` для обновления:
- `Роуты — Авто-карта.md` — все endpoints + таблицы БД
- `Desktop JS — Авто-карта.md` — все JS файлы + API вызовы
- `Mobile JSX — Авто-карта.md` — все JSX + API вызовы
- `Миграции — Авто-карта.md` — все CREATE TABLE
- `Матрица Фронт-API-БД.md` — кто вызывает какой endpoint
- `Git — Последние изменения.md` — git log

---

## Ключевые правила (нарушение = баги в продакшне)

### БД — названия полей
```sql
tender_status    -- НЕ status!
tender_price     -- НЕ amount, НЕ price!
login            -- НЕ username! (таблица users)
rating           -- НЕ score!
approval_status  -- НЕ status! (таблица estimates)
valid_to         -- НЕ expiry_date! (таблица employee_permits)
employee_id      -- НЕ user_id! (таблица employee_permits)
```

### Мягкое удаление (V118+)
```sql
UPDATE table SET deleted_at = NOW() WHERE id = $1   -- ✅
DELETE FROM table WHERE id = $1                      -- ❌ НЕЛЬЗЯ
```

### Расходы — только через позиции
```js
POST /api/expenses/items/:work_id  { name, quantity, price }  // ✅
POST /api/expenses/work { amount }                             // ❌ без позиций
```

### Уход работника
```sql
UPDATE users SET departure_date = '...' WHERE id = $1  -- ✅
UPDATE users SET is_active = false WHERE id = $1        -- ❌ теряем историю
```

### JS — какой стандарт где
```
src/routes/         → Node.js (CommonJS, require)
public/assets/js/   → ES6+ (const, =>, class)
public/mobile-app/  → JSX + Hooks (React)
```

---

## API маршруты — быстрая шпаргалка

### Выделенные роуты (НЕ через /data/)
```
/api/tenders         /api/estimates       /api/works
/api/invoices        /api/acts            /api/payroll/sheets
/api/chat-groups     /api/mimir           /api/field-*
/api/equipment       /api/customers       /api/staff
```

### Generic CRUD через /data/
```
/api/data/hr_requests    /api/data/proxies      /api/data/seals
/api/data/contracts      /api/data/proc_requests /api/data/bonus_requests
```

---

## Мимир Conductor (новая мульти-агентная система просчёта)

> ⚠️ **ЭТО ОСНОВНАЯ БОЕВАЯ СИСТЕМА авто-просчёта** (главный модуль CRM, контракты 100–300 М ₽).
> Старый монолитный Мимир (`mimir-auto-estimate.js` + `/auto-estimate`) — **legacy/fallback**, не трогать.
> На момент написания (31.05.2026) код в ветке **`mimir-conductor-refactor`**, ещё **НЕ** смержен в `mobile-v3`.

Рефакторинг монолитного промпта → мульти-агентный **Conductor** (главный мозг Opus 4.7 / Sonnet 4.6
работает в native tool-use agent loop, сам решает каких агентов звать, задаёт уточнения РП/заказчику,
читает ответы через дни, пересчитывает только затронутое). РП видит мысли каждого агента в War Room в реальном времени.

**Где код:**
- Бэкенд-сервис: `src/services/mimir-conductor/` — `conductor.js` (главный loop), `tool-executor.js`,
  `agents-registry.js` (**30 реальных агентов + 1 mock**), `hard-rules.js` (safety floor),
  `conductor-run.js` (CRUD/стейт), `letter-generator.js` + `reply-parser.js` + `apply-answers.js` (письма заказчику),
  `montecarlo.js` + `cashflow.js` (детерминированная математика), `director-report.js` (PDF), `run-sweeper.js` (reaper зомби-ранов),
  `models-config.js`. Сами агенты — `src/services/mimir-conductor/agents/`.
- Роуты: `src/routes/mimir-conductor.js` → **`/api/mimir/conductor/*`**: `start`, `events` (SSE-поток мыслей),
  `run/:id`, `artifact/:id`, `run/:id/report` (директорский PDF), `letter/:id/upload-reply` и др.
- Фронт (desktop, ES6+): War Room — **`/conductor-estimate.html`** + `mimir-conductor-ui.js`;
  дашборд ожидания заказчика — **`/awaiting-customer.html`**; модалка выбора метода на странице работы — `mimir-method-picker.js`
  («🧙 Быстрое (Quick)» vs «🎼 Полный (Conductor)»).

**БД — 8 таблиц, миграции V133–V140:**
`mimir_conductor_runs` (V133, стейт-машина), `mimir_agent_runs` (V134), `mimir_artifacts` (V135, хеши),
`mimir_agent_events` (V136, лента событий для SSE), `mimir_clarifications` (V137, каналы PM/CUSTOMER/AUTO),
`mimir_customer_letters` (V138), `mimir_norms_index` (V139, **RAG-индекс нормативов на pgvector + embeddings**),
+ V140 (`director_report_path`). Следующая свободная миграция — **V141**.

**Ключевые принципы:**
- **ВСЕ модели — через ОДИН прокси `routerai.ru`** (`src/services/ai-provider.js`). Отдельные ключи Perplexity/DeepSeek/Voyage/Yandex **НЕ заводим**.
- **Stub-режим** (`aiProvider.isStubMode()`, ключ `stub-*`) — прогон без расхода баланса (детерминированно). Live AI-smoke — отдельно.
- Доступ **по ролям** (`requireRoles`), фича-флаг `MIMIR_CONDUCTOR_ENABLED` — **ОТМЕНЁН**, Conductor для всех.
- Стейт-машина: DRAFT, RUNNING, CONSOLIDATING, BLOCKED_BY_PM, BLOCKED_BY_CUSTOMER, READY_FOR_REVIEW, APPROVED, REJECTED, CANCELLED, ERROR.
- Async: просчёт может жить недели в ожидании заказчика; `run-sweeper.js` помечает зомби-раны (RUNNING > 30 мин / после рестарта) как ERROR.

**Подробная документация:** vault `Мимир — Conductor Refactor/` (`00 INDEX.md` + сессии 01–08 + `09 AI-Smoke план` / `10 Dev-сервер setup` / `11 Production deploy`).

---

## Деплой — чеклист (ОБЯЗАТЕЛЬНО)

```bash
# Mobile: собрать и скопировать
npm run build
cp -r dist/* ../m/

# Пушить
git push origin mobile-v3

# На сервере (92.242.61.184)
git fetch origin && git reset --hard origin/mobile-v3
systemctl restart asgard-crm   # НЕ pm2!
```

**⚠️ Три обязательных шага при каждом деплое:**
1. Бампнуть `SHELL_VERSION` в `build_info.js` (если менял Desktop JS)
2. Добавить миграцию (если менял схему БД)
3. Добавить запись в `app_updates` (баннер обновлений):
```sql
INSERT INTO app_updates (version, changes, created_at) VALUES ('v20.X.X', '...', NOW());
```

---

## Сервер

```
IP:       92.242.61.184
Путь:     /var/www/asgard-crm/
Сервис:   systemctl restart asgard-crm
БД:       PGPASSWORD=123456789 psql -U asgard -d asgard_crm
SSH ключ: ~/.ssh/asgard_crm_deploy
```

---

## Тест-аккаунты

| Логин | Пароль | Роль | PIN |
|-------|--------|------|-----|
| test_pm | Test123! | PM | 1234 |
| test_director | Test123! | DIRECTOR_GEN | 0000 |

---

## Роли (15 штук)
`ADMIN, PM, TO, HEAD_PM, HEAD_TO, HR, HR_MANAGER, BUH, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, OFFICE_MANAGER, CHIEF_ENGINEER, WAREHOUSE, PROC`

---

## Как обновлять этот vault

**При добавлении нового файла/роута/компонента:**
```bash
node sync-vault.js   # обновит авто-карты
```

**При добавлении нового модуля:**
Обновить вручную соответствующий `.md` в vault (Фронт → Бэк → БД).

**При изменении схемы БД:**
Обновить `БД — Все таблицы.md` и файл модуля.

---

*Vault: C:\Users\Nikita-ASGARD\ASGARD-CRM-Vault*
*Sync: node sync-vault.js*
