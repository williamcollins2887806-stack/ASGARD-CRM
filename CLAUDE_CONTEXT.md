# ASGARD CRM — Mobile v3 Context Journal

> Межсессионный журнал для Claude. Обновляется в конце каждой сессии.
> Последнее обновление: **14.03.2026 — Сессия 2.5 (CSS isolation from desktop, P2/P3 fixes: avatar, tooltip, z-index, PIN SHA-256, memory leaks)**

---

## 1. ПРОЕКТ

**Цель:** Полный перезапуск мобильного фронтенда ASGARD CRM.
Mobile v2 **архивирован** в `public/_deprecated/` (повреждён GPT Codex).
Mobile v3 — чистый рестарт. Работает через hash-router внутри `index.html`.

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
mobile_v3.css   — УДАЛЁН в Сессии 2. Стили мигрированы в ds.js generateCSS().
```

### Архив (НЕ ИСПОЛЬЗОВАТЬ)
```
public/_deprecated/mobile_v2_archived_20260314/  — 28 JS файлов mobile_v2
public/_deprecated/mobile_v2.css*                — 5 CSS файлов mobile_v2
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

### Принцип: 100% стилей через JS (ds.js generateCSS)

**Начиная с Сессии 2 — `mobile_v3.css` удалён.** Все стили в `ds.js generateCSS()`:
- `@keyframes` — 20 анимаций (shimmer, slide, fade, bounce, breath, etc.)
- `::before / ::after` — sheet-handle, ripple
- `:active` — pressable, card-hover, btn, btn-mini, fab, tabbar
- `env(safe-area-inset-*)` — content, tabbar, safe-top/bottom/x
- `backdrop-filter: blur()` — tabbar, header
- `::-webkit-scrollbar { display: none }` — scrollbar hiding
- `.asgard-text-safe/clamp-1/2/3` — text utilities
- `@media print` — hide tabbar/header/fab
- `::selection` — синяя подсветка выделения

**Единый CSS-prefix: `asgard-`** — никаких `mc-`, `mv3-`.

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
**Итого:** 40 компонентов (модуль M), ~7500 строк JS+CSS.

### Сессия 1.1–1.2 (14.03.2026) — Auth + полный набор виджетов
Добавлено к витрине (test.js 734 строки, 23 секции):
- **Block 18: Auth экраны** — Welcome (руны + щит + кнопки), Login (floating labels, форма на градиенте), PIN (numpad 4×3, dots, Face ID, интерактивный ввод), Register (заявка на доступ + выбор роли)
- **Block 19: Модалки бухгалтерии** — Оплата (ПП/Наличные), подтверждение наличных, отчёт о расходах (file upload + textarea), возврат средств
- **Block 20: Формы (дополнительные)** — Checkbox group, Radio group, File upload zone
- **Block 21: Мини-календарь** — Grid 7×5, текущий день красный, дедлайны синие точки
- **Block 22: Сканер, телефония, почта, банк, площадки**
- **Block 23: Все оставшиеся виджеты** — Уведомления-список, Мои работы (3 карточки с прогрессом), Согласования (3 ожидающих), Допуски (3 истекающих), KPI сводка (4 числа), Подотчётные (на руках/потрачено/активных), Оборудование-алерты (3 позиции), Ведомости (ожидание), Заявки с AI-цветом (зелёный/жёлтый/красный), ТМЦ баланс

**Полный чек-лист виджетов дашборда (все 27 из ТЗ):**
| # | Виджет | Блок | Статус |
|---|--------|------|--------|
| 1 | Приветствие | 16 | ✅ |
| 2 | Уведомления | 23 | ✅ |
| 3 | Мои работы | 23 | ✅ |
| 4 | Воронка | 16 | ✅ |
| 5 | Финансы | 16 | ✅ |
| 6 | Стоимость ТМЦ | 23 | ✅ |
| 7 | Дни рождения | 16 | ✅ |
| 8 | Согласования | 23 | ✅ |
| 9 | Календарь | 21 | ✅ |
| 10 | Быстрые действия | 15 | ✅ |
| 11 | Сканер чеков | 22 | ✅ |
| 12 | Телефония | 22 | ✅ |
| 13 | Просроченные работы | 16 | ✅ |
| 14 | Истекающие допуски | 23 | ✅ |
| 15 | Загрузка РП | 12 | ✅ |
| 16 | Динамика тендеров | 12 | ✅ |
| 17 | KPI сводка | 23 | ✅ |
| 18 | Ближайшие дедлайны | 16 | ✅ |
| 19 | Баланс кассы | 16 | ✅ |
| 20 | Мои подотчётные | 23 | ✅ |
| 21 | Оборудование алерты | 23 | ✅ |
| 22 | Ведомости ожидание | 23 | ✅ |
| 23 | Мои задачи | 16 | ✅ |
| 24 | Заявки AI | 23 | ✅ |
| 25 | Банковская сводка | 22 | ✅ |
| 26 | Тендерные площадки | 22 | ✅ |
| 27 | Моя почта | 22 | ✅ |

**Дополнительно утверждены на витрине:**
- Checkbox / Radio / File Upload (Block 20)
- Модалки бухгалтерии: 4 сценария (Block 19)
- Auth: 4 экрана (Block 18)
- Мини-календарь (Block 21)

### Дополнение 1.1 (14.03.2026) — Auth экраны + аудит полноты
- [x] Добавлен Block 18: Auth экраны (5 визуальных демо):
  - 18.1 Welcome (shield, руны, градиент, 3 кнопки)
  - 18.2 Login (форма логин+пароль на hero-grad, floating labels)
  - 18.3 PIN-код (аватар, 4 точки, рабочий numpad с haptic)
  - 18.4 Register (заявка на доступ, роли, форма)
- [x] Добавлен Block 19: Модалки бухгалтерии (4 штуки):
  - Выбор способа оплаты (ПП / Наличные) — BottomSheet
  - Подтверждение получения наличных — Confirm
  - Отчёт о расходах (file upload + comment) — BottomSheet fullscreen
  - Возврат средств в кассу — BottomSheet
- [x] Добавлен Block 20: Недостающие формы:
  - Checkbox (с анимацией)
  - Radio (с подсветкой)
  - File upload (drop zone)
- [x] Добавлен Block 21: Мини-календарь (март 2026, today highlight, event dots)
- [x] Добавлен Block 22: Остальные виджеты дашборда:
  - Сканер чеков (кнопка + последний скан)
  - Телефония (статус онлайн)
  - Моя почта (3 письма, unread dots)
  - Банковская сводка (расчётный счёт)
  - Тендерные площадки (2 новых с площадок)
- [x] test.js: 609 строк, 22 блока

**Полный аудит компонентов для v3 (40 шт):**
Все 40 компонентов имеют визуальные демо в витрине. Для следующих сессий
новые компоненты НЕ НУЖНЫ — только собирать страницы из существующих.

**Полный аудит виджетов дашборда (27 из задания):**
✅ 1.Приветствие 2.Уведомления 3.Мои работы 4.Воронка 5.Финансы
✅ 6.ТМЦ(N/A) 7.ДР 8.Согласования(в карточках) 9.Календарь 10.Быстрые действия
✅ 11.Сканер чеков 12.Телефония 13.Просроченные 14.Допуски(в уведомлениях)
✅ 15.Загрузка РП 16.Динамика(sparkline) 17.KPI(stats) 18.Дедлайны
✅ 19.Баланс кассы 20.Подотчётные(в кассе) 21.Оборудование(alerts)
✅ 22.Ведомости(N/A) 23.Задачи(checklist) 24.Заявки(карточки)
✅ 25.Банк.сводка 26.Тендер.площадки 27.Моя почта

**Полный аудит Auth (5 экранов):**
✅ Welcome, Login, PIN Setup/Confirm, Quick PIN, Register

### Сессия 2 ✅ (14.03.2026) — Router-интеграция + P0/P1 фиксы из ревью

**Архивация mobile_v2:**
- [x] `public/assets/js/mobile_v2/` (28 файлов) → `public/_deprecated/mobile_v2_archived_20260314/`
- [x] 5 CSS файлов `mobile_v2.css*` → `public/_deprecated/`
- [x] 17 закомментированных v2-строк в index.html — удалены
- [x] Флаг `MOBILE_V2_ENABLED` — удалён полностью
- [x] `auth.js` v3 подключён в index.html

**Router-интеграция:**
- [x] `App.shouldUseMobile()` — детектирует мобильное устройство (userAgent + width + touch)
- [x] `App.init()` — условная инициализация: мобильный shell только на мобильных, десктоп не затронут
- [x] Авто-инициализация через DOMContentLoaded в core.js
- [x] Безопасная регистрация маршрутов (typeof проверки на WelcomePage/LoginPage/TestPage)
- [x] Placeholder для /home (ссылка на витрину)
- [x] `mobile-test.html` — удалён, витрина доступна через `#/test`

**CSS-унификация (P0):**
- [x] `mc-*` → `asgard-*` (66 вхождений в components.js)
- [x] `mv3-*` → `asgard-*` в test.js
- [x] `mobile_v3.css` удалён — все стили мигрированы в `ds.js generateCSS()`:
  - Добавлены: text-safe/clamp, :active состояния, ripple, sheet-handle, header backdrop, safe-area, print, 4 уникальных keyframes (asgardFadeOut, asgardBounce, asgardBreath, asgardSlideSheetDown)
- [x] Единый CSS-prefix `asgard-` во всех файлах

**Дедупликация (P0):**
- [x] `el()` — одна каноническая версия в `core.js (Utils.el)`
  - `components.js` → `const el = Utils.el;`
  - `auth.js` → `const el = Utils.el;`
  - `test.js` → тонкая обёртка `el(tag, styleObj, children)` → `Utils.el(tag, {style}, children)`
- [x] Keyframes — один источник в ds.js (16 общих + 4 уникальных)
- [x] CSS reset — только в ds.js

**Качество кода (P0):**
- [x] `console.log('[MOBILE_V2]...')` — удалён
- [x] Версии: `Mobile Core v2.0` → `v3.0`, `auth.js source: mobile_v2` → `mobile_v3`

**Touch targets ≥ 44px (P1):**
- [x] Header back button: padding 4px → 10px, min 44×44
- [x] Header action buttons: padding 6px → 10px, min 44×44
- [x] BottomSheet close ✕: 28px → 36px + 4px padding = 44px
- [x] BurgerMenu close ✕: 36px → 44px
- [x] Card action buttons: padding 4px 8px → 10px 12px, minHeight 44px

**Accessibility ARIA (P1):**
- [x] Header: `role="banner"`
- [x] TabBar: `role="navigation"`, `aria-label="Навигация"`
- [x] Tab items: `role="tab"`, `aria-selected` toggle
- [x] BottomSheet: `role="dialog"`, `aria-modal="true"`
- [x] Confirm: `role="alertdialog"`, `aria-modal="true"`
- [x] ActionSheet: `role="dialog"`, `aria-modal="true"`
- [x] BurgerMenu: `role="dialog"`, `aria-modal="true"`
- [x] Toast: `role="status"`, `aria-live="polite"`
- [x] SearchBar: `role="search"`
- [x] Back/Close buttons: `aria-label`
- [x] Form required: `aria-required="true"`
- [x] Form error: `aria-invalid="true"` (set/unset)

**Scroll lock (P1):**
- [x] `Utils.lockScroll()` / `Utils.unlockScroll()` — ref-counted
- [x] Применён в: BottomSheet, Confirm, ActionSheet, BurgerMenu

**AsgardAuth fallback (P1):**
- [x] `authLoginStep1()`, `authGetAuth()`, `authVerifyPin()` — обёртки с fallback на API.fetch
- [x] Нет ReferenceError если десктопный auth.js не загружен

**Дополнительно (P2):**
- [x] BottomSheet drag parse bug: `replace(/[^\d]/g,'')` → `match(/translateY\(([+-]?\d+)/)` — корректный parse
- [x] BurgerMenu accordion: `setTimeout(350)` → `transitionend` event

**TODO для Сессии 3:**
- [x] Avatar hardcoded colors → DS tokens ✅ (Сессия 2.5)
- [x] BarChart tooltip duplication → выделить в функцию ✅ (Сессия 2.5)
- [x] Z-index scale: `DS.z = {...}` + замена magic numbers ✅ (Сессия 2.5)

### Сессия 2.5 ✅ (14.03.2026) — CSS-изоляция от десктопа + P2/P3 фиксы

**CSS-изоляция десктопных стилей:**
- [x] `html.asgard-mobile` класс добавляется в `Layout.create()`
- [x] 22 CSS-правила в `ds.js generateCSS()` через `html.asgard-mobile`:
  - `body::before` (градиент-полоска) — скрыта
  - `body` — сброс min-height/overflow/position/width/height
  - Шрифт: системный `-apple-system` вместо Inter на всех элементах
  - `input/select/textarea` — сброс десктопных стилей (width, padding, border, background)
  - `input:focus` — убран двойной focus-glow (box-shadow: none)
  - `checkbox/radio` — сброс десктопного размера
  - `a` — цвет inherit, без decoration
  - `::-webkit-scrollbar` + `scrollbar-width: none` — полное скрытие скроллбаров

**P2/P3 фиксы:**
- [x] FIX-1: Avatar — hardcoded цвета → `DS.t.red/blue/green/orange/gold` (theme-aware)
- [x] FIX-2: BarChart — 3 дублированных tooltip-блока → единая `showTooltip()` функция
- [x] FIX-3: Z-index scale `DS.z` = {base:0, dropdown:10, sticky:50, fab:90, overlay:1000, sheet:1500, modal:2000, toast:2500}
  - Заменены 10 magic numbers в components.js
- [x] FIX-4: PIN hash → SHA-256 (`crypto.subtle.digest`), async, salt `asgard_pin_salt_`, prefix `ph2_`
  - Все вызовы переведены на `await hashPin(pin)`
  - Старые PIN `ph_*` автоматически инвалидируются (re-login required)
- [x] FIX-5: Memory leaks — listener cleanup:
  - `renderTabBar()` → cleanup предыдущего `asgard:route` listener через `_routeHandler`
  - `createThemeToggle()` → cleanup через `toggle._cleanup()`, `asgard:theme` listener

**Статус:** Тестовая страница `#/test` готова к утверждению дизайна. CSS-изоляция обеспечивает 1:1 вид со standalone HTML.

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

- `mobile_v2` полностью архивирован в `public/_deprecated/`. Флаг `MOBILE_V2_ENABLED` удалён.
- `mobile_v3.css` удалён. Все стили в `ds.js generateCSS()`.
- `mobile-test.html` удалён. Витрина: `https://asgard-crm.ru/#/test`
- Мобильная версия активируется автоматически через `App.shouldUseMobile()` (userAgent + width ≤ 768)
- Десктоп: `App.init()` возвращает early, `app.js` работает как раньше
- `el()` — единственная каноническая версия в `core.js (Utils.el)`
- `DS.z` — z-index scale: base(0), dropdown(10), sticky(50), fab(90), overlay(1000), sheet(1500), modal(2000), toast(2500)
- `hashPin()` — async SHA-256, prefix `ph2_`, salt `asgard_pin_salt_`. Старые `ph_` PIN невалидны.
- `html.asgard-mobile` класс — CSS-изоляция мобильного shell от десктопных 860KB стилей
- `auth.js` использует fallback-обёртки для AsgardAuth (не ломается без десктопного auth.js)
- `DS.setTheme()` — исправлен баг: теперь устанавливает `root.dataset.theme = name`
- GitHub-токен: используется текущий (Nick предоставляет при пуше)
- Сервер: SSH ключ `C:\Users\Nikita-ASGARD\.ssh\asgard_crm_migrate`

---

## Модули Закупки + Склад + Сбор (feature/procurement-warehouse-assembly)
- V052: procurement_requests (ex tmc_requests) + items + payments + history
- V053: assembly_orders + pallets (capacity_items, capacity_kg) + items
- Backend: src/routes/procurement.js (~800 строк), src/routes/assembly.js (~700 строк)
- Frontend: procurement-page.js (~450 строк), assembly-page.js (~300 строк), assembly-dnd.js (~500 строк VPB)
- CSS: procurement.css (prefix proc-*), assembly.css (prefix asm-* page-level, vpb__* BEM for Visual Pallet Builder)
- Visual Pallet Builder (VPB): drag-and-drop сборка паллетов, деревянная текстура CSS, FLIP-анимации,
  Web Audio thud, stretch-film wrap, capacity limits (warning 80% / full 100% / overfill), touch/pointer
- Роли: ASSEMBLY_MANAGERS (PM+WH+DIR) управляют сборкой, WH_ROLES — только receive-all (приёмка)
- Демобилизация: return_status (returning/damaged/lost/consumed) popup на бейдже
- Интеграция: pm_works.js (3 модалки в "Действия" + closeout проверки + возврат оборудования)
- Удалено: purchase_requests, proc_requests.js, tmc_requests.js, upsertPurchaseRequest, notifyPurchaseRequest
- approvalService.js: procurement_requests вместо tmc_requests
- equipment.js: новые статусы + reserve/return/write-off/available/from-procurement
- Мобильные заглушки: procurement.js, assembly.js (мини-статистика + ролевой доступ)
- Тесты: tests/e2e/flow-procurement-warehouse-assembly.test.js (~50 тестов)

## Техдолг после console-audit session (2026-04-19)

- **pm_works.js subtitle `&quot;`** — `esc()` экранирует кавычки в имени заказчика, subtitle показывает `&quot;` вместо `"`. Решение: отделить HTML-рендер от textContent-вывода (рефакторинг esc → textContent для subtitle). Не убирать esc() — это XSS-защита.
- **loginAs flaky в e2e-тестах** — Playwright loginAs() через UI нестабилен (SW update banner перехватывает, PIN keypad race, session timeout). Нужен retry + увеличенный timeout или API-based login fallback.
- **Клик по строке таблицы /pm-works** — sticky header `<div>Дедлайн</div>` перекрывает pointer events. Нужен z-index audit для sticky th в таблицах.
- **Pre-commit hook**: `.githooks/pre-commit` блокирует Unicode smart quotes (U+201C/U+201D) в .js/.css/.html/.json. Активируется через `git config core.hooksPath .githooks` (автоматически при `npm install` через postinstall скрипт).
