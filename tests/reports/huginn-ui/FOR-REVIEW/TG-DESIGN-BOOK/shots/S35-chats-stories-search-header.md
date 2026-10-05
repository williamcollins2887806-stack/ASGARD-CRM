# S35 — chats-stories-search-header

## 1. Мета
Источник 828×525 px, база 414 pt @2x, pt = px/2.

- **Приложение:** Telegram iOS (русский UI).
- **Экран:** список чатов («Чаты») — верхний chrome: StatusBar + Nav + Stories + Search.
- **Тема:** Dark / Liquid Glass (iOS 26-style), фон не pure black, а системный `#1C1C1E`.
- **Ориентация:** портрет.
- **Файл-референс:** `REFS/S35.jpg` (кроп **верхней** части экрана до поисковой строки; низ списка чатов / TabBar обрезаны). Логическая высота кропа **262.5 pt** из полного ~896 pt.
- **Системное время:** `09:52`.
- **Сеть / батарея:** LTE; сигнал ~2/4; батарея **52%** в режиме энергосбережения (жёлтый fill).
- **Тексты на кадре (дословно):** `09:52`, `TELEGRAM`, `LTE`, `52`, `Изм.`, `Чаты`, `Моя история`, `Юлия Мор…`, `Новосиб М…`, `Ксения Ма…`, `Максим Ве…`, `Поиск`.

## 2. Иерархия слоёв
Z от дальнего к ближнему:

1. **`.tg-screen-bg`** — сплошной тёмный холст `#1C1C1E` (без видимого градиента на кропе).
2. **`.tg-stories-row`** — горизонтальный ряд аватаров + подписи (скролл-контент под nav).
3. **`.tg-search-wrap`** — поисковая капсула под историями (idle, контент по центру).
4. **`.tg-nav-bar`** — зона заголовка: glass-pills `Изм.` / cluster compose; title `Чаты` по центру. На однотонном фоне blur читается как плотный `#1F1F1F` + тонкий rim-highlight.
5. **`.tg-status-bar`** — системный слой: время + location, синяя капсула `TELEGRAM`, LTE + battery.

На кропе **нет** списка ячеек чатов, TabBar и home indicator.

## 3. Геометрия
Все значения — **логические pt** (кадр @2x ⇒ pt = px/2), если не указано иное. Пиксели оригинала в скобках где полезно.

### Экран / вертикальный ритм
| Элемент | Значение |
|---|---|
| Ширина | **414 pt** (828 px) |
| Высота кропа | **262.5 pt** (525 px) |
| Status content band | ≈ **5–27 pt** (синяя pill y≈5–26.5) |
| Nav pills vertical | top rim ≈ **58 pt**, bottom ≈ **94–97 pt**, высота fill ≈ **36–39 pt** |
| Title / «Изм.» glyph box | y **74.0–85.5 pt** (высота глифа **11.5 pt**) |
| Stories outer circles | y ≈ **115–176.5 pt** (центры y ≈ **145.75 pt**) |
| Story labels | y ≈ **184–193.5 pt** (glyph h ≈ **9–10 pt**) |
| Gap labels → search | ≈ **16 pt** |
| Search bar | top ≈ **208 pt**, bottom ≈ **251.5 pt**, h ≈ **44 pt** |

### StatusBar
| Элемент | Значение |
|---|---|
| Время `09:52` | left inset ≈ **20–22 pt**; glyph h ≈ **8–9 pt** → визуально **15–16 pt** Semibold |
| Location arrow | сразу справа от времени, ≈ **10–12 pt**, белый filled |
| Синяя pill `TELEGRAM` | bbox ≈ **x 161–252.5 pt**, **y 5–26.5 pt** → **w 92 pt × h 22 pt**; `border-radius: 11 pt` (stadium) |
| Pill content | слева paper-plane logo ≈ **12–14 pt**; gap ≈ **6–8 pt**; текст UPPERCASE |
| Right cluster | signal (4 bars) + `LTE` + battery capsule; right inset ≈ **16–20 pt** |
| Battery body | horizontal pill + terminal; fill ≈ 52% ширины; digit `52` по центру |

### Navigation
| Элемент | Значение |
|---|---|
| Left pill `Изм.` | ≈ **x 19.5–76 pt**, **y 58–97 pt** → **w ≈ 56.5 pt × h ≈ 36–39 pt**; `border-radius: 18–19.5 pt` (stadium) |
| Title `Чаты` | центр по X; glyph box ≈ **x 187–226.5 pt**, **y 74–85.5 pt** |
| Right dual-pill | ≈ **x 311–397.5 pt**, та же высота ≈ **36–39 pt** → **w ≈ 86.5 pt**; stadium |
| Right icons | два контрола в одной капсуле; центры ≈ **327.75 pt** и **375.75 pt**; gap центров **48 pt** |
| Story+ glyph bbox | ≈ **16.5–18.5 pt** (круг с пунктиром справа + «+») |
| Compose glyph bbox | ≈ **18.5 × 18.5 pt** (rounded-square + pencil) |
| H insets chrome | left pill left-edge ≈ **16–20 pt**; right pill right-edge ≈ **16–17 pt** до края экрана |

### Stories
| Параметр | Значение |
|---|---|
| Outer Ø (с кольцом) | **62 pt** (124 px) |
| Avatar inner Ø (под кольцом) | ≈ **53 pt** (фото до тёмного gap) |
| Gap avatar ↔ ring | ≈ **1.0–1.5 pt** тёмный knockout (`#141215`) |
| Ring stroke | ≈ **3.5–4.0 pt** |
| Segment gaps | 4 разрыва примерно на 12/3/6/9 часов; ширина gap ≈ **2–3 pt** |
| Centers X (pt) | **Моя 42** · **Юлия 116** · **Новосиб 190** · **Ксения 264** · **Максим 338** · (крайний partial ≈ **397**) |
| Pitch (центр→центр) | **74 pt** (кроме последнего обрезанного) |
| My-story badge `+` | Ø ≈ **16 pt** (синий круг); сидит на нижнем-правом краю аватара; тёмный ring-knockout цвета фона ≈ **2 pt** |
| Label width | ≤ ≈ **70–74 pt**, truncate `…`, center under avatar |
| Label gap under outer circle | ≈ **8–10 pt** |

### Search
| Параметр | Значение |
|---|---|
| Bar | **x 16–397.5 pt**, **y 208–251.5 pt** |
| Width | **381.5 pt** (= 414 − 2×16.25) |
| Height | **44 pt** |
| Corner radius | ≈ **22 pt** (почти полный stadium: R ≈ H/2) |
| Placeholder group | лупа + `Поиск` **по центру** бара (idle) |
| Loupe | ≈ **14–16 pt**, stroke ≈ **1.5–2 pt** |
| Gap loupe → text | ≈ **5–7 pt** |

## 4. Цвет
Замеры Pillow по оригиналу (JPEG → оттенки слегка сдвинуты; где явно артефакт — помечено).

| Роль | HEX / RGBA (замер) | Где |
|---|---|---|
| Screen BG | `#1C1C1E` | холст, промежутки |
| Nav / pill fill | `#1F1F1F` | `Изм.`, right cluster (плотный glass over dark) |
| Pill rim highlight | `#3E3E40` … `#444446` (AA) | тонкая светлая кромка капсул |
| Primary text | `#FFFFFF` / `#EFEFF0` | `Чаты`, `Изм.`, story labels, status time |
| Secondary / placeholder | `#8A8A8C` … `#919193` (≈ system `#8E8E93`) | лупа + `Поиск` |
| Search field fill | `#323234` | idle search capsule |
| TELEGRAM pill core | `#4E81D6` … `#3578F1` (верх/низ ярче, середина мягче — glass volume) | status center pill |
| TELEGRAM pill edge AA | `#86AEE8`, `#6499E8` | боковые кромки |
| Story ring green/teal | avg bright `#70B495`; samples `#6BBB8F`, `#68B48A`, `#6FB394` | верх/лево кольца |
| Story ring blue | avg bright `#69A3CD`; samples `#65A2CE`, `#6B9FD9`, `#5E9DE4` | низ/право кольца |
| Ring conic intent | green/mint → teal → blue (угловой градиент по окружности) | unread stories |
| My-story `+` badge | `#5984D9` … `#799FE4` (центр темнее края; цель ≈ `#0A84FF`/`#007AFF`) | add-story |
| Battery Low Power fill | замер JPEG `#988239`/`#B7A04A` → канон iOS **`#FFD60A`** | battery 52% |
| Battery digit | тёмный (замер смешанный с fill); визуально **чёрный** на жёлтом | `52` |
| Inactive signal bars | тёмно-серый ≈ `#3A3A3C`/`#48484A` | 3–4 bars |
| Active signal / LTE | `#FFFFFF` | bars 1–2, текст `LTE` |

**Прозрачность / затемнение:** на кропе под glass нет пёстрого контента — `backdrop-filter` не доказан пиксельно; капсулы выглядят как почти непрозрачный material `#1F1F1F` (+ ~1–2% whiten vs `#1C1C1E`) с rim specular. Search `#323234` ≈ +8–10 brightness steps над фоном.

## 5. Типографика
Семейство: **SF Pro Text / Display** (системный iOS).

| Элемент | Size (оценка) | Weight | Color | Notes |
|---|---|---|---|---|
| Status time `09:52` | **15–16 pt** | Semibold | `#FFFFFF` | glyph h≈8–9 pt |
| Status `TELEGRAM` | **11–12 pt** | Bold / Semibold | `#FFFFFF` | ALL CAPS, tracking плотный |
| Status `LTE` | **12 pt** | Semibold | `#FFFFFF` | |
| Battery `52` | **10–11 pt** | Semibold/Bold | `#000000` | внутри battery |
| Nav `Изм.` | **17 pt** | Regular/Medium | `#FFFFFF` | не accent-blue (в отличие от старых тем) |
| Nav title `Чаты` | **17 pt** | Semibold/Bold | `#FFFFFF` | glyph h 11.5 pt ≈ 0.68×17 |
| Story labels | **12–13 pt** | Regular | `#EDEDEE`–`#EFEFF0` | 1 line, truncate `…` |
| Search `Поиск` | **17 pt** | Regular | `#8A8A8C` | tracking ≈ −0.4 pt |

Дословные строки подписей историй: `Моя история`, `Юлия Мор…`, `Новосиб М…`, `Ксения Ма…`, `Максим Ве…`.

## 6. Иконки/контролы

### Status
- **Location services:** filled arrowhead↗, белый, рядом с временем.
- **TELEGRAM pill:** white paper-plane (логотип) + label; форма — системная/Live-Activity-like капсула поверх Dynamic Island зоны.
- **Cellular:** 4 вертикальных бара возрастающей высоты; активны ≈2.
- **Battery:** capsule + tip; Low Power Mode (жёлтый); процент внутри.

### Nav
- **`Изм.`:** текстовая кнопка в glass-stadium (режим редактирования списка).
- **Story create (левая в dual-pill):** окружность outline; правая дуга **пунктир/сегменты** (3 штриха) — «добавить историю»; внутри «+».
- **Compose (правая в dual-pill):** rounded-square outline + диагональный pencil; угол квадрата разомкнут под грифель; tip — точка.

### Stories
- **Моя история:** круглый аватар **без** gradient-ring; badge `+` (синий круг, белый плюс, тёмный separator от фото).
- **Чужие:** avatar + **4-сегментное** conic ring (unread); gaps knockout в цвет фона.
- Горизонтальный scroll; последний аватар обрезан правым краем.

### Search
- SF Symbol-like **`magnifyingglass`**, цвет placeholder.
- Idle: группа центрирована; курсора нет; кнопки «Отмена» нет.

## 7. Тени / бордеры / разделители
- **Hairline-разделителей** между stories и search / nav **не видно** — ритм только отступами и tonal shift.
- **Glass pills (Изм. / dual):** тонкий светлый rim (AA, 0.5–1 px @2x) ≈ `rgba(255,255,255,0.08–0.18)` поверх `#1F1F1F`; отдельной drop-shadow маски в пикселях почти нет (возможен мягкий contact shadow <2 pt, JPEG съедает).
- **TELEGRAM pill:** объём за счёт вертикального градиента синего (верх/низ `#3578F1`, середина мягче) — «стеклянная линза», не flat fill.
- **Story rings:** stroke без внешней тени; внутренний dark gap отделяет фото от градиента.
- **Search:** без бордера; края = AA скругления stadium; тени нет.
- **My-story badge:** обязательный dark halo/border цвета `#1C1C1E`, чтобы плюс не сливался с фото.

## 8. Состояния на кадре
| Зона | Состояние |
|---|---|
| Список чатов | не виден (обрезан) |
| Nav | idle; не Edit-mode (кнопка ещё показывает `Изм.`) |
| Stories «Моя» | нет своей активной story-кольца; доступен add (`+`) |
| Stories контактов | **unread** (цветные сегментированные кольца), ≥4 сегмента у первого контакта |
| Search | **idle / unfocused** — placeholder по центру |
| Status network | LTE, сигнал частичный |
| Battery | **Low Power Mode**, 52% |
| Location | сервисы геолокации активны (стрелка у времени) |

## 9. CSS-скелет (псевдо-классы .tg-*)
```css
.tg-screen-bg {
  background: #1C1C1E;
  color: #FFFFFF;
  font-family: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
}

.tg-status-bar {
  height: 54px; /* ~27pt content + safe */
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16pt;
}

.tg-status-telegram-pill {
  height: 22pt;
  min-width: 92pt;
  padding: 0 10pt;
  border-radius: 11pt;
  background: linear-gradient(180deg, #3578F1 0%, #4E81D6 45%, #3578F3 100%);
  display: inline-flex;
  align-items: center;
  gap: 6pt;
  color: #FFF;
  font-size: 11.5pt;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.tg-nav-bar {
  height: 44pt;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16pt;
  position: relative;
}

.tg-nav-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 17pt;
  font-weight: 600;
  color: #FFF;
}

.tg-glass-pill {
  height: 36pt;
  padding: 0 14pt;
  border-radius: 18pt;
  background: #1F1F1F;
  box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.12);
  /* backdrop-filter: blur(24px) saturate(140%); — на пёстром скролле */
  color: #FFF;
  font-size: 17pt;
}

.tg-glass-pill--cluster {
  width: 86.5pt;
  padding: 0 12pt;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0; /* иконки с центрами ~48pt apart */
}

.tg-stories-row {
  display: flex;
  gap: 0;
  padding: 8pt 12pt 0;
  overflow-x: auto;
}

.tg-story {
  width: 74pt; /* pitch */
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.tg-story-ring {
  width: 62pt;
  height: 62pt;
  border-radius: 50%;
  padding: 3.5pt; /* stroke */
  background: conic-gradient(
    from 0deg,
    #69A3CD,
    #70B495,
    #6BBB8F,
    #69A3CD
  );
  /* mask gaps at 0/90/180/270 for N segments */
}

.tg-story-avatar {
  width: 53pt;
  height: 53pt;
  border-radius: 50%;
  box-shadow: 0 0 0 1.25pt #1C1C1E; /* gap */
  object-fit: cover;
}

.tg-story-add {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16pt;
  height: 16pt;
  border-radius: 50%;
  background: #0A84FF;
  border: 2pt solid #1C1C1E;
  color: #FFF;
}

.tg-story-label {
  margin-top: 8pt;
  max-width: 70pt;
  font-size: 12.5pt;
  color: #EFEFF0;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tg-search-wrap {
  padding: 16pt 16pt 0;
}

.tg-search-bar {
  height: 44pt;
  border-radius: 22pt;
  background: #323234;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6pt;
  color: #8E8E93;
  font-size: 17pt;
}

.tg-search-bar__icon {
  width: 16pt;
  height: 16pt;
  opacity: 0.95;
}
```

## 10. Неуверенности
1. **Точная высота nav-pill:** fill-core стабилен ≈36 pt, но AA/rim и возможный soft-shadow дают разброс **36–39 pt** на разных X-срезах.
2. **`backdrop-filter` / alpha glass:** на равномерном `#1C1C1E` нельзя отделить blur от opaque `#1F1F1F`; значение blur/saturate — гипотеза Liquid Glass, не замер.
3. **Search height 44 pt** заметно выше канона iOS 36 pt (как в S12); на кадре пиксельный bbox устойчив (y 416–503). Возможно специфика iOS 26 chat-list / JPEG-ореол ±1–2 pt.
4. **Жёлтый батареи** в JPEG уходит в `#988239`/`#B7A04A`; канонический Low Power `#FFD60A` нужно брать из UIKit, не из кадра.
5. **Синий badge / TELEGRAM pill:** JPEG сдвигает к более бледному `#5984D9`/`#4E81D6`; истинный brand/system blue может быть ближе к `#007AFF` / `#0A84FF` / `#3390EC`.
6. **Число сегментов кольца** у всех контактов: у «Юлия» уверенно 4; у остальных на кадре похоже, но gap’ы на мелком масштабе частично сливаются с AA.
7. **Пользовательская пометка «кроп нижней части»** в запросе не совпадает с содержимым кадра (это верх: status→search); в мета зафиксирован факт по пикселям.
8. **Тень dual-pill:** в vision-кропе предполагается soft drop shadow; на полном кадре контраст тени < шума JPEG — сила/радиус не сертифицированы.
