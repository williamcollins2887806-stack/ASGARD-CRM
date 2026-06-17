# 🏠 Home — Зал Ярла

> **Это ЭТАЛОН страницы для агентов.** Все остальные страницы должны быть переписаны по этому образцу.

## Что делает

Главная страница CRM 2.0. Виджеты по ролям, кастомизация (добавить/убрать), сброс к дефолту.

## Замещает

`public/assets/js/custom_dashboard.js` (1 555 строк vanilla) → 220 строк React.

## URL

`#/home` — тот же hash что в vanilla.

## RBAC

Доступно всем ролям. `DEFAULT_LAYOUTS` определяет какие виджеты по умолчанию у какой роли.

## Зависимости (компоненты)

| Откуда | Что используется |
|---|---|
| `@/api/useAuth` | `useAuth()` для получения user.id, user.role, user.name |
| `@/modals` | `useModal`, `PickerModal`, `ConfirmModal` |
| `@/modals/Notifications` | `toast.info`, `toast.success` |
| `@/modals/parts` | `Btn` |
| `@/widgets/*` | 11 готовых виджетов (Welcome, Notifications, MyWorks, ...) |

## API запросы (через widgets)

Виджеты сами идут в API через `@/api/client`:
- `/api/notifications` — Notifications widget
- `/api/works?pm_id=...` — MyWorks
- `/api/tenders` — Funnel + Money
- `/api/birthdays` — Birthdays
- `/api/tasks/todo` — Todo
- `/api/data/bonus_requests?status=pending` — Approvals

## Сохранение настроек

Сейчас `localStorage.asgard_v2_home_layout_<userId>`.

**TODO:** перенести в БД через `/api/data/settings` ключ `dash_layout_<userId>` (как в vanilla).

## Структура файла

```
src/pages/Home/
  index.jsx     ← главный компонент (default export)
  README.md     ← этот файл
```

## Что показывает агентам

1. **Структура страницы:** Header (TopActionsBar или кастомный) + контент
2. **Использование готовых модалок:** PickerModal multi, ConfirmModal с tone
3. **Toast API:** `toast.success` / `toast.info` — НЕ `AsgardUI.toast`
4. **Auth:** через `useAuth()` хук
5. **Локальное состояние:** через `useState` + `useEffect` для load/save
6. **Структура папки страницы:** `index.jsx` + `README.md` (минимум)
7. **NO inline стилей цветов** — всё через `var(--*)` в CSS-файлах
8. **NO `window.confirm/prompt/alert`** — только React-модалки

## Drag & drop виджетов

Реализовано через нативный HTML5 D&D (паттерн из `Funnel/index.jsx`):
- Каждый виджет имеет ручку «≡» в шапке (`<span class="widget-grip" draggable />`).
- `onDragStart` запоминает id в `draggedIdRef`; `onDragOver` подсвечивает целевой
  виджет (`widget--drop-target`); `onDrop` переставляет id в массиве `layout`
  через `splice(fromIdx,1)` + `splice(toIdx,0,id)` и сразу пишет в `localStorage`
  (тот же ключ `asgard_v2_home_layout_<userId>`).
- Нет внешних зависимостей (react-dnd / dnd-kit).

## Чего НЕТ в эталоне (но может потребоваться)

- **Сохранение в БД** — пока только localStorage (`asgard_v2_home_layout_<userId>`).
  Когда понадобится синхронизация между устройствами — переехать на
  POST `/api/data/settings` ключ `dash_layout_<userId>` (как в vanilla).
- **A/B layouts** — на будущее.

## Тесты

Пока без тестов — структура простая, виджеты тестируются отдельно через каталог.

После переписи всех страниц добавим E2E через Playwright.
