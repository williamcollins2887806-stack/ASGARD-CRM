# S13 — add-contacts-dark

## 1. Мета
- **Приложение:** Telegram iOS (русский UI).
- **Экран:** модальный «Добавить» — выбор контактов для добавления в группу/канал (Add Members / contact multi-select).
- **Тема:** Dark / Night OLED (pure black).
- **Ориентация:** портрет.
- **Файл-референс:** `REFS/S13.jpg`, физический размер **828 × 1792 px** (≈ **414 × 896 pt** @2x).
- **StatusBar:** время `09:54` слева; по центру синяя капсула Telegram (paper-plane + «TELEGRAM»); справа LTE + батарея **51%** (жёлтый fill ≈ `#FFD60A` / low-battery tint).
- **Safe Area:** верх ≈ 44–48 pt (status + Dynamic Island); низ — без TabBar/FAB (модалка поверх), home-indicator зона пустая/`#000`.
- **Язык:** русский chrome (`Добавить`, `Поиск контактов...`, статусы `был(а) …`); имена контактов смешанные (латиница/кириллица/emoji).

## 2. Иерархия слоёв
Сверху вниз (z от дальнего к ближнему):

1. **`.tg-screen-bg`** — сплошной `#000000` на всю высоту.
2. **`.tg-contact-list`** — скролл: section headers (буквы) + rows (checkbox + avatar + text).
3. **`.tg-search-bar`** — поле «Поиск контактов...» под nav (в потоке / sticky под chrome).
4. **`.tg-nav-bar`** — круглая Close (X) слева, title «Добавить» по центру, круглая Done (✓) справа.
5. **`.tg-index-bar`** — фиксированный вертикальный алфавитный указатель у правого края (поверх списка).
6. **`.tg-status-bar`** — системный слой + Telegram return-pill.

Порядок отрисовки: Background → List → Search/Nav chrome → Index rail → StatusBar.

## 3. Геометрия
Все значения — **логические pt** (кадр @2x ⇒ pt = px/2), если не указано иное. В скобках — измерение в px кадра.

### Экран / chrome
| Элемент | Значение |
|---|---|
| Ширина экрана | 414 pt (828 px) |
| Высота экрана | 896 pt (1792 px) |
| StatusBar + Island inset | ~44–48 pt до нижней кромки status |
| NavBar контентная высота | ~44–48 pt |
| Nav круглая кнопка | Ø **30–32 pt** (≈60–64 px), `border-radius: 50%` |
| Nav button left inset | **16 pt** до центра/края круга |
| Nav button right inset | **16 pt** |
| Gap title ↔ buttons | title абсолютный center экрана |
| Search внешние inset L/R | **16 pt** (≈32–40 px до fill с учётом AA) |
| Search высота | **36 pt** (fill ≈ 28–32 pt + AA; design-intent 36) |
| Search `border-radius` | **10 pt** |
| Search вертикальный margin | top ~6–8 pt под nav, bottom ~8–12 pt до первой section |
| Index rail ширина | **14–20 pt** (буквы ≈11 pt + padding) |
| Index right inset | **2–4 pt** от края экрана |
| Index letter step | **≈15 pt** (≈30 px между центрами глифов) |
| Index вертикальный span | ≈ от y≈235 pt до ≈798 pt (буквы от A… до кириллицы) |

### Section header
| Параметр | Значение |
|---|---|
| Высота | **28–32 pt** |
| Letter left inset | **16 pt** |
| Letter baseline | вертикально по центру header-зоны |
| Gap header → first row | 0 (header сидит над первым контактом секции) |

### Contact row
| Параметр | Значение |
|---|---|
| Высота ряда | **52–56 pt** (между центрами checkbox ≈ **53 pt** / 106 px) |
| Checkbox Ø | **22 pt** (≈44–45 px), `border-radius: 50%` |
| Checkbox `border-width` | **1.5–2 pt** (stroke-only, fill transparent) |
| Checkbox left inset | **16 pt** |
| Gap checkbox → avatar | **12 pt** |
| Avatar Ø | **40 pt** (≈80 px), `border-radius: 50%` |
| Gap avatar → text | **12 pt** |
| Text block start X | 16+22+12+40+12 = **102 pt** (divider start измерен ≈103.5 pt / 207 px) |
| Text block right inset | **20–28 pt** (место под index rail, текст не заезжает на буквы) |
| Name / status stack gap | **1–3 pt** |
| Divider inset-left | **≈102–104 pt** |
| Divider right | до края экрана (под index, hairline виден до ~right−0) |
| Divider толщина | **0.5 pt** (1 px @2x) |

Горизонтальная формула ряда:
`[16][checkbox 22][12][avatar 40][12][name+status …][gap][index ~16–20]`

## 4. Цвет
| Роль | HEX / RGBA | Где |
|---|---|---|
| Screen BG | `#000000` | весь фон |
| Search field fill | `#1C1C1E` (семпл кадра ≈ `#181818`) | `.tg-search-input` |
| Nav button fill | `#2C2C2E` (семпл ≈ `#191919`…`#474747` из-за JPEG/иконки) | круги X / ✓ |
| Primary text | `#FFFFFF` | «Добавить», имена контактов, иконки X/✓ |
| Secondary text | `#8E8E93` (семпл status ≈ `#888888`…`#969696`) | статусы `был(а)…`, placeholder поиска, section letters |
| Placeholder | `#8E8E93` | «Поиск контактов...» |
| Accent / index | `#007AFF` (iOS blue; JPEG сжимает до ≈ `#6D81C0`…`#5288C1`) | alphabet rail |
| Telegram status pill | `#2481CC` / `#3478F6` (семпл avg ≈ `#548DEA`) | капсула TELEGRAM в status |
| Battery low tint | `#FFD60A` | fill батареи 51% |
| Checkbox stroke (off) | `#38383A` … `#545458` (семпл кольца ≈ `#444444`…`#5A5A5A`) | unchecked ring |
| Divider | `#2C2C2E` / `#38383A` (семпл ≈ `#2A2A2A`…`#333333`) | hairline под row |
| Avatar letter «A» purple | gradient ≈ `#D39CFF` → `#B86ADF` (mid ≈ `#D7A6E9` / `#CD8AE9`) | letter-avatar |
| Avatar letter «A» orange | ≈ `#FBAA51` / mid `#F3CD93` | letter-avatar |
| Avatar letter «FI» blue | ≈ `#66B6FF` → `#3391FF` / `#63B6F2` | letter-avatar |
| Avatar letter «L» green | ≈ `#85E085` → `#55D255` / `#85D57A` | letter-avatar |
| Photo avatars | full-bleed circular crop, **без** stroke/ring | реальные фото |

## 5. Типографика
Семейство: **SF Pro Text / SF Pro Display** (`-apple-system`).

| Элемент | Size | Weight | Color | Notes |
|---|---|---|---|---|
| Status time | 15–16 pt | Semibold | `#FFFFFF` | `09:54` |
| Status pill «TELEGRAM» | 11–12 pt | Semibold / Bold | `#FFFFFF` | uppercase, в синей капсуле |
| Nav title «Добавить» | **17 pt** | **Semibold (600)** | `#FFFFFF` | tracking ≈ −0.4 pt, center |
| Search placeholder | **17 pt** | Regular | `#8E8E93` | «Поиск контактов...»; лупа слева от текста (если есть) |
| Section letter (A, D, I, L, O, R, N…) | **14–15 pt** | Semibold | `#8E8E93` | left-aligned 16 pt |
| Contact name | **17 pt** | Regular / Medium / Semibold | `#FFFFFF` | 1 line, ellipsis; emoji inline (🐸, 🏔️, 🎲) |
| Contact status | **13–14 pt** | Regular | `#8E8E93` | `был(а) недавно`, `был(а) 04/17/26`, `был(а) в этом месяце`, `был(а) очень давно` |
| Index letters | **10–11 pt** | Bold / Semibold | `#007AFF` | condensed vertical stack; Latin + Cyrillic |

## 6. Иконки/контролы

### Navigation
- **Left — Close:** белый `×` (две пересекающиеся линии, stroke ≈1.5–2 pt) в круге `#2C2C2E`. Hit-area ≥44×44 pt.
- **Right — Done:** белая галочка `✓` (stroke ≈2 pt) в круге `#2C2C2E`. На кадре визуально «активна» по наличию, но без синей заливки (стандарт TG: серый круг + белая иконка).
- **Center:** текст `Добавить`, без subtitle/счётчика выбранных.

### Search
- Поле-капсула `#1C1C1E`, radius 10 pt.
- Placeholder `Поиск контактов...` серый; опционально magnifying-glass SF Symbol слева (~14–16 pt, `#8E8E93`).
- Состояние idle (без фокуса, без курсора, без clear-кнопки).

### Checkbox (selection)
- Форма: **кольцо** (radio-style), не квадрат.
- Unchecked: только stroke `#38383A`/`#545458`, fill transparent / `#000`.
- Checked (не на кадре): обычно fill `#007AFF` + белая галочка — для реконструкции держать как соседнее состояние.

### Alphabet index
- Вертикальный rail: `A D I L O R S T V X Z` затем кириллица `А Б В Г Д Е Ж…` (на кадре виден переход Latin→Cyrillic).
- Между некоторыми глифами — микро-засечки/разделители ≈6–8×1 px, цвет ≈`#2C2C2E` (JPEG; design-intent hairline).
- Активного «увеличенного» буквенного HUD на кадре нет (все буквы равномерно `#007AFF`).

### Avatars
- Letter-avatars: круг 40 pt, буква(ы) белые по центру ~17–18 pt Semibold, фон solid/gradient брендового цвета Telegram.
- Photo-avatars: `object-fit: cover`, круг без обводки.

## 7. Тени / бордеры / разделители
- **Shadows / elevation:** отсутствуют (плоский OLED).
- **Blur:** nav/search без видимого `backdrop-filter` на этом кадре (фон уже `#000`, chrome непрозрачен).
- **Nav buttons:** без бордера; fill solid/near-solid `#2C2C2E`.
- **Search:** без бордера, только fill + radius.
- **Checkbox:** единственный явный stroke-бордер (1.5–2 pt).
- **Row divider:** hairline **0.5 pt**, цвет `#38383A` / семпл `#2A2A2A`–`#333333`; начинается от X текста (~102 pt), идёт вправо до края; **не** проходит под checkbox/avatar.
- **Section headers:** без нижней линии отдельного стиля (отделяются отступом + буквой).

## 8. Состояния на кадре
- Все видимые checkbox = **unchecked** (пустые кольца).
- Search = idle, placeholder виден.
- Список прокручен к началу алфавита (секция **A** сверху; далее D / I / L / O / R…).
- Нет выбранных chips/пилюль над списком (0 selected UI).
- StatusBar: Telegram foreground-pill активен (возврат в TG из другого контекста / multitasking cue).
- Батарея 51%, LTE, без зарядки.
- Index rail полностью отрисован, без pressed/magnifier overlay.

Видимые типы строк (для паритета контента):
- Letter-avatar + name + last-seen.
- Photo-avatar + name + last-seen.
- Имена с emoji в title.
- Section letters между группами.

## 9. CSS-скелет
```css
.tg-screen {
  --tg-bg: #000000;
  --tg-surface: #1c1c1e;
  --tg-control: #2c2c2e;
  --tg-text: #ffffff;
  --tg-text-sec: #8e8e93;
  --tg-accent: #007aff;
  --tg-sep: #38383a;
  --tg-check-stroke: #545458;
  background: var(--tg-bg);
  color: var(--tg-text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  width: 414px;
  height: 896px;
  position: relative;
  overflow: hidden;
}

.tg-status-bar {
  height: 48px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 0 16px 4px;
  font-size: 15px;
  font-weight: 600;
}

.tg-status-pill {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: 10px;
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  background: #2481cc;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.tg-nav-bar {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  position: relative;
}

.tg-nav-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--tg-control);
  color: #fff;
  display: grid;
  place-items: center;
  border: 0;
}

.tg-nav-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.4px;
}

.tg-search-wrap {
  padding: 6px 16px 10px;
}

.tg-search-input {
  height: 36px;
  border-radius: 10px;
  background: var(--tg-surface);
  color: var(--tg-text-sec);
  font-size: 17px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border: 0;
}

.tg-list {
  overflow-y: auto;
  height: calc(100% - 48px - 44px - 52px);
  padding-right: 18px; /* место под index */
}

.tg-section-header {
  height: 30px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  color: var(--tg-text-sec);
  font-size: 14px;
  font-weight: 600;
}

.tg-contact-row {
  height: 54px;
  display: flex;
  align-items: center;
  padding-left: 16px;
  position: relative;
}

.tg-checkbox {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--tg-check-stroke);
  background: transparent;
  flex: 0 0 auto;
  margin-right: 12px;
  box-sizing: border-box;
}

.tg-checkbox.is-checked {
  background: var(--tg-accent);
  border-color: var(--tg-accent);
}

.tg-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  flex: 0 0 auto;
  margin-right: 12px;
}

.tg-avatar-letter {
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 17px;
  font-weight: 600;
}

.tg-contact-info {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-right: 8px;
  border-bottom: 0.5px solid var(--tg-sep);
}

.tg-contact-name {
  font-size: 17px;
  font-weight: 400;
  color: var(--tg-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 22px;
}

.tg-contact-status {
  font-size: 13px;
  font-weight: 400;
  color: var(--tg-text-sec);
  line-height: 18px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tg-index-bar {
  position: absolute;
  right: 2px;
  top: 120px;
  bottom: 40px;
  width: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  color: var(--tg-accent);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  pointer-events: auto;
  z-index: 5;
  user-select: none;
}

.tg-index-item {
  text-align: center;
}
```

## 10. Неуверенности
- **Accent index blue:** на JPEG уходит в `#5288C1`/`#6D81C0`; канон iOS/Telegram dark — `#007AFF` (или accent пользователя). Для пиксель-матча к JPG можно подмешать desaturated blue, для UI-реконструкции — `#007AFF`.
- **Nav button fill:** семпл левого круга ≈`#191919`, правого светлее из-за антиалиаса галочки; design-token Telegram — `#2C2C2E` (возможно `rgba(44,44,46,0.82)` на blur-фоне, здесь фон уже чёрный).
- **Search height:** fill-зона на кадре визуально чуть ниже каноничных 36 pt из-за сжатия/кропа AA; держать **36 pt / radius 10**.
- **Row height:** измеренный шаг центров checkbox = 53 pt; визуальный «воздух» рядов ближе к 52–56 pt — брать **54 pt** как среднее.
- **Divider alpha:** семпл `#2A2A2A`–`#333333` может быть `#38383A` @ ~0.6–1.0 на `#000`; safest — solid `#38383A` 0.5 pt.
- **Состав index:** точный набор латинских «дыр» (пропущенные B,C,E…) зависит от реально присутствующих секций в книге контактов пользователя; на кадре видны A,D,I,L,O,R,S,T,V,X,Z + кириллица.
- **Имена контактов:** OCR по JPEG неоднозначен (A.Alexey vs «A Truk Сервис» и т.п.) — для UI-реконструкции важнее геометрия/токены, не точные строки.
- **Лупа в search:** на кадре placeholder сдвинут; наличие SF Symbol `magnifyingglass` слева вероятно, но контраст низкий — помечено как опциональное.
