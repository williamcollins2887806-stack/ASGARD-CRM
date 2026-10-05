# S01 — chat-list-dark

## 1. Мета
- **Приложение:** Telegram iOS (клиент с русским UI).
- **Экран:** главный список чатов (Chat List), тёмная тема Night / OLED.
- **Состояние:** синхронизация («Обновление...»), 4 закреплённых чата, 2 служебных баннера, непрочитанные счётчики, FAB поиска, нижний TabBar с баджем.
- **Файл-референс:** `REFS/S01.jpg`, физический размер **828 × 1792 px** (≈ **414 × 896 pt** @2x).
- **Ориентация:** портрет.
- **StatusBar:** время `15:51` слева; центр — иконка Telegram (paper-plane в круге); справа LTE + батарея **51%** (белый fill, без зарядки).
- **Safe Area:** верх ≈ 44–48 pt (status + notch/Dynamic Island зона); низ home-indicator ≈ 34 pt.

## 2. Иерархия слоёв
Сверху вниз (z от дальнего к ближнему):

1. **`.tg-screen-bg`** — сплошной `#000000`, на всю высоту.
2. **`.tg-chat-list`** — скролл-контент (баннеры + ячейки), уходит под nav/tab blur.
3. **`.tg-banner-stack`** — два карточных баннера под nav bar (внутри скролла / sticky-зоны).
4. **`.tg-nav-bar`** — полупрозрачный blur поверх верха списка; кнопки «Изм.» / «Обновление...» / compose.
5. **`.tg-status-bar`** — системный слой поверх nav.
6. **`.tg-search-fab`** — круглая кнопка поиска, справа над TabBar.
7. **`.tg-tab-bar`** — нижняя floating-капсула с blur + home indicator.

## 3. Геометрия
Все значения ниже — **логические pt** (кадр @2x ⇒ pt = px/2), если не указано иное.

### Экран / chrome
| Элемент | Значение |
|---|---|
| Ширина экрана | 414 pt |
| Высота экрана | 896 pt |
| StatusBar высота | ~44 pt (с учётом inset) |
| NavBar контентная высота | ~44 pt |
| NavBar + status суммарно | ~88–96 pt до первой видимой строки списка |
| TabBar капсула | высота ~64–68 pt, inset L/R ~10–12 pt, bottom ~8–10 pt над home indicator |
| TabBar общая зона с safe | ~83–90 pt |
| Search FAB | диаметр **56 pt**, right inset **16 pt**, bottom над TabBar **~12–16 pt** |
| Home indicator | ширина ~134 pt, высота 5 pt, центр, `#FFFFFF` @ ~0.3–0.4 alpha |

### Баннеры
| Параметр | Значение |
|---|---|
| Горизонтальный inset | **8–10 pt** |
| Gap между баннерами | **6–8 pt** |
| Высота баннера | **~52–56 pt** |
| Corner radius баннера | **12 pt** |
| Внутренний padding | L/R **12 pt**, V **10–12 pt** |
| Иконка слева в баннере | круг ~28–32 pt |
| Gap иконка → текст | **10–12 pt** |
| Кнопка «Разрешить» (гео) | высота ~28–30 pt, radius ~14–15 pt (pill), right-aligned |

### Ячейка чата
| Параметр | Значение |
|---|---|
| Высота ячейки | **76 pt** (аватар 60 + padding V 8+8) |
| Avatar | **60 × 60 pt**, `border-radius: 50%` |
| Avatar left inset | **16 pt** |
| Gap avatar → text | **12 pt** |
| Text block right inset | **16 pt** |
| Content start X | 16 + 60 + 12 = **88 pt** |
| Divider | толщина **0.5 pt**, начинается с X≈**88 pt** до правого края −0 |
| Title row высота | ~22 pt |
| Snippet max lines | **2** (line-clamp), line-height ~18–20 pt |
| Time column | правый верх ячейки, baseline с title |
| Unread badge | min-width ~20–22 pt, height ~20 pt, radius **10 pt**, padding H **6–7 pt** |
| Pin icon | ~14–16 pt, правый низ ячейки (место badge, если нет unread) |

### Закреплённый блок
- Первые **4** ячейки: Анализ тендеров, Офис АСГАРД-Сервис, Тайпспейс Медиа, Playerok.
- Визуально слегка приподнятый фон относительно чистого `#000` (см. §4).
- После 4-й — обычный список без pin.

## 4. Цвет
| Роль | HEX / RGBA | Где |
|---|---|---|
| Screen BG | `#000000` | весь фон |
| Pinned row BG | `#161618` … `#1C1C1E` (≈ `#000` + 6–10% white) | 4 pinned cells |
| Nav / Tab blur fill | `rgba(28, 28, 30, 0.72–0.88)` | `.tg-nav-bar`, `.tg-tab-bar` |
| Primary text | `#FFFFFF` | имена чатов, «Обновление...» |
| Secondary text | `#8E8E93` | сниппеты, время, mute, tabs inactive |
| Tertiary / dim | `#636366` | редкий мета-текст |
| Link / accent blue | `#0A84FF` (dark system blue) | «Изм.», verified, active tab tint, «Разрешить» fill |
| Unread active | `#007AFF` / `#0A84FF` | badge «8» |
| Unread muted | `#3A3A3C` | badges 43 / 145 / 40 |
| Badge text on blue | `#FFFFFF` | |
| Badge text on muted | `#EBEBF5` @ 0.6 или `#8E8E93` | |
| Draft label | `#FF453A` (dark system red) | «Черновик:» |
| Divider | `#2C2C2E` / `#38383A` | hairline |
| Banner surface | `#1C1C1E` @ ~0.92–1.0 | ДР / гео |
| Banner icon blue | `#0A84FF` | иконка ДР / гео |
| Tab badge red | `#FF3B30` / `#FF453A` | «32» на Чаты |
| FAB fill | `#2C2C2E` … `#1C1C1E` | круг поиска |
| FAB icon | `#FFFFFF` | лупа |
| FAB ring | `rgba(255,255,255,0.08–0.12)` | тонкая обводка |

## 5. Типографика
Семейство: **SF Pro Text / SF Pro Display** (системный iOS).

| Элемент | Size | Weight | Color | Notes |
|---|---|---|---|---|
| Status time | 15–16 pt | Semibold | `#FFFFFF` | |
| Nav «Изм.» | 17 pt | Regular | `#0A84FF` | left |
| Nav title «Обновление...» | 17 pt | Semibold | `#FFFFFF` | + spinner 14–16 pt слева от текста |
| Chat title | **17 pt** | **Semibold** | `#FFFFFF` | tracking ≈ −0.4 pt |
| Snippet / preview | **15 pt** | Regular | `#8E8E93` | 2 lines, truncate ellipsis |
| Draft prefix | 15 pt | Regular | `#FF453A` | «Черновик:» перед серым текстом |
| Sender prefix in group | 15 pt | Regular | `#FFFFFF` or `#8E8E93` | «Имя:» в сниппете |
| Time / date | **14–15 pt** | Regular | `#8E8E93` | «вт», «пн», «вс», «15:42» |
| Unread digit | 13–14 pt | Semibold | white / gray | |
| Banner title | 15–16 pt | Semibold | `#FFFFFF` | «День рождения», «Трансляция геопозиции» |
| Banner subtitle | 13–14 pt | Regular | `#8E8E93` | «Сегодня у …» |
| Banner CTA | 14–15 pt | Semibold | `#FFFFFF` on blue pill | «Разрешить» |
| Tab label | **10 pt** | Medium | inactive `#8E8E93`, active `#0A84FF` | Контакты / Звонки / Чаты / Настройки |

## 6. Иконки/контролы

### Navigation
- **Left:** текст `Изм.` (Edit) — без иконки, hit-area ~44×44.
- **Center:** UIActivityIndicator (белый, ~16 pt) + `Обновление...`.
- **Right cluster (gap ~18–22 pt):**
  1. `plus.circle` / compose-group — outline, `#0A84FF`, ~24–28 pt.
  2. `square.and.pencil` — новое сообщение, `#0A84FF`, ~24–28 pt.

### Баннеры
1. **День рождения:** круглый blue icon (торт/gift), title + subtitle «Сегодня у …», chevron `>` справа `#8E8E93`.
2. **Трансляция геопозиции:** location icon в синем круге; справа pill-кнопка **«Разрешить»** fill `#0A84FF`, text white.

### В ячейках
- **Verified:** синий диск ~14–16 pt + белая галочка (Playerok, Москвач) — сразу справа от title.
- **Mute:** `speaker.slash` ~14 pt, `#8E8E93`, после title/verified (Офис, Тайпспейс, Московская…, Москвач).
- **Pin:** `pin.fill` / diagonal pin, `#8E8E93`, правый нижний угол content column у pinned без unread.
- **Mention / @ badge:** на части muted может быть отдельный индикатор; на кадре доминируют числовые counters.
- **Avatars:** фото или градиентные буквенные плейсхолдеры (круг 60).

### FAB
- Magnifying glass `magnifyingglass`, stroke 2 pt, центр круга 56.

### TabBar (4 вкладки, равные колонки)
1. Контакты — person.2 outline.
2. Звонки — phone outline.
3. **Чаты** — active, bubble.fill + red badge **32** (top-right иконки, ~18 pt круг).
4. Настройки — gear outline.
- Active icon tint `#0A84FF`; inactive `#8E8E93`.

## 7. Тени / бордеры / разделители
- **Shadows на ячейках:** нет (плоский iOS list).
- **NavBar / TabBar:** `backdrop-filter: blur(20–40 px)` + полупрозрачный fill; нижняя граница nav — очень слабый hairline `rgba(84,84,88,0.45)` или отсутствует.
- **Dividers между чатами:** `0.5 pt` solid `#2C2C2E`, inset-left **88 pt**.
- **Pinned vs regular:** без жирной секции-хедера; отделение только фоном + pin icons.
- **FAB shadow:** мягкая `0 4px 12px rgba(0,0,0,0.35)`, ring `0.5 pt` light.
- **TabBar:** floating capsule, outer shadow `0 8px 24px rgba(0,0,0,0.45)`; corner-radius **≈ 32–36 pt** (почти stadium).
- **Banner:** без drop-shadow или очень слабый; бордер отсутствует, отличие = fill `#1C1C1E`.

## 8. Состояния на кадре

### Список (сверху вниз, видимое)
| # | Title | Meta R | Snippet / state | Badges / icons |
|---|---|---|---|---|
| P1 | Анализ тендеров | вс | **Черновик:** (red) + серый preview | pin |
| P2 | Офис АСГАРД-Сервис | пн | muted preview | mute + pin |
| P3 | Тайпспейс Медиа | пн | muted | mute + pin |
| P4 | Playerok ✓ | 15:42? | last msg | verified + pin |
| 5 | … (обычные) | даты | previews 1–2 lines | |
| … | Офис / группы | | | muted gray badges **43**, **145**, **40** |
| | один unmuted | | | blue badge **8** |
| | Москвач ✓ | | | verified + mute |

### Глобальные UI-states
- Syncing: nav title = spinner + «Обновление...».
- Birthday banner visible.
- Location permission banner visible («Разрешить»).
- Tab «Чаты» selected; global unread **32**.
- Search FAB visible (не скрыт клавиатурой).

## 9. CSS-скелет
```css
.tg-screen {
  width: 414px;
  height: 896px;
  background: #000000;
  color: #ffffff;
  font-family: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
  position: relative;
  overflow: hidden;
}

.tg-status-bar {
  height: 44px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 0 16px 4px;
  font-size: 15px;
  font-weight: 600;
  z-index: 40;
}

.tg-nav-bar {
  height: 44px;
  display: grid;
  grid-template-columns: 64px 1fr auto;
  align-items: center;
  padding: 0 12px 0 16px;
  background: rgba(28, 28, 30, 0.82);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  position: sticky;
  top: 44px;
  z-index: 30;
}
.tg-nav-bar__edit { color: #0a84ff; font-size: 17px; }
.tg-nav-bar__title {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  font-size: 17px; font-weight: 600; color: #fff;
}
.tg-nav-bar__actions { display: flex; gap: 18px; color: #0a84ff; }
.tg-nav-bar__actions svg { width: 26px; height: 26px; }

.tg-banner-stack { padding: 8px 10px 4px; display: flex; flex-direction: column; gap: 7px; }
.tg-banner {
  display: flex; align-items: center; gap: 12px;
  min-height: 54px; padding: 10px 12px;
  background: #1c1c1e; border-radius: 12px;
}
.tg-banner__icon {
  width: 30px; height: 30px; border-radius: 50%;
  background: #0a84ff; flex-shrink: 0;
}
.tg-banner__title { font-size: 15px; font-weight: 600; color: #fff; }
.tg-banner__sub { font-size: 13px; color: #8e8e93; }
.tg-banner__cta {
  margin-left: auto; height: 30px; padding: 0 14px;
  border-radius: 15px; background: #0a84ff; color: #fff;
  font-size: 14px; font-weight: 600; border: 0;
}

.tg-chat-list { overflow-y: auto; padding-bottom: 120px; }

.tg-chat-cell {
  display: grid;
  grid-template-columns: 60px 1fr;
  column-gap: 12px;
  height: 76px;
  padding: 8px 16px;
  background: #000;
  position: relative;
}
.tg-chat-cell--pinned { background: #161618; }
.tg-avatar { width: 60px; height: 60px; border-radius: 50%; object-fit: cover; }

.tg-chat-cell__body {
  min-width: 0;
  display: flex; flex-direction: column; justify-content: center; gap: 2px;
  border-bottom: 0.5px solid #2c2c2e;
  padding-bottom: 8px;
}
.tg-chat-cell__row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.tg-title {
  font-size: 17px; font-weight: 600; letter-spacing: -0.4px;
  color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tg-title__verified {
  display: inline-block; width: 14px; height: 14px; margin-left: 4px;
  background: #0a84ff; border-radius: 50%;
}
.tg-title__mute { width: 14px; height: 14px; margin-left: 4px; color: #8e8e93; }
.tg-time { font-size: 14px; color: #8e8e93; flex-shrink: 0; }

.tg-snippet {
  font-size: 15px; line-height: 18px; color: #8e8e93;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.tg-snippet__draft { color: #ff453a; }
.tg-snippet__sender { color: #fff; }

.tg-meta-right {
  display: flex; flex-direction: column; align-items: flex-end;
  justify-content: space-between; min-height: 44px; padding: 2px 0;
}
.tg-badge-unread {
  min-width: 20px; height: 20px; padding: 0 6px;
  border-radius: 10px; background: #0a84ff; color: #fff;
  font-size: 13px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
}
.tg-badge-muted { background: #3a3a3c; color: #8e8e93; }
.tg-pin { width: 14px; height: 14px; color: #8e8e93; }

.tg-search-fab {
  position: absolute; right: 16px; bottom: 108px;
  width: 56px; height: 56px; border-radius: 50%;
  background: #2c2c2e; color: #fff;
  box-shadow: 0 4px 12px rgba(0,0,0,0.35);
  border: 0.5px solid rgba(255,255,255,0.1);
  display: grid; place-items: center; z-index: 25;
}

.tg-tab-bar {
  position: absolute; left: 12px; right: 12px; bottom: 22px;
  height: 66px; border-radius: 34px;
  background: rgba(28, 28, 30, 0.86);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.45);
  display: grid; grid-template-columns: repeat(4, 1fr);
  align-items: center; z-index: 35;
}
.tg-tab {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  color: #8e8e93; font-size: 10px; font-weight: 500; position: relative;
}
.tg-tab--active { color: #0a84ff; }
.tg-tab__badge {
  position: absolute; top: -4px; right: calc(50% - 22px);
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 9px; background: #ff453a; color: #fff;
  font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
}

.tg-home-indicator {
  position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
  width: 134px; height: 5px; border-radius: 3px;
  background: rgba(255,255,255,0.35); z-index: 36;
}
```

## 10. Неуверенности
- Точный HEX фона pinned-ряда: визуально `#161618`, может быть `#1C1C1E` @ низкой alpha поверх `#000`.
- Радиус blur nav/tab: оценка **28 px**; в Telegram iOS часто UIBlurEffect `.systemChromeMaterialDark` — точное σ не измерить со скрина.
- TabBar: floating capsule vs edge-to-edge — на кадре **капсула** с отступами; точный radius 32 vs 36 pt.
- Цвет draft: `#FF453A` (dark) vs `#FF3B30` (light system) — на OLED ближе к `#FF453A`.
- Unread blue: `#0A84FF` vs `#007AFF` — в dark UI предпочтителен `#0A84FF`.
- Высота баннера гео с CTA чуть больше баннера ДР (~2–4 pt).
- Часть title/snippet в нижних ячейках обрезана TabBar/FAB — полный текст не восстановить.
- Точный glyph set (SF Symbols версии) для compose-кнопок — по силуэту: `plus.circle` + `square.and.pencil`.
