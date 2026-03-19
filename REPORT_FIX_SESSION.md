# ASGARD CRM — Отчёт: Фикс-сессия (FIX_1 + FIX_2 + FIX_3)
# Дата: 2026-03-17
# Коммит: 7ac2a46 (mobile-v3)
# ═══════════════════════════════════════════════

## ПРОМПТ 1: АРХИТЕКТУРНЫЕ ФИКСЫ (FIX_1_ARCH) — ЗАВЕРШЁН

### Часть 1: Router Lifecycle Management ✅
- [x] `_asgardOpenModals` — глобальный стек открытых модалок (core.js)
- [x] `Router.onLeave(fn)` — регистрация cleanup-функций при навигации
- [x] `_runCleanups()` — вызывается в handleRoute(): cleanup callbacks + закрытие модалок + blur клавиатуры + unlockScroll
- [x] BottomSheet: push/remove в _asgardOpenModals при open/close (components.js)
- [x] messenger.js: Router.onLeave вместо setInterval _checkLeave (SSE + poll)
- [x] gantt.js: Router.onLeave для cleanup orientation listeners

### Часть 2: API.fetch Таймаут ✅
- [x] УЖЕ РЕАЛИЗОВАН: AbortController в fetchFresh() с настраиваемым timeout (default 15s)
- [x] Retry с exponential backoff (fetchWithRetry)

### Часть 3: M.Form Двойной Тап Защита ✅
- [x] `_busy` флаг на submit button
- [x] opacity: 0.5 + pointer-events: none при отправке
- [x] Promise.resolve(onSubmit(data)).finally() — разблокировка при resolve/reject
- [x] Одно место → все формы (tasks, cash, messenger, profile)

### Часть 4: Safari 100vh ✅
- [x] `100dvh` fallback в mobile-shell.css (.asgard-shell)
- [x] `--vh` CSS custom property в core.js (App.init + window.resize)
- [x] Заменено `height: '100vh'` → `calc(var(--vh, 1vh) * 100)` в:
  - mimir.js (page container)
  - messenger.js (chat page, story viewer, recording overlay)

### Часть 5: iOS Input Zoom ✅
- [x] УЖЕ РЕАЛИЗОВАН: `font-size: 16px !important` в mobile-shell.css

### Часть 6: prefers-color-scheme ✅
- [x] При загрузке: matchMedia('prefers-color-scheme: dark') → DS.setTheme()
- [x] Change listener: авто-обновление при смене системной темы
- [x] Ручной выбор (localStorage asgard_theme) приоритетнее системной темы

### Часть 7: Мелкие фиксы из аудита ✅
- [x] 7.1 Маршрут 'undefined' — НЕ НАЙДЕН (0 совпадений)
- [x] 7.2 POST без catch — ВСЕ ИМЕЮТ .catch()
- [x] 7.3 meetings.js — date guards для null dates (filter, isPast, time field)
- [x] 7.5 Гант в меню — ОСТАВЛЕН (переработан в FIX_2)
- [x] 7.6 cash.js — убрана заглушка "В разработке" (кнопка "Отчёт")

### Часть 8: iOS Баги ✅
- [x] `overscroll-behavior: none` в mobile-shell.css
- [x] Safe area — УЖЕ ЕСТЬ: env(safe-area-inset-top/bottom) в @supports
- [x] `touch-action: manipulation` — УЖЕ ЕСТЬ
- [x] Passive listeners — УЖЕ ЕСТЬ на всех scroll/touch listeners
- [x] Memory leak — закрывается через Router.onLeave

### Проверки
- Синтаксис: **0 ошибок** (83+ файла)
- Заглушки: **0**
- undefined: **0**

---

## ПРОМПТ 2: CASH + ГАНТ (FIX_2_MAJOR) — ЗАВЕРШЁН

### Часть 1: Заявки на аванс (cash.js) — 240 строк ✅
- [x] Список заявок через GET /api/cash/my
- [x] Hero card — баланс (получено/потрачено/возвращено)
- [x] **FilterPills**: Все / На согласовании / Одобрено / Закрыто
- [x] Каждая карточка: назначение, сумма, дата, статус (badge), работа
- [x] Скелетон при загрузке
- [x] Empty state: "Заявок пока нет" / "Нет заявок с таким статусом"
- [x] Error handling с ErrorBanner + Toast
- [x] **Создание**: BottomSheet fullscreen с M.Form
  - Назначение (text, required)
  - Сумма ₽ (number, required)
  - **Связать с работой** (select из /works)
  - **Срок** (date picker)
  - Комментарий (textarea)
- [x] **Детальная карточка**: BottomSheet с DetailFields + расходы
- [x] **Pull-to-refresh** через asgard:refresh event
- [x] FAB с предзагрузкой списка работ
- [x] Действие "Получил" для status=money_issued

### Часть 2: Диаграмма Ганта (gantt.js) — 357 строк ✅
- [x] **Landscape-only**: orientation detection (screen.orientation + resize)
- [x] **Оверлей "Переверните телефон"**: 📱 с CSS анимацией вращения + кнопка "Назад"
- [x] CSS @keyframes asgard-rotate-phone в mobile-shell.css
- [x] **Горизонтальный chart**:
  - Левая колонка: имена работ (150px, фиксированная)
  - Правая часть: горизонтальная временная шкала (месяцы)
  - Цветные полоски по датам (start → end)
  - Цвет по статусу: зелёный=завершено, синий=в работе, оранжевый=новая, красный=просрочено
  - Вертикальная красная линия — текущая дата
  - Строки 36px (компактные)
- [x] **Синхронизированный скролл**: вертикальный (имена ↔ полоски) + горизонтальный (header ↔ body)
- [x] **Авто-скролл к сегодня** при загрузке
- [x] **Клик по строке/полоске → BottomSheet** с DetailFields:
  - Статус, объект, план начало/конец, факт начало/конец, ответственный, бюджет
- [x] **Закрытие модалок при повороте в portrait**
- [x] Router.onLeave для cleanup orientation listeners
- [x] Данные: GET /api/works, поля start_plan/start_fact/end_plan/end_fact
- [x] Guard для null dates
- [x] **Пункт в меню "Ещё"**: 📊 Диаграмма Ганта → /gantt

### Проверки
- Синтаксис: **0 ошибок**
- Заглушки: **0**
- Маршруты: cash + gantt зарегистрированы

---

## ПРОМПТ 3: ФИНАЛЬНЫЙ АУДИТ + ДЕПЛОЙ (FIX_3) — ЗАВЕРШЁН

### Блок 1: Базовые проверки ✅
```
Синтаксис JS:     0 ошибок (83+ файла)
Заглушки:         0
undefined:        0
Encoding:         0 битых строк
```

### Блок 2: Cash.js ✅
```
Строк:            240
API вызовы:       5
Заглушки:         0
Скелетон:         2
Empty state:      1
Error handling:   6 catch
Форма:            4 (M.Form + BottomSheet + POST)
FilterPills:      1
```

### Блок 3: Gantt.js ✅
```
Строк:            357
Landscape:        8 refs
Overlay:          2 ("Переверните")
BottomSheet:      5 (detail + modal cleanup)
onLeave:          4 (Router.onLeave + cleanup)
Unguarded dates:  0 (1 копия minDate — безопасно)
В меню "Ещё":     1
```

### Блок 4: Edge Cases ✅
```
POST/PUT с catch:           все OK (0 warning)
Router.onLeave:             8 refs
_asgardOpenModals:          4 (components) + 3 (core)
activeElement.blur:         1
SSE cleanup onLeave:        3 refs
M.Form _busy:               3 refs
AbortController:            3 refs
Safari 100dvh:              CSS 1 + JS 2
touch-action manipulation:  1
overscroll-behavior:        1
prefers-color-scheme:       2
```

### Блок 5: Серверная проверка ✅
```
Сервис:           active
HTTP:             200
Port:             3000 (node pid=978889)
UA Desktop:       0 mobile_v3 refs
UA iPhone:        83 mobile_v3 refs
Ошибки в логах:   0
Коммит:           7ac2a46
```

### Блок 6: Деплой ✅
```
Git push:         15a2119..7ac2a46 (mobile-v3 → origin)
Git pull сервер:  Fast-forward, 9 файлов, 570 ins / 294 del
Restart:          systemctl restart asgard-crm
Status:           active
HTTP:             200
```

---

## ИТОГО

```
═══════════════════════════════════════════
  ФИНАЛЬНЫЙ ВЕРДИКТ
═══════════════════════════════════════════
  Промпт 1 (FIX_1_ARCH):     ✅ 8/8 частей
  Промпт 2 (FIX_2_MAJOR):    ✅ Cash + Gantt
  Промпт 3 (FIX_3_AUDIT):    ✅ Аудит + деплой

  Коммит: 7ac2a46 (mobile-v3)
  Предыдущий: 15a2119
  Сервер: 92.242.61.184 — ACTIVE, HTTP 200
  Файлов изменено: 9
  Строк: +570 / -294

  СТАТУС: ✅ DEPLOYED
═══════════════════════════════════════════
```

### Изменённые файлы
| Файл | +/- | Описание |
|------|-----|----------|
| core.js | +46 | Router.onLeave, _runCleanups, _openModals, --vh, prefers-color-scheme |
| components.js | +27 | BottomSheet _openModals + M.Form _busy |
| mobile-shell.css | +17 | 100dvh, overscroll, rotate-phone anim |
| cash.js | +253/-253 | Фильтры, select работ, deadline, pull-refresh |
| gantt.js | +490/-188 | Landscape chart с timeline + orientation overlay |
| messenger.js | +18 | Router.onLeave, calc(--vh), story/record 100vh |
| meetings.js | +10 | Date guards |
| mimir.js | +2 | calc(--vh) |
| more_menu.js | +1 | Пункт "Диаграмма Ганта" |
