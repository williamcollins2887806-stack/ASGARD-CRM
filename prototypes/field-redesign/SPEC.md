# ASGARD FIELD — дизайн-спека редизайна (2026)

Источник: `tests/reports/DESIGN-2026-DIRECTION.md` (93 источника, контрасты посчитаны
`tools/design_tokens_contrast.py`). Прототип: `prototypes/field-redesign/`
(рендеры `_shots/after/`, до — `_shots/before/`).

## Принципы (в порядке важности)

1. **Иерархия — светлотой, не тенью.** Слои `bg-0..bg-4`; подъём = светлее.
   Тень только у по-настоящему плавающих слоёв (шит, popover).
2. **Один акцент на экран.** Синий — primary/навигация. Красный — только
   destructive/ошибка. Золото — VIP, 1–2 места во всём приложении.
3. **Типографика — 8 ролей.** Никаких `text-[Npx]`; пол 12px; иерархия весом и цветом.
4. **Один край.** Hairline вшит в тень — не дублировать `border` + `box-shadow`.
5. **Стекло — только навигация и шит**, blur 10–14px, `-webkit-` префикс, фолбэк.
   Никогда внутри скроллящегося списка, никогда не анимировать `backdrop-filter`.
6. **Ноль инлайн-стилей.** Только токены + классы + общие компоненты.

## Палитра

### Dark (`:root`)
| роль | значение | примечание |
|---|---|---|
| bg-0 | `#0C0F13` | скрим, глубина |
| bg-1 | `#0F1217` | фон приложения (светлее прежнего `#0a0a0c`) |
| bg-2 | `#141922` | карточки |
| bg-3 | `#1A2029` | nested, input, hover |
| bg-4 | `#232B36` | тулбар, popover |
| fg-1..4 | `#E8EDF4` `#A3AEBF` `#7C889B` `#5A6577` | fg-3 = 5.23:1 |
| line / line-strong | `rgba(255,255,255,.10)` / `.18` | |
| blue-500 / 400 | `#2E64A8` / `#5590E0` | заливка / текст (5.41:1) |
| red-500 / 400 | `#BE2135` / `#E8697C` | заливка / текст (5.66:1) |
| gold-500 / 400 | `#D4A843` / `#E3BC63` | VIP (текст на золоте `#0B1220`, 8.45:1) |

### Light (`[data-theme=light]`)
| роль | значение | примечание |
|---|---|---|
| bg-0..4 | `#EDEFF3` `#F4F5F7` `#FFFFFF` `#F0F1F4` `#E7EAEF` | холодный, не пергамент |
| fg-1..4 | `#111827` `#4B5563` `#616C7E` `#8A93A3` | fg-3 = 4.87:1 |
| line / line-strong | `#E1E5EB` / `#C8CFDA` | |
| blue-500 / 400 | `#1E4D8C` / `#1C4E90` | заливка (8.42:1) / текст (8.26:1) |
| red | `#BE2135` | 6.07:1 |
| gold-500 / 400 | `#D4A843` / `#7F6119` | **золото текстом на белом = 2.21:1 → запрещено**; только `#7F6119` |

Проверенные контрасты: см. §4 DESIGN-2026-DIRECTION. Обе темы проходят AA на body.

## Типографика

| роль | size | weight | lh | ls | где |
|---|--:|--:|--:|--:|---|
| display | 32 | 700 | 1.15 | −0.02em | главная метрика (1 на экран) |
| title | 22 | 600 | 1.25 | −0.015em | заголовок страницы/шита |
| headline | 17 | 600 | 1.3 | −0.01em | имя карточки, заголовок секции |
| body | 15 | 400/500 | 1.5 | 0 | текст, значения |
| label | 13 | 500 | 1.35 | 0 | лейблы полей |
| caption | 12 | 500 | 1.35 | +0.005em | метаданные — **пол** |

Шрифт: `Inter` (variable) / системный стек; Cinzel из UI убирается.

## Радиусы / тени / движение

- Радиусы: chip 8, control 10, card 14, sheet 20 (top), full 999. Вложенный = внешний − padding.
- Тени `--e1..--e4`: 2–3 слоя размытия + hairline первым слоем.
- Движение: `--t-1` 120ms (press), `--t-2` 200ms (chip/toggle), `--t-3` 280ms (enter sheet),
  `--t-3x` 210ms (exit = 75%). Кривые `--e-out` (входы), `--e-in` (выходы), `--e-in-out` (перемещение).
  Анимировать только `transform`/`opacity`.

## Стекло

```css
.topbar / .tabbar {
  background: color-mix(in oklab, var(--bg-2) 86%, transparent);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
          backdrop-filter: blur(14px) saturate(160%);
  border-bottom/ top: 1px solid var(--line);
}
.sheet { backdrop-filter: blur(10px) saturate(150%); }  /* плотнее, меньше блюра */
@media (prefers-reduced-transparency: reduce) { .topbar,.tabbar,.sheet { backdrop-filter:none; background: var(--bg-2); } }
```

## Общие компоненты (обязательны к переиспользованию)

| компонент | назначение | где применяется |
|---|---|---|
| `Sheet` | ЕДИНСТВЕННАЯ шторка (обёртка над `BottomSheet`) | все модалки/шиты field |
| `AppBar` | топбар с optional back/right | все экраны |
| `Card` | поверхность контента (flat / nested) | все экраны |
| `Hero` | главная метрика (display) | хаб, деньги, табель |
| `StatTile` | KPI-плитка | хаб, деньги, табель |
| `ListRow` | строка списка | все списки |
| `Button` | primary/danger/gold/ghost, sizes | все |
| `Chip` / `Segmented` | фильтры, табы внутри страницы | деньги, табель, рейтинг |
| `Field` | лейбл + инпут + хинт | все формы |
| `Badge` | статус: точка + текст | все |
| `Banner` | info/ok/warn/err блок | нотки, допуски, ошибки |
| `EmptyState` | пустое состояние | все списки |
| `Skeleton` | загрузка | все списки |
| `ProgressBar` | прогресс | табель, ранг |
| `PushCard` | превью пуша | только прототип/витрина |

## Safe-area (чёлка / Dynamic Island / нижний индикатор)

- `viewport-fit=cover` уже есть; `--safe-top/-bottom` из `env()`.
- Обязательно: топбар — `padding-top: calc(8px + var(--safe-top))`; таббар/нижние бары —
  `padding-bottom: var(--safe-bottom)`.
- Запрещены жёсткие `32px` в нижних барах (сейчас в `FieldLesson.jsx:326`,
  `FieldAcademyQuiz.jsx:385`, `OfficeLesson.jsx:439`).

## Anti-patterns (запрещено)

1. Эмодзи как иконки (📦 🚛 🧙) → stroke-иконки 24px.
2. Градиент как заливка по умолчанию (сейчас 363 в mobile).
3. Золото везде / `gold-glow` / `--accent-secondary: gold`.
4. Один радиус и одна тень на всё.
5. `text-[Npx]`, микротип < 12px.
6. `border` + `box-shadow` на одной поверхности.
7. Стекло на карточках списка и внутри скролла.
8. Анимация `backdrop-filter` / `box-shadow`.
9. Пурпур/циан в дефолтных акцентах.
10. `alert()` / `confirm()` вместо системного диалога.

## Приёмка

- Контраст-гейт `tools/design_tokens_contrast.py` (body ≥ 4.5, non-text ≥ 3.0, exit 1).
- `tools/field-surface-audit.js --check`: 0 новых инлайн-стилей/hex/ad-hoc-оверлеев/`alert`.
- Матрица покрытия `SURFACES.md` закрыта 100%.
- Рантайм-обход на стенде `:3100` (`FIELD-REDESIGN-E2E.md`), 0 JS-ошибок, 5 устройств × 2 темы.
