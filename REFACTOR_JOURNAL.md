# ЖУРНАЛ РЕФАКТОРИНГА mobile-refactor
## Ветка: mobile-refactor | Начало: 2026-03-18

---

## АУДИТ — НАЙДЕННЫЕ ПРОБЛЕМЫ

### 🔴 КРИТИЧЕСКИЕ (P0)

**BUG-1: Mimir-сообщения пропадают при перезаходе**
- Файл: `src/routes/chat_groups.js:653`
- Причина: `JOIN users u ON m.user_id = u.id` — INNER JOIN фильтрует сообщения Mimir (user_id=0), которого нет в таблице users
- Фикс: `LEFT JOIN` + `COALESCE(u.name, 'Мимир')` + `(m.user_id = 0) as is_mimir_bot`

**BUG-2: Виджет "Загрузка РП" показывает не всех РП**
- Файл: `public/assets/js/mobile_v3/widgets/team_workload.js`
- Причина: `/works` API имеет `limit=100`, загружает только последние 100 работ. Если у РП есть только старые работы — он не попадает в выборку
- Фикс: использовать `/works/analytics/team` (серверная агрегация без лимита)

### 🟠 СЕРЬЁЗНЫЕ (P1)

**BUG-3: CSS изоляция — huginn.css содержит не-prefixed классы**
- Файл: `public/assets/css/huginn.css:2095,2110,2291,2306,2329`
- Классы: `.chat-item--mimir`, `.chat-message.mimir-bot`, `.chat-attachment-link`, `.chat-mic-btn`, `.chat-main`
- Конфликт с десктопным `app.css` (строки 7920-8800) и `theme.css` (3586+)
- Фикс: переименовать в `.huginn-chat-item--mimir`, `.huginn-message--mimir-bot`, etc.

**BUG-4: 123 inline style-а в messenger.js**
- 43 × `style: {}` объекты (при создании элементов)
- 80 × `element.style.xxx = ...` (динамические)
- Часть статических можно заменить CSS-классами
- Часть динамических (display:none/flex, transform, height) — оставить в JS (это правильно)

**BUG-5: Huginn-аватар Mimir — inline styles**
- `messenger.js:771-778` — 8 CSS-свойств через `style:{}` у аватара Mimir
- Должны быть в CSS классе

**BUG-6: Виджеты — все используют inline styles для layout**
- team_workload, tenders_funnel, kpi_summary и др.
- Нужен CSS design system для виджетов

---

## ПЛАН ИСПОЛНЕНИЯ

1. ✅ Бэкап и ветка
2. ✅ Аудит
3. 🔄 Фикс BUG-1 (Mimir сообщения)
4. 🔄 Фикс BUG-2 (Виджет team_workload)
5. 🔄 Фикс BUG-3 (CSS изоляция huginn.css)
6. 🔄 CSS-рефакторинг huginn.css (на основе Desktop/для кода/huginn.css)
7. 🔄 Убрать inline styles из messenger.js → CSS классы
8. 🔄 CSS design system для мобильных виджетов
9. 🔄 Проверка остальных мобильных страниц

---

## ВЫПОЛНЕННЫЕ ФИКСЫ

### ✅ BUG-1: Mimir-сообщения пропадают (коммит ~)
- `src/routes/chat_groups.js`: INNER JOIN → LEFT JOIN + COALESCE(u.name,'Мимир')

### ✅ BUG-2: Виджет team_workload — неверные данные
- `widgets/team_workload.js`: заменён на `/works/analytics/team`
- `widgets/overdue_works.js`, `kpi_summary.js`: заменены на `/works?limit=1000`

### ✅ BUG-3: CSS изоляция messenger.js
- `messenger.js`: все inline styles убраны, добавлены `.huginn-*` классы в huginn.css

### ✅ TASK: Создан CSS design system для 38 мобильных компонентов
- `public/assets/css/asgard-components.css` (~1900 строк) — НОВЫЙ ФАЙЛ
  - Покрывает все 38 M.* компонентов с `.asgard-*` классами
  - Modifier classes: `--transparent`, `--gradient`, `--outline`, `--border-{color}`, `--dual`, etc.
- `public/assets/js/mobile_v3/components.js`:
  - Было ~235 inline style объектов → осталось ~44 (только динамические: DS.anim, DS.animPop, dynamic colors)
  - Удалены неиспользуемые функции `inputStyle()` и `pillStyle()`
  - Все компоненты используют CSS классы через `className:`
- `public/index.html`: добавлена ссылка на `asgard-components.css?v=17.12.0`
- `public/sw.js`: добавлен в SHELL_ASSETS

### ✅ Huginn.css — дополнения
- Добавлены классы: `.huginn-mimir-avatar-small`, `.huginn-file-info`, `.huginn-video-preview`, `.huginn-group-settings`, `.huginn-check-icon`
- Фикс height:100% для `.huginn-chat-page`

---

### 📊 ИТОГИ CSS-рефакторинга components.js

| Компонент | До | После |
|---|---|---|
| Header | 9 inline | 0 (className modifier) |
| HeroCard | 7 inline | 1 (dynamic gradient) |
| Card | 14 inline | 2 (DS.anim + customStyle) |
| Badge | 9 inline | 3 (dynamic colors) |
| FilterPills | 8 inline | 0 |
| Stats | 6 inline | 2 (DS.anim + iconColor) |
| Section | 7 inline | 0 |
| List | 2 inline | 0 |
| Empty | 4 inline | 1 (DS.anim) |
| Skeleton | 8 inline | 4 (dynamic heights) |
| Toast | 11 inline | 3 (dynamic colors) |
| BottomSheet | 15 inline | 1 (dynamic maxHeight) |
| Confirm | 12 inline | 2 (DS.animPop + danger color) |
| FAB | 11 inline | 1 (animation: none) |
| TablePage | 3 inline | 0 |
| BarChart | 12 inline | 6 (dynamic bg + transition delay) |
| BigNumber | 7 inline | 4 (dynamic colors) |
| Form | 18 inline | 3 (toggle state) |
| FullWidthBtn | 8 inline | 2 (ripple position + v) |
| DetailFields | 9 inline | 1 (DS.anim) |
| ProgressBar | 6 inline | 1 (dynamic bg) |
| Tabs | 8 inline | 0 |
| QuickActions | 7 inline | 1 (DS.anim) |
| MimirBanner | 8 inline | 1 (DS.anim) |
| SearchBar | 9 inline | 0 |
| ActionSheet | 10 inline | 0 |
| DatePicker | 7 inline | 0 |
| Avatar | 8 inline | 3 (size, gradient, font-size) |
| NotificationCard | 10 inline | 0 |
| StepWizard | 12 inline | 0 |
| Timeline | 9 inline | 2 (dynamic dot color + padBottom) |
| ChatBubble | 9 inline | 0 |
| MessageComposer | 7 inline | 0 |
| Chip | 6 inline | 3 (dynamic colors) |
| SegmentControl | 7 inline | 0 |
| PullToRefresh | 5 inline | 0 |
| SwipeCard | 6 inline | 1 (dynamic bg) |
| DonutChart | 4 inline | 0 |
| BurgerMenu | 14 inline | 0 |
| ErrorBanner | 6 inline | 1 (color-mix bg) |
| AccessDenied | 5 inline | 0 |
| **ИТОГО** | **~235** | **~44** |

---

## ВАЖНЫЕ НАБЛЮДЕНИЯ

- Мобилка и десктоп загружают ОДНИ CSS файлы (app.css, theme.css) + мобильные (mobile-shell.css, huginn.css)
- `.asgard-shell` — контейнер изоляции мобилки (mobile-shell.css scope)
- Huginn использует `.huginn-*` prefix в messenger.js (хорошо), но huginn.css имеет устаревшие `.chat-*` селекторы
- Desktop `renderTeamWorkload` читает из AsgardDB (все работы). Mobile делает API call с limit=100
- Mimir сообщения сохраняются с `user_id=0` в БД — это правильно, но запрос их не возвращает из-за INNER JOIN
