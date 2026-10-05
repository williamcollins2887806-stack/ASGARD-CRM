# S12 — contacts-glass-nav-dark

## 1. Мета
- **Приложение:** Telegram iOS (русский UI).
- **Экран:** список контактов (Contacts) — вкладка «Контакты» активна.
- **Тема:** Dark / OLED Night (`#000000` pure black).
- **Ориентация:** портрет.
- **Файл-референс:** `REFS/S12.jpg`, физический размер **828 × 1792 px** (≈ **414 × 896 pt** @2x).
- **Системное время на кадре:** `09:55`.
- **Сеть / батарея:** LTE, сигнал полный, батарея **~51%** (белый fill, без иконки зарядки).
- **Status chrome:** слева время; по центру — синяя «капсула» возврата в Telegram (paper-plane / active-app pill); справа LTE + батарея.
- **Контекст:** скролл у верха списка; строка «Пригласить» видна; низ списка просвечивает сквозь floating glass tab bar + отдельный FAB поиска справа.
- **Отличие от S02:** то же семейство экрана, другой таймстамп/контент (09:55 vs 15:51), badge «Чаты» = **51**, у активного таба «Контакты» — мягкий teal/green-blue glow-подложка под иконкой.

## 2. Иерархия слоёв
Порядок отрисовки (z от дальнего к ближнему):

1. **`.tg-screen-bg`** — сплошной `#000000` на весь viewport.
2. **`.tg-list`** — скролл: action-row «Пригласить» + ряды контактов + hairline-разделители; контент уходит **под** floating chrome.
3. **`.tg-header` + `.tg-search-wrap`** — верхний chrome (header + search); на кадре скролл≈0, sticky не доказан, но визуально закреплены над списком.
4. **`.tg-nav-island`** — плавающая glass-капсула с 4 табами (blur + translucent fill).
5. **`.tg-fab-search`** — отдельный круглый FAB с лупой справа от острова (gap ~8–12 pt).
6. **`.tg-status-bar`** — системный слой (время / Telegram-pill / LTE+battery) + home indicator внизу.

## 3. Геометрия
Все значения — **логические pt** (кадр @2x ⇒ pt = px/2), если не указано иное.

### Экран / chrome
| Элемент | Значение |
|---|---|
| Ширина экрана | **414 pt** |
| Высота экрана | **896 pt** |
| StatusBar + Island зона | ~47–54 pt до контента header |
| Header row | высота **44 pt**; H-padding **16 pt** |
| Home indicator | ширина ~134 pt, высота **5 pt**, центр, `#FFFFFF` @ ~0.30–0.40 alpha |
| Clearance снизу под nav+FAB | padding-bottom списка **~110–130 pt** |

### Header
| Элемент | Значение |
|---|---|
| «Сортировка» pill | высота **32 pt**, H-padding **10–12 pt**, `border-radius: 16 pt` (stadium), left inset **16 pt** |
| Title «Контакты» | абсолютный центр по X экрана |
| «+» button | круг **Ø 32 pt**, right inset **16 pt**, `border-radius: 50%` |
| Gap title ↔ buttons | title не перекрывает pills (min clear ~8 pt) |

### Search
| Параметр | Значение |
|---|---|
| Wrap padding | V **8 pt**, H **16 pt** |
| Bar height | **36 pt** |
| Bar width | `100% − 32 pt` |
| Corner radius | **10 pt** |
| Inner content | лупа ~16 pt + gap **6 pt** + «Поиск»; визуально **центрированы** в баре |
| Icon/text vertical align | center |

### Action «Пригласить»
| Параметр | Значение |
|---|---|
| Row height | **44–48 pt** |
| Left padding | **16 pt** |
| Icon size | **22–24 pt** (контур person+plus) |
| Gap icon → text | **12 pt** |
| Right padding | **16 pt** |

### Contact row
| Параметр | Значение |
|---|---|
| Row height | **56–60 pt** (типично **58**) |
| H-padding | **16 pt** |
| Avatar | **Ø 40 pt**, `border-radius: 50%` |
| Gap avatar → text | **12 pt** |
| Text stack gap (name↔status) | **2–3 pt** |
| Content start X | 16 + 40 + 12 = **68 pt** |
| Divider | **0.5 pt**, inset-left **68 pt** → right **0** |
| Visible names on frame (примеры) | letter/photo avatars: «Сергей…», «Эдуард», «Эдуард Казанцев», «Вера Сухова» (низ частично под blur) |

### Bottom nav island + FAB
| Параметр | Значение |
|---|---|
| Island width | **~300–330 pt** (~72–80% ширины; **не** full-bleed — справа место под FAB) |
| Island height | **56–64 pt** |
| Island corner radius | **28–32 pt** (stadium) |
| Island bottom inset | **20–28 pt** над home indicator |
| Island H position | смещён чуть влево от центра (центр массы с FAB ≈ центр экрана) |
| Inner padding | V **8–10 pt**, H **16–22 pt** |
| Tab slots | 4 × равные колонки `space-around` / `space-evenly`, ширина слота ~56–64 pt |
| Tab icon | **24–26 pt** |
| Tab label gap | **2–4 pt** под иконкой |
| Active glow under «Контакты» | мягкий овал / pill под иконкой: ~36×22 pt, radius ~11–14 pt |
| FAB diameter | **52–56 pt** |
| FAB right inset | **16–20 pt** |
| FAB bottom | ≈ выровнен с island (**20–28 pt**) |
| Gap island→FAB | **8–12 pt** |
| Badge «51» | height **16–18 pt**, min-width **20–24 pt**, radius **9–10 pt**, top-right иконки, offset ~−4/−6 pt |
| Badge «!» | круг **Ø 16–18 pt** |

## 4. Цвет
| Роль | HEX / RGBA | Где |
|---|---|---|
| Screen BG | `#000000` | весь фон |
| Surface control | `#1C1C1E` | sort pill, «+», search bar, FAB fill |
| Primary text | `#FFFFFF` | title, имена, sort/plus glyphs |
| Secondary text | `#8E8E93` | статусы «был(а)…», placeholder «Поиск», inactive tabs |
| Accent (links / active) | `#007AFF` (alt dark-system `#0A84FF`) | «Пригласить», active tab tint |
| Active tab glow | `rgba(48, 176, 199, 0.22–0.35)` или `rgba(10, 132, 255, 0.18–0.28)` с лёгким teal bias | овальная подложка под иконкой «Контакты» |
| Separator | `#38383A` / `#2C2C2E` | hairline под рядами |
| Badge fill | `#FF3B30` / `#FF453A` | «51», «!» |
| Badge text | `#FFFFFF` | |
| Nav island fill | `rgba(28, 28, 30, 0.78–0.88)` | glass capsule |
| Nav island border | `rgba(255, 255, 255, 0.08–0.12)` | 0.5 pt ring |
| Telegram status pill | `#007AFF` / `#3390EC` fill | center status capsule |
| Letter avatar samples | `#5AC8FA`, `#3390EC`, `#5E5CE6` + photo crops | плейсхолдеры / фото |
| Home indicator | `rgba(255, 255, 255, 0.30–0.40)` | низ экрана |

## 5. Типографика
Семейство: **SF Pro Text / SF Pro Display** (`-apple-system`).

| Элемент | Size | Weight | Color | Notes |
|---|---|---|---|---|
| Status time `09:55` | 15–16 pt | Semibold | `#FFFFFF` | |
| Header title «Контакты» | **17 pt** | Semibold / 600 | `#FFFFFF` | tracking ≈ −0.41 |
| «Сортировка» | 15–17 pt | Regular | `#FFFFFF` | внутри pill |
| Search placeholder «Поиск» | **17 pt** | Regular | `#8E8E93` | |
| Action «Пригласить» | **17 pt** | Regular / Medium | `#007AFF` | |
| Contact name | **16–17 pt** | Semibold | `#FFFFFF` | 1 line, ellipsis |
| Contact status | **13–14 pt** | Regular | `#8E8E93` | `был(а) MM/DD/YY` / «недавно» и т.п. |
| Tab label | **10–11 pt** | Medium | active `#007AFF`, inactive `#8E8E93` | |
| Badge digits `51` | **11–12 pt** | Bold / Semibold | `#FFFFFF` | |
| Badge `!` | **11–12 pt** | Bold | `#FFFFFF` | |

## 6. Иконки/контролы
### Header
- **Left — «Сортировка»:** текстовая pill-кнопка, fill `#1C1C1E`, без отдельной иконки (или микро-chevron — на кадре доминирует текст).
- **Right — «+»:** SF-style plus, stroke ~2–2.5 pt, цвет `#FFFFFF` на круге `#1C1C1E`.
- Hit-area ≥ **44×44 pt**.

### Search
- SF Symbol `magnifyingglass`, ~16 pt, `#8E8E93`, слева от плейсхолдера; пара центрирована в баре.

### Invite row
- Контурный `person.badge.plus` / person+plus в круге-outline, stroke `#007AFF`, ~22–24 pt.
- Текст «Пригласить» (на кадре может быть «Пригласить» / «Пригласить друзей» — тот же accent).

### Tab bar (4 колонки L→R)
1. **Контакты (active):** filled person silhouette `#007AFF` + soft teal/blue glow oval позади; лейбл active.
2. **Звонки:** outline phone, `#8E8E93`.
3. **Чаты:** outline/fill chat bubble `#8E8E93` + red badge **`51`**.
4. **Настройки:** outline gear `#8E8E93` + red circle badge **`!`**.

### FAB
- `magnifyingglass`, ~22–24 pt, `#FFFFFF` / `#EBEBF5`, на круге `#1C1C1E`.
- Отдельный контрол, **не** внутри island.

## 7. Тени / бордеры / разделители
- **Список:** плоский; теней на рядах **нет**.
- **Contact separators:** `0.5 pt` solid `#38383A`; inset-left **68 pt** → right edge; не идут под аватар.
- **Search / sort / plus:** без border; только fill `#1C1C1E`.
- **Nav island:**
  - `backdrop-filter: blur(20px)` (диапазон 16–24 px) + `saturate(140–180%)`;
  - fill `rgba(28,28,30,0.78–0.88)`;
  - border `0.5 pt rgba(255,255,255,0.10)`;
  - shadow `0 4px 16px rgba(0,0,0,0.45–0.55)` (опц. `0 8px 24px rgba(0,0,0,0.40)`).
- **FAB:** shadow `0 2px 10px rgba(0,0,0,0.45)`; опц. ring `0.5 pt rgba(255,255,255,0.08)`.
- **Badges:** без stroke; читаемость за счёт красного на тёмной иконке.
- **Active glow:** без жёсткой обводки; мягкий blur/alpha oval (не solid pill).
- **Blur поверх списка:** через island частично видна нижняя строка («Вера…») — обязательный glass-эффект.

## 8. Состояния на кадре
- **Active tab:** «Контакты» — filled icon + accent label + soft glow.
- **Inactive tabs:** Звонки / Чаты / Настройки — `#8E8E93`.
- **Badges:** Чаты=`51`; Настройки=`!`.
- **Search:** пустой, placeholder «Поиск».
- **Invite row:** видна сразу под search.
- **Scroll:** верх списка (invite + первые контакты); низ перекрыт island/FAB.
- **Theme:** OLED black, поверхности контролов только `#1C1C1E`.
- **Status:** `09:55`, LTE, ~51%, синяя Telegram-капсула по центру.
- **Keyboard:** скрыта.
- **Selection/press:** нет pressed-state на рядах.

## 9. CSS-скелет
```css
.tg-screen {
  position: relative;
  width: 414px;
  height: 896px;
  background: #000000;
  color: #ffffff;
  font-family: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
  overflow: hidden;
}

.tg-status-bar {
  height: 54px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 0 24px 8px;
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
  z-index: 40;
}

.tg-status-pill {
  position: absolute;
  left: 50%;
  top: 10px;
  transform: translateX(-50%);
  height: 28px;
  padding: 0 12px;
  border-radius: 14px;
  background: #007aff;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
}

.tg-header {
  position: relative;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  z-index: 30;
}

.tg-btn-sort {
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  background: #1c1c1e;
  color: #ffffff;
  font-size: 15px;
  border: 0;
}

.tg-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.41px;
  color: #ffffff;
}

.tg-btn-plus {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #1c1c1e;
  color: #ffffff;
  display: grid;
  place-items: center;
  border: 0;
  font-size: 22px;
  line-height: 1;
}

.tg-search-wrap {
  padding: 8px 16px;
  z-index: 30;
}

.tg-search-bar {
  height: 36px;
  border-radius: 10px;
  background: #1c1c1e;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #8e8e93;
  font-size: 17px;
}

.tg-action-invite {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 48px;
  padding: 0 16px;
  color: #007aff;
  font-size: 17px;
}

.tg-list {
  overflow-y: auto;
  padding-bottom: 120px; /* clearance under island + FAB */
  z-index: 10;
}

.tg-contact-row {
  display: flex;
  align-items: center;
  min-height: 58px;
  padding: 8px 16px;
  position: relative;
}

.tg-contact-row::after {
  content: "";
  position: absolute;
  left: 68px;
  right: 0;
  bottom: 0;
  height: 0.5px;
  background: #38383a;
}

.tg-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  margin-right: 12px;
  flex-shrink: 0;
  object-fit: cover;
  background: #3390ec;
}

.tg-contact-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tg-contact-name {
  font-size: 17px;
  font-weight: 600;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tg-contact-status {
  font-size: 14px;
  color: #8e8e93;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tg-nav-island {
  position: absolute;
  bottom: 28px;
  left: 18px; /* сдвиг влево — справа FAB */
  width: 310px;
  height: 64px;
  padding: 8px 18px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 32px;
  background: rgba(28, 28, 30, 0.82);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 0.5px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  z-index: 50;
}

.tg-nav-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 56px;
  color: #8e8e93;
  font-size: 10px;
  font-weight: 500;
}

.tg-nav-item.active {
  color: #007aff;
}

.tg-nav-item.active::before {
  content: "";
  position: absolute;
  top: 2px;
  width: 36px;
  height: 22px;
  border-radius: 12px;
  background: rgba(48, 176, 199, 0.28);
  filter: blur(0.5px);
  z-index: -1;
}

.tg-badge {
  position: absolute;
  top: -4px;
  right: 6px;
  min-width: 18px;
  height: 16px;
  padding: 0 5px;
  border-radius: 10px;
  background: #ff3b30;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  display: grid;
  place-items: center;
  line-height: 1;
}

.tg-badge.alert {
  width: 16px;
  min-width: 16px;
  padding: 0;
  border-radius: 50%;
}

.tg-fab-search {
  position: absolute;
  right: 16px;
  bottom: 28px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #1c1c1e;
  color: #ffffff;
  display: grid;
  place-items: center;
  border: 0;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  z-index: 50;
}

.tg-home-indicator {
  position: absolute;
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
  width: 134px;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.35);
  z-index: 60;
}
```

## 10. Неуверенности
- Точный hue active-glow: на кадре читается как **teal/green-blue**, не чистый `#007AFF` solid pill — возможна кастомная тема / Liquid Glass артефакт / compression; диапазон `rgba(48,176,199,0.22–0.35)` vs `rgba(10,132,255,0.18–0.28)`.
- Alpha/blur island: оценка `0.78–0.88` / `16–24px` — зависит от контента под баром и JPEG.
- Точная ширина island vs FAB gap: bar ~300–330 pt; FAB отдельно справа, не «внутри» капсулы.
- Sticky header/search при скролле на кадре не доказан (scroll≈0).
- Logical width: файл 828×1792 ⇒ **414×896**; визуально близко к 390-классу — при вёрстке якориться на **414**.
- Текст invite: «Пригласить» vs «Пригласить друзей» — один и тот же accent-row паттерн.
- Letter-avatar HEX — приближение по кадру, не токен Telegram brand.
- Status center pill: active-app return vs Dynamic Island overlay — геометрия капсулы ~28 pt height оценена.
