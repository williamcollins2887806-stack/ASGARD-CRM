# S36 — chats-glass-tabbar-fab

## 1. Мета
Источник **828×258 px**, база **414 pt @2x**, **pt = px/2**.

- **Приложение:** Telegram iOS (русский UI), тёмная тема / OLED Night.
- **Стиль:** iOS 26 **Liquid Glass** — плавающий glass-остров табов + отдельный круглый FAB поиска.
- **Кадр:** нижний кроп экрана списка чатов (не полный viewport 414×896). Видны: одна верхняя строка чата + floating chrome + фрагменты строк под blur.
- **Файл-референс:** `REFS/S36.jpg` (828×258 px RGB JPEG).
- **Активная вкладка:** «Чаты» (3-я из 4).
- **Тексты на кадре (дословно):**
  - Табы: `Контакты` · `Звонки` · `Чаты` · `Настройки`
  - Бейджи табов: `52` (Чаты), `!` (Настройки)
  - Строка чата: заголовок `Тайпспейс Медиа`; время `09:19`; превью `В России снова обсуждают плату за…` (хвост обрезан эллипсисом)
  - Счётчики непрочитанного справа: `1` (верхний, светлый/серый круг) и `80` (нижний серый круг/пилюля)
- **Не на кадре:** status bar, header списка, home indicator (обрезаны кропом).

## 2. Иерархия слоёв
Порядок отрисовки (z от дальнего к ближнему):

1. **`.tg-screen-bg`** — сплошной `#000000` (OLED black).
2. **`.tg-chat-list`** — ряды чатов (аватар, title+mute, time, preview+thumb, unread badges). Контент уходит **под** floating chrome; сквозь glass читаются силуэты (синяя «M»-аватарка, серые счётчики, фрагменты текста).
3. **`.tg-nav-island`** — плавающая stadium-капсула Liquid Glass с 4 табами (blur + translucent fill + top rim highlight).
4. **`.tg-tab` ×4** — иконка + лейбл; у активного — selection-disc + accent tint.
5. **`.tg-tab-badge`** — красные бейджи поверх иконок (`52`, `!`).
6. **`.tg-fab-search`** — отдельный круглый FAB с лупой справа от острова (тот же glass-материал).
7. (за кадром кропа) status bar / home indicator — не сертифицировать по S36.

## 3. Геометрия
Все значения — **логические pt** (кадр @2x ⇒ pt = px/2), если не указано иное.  
Координаты px на кропе: начало (0,0) = левый верх кадра S36 (не полный экран).

### Кроп / экран
| Параметр | px | pt |
|---|---:|---:|
| Размер кадра | 828×258 | 414×129 |
| База устройства | — | **414×896** (не 390/393) |
| Левый inset острова | 42 | **21** |
| Правый inset FAB | 828−787=41 | **20.5** |
| Зазор island→FAB | 19 | **9.5** |
| Зазор под FAB/island до низа кропа | ~41 | **~20.5** (полный bottom inset экрана не виден) |

### `.tg-nav-island` (stadium / Liquid Glass pill)
| Параметр | px | pt |
|---|---:|---:|
| Outer box | x=42…641, y=90…217 | left **21**, top-in-crop **45** |
| Width | 599 | **~299.5** (~72% ширины 414) |
| Height | 127 | **~63.5** |
| Corner radius | height/2 | **~31.5–32** (полностью stadium) |
| Inner body fill | стабильный с ~x=48 / y=92 | — |
| Top rim highlight | y≈90–92 | полоса **~1–1.5 pt** |
| Внутренний V-padding (icon→label→edge) | — | icon top ~**12–13** от верха острова; labels y≈90–95 pt-from-crop-top |

### Табы (4 колонки L→R)
Центры иконок (px → pt): **63.8 · 138.3 · 199.5 · 273.3**  
Шаг центров: **~74.5 / 61.3 / 73.8 pt** (Чаты чуть сдвинут влево из‑за selection-disc/бейджа; визуально `space-evenly` ≈ **~70–75 pt** слот).

| Таб | Icon bbox (px) | Icon size (pt) | Label |
|---|---|---|---|
| Контакты | 105–150 × 115–160 | **~23×23** | `Контакты` |
| Звонки | 255–298 × 117–159 | **~22×21.5** | `Звонки` |
| Чаты (active) | 373–425 × 116–160 | **~26.5×22.5** (двойной bubble) | `Чаты` |
| Настройки | 518–575 × 113–162 | **~29×25** (с учётом зубьев шестерни) | `Настройки` |

- Gap icon → label: **~8–10 pt** (labels band y=180–190 px ⇒ **90–95 pt** от верха кропа).
- Label height band: **~5–6 pt** (y=180…190 px).

### Selection disc (active «Чаты»)
| Параметр | px | pt |
|---|---:|---:|
| Gray plate bbox (L≈57) | 332–468 × 110–174 | **~68×32.5** (овал; ширина завышена антиалиасом/бейджем) |
| Рабочий диаметр визуального круга | ~100–110 | **~50–55** за иконкой |
| Fill | `#393939` / `#383838` | поверх glass `#171717` |

### Badges на табах
| Badge | bbox px | size pt | форма |
|---|---|---|---|
| `52` на Чаты | 398–447 × 109–141 | **25×16.5** | **stadium/pill** (w>h) |
| `!` на Настройки | 557–590 × 109–140 | **17×16** | **круг Ø ~16–17** |
| Offset | top-right иконки | ~−2…−4 pt наружу | поверх icon |

### `.tg-fab-search`
| Параметр | px | pt |
|---|---:|---:|
| Outer | x=660…787, y=90…217 | — |
| Diameter | 127×127 | **Ø 63.5** (= высота island) |
| Center | ~(723.5, 153.5) | ~(361.8, 76.8) in-crop |
| Icon (лупа) white bbox | 702–743 × 133–174 | **~21×21** |
| Stroke лупы | ~2–3 px white ring | **~1–1.5 pt** |
| Gap island→FAB | 19 | **9.5** |

### Строка чата (фон, частично)
| Элемент | Оценка |
|---|---|
| Avatar | слева; squircle/rounded square ~**Ø/side 48–52 pt** (на кропе верх обрезан слабо — виден «TS» pixel-logo) |
| Title `Тайпспейс Медиа` | Semibold white; за ним mute glyph |
| Time `09:19` | right-aligned, secondary gray |
| Preview thumb | ~**14–16 pt** square перед текстом превью |
| Unread `1` | верхний правый счётчик, компактный круг/пилюля |
| Unread `80` | bbox ≈756–795×66–105 px → **Ø ~20 pt**, fill `#383838` |
| List separator | hairline под строкой; на кропе почти слит с `#000` / частично под glass |

## 4. Цвет
Замеры Pillow (усреднение / «чистые» пиксели без сильного bleed). JPEG сжимает насыщенность — системные токены iOS указаны как целевые рядом с измеренными.

| Роль | Измерено (HEX) | Целевой токен / RGBA | Где |
|---|---|---|---|
| Screen BG | `#000000` | `#000000` | весь фон |
| Glass body fill | `#171717`…`#181818` (L≈23–24) | `rgba(28,28,30,0.82)` поверх чёрного (= `#1C1C1E` × ≈0.82) | island + FAB body |
| Glass over content (низ бара) | `#1E1E1E`…`#313132` | blur+mix; не solid | где просвечивает список |
| Top rim highlight | `#515151`…`#5E5E5E` (y≈90–92) | `rgba(255,255,255,0.10–0.18)` 0.5–1 pt | верхняя кромка glass |
| Left rim | `#232323`…`#2D2D2D` | слабый specular | торцы stadium |
| Selection disc | `#393939` / `#383838` | `rgba(255,255,255,0.12–0.18)` или solid `#393939` | под иконкой Чаты |
| Active blue (icon) | purest `#4789F7`; avg top `#4A87F4` | **`#007AFF`** / dark `#0A84FF` (JPEG↑) | иконка Чаты |
| Active blue (label) | смесь `#445881`… (anti-alias) | тот же accent | текст `Чаты` |
| Inactive icons | `#FFFFFF` / `#FEFEFE` | `#FFFFFF` | Контакты / Звонки / Настройки / лупа |
| Inactive labels | avg `#EAEBEC` | `#FFFFFF` @ ~0.92–1.0 (на glass чуть серее) | Контакты, Звонки, Настройки |
| Badge red | purest `#D94F42` / `#D65746`; avg `#D06254` | **`#FF3B30`** / `#FF453A` | `52`, `!` |
| Badge text | `#FFFFFF` | `#FFFFFF` | цифры / `!` |
| Chat title | `#F7F7F7`…`#FFFFFF` | `#FFFFFF` | `Тайпспейс Медиа` |
| Time / mute / preview | `#8E8E8E`…`#8E8E93` range; mute `#8E8E8E` | `#8E8E93` | `09:19`, mute, preview |
| Unread badge fill | `#383838` | `#333333` / `#3A3A3C` | `80` |
| Unread `1` | светло-серый/белый круг на чёрном | secondary surface | верхний счётчик |
| Avatar «TS» | чёрный фон + белые пиксели лого | — | канал Typespace |

**Прозрачность glass:** при допущении surface `#1C1C1E` (28) над `#000` и измеренном `#171717` (23) → **α ≈ 0.82**. Визуально blur сильнее у краёв и там, где под баром цветной контент (синяя M).

## 5. Типографика
Семейство: **SF Pro Text / SF Pro Display** (`-apple-system`).

| Элемент | Size | Weight | Color | Notes |
|---|---|---|---|---|
| Tab label inactive | **10–11 pt** | Medium | `#FFFFFF` / near-white | `Контакты`, `Звонки`, `Настройки` |
| Tab label active | **10–11 pt** | Medium | `#007AFF` | `Чаты` |
| Badge `52` | **11–12 pt** | Bold / Semibold | `#FFFFFF` | плотный кернинг |
| Badge `!` | **11–13 pt** | Bold | `#FFFFFF` | центр круга |
| Chat title `Тайпспейс Медиа` | **16–17 pt** | Semibold | `#FFFFFF` | 1 line |
| Time `09:19` | **13–14 pt** | Regular | `#8E8E93` | top-right row |
| Preview | **15 pt** | Regular | `#8E8E93` | ellipsis |
| Unread `80` / `1` | **12–13 pt** | Semibold | light on gray / dark on light | |

## 6. Иконки/контролы

### Таб-бар (L→R)
1. **Контакты (inactive):** person silhouette в круге; stroke/fill **белый** `#FFFFFF`; ~23 pt.
2. **Звонки (inactive):** telephone handset (наклонён); **белый** outline/fill; ~22 pt.
3. **Чаты (active):** два overlapping speech bubbles; **accent blue** `#007AFF` (измерено ~`#4789F7`); + selection disc; + red pill badge **`52`**.
4. **Настройки (inactive):** gear; **белый**; + red circle badge **`!`**.

### FAB поиска
- SF Symbol `magnifyingglass`, ~**21 pt**, `#FFFFFF`, handle ↘ 45°.
- Отдельный контрол, **не** внутри island; диаметр = высота island (**63.5 pt**).

### Chat-row chrome (фон)
- Mute: speaker + slash, `#8E8E93`, сразу после title.
- Link/media thumb ~16 pt перед preview.
- Unread counters справа (не на FAB): `1`, `80`.

## 7. Тени / бордеры / разделители
- **Nav island / FAB:**
  - `backdrop-filter: blur(20–28px)` + `saturate(140–180%)` (оценка по «размазанности» текста под баром).
  - Fill: `rgba(28,28,30,0.80–0.86)`.
  - Border/rim: **0.5 pt** `rgba(255,255,255,0.10–0.16)` сильнее сверху (`#515151`–`#5E5E5E` на 1px-кромке).
  - Shadow: мягкая, диффузная `0 4px 18px rgba(0,0,0,0.45–0.60)` — «приподнимает» pill над списком; жёсткого каста нет.
- **Selection disc:** без обводки; solid/полупрозрачный круг `#393939`.
- **Badges:** без stroke; читаемость за счёт красного на тёмном/синем.
- **List separators:** hairline ~0.5 pt `#2C2C2E`/`#38383A` (на кропе слабо видны под blur).
- **FAB:** тот же материал, что island; ring/highlight верхняя дуга слабее (`#202020`).

## 8. Состояния на кадре
- **Active tab:** «Чаты» — blue icon + blue label + gray selection disc + badge `52`.
- **Inactive tabs:** Контакты / Звонки / Настройки — белые иконки и лейблы; у Настроек badge `!`.
- **FAB:** idle (не pressed); лупа белая на glass.
- **Chat row:** канал «Тайпспейс Медиа» muted; time `09:19`; unread `1` + `80`.
- **Scroll:** низ списка под floating chrome (просвечивает аватар «M» и хвосты превью).
- **Theme:** OLED `#000000`; glass ≈ `#1C1C1E` @ 0.82.
- **Keyboard / menus:** нет.
- **Pressed / drag:** не зафиксированы.

## 9. CSS-скелет
```css
/* База: 414pt logical; значения в px ниже = pt при layout 1x CSS */
.tg-screen {
  position: relative;
  width: 414px;
  height: 896px;
  background: #000000;
  color: #ffffff;
  font-family: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
  overflow: hidden;
}

.tg-chat-list {
  padding-bottom: 120px; /* clearance под island+FAB */
}

.tg-chat-row {
  display: flex;
  align-items: center;
  min-height: 72px;
  padding: 8px 16px;
  gap: 12px;
}

.tg-chat-row__title {
  font-size: 17px;
  font-weight: 600;
  color: #ffffff;
}

.tg-chat-row__time,
.tg-chat-row__preview,
.tg-chat-row__mute {
  color: #8e8e93;
}

.tg-chat-row__unread {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: #383838;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  display: grid;
  place-items: center;
}

.tg-nav-dock {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 20px; /* + home indicator clearance на полном экране */
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 21px 0 21px;
  gap: 9.5px;
  pointer-events: none;
}

.tg-nav-dock > * {
  pointer-events: auto;
}

.tg-nav-island {
  width: 299.5px;
  height: 63.5px;
  border-radius: 31.75px;
  background: rgba(28, 28, 30, 0.82);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  box-shadow:
    0 4px 18px rgba(0, 0, 0, 0.5),
    inset 0 0.5px 0 rgba(255, 255, 255, 0.14);
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  padding: 6px 10px 8px;
}

.tg-tab {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  color: #ffffff;
  background: transparent;
  border: 0;
}

.tg-tab__icon {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  z-index: 1;
}

.tg-tab__label {
  font-size: 10px;
  font-weight: 500;
  line-height: 1.1;
  z-index: 1;
}

.tg-tab.is-active {
  color: #007aff;
}

.tg-tab.is-active .tg-tab__disc {
  position: absolute;
  top: 2px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14); /* ≈ #393939 over glass */
  z-index: 0;
}

.tg-tab-badge {
  position: absolute;
  top: -2px;
  right: 10px;
  z-index: 2;
  min-width: 16px;
  height: 16.5px;
  padding: 0 5px;
  border-radius: 999px;
  background: #ff3b30;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  display: grid;
  place-items: center;
  box-shadow: none;
}

.tg-tab-badge--dot {
  width: 16px;
  min-width: 16px;
  padding: 0;
  border-radius: 50%;
}

.tg-fab-search {
  width: 63.5px;
  height: 63.5px;
  border-radius: 50%;
  background: rgba(28, 28, 30, 0.82);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.48),
    inset 0 0.5px 0 rgba(255, 255, 255, 0.12);
  display: grid;
  place-items: center;
  color: #ffffff;
  border: 0;
}

.tg-fab-search__icon {
  width: 21px;
  height: 21px;
}
```

## 10. Неуверенности
1. **Полный bottom inset** (island ↔ home indicator) — кроп обрезает низ экрана; измерен только зазор до низа кадра (~20.5 pt), не системный safe-area.
2. **α glass** оценена моделью «#1C1C1E × α над #000 → #171717» (α≈0.82); реальный iOS material может быть vibrancy + variable blur, не константная заливка.
3. **Active blue:** измеренные `#4789F7` / `#4A87F4` ярче канона `#007AFF` из‑за JPEG/subpixel; в коде брать системный token.
4. **Badge red** similarly desaturated (`#D94F42` vs `#FF3B30`).
5. **Selection disc** ширина по gray-mask (~68 pt) завышена anti-alias/бейджем; визуальный круг ближе к **Ø 50–55 pt**.
6. **Шаг табов** не идеально равный (61 vs 74 pt) — влияние badge/disc на bbox; layout всё же `space-evenly`.
7. **Unread `1`:** форма (белый vs серый круг) и точный fill частично сливаются с time-пикселями; `80` замерен увереннее (`#383838`, Ø≈20 pt).
8. **Blur radius** (20–28 px) — оценка по читаемости текста под баром, не EXIF/метаданные.
9. Тени island/FAB — мягкие; точные CSS `box-shadow` параметры — реконструкция, не dump из runtime.
10. Иконки — SF Symbols / Telegram custom; path-данные не извлекались, только bbox и цвет.
