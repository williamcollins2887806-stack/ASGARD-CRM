# 🎨 АСГАРД CRM 2.0 — Дизайн-система

> **Это документ для разработчиков (включая ИИ-агентов), пишущих новые страницы.**
> Прочитай ВСЁ перед началом работы. Не нарушай правила — иначе UI будет «зоопарком».

---

## 🛑 Жёсткие правила (НЕ нарушать)

1. **НЕ создавай новые компоненты** — используй только из `@/modals`, `@/inputs`, `@/blocks`, `@/widgets`
2. **НЕ пиши inline-стили цвета** — только CSS-переменные (`var(--gold)`, `var(--t-1)` и т.д.)
3. **НЕ используй** `color: white`, `color: black`, `#fff`, `#000` — это сломает темы
4. **НЕ ломай hash-маршруты** — все `#/route` остаются как в vanilla
5. **НЕ используй** `window.confirm`, `window.prompt`, `window.alert` — только `ConfirmModal/PromptModal/AlertModal`
6. **НЕ используй** `console.log` для пользователей — `toast.info/error/...`
7. **НЕ пиши новые CSS-классы** для базовых вещей (кнопки, инпуты, карточки) — есть готовые
8. **ВСЕГДА проверяй в обеих темах** перед PR (☀️ + 🌙)
9. **ВСЕГДА используй** semantic HTML (`<button>` для действий, `<a>` для навигации)

---

## 📐 Структура страницы (обязательный паттерн)

Каждая страница должна выглядеть так:

```jsx
// src/pages/Tenders/Tenders.jsx
import { TopActionsBar, FilterBar, TabsBar, ListItemRow, EmptyState } from '@/blocks/Blocks';
import { FormModal, ConfirmModal } from '@/modals';
import { useModal } from '@/modals';
import { useAuth } from '@/api/useAuth';

export default function TendersPage() {
  const { user } = useAuth();
  const { open } = useModal();
  // ... hooks

  return (
    <div className="page-tenders">
      <TopActionsBar />              {/* Заголовок + кнопки действий */}
      <FilterBar />                  {/* Поиск + фильтры (если нужны) */}
      <TabsBar />                    {/* Табы (если нужны) */}
      <div className="page-content">
        {/* основной контент: ListItemRow / cards / table */}
      </div>
    </div>
  );
}
```

### Не делай так

❌ Сразу `<div>` с контентом без хедера
❌ Свой кастомный заголовок страницы
❌ Inline-кнопки в стиле «свободного полёта»
❌ Большие `<form>` прямо на странице — создание в модалке через `FormModal`

---

## 🎨 Цвета

Используй **только CSS-переменные** из `theme.css`. Они адаптируются к темам автоматом.

### Бренд (логика, не палитра)

| Переменная | Когда |
|---|---|
| `var(--gold)` / `var(--gold-l)` | Главный акцент, успех, активный элемент |
| `var(--red)` / `var(--red-l)` | Бренд второй, опасно, удаление |
| `var(--blue)` / `var(--blue-l)` | Информация, ссылки |

### Семантика

| Переменная | Когда |
|---|---|
| `var(--ok)` | Успех (выиграли, оплачено, согласовано) |
| `var(--err)` | Ошибка (проиграли, отклонено) |
| `var(--info)` | Нейтральное (новый, ожидание) |
| `var(--purple)` | Спец (AI, mimir) |
| `var(--amber)` | Предупреждение, доработка |
| `var(--orange)` | Расходы |
| `var(--cyan)` | Логистика, складское |

### Текст и фон

| Переменная | Когда |
|---|---|
| `var(--t-1)` | Основной текст |
| `var(--t-2)` | Вторичный |
| `var(--t-3)` | Приглушённый (хелперы, метки) |
| `var(--t-4)` | Едва заметный (placeholder) |
| `var(--bg-0)` | Фон страницы |
| `var(--card-bg)` | Фон карточки (НЕ `var(--bg-2)` напрямую!) |
| `var(--inner-bg)` | Фон вложенного блока (row-item, pill) |
| `var(--bar-bg)` | Фон полосы (progress) |
| `var(--hover-bg)` | Фон при hover |

### Запрещено

❌ `background: #1B2336` — это сломает светлую тему
✅ `background: var(--card-bg)` — работает в обеих

---

## 📏 Размеры и отступы

### Радиусы

| Переменная | Где |
|---|---|
| `var(--r-xs)` 6px | Чипы, мини-бейджи |
| `var(--r-sm)` 8px | Малые кнопки, input |
| `var(--r-md)` 12px | Карточки, основные кнопки |
| `var(--r-lg)` 16px | Большие карточки, модалки |
| `var(--r-xl)` 22px | Hero-блоки |
| `var(--r-pill)` 9999px | Pills, бейджи |

### Тени

| Переменная | Где |
|---|---|
| `var(--sh-sm)` | Лёгкая (input при focus) |
| `var(--sh-md)` | Карточки при hover |
| `var(--sh-lg)` | Модалки, drawer |
| `var(--sh-card)` | По умолчанию для карточек |

### Spacing (используй в style или Tailwind-like)

| Тонкая | 4px |
| --- | --- |
| Малая | 8px |
| Средняя | 14px |
| Большая | 22px |
| Большая+ | 28px |

---

## ✍ Типографика

### Размеры

| Размер | Где |
|---|---|
| 11px | Метки UPPERCASE с letter-spacing 0.18em |
| 12-13px | Хелперы, subtitle |
| 14px | Основной текст, body |
| 16px | Заголовок модалки h2 |
| 18-22px | Заголовок страницы h2 |
| 28-36px | Hero-цифры, KPI |
| 48-64px | Календарь день, баланс кассы |

### Веса

| Вес | Когда |
|---|---|
| 400-500 | Обычный текст |
| 600 | Лейблы, бренд-имена |
| 700 | Заголовки, акцент |
| 800 | KPI цифры, важные заголовки |
| 900 | Огромные числа, hero |

### Бренд-текст (градиент)

```jsx
<h1 style={{ background: 'var(--brand-text)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
  Заголовок
</h1>
```

---

## 🧩 Компоненты — что когда

### Модалки

| Сценарий | Компонент |
|---|---|
| «Удалить?» | `ConfirmModal` tone="danger" |
| «Подтвердить?» | `ConfirmModal` tone="warn"/"success" |
| Ввод одного значения | `PromptModal` |
| Длинный комментарий | `PromptModal` multiline |
| Создание сущности | `FormModal` (поля массивом) |
| Сложный многошаговый | `WizardModal` |
| Карточка с табами | `DetailsModal` |
| Согласование 4 действия | `ApprovalModal` |
| Выбор из списка людей | `PickerModal` |
| Выбор Quick/Conductor | `MethodPicker` |
| Меню действий | `ActionMenu` |
| Корзина / sidebar | `DrawerModal` shape="drawer-right" |
| Успех/ошибка с одной кнопкой | `AlertModal` tone="..." |
| Загрузка | `LoaderModal` |
| Смена статуса с причиной | `StatusChangeModal` |
| Превью файла | `FilePreviewModal` |
| Удалить N выбранных | `MassActionConfirm` |
| Финансы (BUH) | `BuhPayBank/IssueCash/...` |

### Инпуты

| Поле | Компонент |
|---|---|
| Любой текст | `TextInput` |
| Пароль | `PasswordInput` |
| Число (с +/-) | `NumberInput` или `Stepper` |
| Деньги | `MoneyInput` |
| ИНН | `INNInput` |
| Телефон | `PhoneInput` |
| Поиск | `SearchInput` |
| Многострочный | `TextareaInput` |
| Выбор из ≤8 опций | `Segmented` или `RadioGroup` |
| Выбор из >8 | `Combobox` (через portal) |
| Несколько значений | `MultiSelect` (chips через portal) |
| Селект простой | `SelectInput` |
| Дата | `DatePicker` |
| Период | `DateRangePicker` |
| Время | `TimePicker` |
| Файл | `FileDrop` |
| Vкл/выкл | `Switch` |
| Список галок | `Checkbox` |
| Звёзды оценка | `Rating` |
| Цвет | `ColorPicker` |
| Громкость, маржа | `Slider` |

### Блоки

| Где | Компонент |
|---|---|
| Заголовок страницы | `TopActionsBar` |
| Поиск+фильтры+чипы | `FilterBar` |
| Табы | `TabsBar` |
| Список с иконкой+статусом | `ListItemRow` |
| Сетка KPI | `StatCardRow` |
| Баннер «внимание» | `AlertStrip` |
| Пустое состояние | `EmptyState` |
| Распределение (HEAD_TO) | `DistPanel` |
| Win-panel выигранные | `WinPanel` |

### Уведомления

| Где | API |
|---|---|
| Успех/ошибка/инфо | `toast.success('...')` / `toast.error()` |
| Async операция | `toast.promise(p, { loading, success, error })` |
| Релиз-баннер | `AnnouncementBanner` |
| Колокольчик | `NotificationBell` |
| Подсказка hover | `<Tooltip content="...">` |
| Шаги процесса | `<ProgressSteps steps={[...]} active={2} />` |
| Раскрывашка | `<Accordion items={[...]} />` |
| Цветной бейдж | `<StatusBadge tone="approved" label="..." />` |
| Голос | `<VoicePlayer duration={23} />` |
| Кол-во | `<Stepper value={n} onChange={...} />` |
| Sparkline | `<MiniChart data={[...]} tone="ok" />` |

---

## 🌗 Темы

Не надо думать про темы вручную — всё работает через `var(--*)`.

### Проверь после написания страницы

1. Открой `https://asgard-crm.ru/v2/#/your-page` в тёмной теме
2. Переключи на ☀️ Светлую (кнопка в шапке)
3. Все элементы должны быть видны
4. Никакого «белое на белом» / «чёрное на чёрном»
5. Hover-эффекты остались
6. Цвета акцентов остались узнаваемы

### Если что-то ломается

- Используется `color: white` хардкодом — заменить на `var(--t-1)`
- Используется `background: #1B2336` — заменить на `var(--card-bg)` / `var(--inner-bg)`
- Используется тень с `rgba(0,0,0,...)` — заменить на `var(--sh-*)`

---

## 🔌 API и данные

### Получение данных

```jsx
import { api } from '@/api/client';

// GET
const data = await api('/api/tenders?limit=100');

// POST
const created = await api('/api/tenders', {
  method: 'POST',
  body: { customer: '...', tender_title: '...' }
});

// Promise-toast обёртка
await toast.promise(
  api('/api/tenders/' + id, { method: 'PUT', body: data }),
  { loading: 'Сохраняем…', success: 'Сохранено', error: 'Не удалось сохранить' }
);
```

### Auth

```jsx
import { useAuth } from '@/api/useAuth';

const { user, token, logout } = useAuth();
// user.role — для проверок RBAC
```

### Темы

```jsx
import { useTheme } from '@/theme/ThemeProvider';

const { theme, toggle } = useTheme();
// theme === 'dark' | 'light'
```

---

## 🏗 Структура файлов

Каждая страница — отдельная папка:

```
src/pages/Tenders/
  index.jsx          — главный компонент (export default)
  TendersList.jsx    — подкомпоненты по логике
  TendersDetail.jsx
  hooks.js           — useTenders, useTenderActions
  TenderForm.jsx     — модалка создания/редактирования
  README.md          — что делает страница, какие props
```

В роутере (`App.jsx`):

```jsx
import Tenders from '@/pages/Tenders';
// ...
<Route path="/tenders" element={<Protected title="Тендеры"><Tenders /></Protected>} />
```

---

## ✅ Чеклист перед PR

- [ ] Нет inline-стилей цвета
- [ ] Нет `color: white/black/#fff/#000`
- [ ] Нет `window.confirm/prompt/alert`
- [ ] Все модалки через `useModal().open(<Modal/>)`
- [ ] Все toast через `import { toast } from '@/modals/Notifications'`
- [ ] Hash-маршрут сохранён (`#/tenders`, не `#/tenders-v2`)
- [ ] Структура: TopActionsBar + (FilterBar) + (TabsBar) + контент
- [ ] Проверено в тёмной + светлой темах
- [ ] Mobile-адаптивность (нет горизонтального скролла на 1100px)
- [ ] Нет `console.log`
- [ ] `npm run build` без warning'ов
- [ ] README.md в папке страницы
- [ ] Все скроллы там, где они нужны (длинные списки, табы), и нет где не нужны

---

## 📚 Где смотреть примеры

- **Каталог компонентов:** `/v2/#/modals` — там 85 живых примеров с кодом в `src/pages/Modals.jsx`
- **Эталон страницы:** `src/pages/Home/index.jsx` (в работе)
- **Простая страница:** `src/pages/ToCalcs/...` (готово, можно смотреть как пример)

---

## ⚠ Что НЕ трогать

- **Mobile React `/m/`** — отдельное приложение, не наша работа сейчас
- **Field PWA `/field/*`** — отдельный модуль, миграция позже
- **Backend `src/routes/`** — API остаётся как есть
- **Миграции БД** — не нужны (только фронт)
- **Старая vanilla CRM в `/legacy/`** — fallback на 3-6 недель, не трогать

---

## 🆘 Если что-то не очевидно

Спроси у автора (Claude). Не выдумывай новые компоненты или паттерны.
