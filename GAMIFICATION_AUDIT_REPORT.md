# Gamification Pre-Implementation Audit
## Модуль «Колесо Норн» — Аудит перед внедрением

**Дата**: 20.04.2026  
**Версия CRM**: mobile-v3  
**Автор**: Claude Code (автоматический аудит)

---

## 1. ASGARD Field Overview (ЛК рабочего)

### 1.1 Структура директорий

| Расположение | Назначение |
|---|---|
| `public/field/` | Основной Field PWA (vanilla JS) |
| `public/field/pages/` | 15 страниц-модулей |
| `public/field/app.js` | Инициализация, auth guard, PWA install |
| `public/field/core.js` | Router, API, Utils, Store, OfflineDB |
| `public/field/components.js` | UI-компоненты (Header, HeroBanner, BigButton, MoneyCard…) |
| `public/field/ds-field.js` | Дизайн-система Field |
| `public/field/sw.js` | Service Worker (SHELL_VERSION `3.3.1`) |
| `src/routes/field-*.js` | 10 бэкенд-файлов маршрутов |

### 1.2 Все страницы Field (15 штук)

| Страница | Файл | Маршрут | Роль |
|---|---|---|---|
| Login | `login.js` | `/field/login` | Все |
| Home | `home.js` | `/field/home` | Все (QuickActions по роли) |
| Shift | `shift.js` | `/field/shift` | Все |
| Money | `money.js` | `/field/money` | Worker |
| Logistics | `logistics.js` | `/field/logistics` | Worker |
| History | `history.js` | `/field/history` | Worker |
| Profile | `profile.js` | `/field/profile` | Все |
| Earnings | `earnings.js` | `/field/earnings` | Worker |
| Photos | `photos.js` | `/field/photos` | Все |
| Stages | `stages.js` | `/field/stages` | Все (раздельные view) |
| **Crew** | `crew.js` | `/field/crew` | **Master only** |
| **Report** | `report.js` | `/field/report` | **Master only** |
| **Incidents** | `incidents.js` | `/field/incidents` | **Master only** |
| **Funds** | `funds.js` | `/field/funds` | **Master only** |
| **Packing** | `packing.js` | `/field/packing` | **Master only** |

### 1.3 SMS-авторизация рабочего

**Файл**: `src/routes/field-auth.js` (~400 строк)

**Поток**:
1. `POST /request-code` — нормализация телефона, поиск в `employees`, отправка SMS через MangoService, запись в `field_auth_codes` (TTL: 5 мин, cooldown: 60 сек)
2. `POST /verify-code` — верификация кода (макс. 3 попытки), генерация JWT (type: `'field'`, срок: 90 дней), запись сессии в `field_sessions`
3. `POST /refresh` — продление сессии на 90 дней
4. `POST /logout` — удаление сессии

**Связанные таблицы**: `field_auth_codes`, `field_sessions`, `field_sms_log`

### 1.4 Связь user ↔ brigade ↔ trip ↔ stages

```
employees (id, fio, phone, position, role_tag, field_role)
    ↓
employee_assignments (employee_id, work_id, field_role, tariff_id, is_active)
    ↓
works (id, work_title, city, object_name, pm_id)
    ↓
field_project_settings (work_id, schedule_type, shift_hours, per_diem, geo_required)

field_checkins → привязаны к employee_id + work_id + assignment_id
field_trip_stages → привязаны к employee_id + work_id + assignment_id
field_logistics → привязаны к employee_id + work_id
```

**Бригада = все активные рабочие на одном work_id** (нет отдельной таблицы `brigades`).

### 1.5 Профиль рабочего

**GET /worker/me** возвращает:
```
id, fio, phone, city, position, role_tag, is_self_employed,
naks, naks_expiry, imt_number, imt_expires, permits,
clothing_size, shoe_size, phone_verified, field_last_login,
day_rate, achievements[8]
```

**Аватар**: Только инициалы (золотой градиент). Фото НЕ хранятся.

**Редактируемые поля** (PUT /personal): phone, email, city, address, passport_data, inn, snils, clothing_size, shoe_size, birth_date, gender.

---

## 2. ЛК мастера

### Роли мастера

```javascript
field_role = 'shift_master'   // Сменный мастер
field_role = 'senior_master'  // Старший мастер
```

Определение: `me?.field_role === 'shift_master' || me?.field_role === 'senior_master'`

### Страницы мастера (6 эксклюзивных)

| Страница | Функционал |
|---|---|
| **Crew** (`/field/crew`) | Список бригады, статусы checkin, ручная отметка |
| **Crew Stages** (`/field/crew-stages`) | Этапы бригады, создание/редакт. за рабочего |
| **Report** (`/field/report`) | Ежедневный отчёт смены |
| **Incidents** (`/field/incidents`) | Инциденты безопасности |
| **Funds** (`/field/funds`) | Приход/расход наличных и материалов |
| **Packing** (`/field/packing`) | Описи оборудования |

### API мастера

```
GET  /stages/my-crew/:work_id      — этапы бригады
POST /stages/on-behalf             — создать этап за рабочего
PUT  /stages/on-behalf/:id         — обновить этап рабочего
POST /stages/request-correction    — запрос корректировки у РП
GET  /checkin/today?work_id=X      — чекины бригады за сегодня
```

---

## 3. Existing Achievements System

### 3.1 Текущая реализация

**Статус: Минимальная, захардкоженная, без БД-таблиц.**

В `GET /worker/me` возвращается массив из **8 ачивок**:

| ID | Icon | Название | Условие |
|---|---|---|---|
| `first_shift` | ⚔️ | Первая смена | Первый checkin |
| `iron_warrior` | 🛡️ | Железный воин | 30 смен |
| `veteran` | 🏆 | Ветеран | 100 смен |
| `chronicler` | 📸 | Летописец | 10 фото |
| `punctual` | ⏰ | Пунктуальный | 20 смен без опозданий |
| `berserker` | 💪 | Берсерк | 5 смен подряд (стрик) |
| `traveler` | 🗺️ | Путешественник | 3 разных объекта |
| `mentor` | 👨‍🏫 | Наставник | Master role |

**Как выдаются**: Вычисляются на лету в бэкенде при запросе `/worker/me` (query к `field_checkins`, `field_photos`). **Нет отдельных таблиц**, нет истории получения, нет уведомлений.

### 3.2 Что нужно для геймификации

- [ ] Таблица `achievements` (каталог)
- [ ] Таблица `user_achievements` (история получения, timestamp)
- [ ] Таблица `achievement_progress` (прогресс по условиям)
- [ ] Push-уведомление при получении
- [ ] UI отображение в профиле с анимацией

---

## 4. User Profile Structure

### 4.1 Таблица `users`

```sql
id, login, password_hash, pin_hash, name, email, phone,
role (VARCHAR 50, default 'PENDING'),
birth_date, employment_date, telegram_chat_id,
is_active, must_change_password, temp_password_hash, temp_password_expires,
last_login_at, patronymic, created_at, updated_at
```

### 4.2 Таблица `employees`

```sql
id, fio, full_name, role_tag, phone, email, position,
passport_number, rating_avg, is_active, user_id → users(id),
phone_verified, field_pin, field_last_login,
clothing_size, shoe_size, created_at, updated_at
```

### 4.3 Таблица `user_profiles`

**НЕ СУЩЕСТВУЕТ** ⚠️ Данные профиля встроены в `users` + `employees`.

### 4.4 Поля для расширения (потребуется миграция)

Отсутствуют и требуют добавления:
- `xp` / `total_xp` (INTEGER)
- `rank` / `rank_id` (INTEGER / FK)
- `level` (INTEGER)
- `rune_balance` (INTEGER) — валюта для магазина
- `equipped_items` (JSONB) — рамка аватара, бейдж, тема
- `streak_current` / `streak_best` (INTEGER)
- `last_wheel_spin` (TIMESTAMP) — когда крутил колесо
- `avatar_frame_id` (FK) — рамка аватара
- `profile_theme_id` (FK) — тема профиля

---

## 5. Design System & Components

### 5.1 Дизайн-система (DS)

**Файлы**:
- JS-токены: `public/mobile-app/src/lib/design-system.js` (114 строк)
- CSS-токены: `public/assets/css/design-tokens.css` (496 строк)
- Field DS: `public/field/ds-field.js`

**Ключевые токены**:

| Категория | Значения |
|---|---|
| **Brand** | `--red: #C8293B`, `--blue: #1E4D8C`, `--gold: #D4A843` |
| **BG (8 уровней)** | `--bg0: #08090C` … `--bg5: #2A3248` |
| **Text** | `--t1: 0.95`, `--t2: 0.65`, `--t3: 0.40` |
| **Semantic** | `--ok: #2D8659`, `--warn: #D4A843`, `--err: #C8293B`, `--info: #3B82F6` |
| **Typography** | display 28/700, title1 22/700, title2 18/600, body 15/400, caption1 13/500, caption2 11/500 |
| **Spacing** | 8px grid: xs=4, sm=8, md=12, lg=16, xl=20, 2xl=24, 3xl=32 |
| **Radius** | sm=6, md=8, lg=12, xl=16, pill=44 |
| **Motion** | instant=100ms, fast=150ms, normal=250ms, slow=400ms, gentle=600ms |
| **Gradients** | `--grad-corp` (red→blue), `--grad-gold` (gold→light), `--grad-aurora` |

**Naming convention**: `--[category]-[variant][-state]` (пр. `--blue-h`, `--gold-bg`)

**Light theme**: `html[data-theme="light"]` переопределяет BG/text/shadows.

### 5.2 Компоненты React Mobile (ui/)

| Компонент | Файл | Назначение |
|---|---|---|
| **Button** | `button.jsx` | variant: default/outline/secondary/ghost/destructive/link; size: xs/sm/default/lg/icon |
| **Dialog** | `dialog.jsx` | Модалки: DialogContent, DialogHeader, DialogFooter, showCloseButton |
| **Toast** | `sonner.jsx` | Toaster + toast() (sonner) |
| **Card** | `card.jsx` | Контейнер с padding/border |
| **Badge** | `badge.jsx` | variant: default/secondary/outline/destructive |
| **Avatar** | `avatar.jsx` | Image + fallback initials |
| **Input** | `input.jsx` | Стилизованный input |
| **Label** | `label.jsx` | Лейбл формы |
| **Tabs** | `tabs.jsx` | TabsList, TabsTrigger, TabsContent |
| **Separator** | `separator.jsx` | Разделитель |
| **ScrollArea** | `scroll-area.jsx` | Кастомный скроллбар |
| **AsgardSelect** | `AsgardSelect.jsx` | Multi-select, search, async |
| **EmployeePicker** | `EmployeePicker.jsx` | Выбор сотрудников |

### 5.3 Shared-компоненты

| Компонент | Назначение | Пригодится для |
|---|---|---|
| **AnimatedCounter** | Анимация чисел | XP/руны |
| **BigNumber** | Большие метрики | Баланс рун |
| **BottomSheet** | Нижний шторка-drawer | Результат колеса |
| **EmptyState** | Заглушка пустого | Магазин без товаров |
| **ProgressBar** | Линейный прогресс | Прогресс до ранга |
| **PullToRefresh** | Тяни-обнови | Магазин, лидерборд |
| **SkeletonKit** | Скелетон загрузки | Все страницы |
| **StatCard** | KPI-карточка | Стрик, ранг, XP |

### 5.4 Desktop-компоненты (AsgardUI)

```javascript
AsgardUI.toast(title, msg, type, timeout)    // ok/err/warn/info, макс 5
AsgardUI.showModal({title, html, icon, wide, fullscreen, onMount})
AsgardUI.showDrawer({title, html, width, actions, onMount})
AsgardUI.emptyState({icon, title, desc, action})
AsgardUI.skeleton(type, count)               // card/text/row
AsgardUI.money(x)                            // форматирование ₽
AsgardUI.statusClass(text)                   // → CSS-класс статуса
```

---

## 6. Routing & Navigation

### 6.1 Mobile Router (React Router v6)

**Файл**: `public/mobile-app/src/App.jsx`  
**Base**: `/m`  
**Guard**: `<ProtectedRoute section="..."><PinGuard>...</PinGuard></ProtectedRoute>`

### 6.2 Tab Bar (5 вкладок)

```javascript
const TABS = [
  { path: '/',      icon: 'home',  label: 'Главная' },
  { path: '/tasks', icon: 'tasks', label: 'Задачи' },
  { path: '/chat',  icon: 'chat',  label: 'Хугинн' },
  { path: '/works', icon: 'works', label: 'Работы' },
  { path: '/more',  icon: 'more',  label: 'Ещё' },
];
```

**TabBar скрывается** на: login, pin, welcome, chat/:id, estimate-report, mimir-estimate, huginn-chat.

### 6.3 Меню «Ещё» (More.jsx)

50+ пунктов, сгруппированных по section (Tenders, Finances, Personnel, Works, Communications, Admin). Фильтрация по RBAC:

```javascript
const visibleMenu = MENU_ITEMS.filter(item => hasPermission(role, item.section));
```

### 6.4 Куда добавить «Колесо» и «Магазин»

**Вариант A — В меню «Ещё»** (рекомендуется для старта):
```javascript
{ path: '/wheel', icon: Zap, label: 'Колесо Норн', section: 'gamification', color: 'var(--gold)', bg: 'var(--gold-glow)' },
{ path: '/shop',  icon: ShoppingBag, label: 'Магазин',  section: 'gamification', color: 'var(--blue)', bg: 'rgba(30,77,140,0.1)' },
```

**Вариант B — 6-я вкладка** (если основная фича, заменить «Работы» или перестроить):
Не рекомендуется: 6 вкладок ← тесно на мобиле.

**Вариант C — Виджет на Home** (dashboard карточка + ссылка в «Ещё»):
Рекомендуется как дополнение к варианту A.

### 6.5 Desktop Navigation

**Файл**: `public/assets/js/app.js` (hash-based router)

9 групп: Home, Тендеры, Работы, Финансы, Ресурсы, Персонал, Коммуникации, Аналитика, Система.

Для геймификации можно:
- Добавить в существующую группу «Персонал» (для HR/Админа)
- Или создать новую группу «Вовлечение» / «Engagement»

---

## 7. PWA Infrastructure

### 7.1 Service Worker

| Параметр | Main CRM | Field PWA |
|---|---|---|
| **Файл** | `public/sw.js` | `public/field/sw.js` |
| **SHELL_VERSION** | `19.8.0` | `3.3.1` |
| **Стратегия** | Network First (API, HTML, JS/CSS) + Stale While Revalidate (статика) | Cache First (shell) + Network First (API) |
| **Offline** | IndexedDB `asgard-offline-queue` | IndexedDB `field-offline-db` |

### 7.2 Push Notifications — 5 шаблонов

| # | Шаблон | Получатель | Действия |
|---|---|---|---|
| 1 | 📋 Просчёт на согласование | Директора | ✅ Согласовать / ❌ Отклонить |
| 2 | 💰 Заявка на оплату | Бухгалтер | 💳 Оплатить / 📝 На доработку |
| 3 | 💵 Наличные выданы | Инициатор | ✅ Подтвердить |
| 4 | 📌 Новая задача | Исполнитель | ✅ Принять |
| 5 | 💬 Сообщение чата | Получатель | 💬 Ответить |

**Добавить «Колесо готово»**: Легко — добавить функцию в `src/services/pushService.js` (по образцу существующих). **Не требует изменений SW или схемы БД.**

### 7.3 Background Sync

- **CRM**: `approval-queue` — офлайн-действия согласования
- **Field**: `field-checkin-sync`, `field-photo-sync`, `field-report-sync`
- Хранение: IndexedDB → retry при восстановлении сети

### 7.4 Offline Guard

`public/assets/js/offline-guard.js` — Мониторинг сети, polling `/api/health`, руническая анимация при офлайне.

### 7.5 PWA Manifest

- **CRM**: `manifest.json` — «АСГАРД CRM», standalone, theme `#0d1428`, 11 иконок
- **Field**: `field/manifest.json` — «ASGARD Field», theme `#C49A2A` (золотой)

---

## 8. Huginn Integration Points

### 8.1 Автосоздание сообщений из бэкенда

**Файл**: `src/services/estimateChat.js`

Полностью рабочий паттерн:
1. `createEstimateChat()` — создаёт чат + pinned card + system message + SSE уведомления
2. `syncCommentToChat()` — дублирует комментарий директора в чат
3. `triggerMimirAutoRespond()` — AI отвечает на комментарий

**Можно из бэкенда отправить системное сообщение в чат бригады?** — **ДА**, инфраструктура полностью готова. Нужно только создать чат с `entity_type='brigade'`.

### 8.2 Типы сообщений

| message_type | Описание |
|---|---|
| `text` | Обычный текст |
| `system` | Системное уведомление |
| `estimate_card` | Pinned карточка просчёта |
| `estimate_update` | Обновление версии просчёта |
| `mimir_response` | AI ответ |
| `voice` | Голосовое |
| `video` | Видео |

### 8.3 Pinned Metric Cards — формат

```json
{
  "estimate_id": 123,
  "title": "Название",
  "status": "sent",
  "total_cost": 1500000,
  "margin_pct": 25,
  "version_no": 1
}
```

**Подходит для лидерборда?** — **ДА**. Можно создать `message_type='leaderboard_card'` с metadata:
```json
{
  "card_type": "brigade_leaderboard",
  "period": "week",
  "entries": [
    {"rank": 1, "brigade_name": "Alpha", "points": 1250},
    {"rank": 2, "brigade_name": "Beta", "points": 1100}
  ]
}
```

### 8.4 Чаты бригад

**Сейчас**: Реализованы только чаты просчётов (entity_type='estimate'). Чатов бригад **нет**, но паттерн расширяется тривиально → `entity_type='brigade'`.

---

## 9. Mimir (YandexGPT/AI) Integration

### 9.1 AI Provider

**Файл**: `src/services/ai-provider.js` (~810 строк)

**3 провайдера** (с автоматическим fallback):

| Провайдер | Модель | Использование |
|---|---|---|
| **OpenAI (routerai.ru)** | `anthropic/claude-sonnet-4.6` | Основной |
| **Anthropic** | `claude-sonnet-4-6-20250514` | PDF/документы |
| **YandexGPT** | `qwen3-235b-a22b-fp8/latest` | Analytics, Fast |

### 9.2 Ключевые endpoint'ы Мимира (30+)

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/chat` | Отправка сообщения (non-streaming) |
| POST | `/chat-stream` | SSE streaming |
| POST | `/employee-summary` | Характеристика сотрудника |
| POST | `/suggest-form` | Автозаполнение форм |
| POST | `/auto-respond` | Авто-ответ на согласование |
| POST | `/auto-estimate` | Авто-просчёт (SSE) |
| POST | `/expense-recognize` | OCR чеков |
| POST | `/suggest-tkp` | Предложения по ТКП |
| GET | `/suggestions` | Ролевые быстрые запросы |

### 9.3 Генерация описаний квестов/ачивок

**Можно?** — **ДА**, абсолютно. Пример:
```javascript
const result = await aiProvider.complete({
  system: 'Ты нордический бард. Генерируй краткие описания ачивок в стиле ASGARD.',
  messages: [{ role: 'user', content: 'Ачивка: 10 смен подряд без пропусков' }],
  maxTokens: 200,
  temperature: 0.7
});
```

### 9.4 Cron-дайджесты

**Файл**: `src/services/mimir-cron.js` (~309 строк)

3 дайджеста в день (09:00, 13:30, 17:30 MSK, Пн-Пт): задачи, дедлайны, мотивация.

**Можно ли добавить gamification-дайджест?** — **ДА**, паттерн идентичный. Функция `sendDigestToUser()` полностью переиспользуема.

---

## 10. Database Schema (Relevant Subset)

### 10.1 Общая статистика

| Параметр | Значение |
|---|---|
| **Всего таблиц** | **~152** |
| **Миграции** | 58 файлов (V001 — V088) |
| **Паттерн миграций** | `V###__description.sql` (Flyway) |
| **Расположение** | `migrations/` |
| **Runner** | `node migrations/run.js` |
| **ВНИМАНИЕ** | Runner сломан (V002 падает) → миграции через `psql -f` |

### 10.2 Таблицы пользователей и сотрудников

**users**: id, login, password_hash, pin_hash, name, email, phone, **role** (VARCHAR 50), birth_date, employment_date, telegram_chat_id, is_active, last_login_at, patronymic

**employees**: id, fio, full_name, **role_tag**, phone, email, position, passport_number, **rating_avg**, is_active, **user_id** → users, phone_verified, field_pin, field_last_login, clothing_size, shoe_size

**employee_assignments**: id, employee_id, work_id, **field_role** (worker/shift_master/senior_master), tariff_id, tariff_points, per_diem, shift_type, is_active

### 10.3 Финансовые таблицы Field

**field_tariff_grid**: id, category, position_name, **points**, **rate_per_shift**, **point_value** (default 500₽), sort_order, is_active, is_combinable, requires_approval

**field_checkins**: id, employee_id, work_id, assignment_id, checkin_at, checkout_at, hours_worked, hours_paid, **day_rate**, **amount_earned**, date, shift, status

**field_trip_stages**: id, employee_id, work_id, assignment_id, stage_type, date_from, date_to, days_count, tariff_id, **tariff_points**, **rate_per_day**, **amount_earned**, source, status

**worker_payments**: id, employee_id, work_id, type (per_diem/salary/advance/bonus/penalty), amount, **total_points**, **point_value**, works_detail (JSONB), payment_method, status

### 10.4 Модели валют/очков

**Существующая модель**: Баллы тарифной сетки (`field_tariff_grid.points × point_value = ₽`). Это НЕ геймификационная валюта, а зарплатная система.

**Нет**: отдельных таблиц points/coins/balance/wallet/transactions для геймификации.

**Модель учёта**: Простая (issued - spent - returned), **НЕ double-entry**.

### 10.5 Таблицы для создания (геймификация)

```sql
-- Валюта и баланс
gamification_wallets (user_id, rune_balance, total_earned, total_spent)
gamification_transactions (id, user_id, amount, type, source, metadata, created_at)

-- Колесо
wheel_spins (id, user_id, reward_type, reward_id, reward_amount, spun_at)
wheel_rewards (id, name, type, value, weight, icon, rarity, is_active)

-- Ачивки
achievements (id, code, name, description, icon, category, condition_type, condition_value, xp_reward, rune_reward)
user_achievements (id, user_id, achievement_id, earned_at, notified)

-- Ранги и стрики
ranks (id, name, icon, min_xp, perks_json)
user_streaks (user_id, streak_type, current, best, last_action_at)

-- Магазин
shop_items (id, name, description, type, price_runes, price_points, stock, image, is_active)
shop_orders (id, user_id, item_id, quantity, total_price, status, fulfilled_by, created_at)

-- Лидерборды
leaderboard_snapshots (id, period, scope, data_json, created_at)
```

---

## 11. RBAC Model

### 11.1 Все роли системы (15 офисных + 3 полевых)

**Офисные роли**:
```
ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV,
HEAD_PM, HEAD_TO, PM, TO, HR, HR_MANAGER,
BUH, OFFICE_MANAGER, PROC, CHIEF_ENGINEER, WAREHOUSE
```

**Полевые роли** (в employee_assignments.field_role):
```
worker, shift_master, senior_master
```

**Наследование**:
- HEAD_PM → наследует PM
- HEAD_TO → наследует TO
- HR_MANAGER → наследует HR
- CHIEF_ENGINEER → наследует WAREHOUSE
- ADMIN → bypass всех проверок

### 11.2 Система прав

**Двухуровневая**:
1. `requireRoles(roles[])` — простая проверка роли
2. `requirePermission(moduleKey, operation)` — модульные права (read/write/delete) из `user_permissions` + `role_presets`

**Auth middleware**: `fastify.authenticate` (JWT), `fastify.fieldAuthenticate` (Field JWT)

### 11.3 RBAC Mobile App

**Файл**: `public/mobile-app/src/config/rbac.js`

```javascript
ROLE_PERMISSIONS = {
  ADMIN: ['*'],
  DIRECTOR_GEN: ['*'],
  PM: ['dashboard','tasks','chat','tenders','works','finances','profile','settings'],
  TO: ['dashboard','tasks','chat','tenders','works','profile','settings'],
  // ...
};
```

Для геймификации: добавить section `'gamification'` в нужные роли.

### 11.4 Роли для геймификации

| Роль в игре | CRM-роль | Доступ |
|---|---|---|
| **Рабочий** | field_role='worker' | Крутить колесо, магазин, профиль |
| **Мастер** | field_role='shift_master/senior_master' | + Лидерборд бригады, + бонусы бригаде |
| **PM** | PM | + Начисление бонусов, обзор бригад |
| **Админ модуля** | ADMIN | + Настройка весов, добавление мерча, отчёты |
| **Бухгалтерия** | BUH | + Выдача физмерча, отчёт по расходам |
| **HR** | HR/HR_MANAGER | + Рейтинги, отчёты по вовлечённости |

---

## 12. Risks, Gotchas, TODOs

### 12.1 Конфликты маршрутов

| Маршрут | Статус |
|---|---|
| `/wheel` | ✅ **Свободен** |
| `/shop` | ✅ **Свободен** |
| `/gamification` | ✅ **Свободен** |
| `/norn` | ✅ **Свободен** |
| `/api/gamification/*` | ✅ **Свободен** |

### 12.2 Производительность

- **Колесо Норн**: Ежедневное крутение → макс. 1 запрос/день/юзер → нагрузка минимальна
- **Лидерборд**: Кэшировать снэпшоты (hourly/daily cron), не считать real-time
- **Магазин**: Статичный каталог → CDN или in-memory кэш
- **Стрики**: Cron-job в полночь для проверки/сброса → не real-time

### 12.3 Известные баги в смежных модулях

| Баг | Где | Влияние на геймификацию |
|---|---|---|
| Миграционный runner сломан (V002) | `migrations/run.js` | Миграции через `psql -f` |
| BUG-8: is_online для direct chats | `chat_groups.js` | Не критично |
| Нет аватаров (только инициалы) | `field-worker.js` | Рамки/аватары потребуют хранения |
| Нет отдельной таблицы brigades | — | Бригада = work_id, лидерборд по work_id |

### 12.4 Архитектурные риски

1. **Field PWA — vanilla JS, CRM Mobile — React**: Геймификацию нужно реализовать в ОБОИХ стеках или только в одном
2. **Нет таблицы brigades**: Лидерборд бригад привязан к `work_id`. При переходе бригады на новый объект — лидерборд обнуляется?
3. **point_value = 500₽ фиксированный**: Руны геймификации НЕЛЬЗЯ смешивать с зарплатными баллами
4. **Аватар-фреймы**: Нужно хранилище для картинок (S3/local?). Сейчас аватары — только инициалы

---

## 13. Recommendations

### Что переиспользовать (готово)

| Компонент | Что | Где |
|---|---|---|
| **Push уведомления** | Добавить шаблон `pushWheelReady` | `pushService.js` |
| **Huginn чаты** | Создать brigade chats (entity_type='brigade') | `estimateChat.js` паттерн |
| **Mimir AI** | Генерация описаний ачивок, quest flavor text | `ai-provider.js` |
| **Cron дайджесты** | Ежедневная gamification-сводка | `mimir-cron.js` паттерн |
| **UI компоненты** | AnimatedCounter, BigNumber, BottomSheet, ProgressBar, StatCard, SkeletonKit | `components/shared/` |
| **Дизайн-токены** | Все цвета, типографика, анимации | `design-tokens.css` |
| **RBAC** | Добавить section 'gamification' | `rbac.js` |
| **SSE** | Real-time обновления (колесо, лидерборд) | SSEManager |

### Что делать с нуля

| Компонент | Почему |
|---|---|
| **Колесо (Wheel)** | Нет аналогов — canvas/CSS анимация вращения |
| **Магазин (Shop)** | Нет каталога товаров в системе |
| **Система рангов** | Нет XP/level логики |
| **Транзакционная модель рун** | Нужна отдельная от зарплатных баллов |
| **Achievement engine** | Текущие 8 ачивок — хардкод, нужна таблица + триггеры |
| **Аватар-фреймы** | Нет хранилища картинок |
| **Админ-панель геймификации** | Настройка весов, мерча, наград |

---

## 14. Уточняющие вопросы для Ники

1. **Field PWA или React Mobile?** Геймификация для рабочих (Field PWA, vanilla JS) или для офисных (React /m/)? Или для обоих? Это кардинально влияет на объём работы.

2. **Руны vs баллы**: Руны — это отдельная валюта, никак не связанная с зарплатными баллами (field_tariff_grid)? Или конвертируемая?

3. **Физический мерч**: Кто отвечает за фулфилмент (доставку мерча рабочему на объект)? Нужен ли workflow «заказ → одобрение → отправка → получение»?

4. **Бригада для лидерборда**: Бригада = все рабочие на одном work_id? Или нужна отдельная сущность «бригада» с постоянным составом, переходящим между объектами?

5. **Аватар-фреймы**: Откуда брать картинки рамок/бейджей? Дизайнер нарисует, или генерировать AI? Хранить на сервере или S3?

6. **Колесо — когда доступно?** Раз в день? Раз в смену? При определённых условиях (checkin + checkout = доступ)?

7. **Anti-cheat**: Нужна ли защита от накрутки? Рабочие могут пытаться крутить колесо с нескольких устройств?

8. **Scope ролей**: Мастер видит ТОЛЬКО свою бригаду в лидерборде, или все бригады компании?

9. **Офлайн**: Колесо и магазин должны работать офлайн (как Field PWA), или только онлайн?

10. **MVP scope**: Какой минимальный набор для первого запуска? Рекомендую: Колесо (daily spin) + 3 типа наград (руны/XP/ничего) + Баланс рун в профиле + Простой магазин (5 товаров). Ранги, ачивки, лидерборды — во второй волне.

---

*Отчёт сгенерирован автоматически на основе анализа кодовой базы ASGARD CRM.*  
*Ничего не было изменено в коде.*
