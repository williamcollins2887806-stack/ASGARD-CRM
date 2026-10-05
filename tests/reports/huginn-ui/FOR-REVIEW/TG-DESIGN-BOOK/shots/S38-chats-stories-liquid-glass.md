# S38 — chats-stories-liquid-glass

## 1. Мета
Источник 828×1792 px, база 414 pt @2x, pt = px/2.

- **Файл:** `REFS/S38.jpg` (RGB JPEG).
- **Устройство:** iPhone логическая сетка **414 × 896 pt** (@2x → физический кадр 828 × 1792). Базу 390/393 **не** использовать.
- **Приложение / тема:** Telegram iOS 26, тёмная тема, **Liquid Glass** (плавающие стеклянные капсулы nav / search / geo / tab bar / FAB).
- **Экран:** вкладка «Чаты» — статус-бар → nav → Stories → поиск → баннер live-location → список чатов → floating TabBar + Search FAB.
- **Метод:** визуальный разбор + Python/Pillow по оригиналу (профили яркости, bbox, семплы RGB, зум-кропы ×2…×4 в `%TEMP%\s38_crops`, просмотр через Read).
- **Slug:** `chats-stories-liquid-glass`.

## 2. Иерархия слоёв
Снизу вверх (z от дальнего к ближнему):

1. **`.tg-screen-bg`** — двухзонный фон списка: верх (chrome + Stories + search + geo + **pinned**) ≈ `#1C1C1E`; ниже перехода ≈ y 1218 px (609 pt) — чистый `#000000` (unpinned-хвост списка).
2. **`.tg-chat-list`** — вертикальный скролл ячеек; уходит **под** верхний chrome и **под** нижний glass TabBar/FAB.
3. **`.tg-stories-row`** — горизонтальный ряд историй (внутри верхнего скролл-контента / sticky-зоны под nav).
4. **`.tg-search`** + **`.tg-geo-banner`** — две отдельные glass-капсулы под Stories.
5. **`.tg-nav-bar`** — заголовок «Чаты» + две glass-пилюли (Edit / compose-cluster); полупрозрачная тёмная подложка.
6. **`.tg-status-bar`** — системный слой: время, Dynamic Island / капсула `TELEGRAM`, LTE, батарея.
7. **`.tg-tab-bar`** — плавающая капсула 4 вкладок с backdrop blur.
8. **`.tg-search-fab`** — отдельный круглый glass-контрол справа от TabBar (лупа).
9. **Badges** на TabBar (красный `52` / `!`) поверх иконок; unread-бейджи ячеек внутри списка.
10. **Home indicator** — тонкая светлая капсула у низа экрана.

## 3. Геометрия
Все размеры — **логические pt** (измерено в px оригинала, ÷2), если не указано иное.

### Экран / chrome
| Элемент | px (оригинал) | pt |
|---|---|---|
| Экран | 828 × 1792 | **414 × 896** |
| Status zone (время / island / battery) | y ≈ 0…88 | ≈ **0…44** |
| Nav content (пилюли + «Чаты») | y ≈ 116…179 | высота пилюль **≈ 31.5** |
| Левая пилюля «Изм.» | x 32…159, y 116…179 | **63.5 × 31.5**, left inset **16** |
| Правая пилюля (story+ / compose) | x 620…795, y 116…179 | **87.5 × 31.5**, right inset ≈ **16.5** |
| Stories (аватары + подписи) | y ≈ 230…384 | блок ≈ **77…90** высотой |
| Search capsule | x 33…794, y 416…503 | **380.5 × 43.5**, H/V inset **16.5** |
| Geo capsule (fill) | x ≈ 33…795, y ≈ 528…600 | ширина ≈ **381**, высота визуально **≈ 36…40** (двухстрочная; внешний bbox с AA до ~54.5 по шуму JPEG) |
| Gap search → geo | y 504…524 | ≈ **10** px = **5** |
| Pinned / elevated list BG | до y ≈ 1218 | до ≈ **609** |
| Pure black list BG | y ≥ 1220 | ≥ **610** |
| TabBar glass (плотная заливка) | y 1624…1759 | top **812**, bot **879.5**, высота **≈ 67.5** |
| TabBar left edge | x ≈ 40 | inset **≈ 20** |
| TabBar ширина (без FAB) | ≈ x 40…640 | **≈ 300** |
| Gap TabBar → FAB | ≈ x 640…670 | **≈ 10…15** |
| Search FAB | max chord ≈ 111 px @ y 1632 | **Ø ≈ 55.5** |
| Home indicator | y ≈ 1785…1790, x ≈ 200…646 | ширина ≈ **223**, высота ≈ **2.5…3** |

Радиусы:
- Nav pills / search / geo / tab capsule — **stadium / pill** (`border-radius = height/2`).
- Search: R ≈ **21.75 pt** (полувысота 43.5/2).
- TabBar: R ≈ **33…34 pt** (полувысота ~67.5/2).
- FAB / аватары списка / story avatars — `border-radius: 50%`.
- Unread blue (1 цифра) — круг; muted `179` — горизонтальная капсула.

### Stories
| Параметр | pt |
|---|---|
| Avatar «Моя история» (без цветного кольца) | Ø **≈ 51.5** (max chord 103 px) |
| Ring outer (контакт с unseen) | Ø **≈ 54.5** (bbox ring ≈ 109×123 px — вертикаль чуть больше из-за сегментов/AA) |
| Gap ring → avatar | ≈ **2…3** |
| Ring stroke | ≈ **2…2.5** |
| Сегменты кольца | **4** равных дуги + тёмные прорези ≈ **1…1.5** |
| Plus на «Моя история» | Ø **≈ 15.5…17.5** (bbox 31×35 px), якорь **bottom-right** аватара |
| Подпись | под аватаром ≈ **4…6**, truncate ellipsis |
| Межайтемный шаг (центры) | ≈ **60…70** (горизонтальный скролл) |

### Ячейка чата
| Параметр | pt |
|---|---|
| Высота ряда | **76** (центры аватаров max-width: 341 → 493 → 645 → 721 → шаг 152 px = 76 pt) |
| Avatar | **Ø 60** (max chord 119 px ≈ 59.5) |
| Avatar left inset | **16** |
| Gap avatar → text | **≈ 12** → content start X ≈ **88** |
| Right inset (time / badge) | **≈ 16** |
| Title row | ≈ **20…22** |
| Snippet | до **2** строк, line-height ≈ **18…20** |
| Divider | **0.5** pt, старт X ≈ **88** (не под аватаром) |
| Pin icon | ≈ **14…16**, правый низ ячейки |
| Mute icon | ≈ **12…14**, сразу после title |
| Unread blue «1» | Ø **19.5** (39×39 px) |
| Unread muted «179» | высота ≈ **19…20**, ширина капсулы ≈ **22…28** |
| Photo thumb в сниппете | квадрат ≈ **18…20**, radius ≈ **3…4** |

### TabBar / FAB
| Параметр | pt |
|---|---|
| 4 равномерных слота | Контакты / Звонки / Чаты / Настройки |
| Active «Чаты» | иконка + label tint + мягкое светлое пятно за иконкой |
| Badge «52» | высота ≈ **16.5**, ширина капсулы ≈ **25** |
| Badge «!» (Настройки) | Ø ≈ **16.5** |
| FAB | Ø **≈ 55.5**, выровнен по вертикали с TabBar |
| Bottom float | низ капсулы ≈ **16.5** pt над низом экрана (875.5 → 896) |

## 4. Цвет
Семплы — композит JPEG на кадре (не «сырой» слой UIKit). Где уместно — оценка материала.

### Фоны / glass
| Роль | RGB / HEX | Примечание |
|---|---|---|
| Elevated list / chrome BG | `(28,28,30)` **`#1C1C1E`** | Stories, search gap, pinned rows |
| Unpinned list BG | `(0,0,0)` **`#000000`** | с y ≈ 1220 px |
| Nav pill fill (композит) | ≈ `#1F1F1F`…`#212121` | поверх `#1C1C1E`; rim светлее |
| Search fill | `(48…50,48…50,50…52)` **`#303032` / `#323234`**; mid с иконкой до `#414143` | glass mid-gray |
| Geo fill | `(31,31,31)` **`#1F1F1F`** | чуть светлее elevated BG |
| Geo top rim | `(45,45,47)` **`#2D2D2F`** | тонкая светлая кромка |
| TabBar / FAB fill на чёрном | `(22…24,22…24,22…24)` **`#161616`…`#181818`** | материал ≈ тёмный + alpha ~0.7–0.85 + blur |
| Tab top highlight | до `(53,53,53)` **`#353535`** на кромке | glass edge |
| Active tab glow (за иконкой) | `(56,58,62)` **`#383A3E`** | мягкое пятно |
| Island / TELEGRAM pill | `(107…116,158…166,232)` **`#6B9EE8`…`#74A6E8`** | системная синяя капсула |

### Текст / иконки
| Роль | HEX | Где |
|---|---|---|
| Primary | `#FFFFFF` | «Чаты», titles, sender names, nav «Изм.» (белый, не синий!), tab inactive |
| Secondary | ≈ `#8D8D8F`…`#8F8E91` (пик time `#9F9FA1`) | time/date, snippets, pin/mute, search «Поиск» ≈ `#8C8C8E` |
| Accent blue (active tab / unread) | композит иконки `#5485EB`…`#5884E3`; badge fill `#5182F1`…`#5481F4` | ближе к **`#007AFF` / `#0A84FF`** до JPEG |
| Story plus | avg `(101,141,221)` **`#658DDD`**, пик B до `#B6DFFF` | синий круг + белый `+` |
| Story ring | top ≈ `#74A087` / `#498A5E` (зелёный); side ≈ `#61B1AD`; bot ≈ `#4C78A9` | градиент green→teal→blue |
| Tab badge red | композит `#D65F50`…`#D36046` | истинный iOS red ≈ **`#FF3B30`** (JPEG приглушает) |
| Muted unread fill | `(73,73,73)` **`#494949`** | badge `179` / `1` у muted |
| Divider | ≈ `#2C2C2E`…`#404042` | hairline |

Оценка прозрачности glass (TabBar/FAB на `#000`): наблюдаемый L≈22–24 → при fill ≈ `#2C2C2E` alpha ≈ **0.75–0.85** + `backdrop-filter` blur (визуально **20–40 px** устройства, точно не измерить по статичному JPEG).

## 5. Типографика
Семейство: **SF Pro Text / Display** (системный iOS).

| Элемент | Size (pt) | Weight | Color | Дословный текст / notes |
|---|---|---|---|---|
| Status time | 15–16 | Semibold | white | `09:52` |
| Island label | 11–12 | Semibold | white | `TELEGRAM` |
| Battery % | 11–12 | Semibold | dark on yellow fill | `53` (Low Power Mode — жёлтая батарея) |
| Nav title | **17** | Semibold | `#FFF` | `Чаты` |
| Nav Edit | **17** | Regular | `#FFF` | `Изм.` (внутри glass-pill) |
| Story label | 11–12 | Regular | `#FFF` | `Моя история`, `Юлия Мор…`, `Новосиб М…`, `Ксения Ма…`, `Максим Ве…`, `Вик…` |
| Search placeholder | 17 | Regular | `#8C8C8E` | `Поиск` (центрирован с лупой) |
| Geo title | 15–16 | Semibold | `#FFF` | `Трансляция геопозиции` |
| Geo subtitle | 13–14 | Regular | secondary | `доступна для Моя ❤️` |
| Chat title | **17** | Semibold | `#FFF` | см. §8 |
| Sender in group | 15 | Regular | `#FFF` | напр. `Олег Сергеевич Асгарт Сервис`, `Елена Скрипник асгард`, `лиза Асгард` |
| Snippet | 15 | Regular | `#8F8E91` | 1–2 строки, ellipsis |
| Time / weekday | 14–15 | Regular | `#8D8D8F` | `09/17`, `вт`, `05/12`, `чт`, `09:45`, `09:32`, `09:19` |
| Unread digit | 12–13 | Semibold | white / light | `1`, `179`, `52` |
| Tab label | **10** | Medium | inactive white; active blue | `Контакты`, `Звонки`, `Чаты`, `Настройки` |

## 6. Иконки/контролы

### Status
- Location arrow (белый) справа от времени — активна трансляция гео.
- Capsule island: paper-plane + `TELEGRAM`.
- Signal bars + `LTE` + battery **53%** (жёлтый fill = Low Power Mode).

### Nav
- **Left pill:** текст `Изм.` (без иконки).
- **Right pill (cluster):**
  1. `plus` в **пунктирном/сегментированном** круге — новая история;
  2. `square.and.pencil` — новый чат/compose.
- Оба glyph **белые**, без синего tint (отличие от pre–Liquid Glass, где Edit был `#0A84FF`).

### Stories
- «Моя история»: аватар + синий круг `+` (белый плюс, тёмный кольцевой контур к аватару).
- Контакты: **4-сегментное** градиентное кольцо (unseen).

### Search / Geo
- Search: SF magnifyingglass + `Поиск`, **center** в капсуле.
- Geo: pin + radio-waves (broadcast); справа `xmark` dismiss.

### Chat row meta
- **Pin** (серый, ~45°) — у закреплённых.
- **Mute** (speaker.slash) — сразу после title.
- Media thumb перед сниппетом (`Фотография`, превью веб/дока).
- Unread: синий круг (unmuted) / серая капсула (muted).

### TabBar
| Tab | Иконка | State |
|---|---|---|
| Контакты | person.crop.circle | inactive white |
| Звонки | phone | inactive white |
| Чаты | bubble.left.and.bubble.right | **active blue** + glow + badge `52` |
| Настройки | gearshape | inactive white + badge `!` |

### FAB
- Круг glass = высота TabBar; glyph лупы белый; **без** badge на кадре.

## 7. Тени / бордеры / разделители
- **Hairline divider** между ячейками: 0.5 pt, `#2C2C2E`…`#404042`, inset слева ≈ 88 pt.
- **Glass rim:** у search / geo / tab / FAB / nav pills — светлая кромка 0.5–1 pt, white @ ~10–20% (на geo top семпл `#2D2D2F`).
- **TabBar / FAB:** мягкая внешняя тень вниз (композит на чёрном, без чёткого bbox); объём = rim + blur, не hard drop-shadow.
- **Story ring:** тёмные радиальные gaps между сегментами (цвет BG).
- **List avatar с story** (чат «Моя ❤️ 🍭»): сегментированное тёмно-серое кольцо вокруг аватара в списке.
- **Home indicator:** светло-серая капсула низкой контрастности на `#000`.

## 8. Состояния на кадре

### Global
- Tab **Чаты** active; live-location broadcast on (status arrow + geo banner).
- Low Power Mode (жёлтая батарея `53`).

### Stories
| Label | State |
|---|---|
| `Моя история` | add (`+`), без цветного ring |
| `Юлия Мор…` / `Новосиб М…` / `Ксения Ма…` / `Максим Ве…` / `Вик…` | unseen, 4-сегментный green→blue ring |

### Chat list (сверху вниз, дословно)
| # | Title | Time | Snippet / meta | Flags |
|---|---|---|---|---|
| 1 | `Анализ тендеров` | `09/17` | `Олег Сергеевич Асгарт Сервис` / `Поправлю` | **pinned** |
| 2 | `Моя ❤️ 🍭` | `вт` | thumb + `Фотография` | **pinned**; story-ring на аватаре списка |
| 3 | `Избранное` | `05/12` | `График_работ_КАО_Азот_Аммиак_2_н` / `а_12_мая_2026г.xlsx` | **pinned**; bookmark-avatar |
| 4 | `Офис АСГАРД-Сервис` | `чт` | `Елена Скрипник асгард` / `Уважаемые коллеги!просьба очень у…` | **pinned** + **muted** |
| 5 | `Московская Хроника` | `09:45` | `🙅‍♂️ «В какой-то момент кто-то всё затормозил» — глава Say Agency на…` | **muted** + unread **`179`** (gray) |
| 6 | `АСГАРД: Замена факельного о…` | `09:32` | `лиза Асгард` / `добрый день, коллеги раннюю оплату…` | unread **`1`** (blue) |
| 7 | `Тайпспейс Медиа` | `09:19` | thumb + `В России снова обсуждают плату за` | **muted** + unread **`1`** (gray) |

Переход pinned→unpinned совпадает со сменой BG `#1C1C1E` → `#000000` (~609 pt).

### Tab badges
- Чаты: красная капсула **`52`**.
- Настройки: красный круг **`!`** (не цифра `1` — подтверждено зум-кропом).

## 9. CSS-скелет (псевдо-классы .tg-*, width 414px)

```css
.tg-screen {
  width: 414px;
  height: 896px;
  position: relative;
  overflow: hidden;
  background: #000;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
}

.tg-screen-bg--elevated { background: #1c1c1e; }
.tg-screen-bg--oled { background: #000; }

.tg-status-bar {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  font-size: 15px;
  font-weight: 600;
}
.tg-status-bar__island {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #6b9ee8;
  font-size: 11px;
  letter-spacing: 0.02em;
}

.tg-nav-bar {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: rgba(28, 28, 30, 0.85);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}
.tg-nav-bar__title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 17px;
  font-weight: 600;
}
.tg-pill {
  height: 32px;
  padding: 0 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.08);
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 17px;
  display: inline-flex;
  align-items: center;
  gap: 14px;
}
.tg-pill--cluster { padding: 0 12px; min-width: 88px; justify-content: center; }

.tg-stories-row {
  display: flex;
  gap: 12px;
  padding: 8px 12px 10px;
  overflow-x: auto;
  background: #1c1c1e;
}
.tg-story {
  width: 66px;
  flex: 0 0 auto;
  text-align: center;
  font-size: 11px;
}
.tg-story__ring {
  width: 54px;
  height: 54px;
  margin: 0 auto 4px;
  border-radius: 50%;
  padding: 2px;
  background: conic-gradient(#34c759, #007aff, #34c759);
}
.tg-story__ring--segmented {
  /* 4 gaps via mask / stroke-dasharray */
}
.tg-story__avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: #000;
  object-fit: cover;
}
.tg-story__add {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #007aff;
  border: 2px solid #1c1c1e;
  color: #fff;
}

.tg-search {
  margin: 0 16px;
  height: 44px;
  border-radius: 22px;
  background: #323234;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #8c8c8e;
  font-size: 17px;
  border: 0.5px solid rgba(255, 255, 255, 0.06);
}

.tg-geo-banner {
  margin: 5px 16px 8px;
  min-height: 40px;
  border-radius: 20px;
  background: rgba(31, 31, 31, 0.92);
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  padding: 8px 14px;
  gap: 10px;
  backdrop-filter: blur(20px);
}
.tg-geo-banner__title { font-size: 15px; font-weight: 600; color: #fff; }
.tg-geo-banner__sub { font-size: 13px; color: #8e8e93; }

.tg-chat-list { background: #1c1c1e; }
.tg-chat-list--unpinned { background: #000; }

.tg-chat-item {
  height: 76px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;
  position: relative;
}
.tg-chat-item::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  left: 88px;
  height: 0.5px;
  background: #38383a;
}
.tg-chat-item__avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  flex: 0 0 auto;
  object-fit: cover;
}
.tg-chat-item__body { flex: 1; min-width: 0; }
.tg-chat-item__title {
  font-size: 17px;
  font-weight: 600;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 4px;
}
.tg-chat-item__sender { font-size: 15px; color: #fff; }
.tg-chat-item__snippet {
  font-size: 15px;
  color: #8e8e93;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tg-chat-item__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex: 0 0 auto;
}
.tg-chat-item__time { font-size: 14px; color: #8e8e93; }
.tg-badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}
.tg-badge--unread { background: #007aff; }
.tg-badge--muted { background: #494949; color: #ebebf5; }
.tg-icon--pin,
.tg-icon--mute { color: #8e8e93; width: 14px; height: 14px; }

.tg-dock {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  pointer-events: none;
}
.tg-tab-bar {
  pointer-events: auto;
  width: 300px;
  height: 68px;
  border-radius: 34px;
  background: rgba(24, 24, 24, 0.82);
  backdrop-filter: blur(32px);
  -webkit-backdrop-filter: blur(32px);
  border: 0.5px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 0 8px;
}
.tg-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  color: #fff;
  font-size: 10px;
  font-weight: 500;
  min-width: 56px;
}
.tg-tab--active { color: #007aff; }
.tg-tab--active .tg-tab__glow {
  position: absolute;
  top: 2px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(80, 90, 110, 0.55), transparent 70%);
  z-index: -1;
}
.tg-tab__badge {
  position: absolute;
  top: -2px;
  right: 8px;
  background: #ff3b30;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tg-search-fab {
  pointer-events: auto;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(24, 24, 24, 0.82);
  backdrop-filter: blur(32px);
  -webkit-backdrop-filter: blur(32px);
  border: 0.5px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.tg-home-indicator {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 134px;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.28);
}
```

## 10. Неуверенности
1. **Blur radius** Liquid Glass (TabBar / FAB / nav / geo): по JPEG только косвенно (сглаживание кромок); оценка **20–40 px** device — не сертифицирована.
2. **Истинный alpha** стекла: композит на `#000` даёт L≈22–24; alpha **0.75–0.85** при fill `#2C2C2E` — модель, не layer dump.
3. **Высота geo-баннера:** визуально ~36–40 pt (две строки); автоматический fill-bbox раздут AA/JPEG до ~54.5 pt — в вёрстке ориентироваться на визуал + padding.
4. **Search height 43.5 pt** по внешнему bbox — возможно +rim/AA; визуально ближе к **36–40 pt** stadium.
5. **Story ring diameter:** горизонталь 54.5 pt, вертикальный bbox больше из-за сегментов — центр кольца уточнять по mid-chord.
6. **Красный badge:** композит `#D65F50` ≠ системный `#FF3B30` из-за JPEG chroma; для UI брать system red.
7. **Синий unread / active tab:** семплы `#5182F1`…`#5485EB` — после сжатия; канон dark iOS ≈ `#0A84FF` / Telegram accent.
8. **Аватар «Тайпспейс»:** на кропе похож на squircle; в остальных рядах — круг. Возможно маска канала vs JPEG.
9. **Точный текст сниппетов** с ellipsis восстановлен по видимым глифам кропов; хвост за `…` на кадре не читается.
10. Переход `#1C1C1E`→`#000` трактован как pinned elevated vs unpinned OLED; альтернатива — артефакт секции/скролла, но левый край стабильно чёрный ниже y 1220.
