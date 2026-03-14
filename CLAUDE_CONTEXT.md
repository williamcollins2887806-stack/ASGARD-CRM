# ASGARD CRM — Mobile v3 Context Journal

> Межсессионный журнал для Claude. Обновляется в конце каждой сессии.
> Последнее обновление: **14.03.2026 — Сессия 1 (Foundation: DS + Components + Showcase)**

---

## 1. ПРОЕКТ

**Цель:** Полный перезапуск мобильного фронтенда ASGARD CRM.
Mobile v2 отключён флагом `MOBILE_V2_ENABLED = false` после повреждений от GPT Codex.
Mobile v3 — чистый рестарт с переиспользованием проверенных v2-компонентов.

**Стек:** Vanilla JS SPA, CSS Custom Properties, hash-router.
**Сервер:** 92.242.61.184, Node.js/Fastify/PostgreSQL.
**Репозиторий:** `williamcollins2887806-stack/ASGARD-CRM`, ветка `mobile-v3`.
**Тестирование:** Nick проверяет на iPhone Safari. Claude пишет и пушит код.

---

## 2. АРХИТЕКТУРА ФАЙЛОВ

### Mobile v3 файлы (будут в `public/assets/js/mobile_v3/`)
```
ds.js           — Design System (темы, токены, типографика)
components.js   — Библиотека UI-компонентов (модуль M)
core.js         — Router, Layout/Shell, TabBar, API, Gestures, Utils
auth.js         — Welcome, Login (credentials → PIN → quickPIN)
test.js         — Витрина компонентов (/test, /test-table)
home.js         — Главная страница
dashboard.js    — Дашборд руководителя
sales.js        — Тендеры, заявки, воронка, контрагенты
works.js        — Просчёты, согласования, работы
finance.js      — Финансы, счета, касса, расходы
people.js       — Персонал, допуски, графики
comms.js        — Чат, почта, уведомления, совещания
resources.js    — ТМЦ, склад, договора, доверенности
tasks.js        — Задачи, канбан
mimir.js        — AI-ассистент Мимир
system.js       — Профиль, настройки, диагностика
```

### CSS
```
mobile_v3.css   — Мобильные стили (отдельный файл, ~15-20KB)
```

### Desktop CSS (НЕ ТРОГАТЬ!)
```
app.css          (277KB)  — Основные стили
theme.css        (261KB)  — Темы (html[data-theme="light"] с 1000+ правил)
components.css   (110KB)  — Компоненты
layout.css       (32KB)   — Разметка
design-tokens.css (21KB)  — Токены
responsive.css   (120KB)  — Адаптив
```

---

## 3. ДИЗАЙН-СИСТЕМА (ds.js)

**Референс:** finance_v3.jsx (blue→red gradient, Alfa-Bank × Ozon × Norse)

### Темы
- **Dark** (по умолчанию): bg `#0D0D0F`, surface `#1A1A1F`, text `#F5F5F7`
- **Light:** bg `#F2F3F5`, surface `#FFFFFF`, text `#1A1A1F`

### Brand Colors
| Token     | Dark       | Light      |
|-----------|-----------|-----------|
| red       | #E53935   | #C62828   |
| blue      | #4A90D9   | #1E5A99   |
| gold      | #D4A843   | #C49A2A   |
| green     | #34C759   | #1A9F4A   |
| orange    | #FF9500   | #E65100   |

### Градиенты
- **heroGrad (dark):** `linear-gradient(135deg, #1A4A8A 0%, #1E5A99 25%, #3A1535 55%, #6B1515 78%, #C62828 100%)`
- **heroGrad (light):** `linear-gradient(135deg, #0A5DC2 0%, #1565C0 25%, #4A1942 55%, #8B1A1A 78%, #C62828 100%)`

### Типографика
| Key   | Size | Weight | Line |
|-------|------|--------|------|
| xs    | 10px | 500    | 1.3  |
| sm    | 12px | 400    | 1.4  |
| base  | 14px | 400    | 1.5  |
| md    | 16px | 600    | 1.3  |
| lg    | 20px | 700    | 1.2  |
| xl    | 24px | 800    | 1.1  |
| hero  | 30px | 800    | 1.0  |
| label | 10px | 500    | 1.3 (uppercase, 1px spacing) |

### Spacing / Radius
- Spacing: xxs(4) xs(8) sm(12) md(14) base(16) lg(20) xl(24) xxl(32) page(20) gap(12)
- Radius: xs(4) sm(8) md(12) lg(14) xl(18) xxl(20) hero(20) pill(44)

---

## 4. КОМПОНЕНТЫ (components.js → модуль M)

### Существующие (26 шт, проверены и рабочие)
| # | Компонент     | Описание                                    |
|---|---------------|---------------------------------------------|
| 1 | Header        | Заголовок страницы, кнопка назад, actions    |
| 2 | HeroCard      | Большая карточка с градиентом, число, детали |
| 3 | Card          | Универсальная карточка с badge, fields, swipe|
| 4 | Badge         | Статус-бейдж (solid/outline), 6 цветов      |
| 5 | FilterPills   | Горизонтальные фильтры-таблетки             |
| 6 | Stats         | Сетка 2×2 со значениями и иконками          |
| 7 | Section       | Секция с заголовком, collapsible             |
| 8 | List          | Обёртка для списка с renderItem              |
| 9 | Empty         | Заглушка «пусто»                            |
|10 | Skeleton      | Скелетоны (hero/stats/list/card)             |
|11 | Toast         | Всплывающее уведомление                     |
|12 | BottomSheet   | Нижняя выезжающая панель с drag              |
|13 | Confirm       | Диалог подтверждения                         |
|14 | FAB           | Плавающая кнопка действия                    |
|15 | TablePage     | Полная страница: header+search+filter+list+chart+stats |
|16 | BarChart      | Столбчатая диаграмма с анимацией             |
|17 | MiniChart     | Маленький SVG sparkline                      |
|18 | BigNumber     | Крупное число с трендом                      |
|19 | Form          | Форма с плавающими лейблами, toggle, select  |
|20 | FullWidthBtn  | Кнопка во всю ширину с ripple                |
|21 | DetailFields  | Список «ключ: значение» для детальных страниц|
|22 | ProgressBar   | Прогресс-бар с процентом                     |
|23 | Tabs          | Горизонтальные вкладки с индикатором         |
|24 | QuickActions  | Горизонтальная полоса быстрых действий       |
|25 | MimirBanner   | Баннер AI-подсказок                          |
|26 | SearchBar     | Поиск с debounce и очисткой                  |

### Нужно добавить для v3 — ДОБАВЛЕНЫ В СЕССИИ 1 ✅
| # | Компонент      | Зачем                                      |
|---|----------------|--------------------------------------------|
|27 | ActionSheet    | iOS-стиль меню действий ✅                  |
|28 | DatePicker     | Выбор даты (нативный + кастомный fallback) ✅|
|29 | Avatar         | Аватар пользователя с инициалами/фото ✅    |
|30 | NotificationCard | Карточка уведомления с иконкой ✅          |
|31 | StepWizard     | Пошаговая форма ✅                          |
|32 | Timeline       | Лента событий / активности ✅               |
|33 | ChatBubble     | Пузырь сообщения (свой/чужой) ✅            |
|34 | MessageComposer| Поле ввода сообщения с прикреплением ✅     |
|35 | Chip           | Маленький тег (multi-select значения) ✅    |
|36 | SegmentControl | Переключатель сегментов ✅                  |
|37 | PullToRefresh  | Визуальный индикатор обновления ✅          |
|38 | SwipeCard      | Карточка с touch swipe-демо ✅              |
|39 | DonutChart     | Прогресс-кольцо (SVG) — НОВЫЙ ✅           |
|40 | BurgerMenu     | Полноэкранное меню — НОВЫЙ ✅              |

---

## 5. СТРАНИЦЫ MOBILE V3

### Полный доступ (создание + редактирование)
| Страница        | Роут           | API routes         | Десктоп JS             |
|-----------------|----------------|--------------------|------------------------|
| Главная         | /home          | data.js            | dashboard.js, home.js  |
| Дашборд         | /dashboard     | data.js, reports.js| dashboard.js           |
| Заявки (pre)    | /requests      | pre_tenders.js     | pre_tenders.js         |
| Контрагенты     | /clients       | customers.js       | customers.js           |
| Тендеры/Воронка | /tenders       | tenders.js         | tenders.js, funnel.js  |
| Калькулятор/ТКП | /calculator    | tkp.js, estimates  | calculator_v2.js       |
| Уведомления     | /alerts        | notifications.js   | alerts.js              |
| Чат (Хугинн)   | /chat          | chat_groups.js     | chat_groups.js         |
| Профиль         | /profile       | users.js           | settings.js            |
| Задачи          | /tasks         | tasks.js           | tasks-page.js          |
| Согласования    | /approvals     | approval.js        | approvals.js           |
| Календарь       | /calendar      | calendar.js        | calendar.js            |

### View-only (просмотр, без создания)
| Страница           | Роут            |
|---------------------|-----------------|
| Сотрудники          | /personnel      |
| Допуски/разрешения  | /permits        |
| Расходы             | /expenses       |
| Работы (свод)       | /works          |
| Документы           | /docs           |
| Склад               | /warehouse      |
| Финансы             | /finances       |
| Счета               | /invoices       |
| Касса               | /cash           |
| Расчёты с рабочими  | /payroll        |

### Убраны из мобильной версии
Гантт, Большой экран, Админ-панель, Конструктор отчётов, Широкие таблицы, Системные настройки, Бэкапы, Редактор шаблонов, Телефония (настройки), Почта (настройки).

---

## 6. UX-ПРАВИЛА

1. **Таблицы → Карточки.** Никаких `<table>` — только Card с fields.
2. **Фильтры → BottomSheet.** Сложные фильтры открываются снизу, не inline.
3. **Длинные формы → StepWizard.** Пошаговое заполнение.
4. **Меню → отдельная страница /more.** Burger-меню с группами и swipe.
5. **Pull-to-refresh** на всех списковых страницах.
6. **Swipe-back** для навигации назад.
7. **Swipe-actions** на карточках (архив, удалить и т.д.).
8. **Infinite scroll** вместо пагинации.
9. **Skeleton loading** при загрузке данных.
10. **TabBar** внизу: Главная, Задачи, Почта, Ещё.
11. **Safe area** — учёт notch/home indicator на iPhone.
12. **Haptic feedback** (vibrate) при действиях.

---

## 7. СТАНДАРТ КАЧЕСТВА — УРОВЕНЬ СБЕР / ЯНДЕКС / АЛЬФА

> Утверждено Nick 14.03.2026. Каждый компонент проверяется по этому чеклисту.

### Скелетоны
- Правильные пропорции, повторяющие реальный контент (не просто серые блоки)
- Shimmer-анимация: волна блика слева направо (как у Сбера)
- Скругления совпадают с настоящими карточками
- Варианты: hero, card, list-item, stats, form — каждый похож на реальный элемент

### Текст
- `word-break: break-word` — ни одна строка не вылезает за экран
- `hyphens: auto` — автоматические переносы
- `-webkit-line-clamp` — обрезка многострочного текста с «...»
- Контраст WCAG AA минимум (4.5:1 для основного текста, 3:1 для крупного)

### Вырез iPhone (Safe Area)
- `env(safe-area-inset-top)` — Header
- `env(safe-area-inset-bottom)` — TabBar, BottomSheet, FAB
- `env(safe-area-inset-left/right)` — контент в landscape
- Применяется на КАЖДОМ слое: header, tabbar, модалки, контент

### Верстка и центрирование
- `flexbox` с `align-items: center` + `justify-content: center` — везде
- Никаких пиксельных подгонок — только relative units и flex
- Иконки и текст внутри рамок/кнопок — строго по центру
- Минимальная зона касания: 44×44px (Apple HIG)

### Свайпы и анимации
- `cubic-bezier(0.25, 0.1, 0.25, 1.0)` — основной easing
- `will-change: transform` + `transform: translate3d()` — GPU-ускорение
- Transition: 200-300ms, не больше
- Плавные переходы между страницами (slide/fade)
- Мягкие скругления — `border-radius` от 8px до 20px по контексту
- Haptic feedback (`navigator.vibrate`) на ключевых действиях

### Цвета и контраст
- Никаких несочетающихся цветов — палитра строго по DS
- Проверка каждой пары цвет/фон на контраст
- Dark theme: текст `#F5F5F7` на фоне `#0D0D0F` — контраст 19.4:1 ✓
- Light theme: текст `#1A1A1F` на фоне `#F2F3F5` — контраст 15.3:1 ✓
- Семантические цвета (success/danger/warning) проверены в обеих темах

---

## 8. CSS АРХИТЕКТУРА

### Принцип: 95% стилей через JS, CSS только для невозможного в JS

**Зачем нужен mobile_v3.css (~10-15KB):**
- `@keyframes` — shimmer-анимация скелетонов, пульсация FAB, slide-in
- `::before / ::after` — декоративные элементы, градиентные overlay
- `:active / :hover` — состояния нажатия (нельзя через inline style)
- `env(safe-area-inset-*)` — вырез iPhone
- `@supports` — проверка возможностей браузера
- `::-webkit-scrollbar { display: none }` — скрытие скроллбаров
- `backdrop-filter: blur()` — стеклянный эффект для TabBar и модалок

**Зачем остальное в JS (через DS):**
- Мгновенное переключение тем — DS.setTheme() меняет все CSS-переменные
- Компоненты самодостаточны — стиль идёт рядом с логикой
- Нет конфликтов с desktop CSS — ничего не пересекается
- Легче дебажить — стиль виден прямо в элементе

**Desktop CSS — НЕ ТРОГАТЬ:**
- app.css (277KB), theme.css (261KB), components.css (110KB)
- layout.css (32KB), design-tokens.css (21KB), responsive.css (120KB)

---

## 9. CODEX DAMAGE ASSESSMENT

### Файлы от Codex (на продакшне, НЕ УДАЛЯТЬ без согласования)
- `src/services/estimateApprovalWorkflow.js` (522 строк) — параллельная система согласований
- `migrations/V043__estimate_approval_workflow.sql` — таблица estimate_approval_requests
- `migrations/V044__estimate_requires_payment.sql` — колонка requires_payment
- `migrations/V045__approval_source_and_payment_completion.sql` — approval_payment_slips

### Codex backup файлы (безопасно)
- `*.bak_codex_*` по всему проекту (travel.js, diag.js, kpi_money.js, staff_schedule.js, receipt_scanner.js)
- `public/assets/css/mobile_v2.css.pre_codex_20260311`
- `public/assets/js/mobile_v2/ds.js.pre_codex_20260311`
- `public/assets/js/mobile_v2/components.js.pre_codex_20260311`

### Новые файлы от другой сессии (14.03.2026)
- `src/services/approvalService.js` (779 строк) — правильная система согласований
- `src/routes/approval.js` (220 строк) — новые API endpoints
- `public/assets/js/approval_modals.js` (357 строк)
- `public/assets/js/approval_payment.js` (261 строк)
- `migrations/V046__universal_approval_payment.sql` (153 строк)
- `AUDIT_APPROVAL_SYSTEM.md` (285 строк)

---

## 10. ПЛАН СЕССИЙ

### Сессия 0 ✅ (14.03.2026) — Аудит и планирование
- [x] Клонирование репо, полный аудит
- [x] Оценка Codex damage
- [x] Инвентаризация компонентов и API
- [x] Создание CLAUDE_CONTEXT.md
- [x] Определение недостающих компонентов

### Сессия 1 ✅ (14.03.2026) — Foundation: DS + Components + Showcase
- [x] Создана папка `public/assets/js/mobile_v3/`
- [x] Скопированы из v2: ds.js (740 строк), components.js, core.js, auth.js
- [x] ds.js обновлён до v3 (header, версия)
- [x] Добавлены 14 новых компонентов (#27-40) в components.js (3089 строк):
  - #27 ActionSheet — iOS-стиль меню действий
  - #28 DatePicker — выбор даты с нативным fallback
  - #29 Avatar — аватар с инициалами/фото/статусом
  - #30 NotificationCard — карточка уведомления
  - #31 StepWizard — пошаговая форма
  - #32 Timeline — лента событий
  - #33 ChatBubble — пузырь сообщения
  - #34 MessageComposer — поле ввода с отправкой/прикреплением
  - #35 Chip — тег с удалением
  - #36 SegmentControl — переключатель сегментов
  - #37 PullToRefresh — визуальный индикатор
  - #38 SwipeCard — карточка с touch swipe
  - #39 DonutChart — прогресс-кольцо (SVG)
  - #40 BurgerMenu — полноэкранное меню со ВСЕМИ разделами CRM
- [x] Создан `mobile_v3.css` (364 строк) — keyframes, safe-area, backdrop-filter, transitions
- [x] Полностью новый `test.js` (349 строк) — витрина 17 блоков:
  - Навигация (TabBar + Burger + Header варианты)
  - Кнопки (Primary/Ghost/Danger/Success/Warning/Loading/Mini)
  - Pill-статусы (12 статусов CRM)
  - Карточки (тендер/работа/аванс/согласование/уведомление/сотрудник)
  - Avatar & Chip
  - SegmentControl & Tabs
  - Формы (Input/Select/Toggle/DatePicker/StepWizard)
  - Bottom Sheet & Action Sheet & Confirm
  - Свайп-карточки & Empty state
  - Toast-уведомления
  - Скелетоны (hero/stats/card/list)
  - Графики (Stats/BarChart/DonutChart/ProgressBar/Sparkline)
  - Timeline
  - Чат (ChatBubble + MessageComposer)
  - Quick Actions & MimirBanner
  - Виджеты дашборда (приветствие/финансы/воронка/задачи/касса/просрочки/ДР/дедлайны)
  - DetailFields
- [x] Создан `public/mobile-test.html` — standalone тест-страница с TabBar
- [x] Обновлён `index.html` — флаг MOBILE_V3_ENABLED + подключение скриптов
- [x] CLAUDE_CONTEXT.md обновлён

**Тестирование:** Открыть `https://92.242.61.184/mobile-test.html` на iPhone Safari.
**Dark/Light:** Кнопка солнца в хедере + тогл-переключатель.
**Burger:** Таб «Ещё» или кнопка в Block 1.
**Итого:** 40 компонентов (модуль M), 6572 строк JS+CSS.

### Сессия 2 — Shell + Navigation + Auth
- [ ] Финализировать Layout/Shell/TabBar
- [ ] Страница /more (меню)
- [ ] Auth flow (welcome → login → PIN)
- [ ] Routing для всех страниц (заглушки)

### Сессии 3-10 — Страницы (по 2-3 страницы за сессию)
- Сессия 3: Home + Dashboard
- Сессия 4: Tasks + Approvals
- Сессия 5: Tenders/Funnel + Clients
- Сессия 6: Calculator/TKP + Works
- Сессия 7: Chat + Notifications + Mail
- Сессия 8: Finance (view) + Invoices + Cash
- Сессия 9: Personnel + Permits + Calendar
- Сессия 10: Resources + Warehouse + Profile

### Сессия 11 — Mimir AI integration
### Сессия 12 — PWA / Push / Offline
### Сессия 13 — Final QA + Production deploy

---

## 11. РАБОЧИЙ ПРОЦЕСС

1. **Claude** пишет код в этой сессии и пушит в GitHub (ветка `mobile-v3`)
2. **Nick** тестирует на iPhone Safari через https://92.242.61.184
3. Каждая сессия заканчивается обновлением этого файла
4. Каждая сессия оставляет **рабочий, не сломанный код**
5. Desktop CSS и JS **НЕ МОДИФИЦИРУЮТСЯ** — только мобильные файлы

---

## 12. КРИТИЧЕСКИЕ ЗАМЕТКИ

- Старый GitHub-токен `ghp_zKk…` **скомпрометирован** — нужен новый перед push
- `DS.setTheme()` — исправлен баг: теперь устанавливает `root.dataset.theme = name`
- Мобильная версия отключена через `window.ASGARD_FLAGS.MOBILE_V2_ENABLED = false` в index.html
- При включении v3: сменить флаг, обновить пути скриптов в index.html
- Сервер: SSH ключ `C:\Users\Nikita-ASGARD\.ssh\asgard_crm_migrate`
