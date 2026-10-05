# S37 — chats-stories-liquid-glass

## 1. Мета
Источник 828×1792 px, база 414 pt @2x, pt = px/2.

- **Приложение:** Telegram iOS, тёмная тема **Liquid Glass** (iOS 26-стиль).
- **Экран:** главный список чатов (вкладка «Чаты» активна).
- **Файл-референс:** `REFS/S37.jpg`.
- **Ориентация:** портрет.
- **StatusBar (дословно):** время `09:52` + иконка активной геолокации (стрелка); справа сотовые полоски + `LTE` + батарея **`53`** с **жёлтым** fill (Low Power Mode).
- **Nav (дословно):** слева pill `Изм.`; центр `Чаты`; справа объединённая pill: dashed-circle `+` + compose (квадрат с карандашом).
- **Stories labels (дословно, L→R):** `Моя история`, `Юлия Мор...`, `Новосиб М...`, `Ксения Ма...`, `Максим Ве...`, `Ви...` (край обрезан).
- **Search placeholder (дословно):** `Поиск`.
- **Tab labels (дословно):** `Контакты` · `Звонки` · `Чаты` · `Настройки`.
- **Отличие от S01:** Liquid Glass floating chrome (nav pills + tab island + FAB), ряд Stories, search-капсула под stories; фон chrome `#1C1C1E`, под floating-баром проступает true black `#000000`.

## 2. Иерархия слоёв
Z от дальнего к ближнему:

1. **`.tg-screen-bg`** — базовый фон: в зоне списка/верхнего chrome медиана **`#1C1C1E`**; в просвете под floating tab/FAB — **`#000000`**.
2. **`.tg-chat-list`** — вертикальный скролл ячеек чатов + hairline-разделители; низ уходит **под** glass tab/FAB.
3. **`.tg-stories-row`** — горизонтальный скролл аватаров + подписи; между nav и search.
4. **`.tg-search-bar`** — stadium-капсула `Поиск` (inactive).
5. **`.tg-nav-bar`** — title `Чаты` + glass-pills `Изм.` / right-actions (поверх stories при скролле обычно sticky; на кадре scroll≈0).
6. **`.tg-tab-island`** — нижняя floating glass-капсула с 4 табами + blur контента списка.
7. **`.tg-fab-search`** — отдельный круглый glass-FAB с лупой справа от island.
8. **`.tg-status-bar`** + home-indicator зона — системный слой поверх всего.

## 3. Геометрия
Все значения — **логические pt** (кадр @2x ⇒ pt = px/2), если не указано иное. Замеры Pillow по оригиналу 828×1792.

### Экран / chrome
| Элемент | Значение (замер) |
|---|---|
| Ширина / высота | **414 × 896 pt** |
| Status content Y | текст времени ≈ **19.0–29.5 pt** |
| Nav content Y | текст `Изм.` / `Чаты` ≈ **74–84.5 pt** |
| Home / bottom safe | tab bottom inset ≈ **20 pt** до низа кадра; home-indicator на кадре почти не читается (чёрный фон) |

### Navigation Liquid Glass pills
| Элемент | Значение |
|---|---|
| `Изм.` glass AABB | x ≈ **19.5–69.5**, y ≈ **67–88.5**, **w ≈ 50**, **h ≈ 21.5** → stadium radius ≈ **10.5–11 pt** |
| `Изм.` text | x ≈ **29.5–60**, y ≈ **74–82** |
| Right actions glass | x ≈ **320–409.5**, y ≈ **60–87**, **w ≈ 89.5**, **h ≈ 27** → radius ≈ **13.5 pt** |
| Right icons bbox | x ≈ **325–386**, y ≈ **69.5–84.5** (два глифа в одной pill, gap ≈ 10–14 pt) |
| Title `Чаты` | центр экрана, glyph bbox ≈ x **186.5–226.5**, y **74–84.5**, h глифа ≈ **10.5** (полный cap-height с AA) |

### Stories
| Параметр | Значение |
|---|---|
| Полоса контента (аватар+кольцо) | y ≈ **115–170 pt** (яркие кольца/фото) |
| Подписи | y ≈ **185–191 pt** (белые глифы; mid sample `#EAEAEC`/`#FFFFFF`) |
| My story avatar (фото, экватор) | Ø ≈ **51–52 pt** (max width ≈ 51.5 pt @ y≈141–150) |
| My story left inset | ≈ **16 pt** (x0≈32 px) |
| Чужие story outer ring bbox | Ø ≈ **54.5 pt** (chroma-кольцо), шаг центров ≈ **65–70 pt** |
| Ring stroke | ≈ **2–2.5 pt**; gap avatar↔ring ≈ **1.5–2.5 pt**; **4 сегмента** с разрывами на 12/3/6/9 часов |
| Plus-badge «Моя история» | AABB ≈ **15.5 × 25.5 pt** (замер по синим пикселям, с AA; визуальный диск ≈ **18–20 pt**), якорь bottom-right аватара |
| Видимо в viewport | ≈ **5.5** аватара (6-й обрезан) |

### Search bar
| Параметр | Значение |
|---|---|
| Y AABB (luminance band) | **208.0 – 252.0 pt** (px 416–504) |
| Высота AABB | **44 pt** (включая AA-кромку stadium; визуальная «тело» ≈ **36–40 pt**) |
| H-inset на mid | ≈ **16–18 pt** (edge_x mid ≈ 32–33 px → 16–16.5 pt) |
| Ширина mid | ≈ **380–381 pt** |
| Форма | **stadium** (radius = h/2 ≈ **18–22 pt** в зависимости от того, брать visual-h или AABB-h) |
| Контент | лупа + `Поиск` **строго по центру** капсулы (не left-aligned) |
| Gap stories-labels → search | ≈ **16–18 pt** (конец белых глифов ~191.5 → старт fill 208) |

> **Важно (пиксели):** между stories и первой ячейкой чата на кадре есть **ровно одна** elevated-капсула. Left/right icon-zones в ней = 0 ярких пикселей; только центральный серый текст → это **search**, не geo-banner. См. §10.

### Chat row
| Параметр | Значение |
|---|---|
| Row pitch (по центрам ярких аватаров) | **76 pt** (подтверждено: 152 px между соседними cy) |
| Avatar | Ø ≈ **59.5–60.5 pt**, left inset ≈ **15.5–16 pt** |
| Gap avatar → text | ≈ **10–12 pt** → content start X ≈ **86–88 pt** |
| Divider | hairline **0.5–1 px** (@2x), цвет ≈ `#2C2C2C`; inset-left от текста (~88 pt) |
| Time / pin column | правый край, inset ≈ **12–16 pt** |
| Unread badge | высота ≈ **18–22 pt**, min-width ≈ **18–22 pt**, radius ≈ половина высоты; H-padding для «179» |

### Bottom tab island + FAB
| Параметр | Значение (y≈1660–1680 px / 830–840 pt) |
|---|---|
| Island x0 | ≈ **20–22.5 pt** |
| Island width | ≈ **295–300.5 pt** |
| Island height (luminance run) | ≈ **63.5 pt** (y≈812–875.5; включает AA/blur ореол) |
| Visual capsule height | ≈ **56–62 pt** |
| Corner radius | ≈ **половина высоты** (stadium) |
| Bottom inset | ≈ **20 pt** |
| FAB diameter | ≈ **58–64 pt** (на mid-y остров шире из-за blur) |
| FAB right inset | ≈ **19.5–22.5 pt** |
| Gap island → FAB | ≈ **9.5–15.5 pt** |
| 4 таба | равномерно внутри island; active `Чаты` = 3-й |

## 4. Цвет
Замеры — медиана/среднее по оригиналу JPEG (с учётом компрессии оттенки «белого» часто `#F0–F7`, не чистый `#FFFFFF`).

| Роль | HEX (замер) | Где / заметки |
|---|---|---|
| Screen BG (list/chrome) | `#1C1C1E` | медиана полей списка, nav, stories gap |
| Screen BG (under float) | `#000000` | просвет слева/между tab и FAB |
| Search fill | `#303032`…`#323234` | mid капсулы; кромка AA чуть темнее |
| Search placeholder / icon | `#838385`…`#8E8E90` | `Поиск` + лупа (до autocontrast) |
| Nav / FAB glass fill | `#1F1F1F`…`#212121` (nav pills); tab/FAB mid `#171717`…`#181818` | полупрозрачный материал на чёрном → эти opaque-эквиваленты |
| Primary text | `#F1F1F1`…`#F7F7F8` | имена чатов, `Чаты`, `Изм.` |
| Secondary text | `#838383`…`#878789` | сниппеты, время, mute |
| Story labels | `#FFFFFF` / `#EAEAEC` | под аватарами |
| Story ring (green top) | ≈ `#6EB690`…`#71B392` | верх сегментов |
| Story ring (cyan/teal) | ≈ `#73A89C`…`#7AAFE3` | бок/низ; градиент green→blue |
| Plus badge blue | ≈ `#5578BB`…`#748DB1` (JPEG); целевой system ≈ `#007AFF` | `+` на «Моя история» |
| Active tab blue | ≈ `#587EE9`…`#6183C7` | иконка+лейбл `Чаты` |
| Unread muted badge | ≈ `#424244`…`#4C4C4E` | «179», «1» на muted |
| Unread active badge | ≈ `#5075BE`…`#5276BF` | «1» на unmuted (JPEG→синий размыт) |
| Tab badge red | ≈ `#C96556`…`#D9544D` (JPEG); целевой ≈ `#FF3B30` | «52» на Чаты; `!` на Настройки |
| Battery Low Power | ≈ `#9B8744`…`#E6D961` | жёлтый fill + чёрные цифры `53` |
| Pin icon | ≈ `#676767` | thumbtack |
| Divider | `#2C2C2C` | hairline между ячейками |
| Tab rim (верх капсулы) | top `#111111` vs mid `#171717` | слабый rim/градиент стекла (не яркий hairline) |

**Прозрачность / материал:** nav pills, search, tab island, FAB — Liquid Glass: `backdrop-filter: blur(≈20–40px)` + fill `rgba(28,28,30, 0.55–0.85)` (точные alpha по JPEG не восстановить; opaque-эквиваленты выше). Список чатов под tab читается, но сильно затемнён/размыт.

## 5. Типографика
Семейство: **SF Pro Text / SF Pro Display** (системный iOS).

| Элемент | Size (оценка) | Weight | Color | Notes |
|---|---|---|---|---|
| Status time `09:52` | 15–16 pt | Semibold | primary white | + location arrow |
| Nav `Изм.` | 15–17 pt | Regular/Medium | `#FFFFFF` | внутри glass pill |
| Nav `Чаты` | 17 pt | Semibold/Bold | `#FFFFFF` | центр |
| Story label | 11–12 pt | Regular | `#FFFFFF` | truncate `…`, center under avatar |
| Search `Поиск` | 17 pt | Regular | `#8E8E93`-класс | + SF Symbol `magnifyingglass`, centered group |
| Chat title | 16–17 pt | Semibold | primary | tracking слегка отрицательный |
| Snippet / sender | 15 pt | Regular | secondary; sender в группе может быть светлее | до 2 строк |
| Time / date | 14–15 pt | Regular | secondary | `09/17`, `вт`, `чт`, `09:45`… |
| Tab label | 10 pt | Regular/Medium | inactive white; active blue | |
| Badge digit | 12–13 pt | Semibold | white on blue/red; white/light on gray | |

### Тексты чатов на кадре (дословно, сверху вниз)
1. **Анализ тендеров** — `Олег Сергеевич Асгарт Сервис` / `Поправлю` — `09/17` — pin  
2. **Моя❤️ 🍭** — `📷`/`превью` + `Фотография` — `вт` — pin  
3. **Избранное** — имя файла `.xlsx` — `05/12` — pin  
4. **Офис АСГАРД-Сервис** — mute — `Елена Скрипник…` — `чт` — pin  
5. **Московская Хроника** — mute — цитата/`«В какой-то момент…` — `09:45` — badge **`179`** (muted gray)  
6. **АСГАРД: Замена факельного о…** — `лиза Асгард…` — `09:32` — badge **`1`** (blue)  
7. **Тайпспейс Медиа** — mute — `В России снова обсуждают плату за…` — `09:19` — badge **`1`** (muted gray)  
8. (под blur) фрагменты про VPN / `Минциф…`, badge **`80`**

## 6. Иконки/контролы

### Status
- Location arrow (filled) справа от времени — индикатор активной трансляции геопозиции на уровне системы.
- Signal bars + `LTE`.
- Battery outline, **yellow fill**, glyph **`53`** чёрным.

### Nav
- **Left:** text-only `Изм.` в glass stadium.
- **Right cluster (одна pill):**
  1. `+` в круге с **пунктирной/сегментированной** обводкой (add story / new).
  2. Compose: rounded-rect + diagonal pencil.
- Оба глифа **белые**, stroke thin (~1.5–2 px @2x).

### Stories
- Plus badge: синий диск + белый `+`.
- Unread rings: segmented gradient green→cyan→blue.
- Read/absent: без цветного кольца (на кадре почти все с кольцом, кроме «Моя история»).

### Search
- SF `magnifyingglass` + `Поиск`, группа centered.

### Chat row accessories
- **Pin:** наклонённая thumbtack, secondary gray (у закреплённых).
- **Mute:** speaker with slash рядом с title (`Офис…`, `Московская Хроника`, `Тайпспейс Медиа`).
- **Unread badges:** pill/circle; muted = gray fill; unmuted = blue fill.
- Media thumb в сниппете (фото у `Моя❤️`).

### Tab bar
- Контакты: person-in-circle.
- Звонки: phone handset.
- Чаты (active): overlapping bubbles, **blue** + soft circular highlight plate за иконкой.
- Настройки: gear.
- Badge **`52`** (red pill) на Чаты; badge **`!`** (red circle) на Настройки.
- FAB: white magnifying glass, отдельный круг.

## 7. Тени / бордеры / разделители
- **Chat dividers:** hairline `#2C2C2C`, inset от текста; без full-bleed.
- **Nav / search / tab:** без жёсткого 1px stroke; край = контраст fill↔bg + лёгкий AA. У tab top rim чуть темнее mid (`#111` vs `#171`) — намёк на glass edge, не яркий highlight.
- **Story rings:** цветной stroke = основной «бордер» аватара.
- **Floating chrome shadow:** очень мягкая наружная тень/ореол (blur), численно по JPEG слабая; визуально отделяет island/FAB от `#000`.
- **Search:** тени нет; глубина только за счёт fill `#323234` на `#1C1C1E`.

## 8. Состояния на кадре
| Состояние | Доказательство |
|---|---|
| Tab **Чаты** active | blue icon+label; soft plate; red `52` |
| Tab **Настройки** alert | red `!` |
| Search **inactive** | centered placeholder, нет caret / Cancel |
| Stories unread | gradient segmented rings |
| My story empty-add | blue `+` badge |
| Chats **pinned** | pin у первых четырёх |
| Chats **muted** | mute glyph + gray unread |
| Unread mixed | gray `179`/`1`/`80` vs blue `1` |
| Low Power Mode | yellow battery `53` |
| Live location (system) | status location arrow; **отдельного geo-banner-слоя на кадре пикселями не подтверждено** (см. §10) |
| List scrolled under chrome | нижние ячейки видны сквозь tab blur |

## 9. CSS-скелет (псевдо-классы `.tg-*`, width 414px)

```css
.tg-screen {
  width: 414px;
  height: 896px;
  background: #1C1C1E;
  color: #F5F5F7;
  font-family: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
  position: relative;
  overflow: hidden;
}

/* true black peeks under floating chrome */
.tg-screen::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 120px;
  background: #000;
  z-index: 0;
  pointer-events: none;
}

.tg-status-bar {
  height: 44px;
  padding: 0 16px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 600;
  position: relative;
  z-index: 40;
}

.tg-nav-bar {
  height: 44px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  z-index: 30;
}
.tg-nav-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 17px;
  font-weight: 600;
}
.tg-glass-pill {
  background: rgba(255, 255, 255, 0.10);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  border-radius: 999px;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 32px;
  padding: 0 12px;
}
.tg-glass-pill--edit { min-width: 50px; height: 32px; font-size: 17px; }
.tg-glass-pill--actions { height: 32px; padding: 0 10px; }

.tg-stories-row {
  display: flex;
  gap: 12px;
  padding: 8px 16px 6px;
  overflow-x: auto;
  position: relative;
  z-index: 10;
}
.tg-story {
  width: 64px;
  flex: 0 0 auto;
  text-align: center;
  font-size: 11px;
  color: #fff;
}
.tg-story-avatar {
  width: 52px;
  height: 52px;
  margin: 0 auto 6px;
  border-radius: 50%;
  position: relative;
}
.tg-story-avatar--ring {
  box-shadow: 0 0 0 2px #1C1C1E, 0 0 0 3.5px transparent;
  background:
    linear-gradient(#1C1C1E, #1C1C1E) padding-box,
    linear-gradient(180deg, #34C759 0%, #5AC8FA 45%, #007AFF 100%) border-box;
  border: 2.5px solid transparent;
}
.tg-story-plus {
  position: absolute;
  right: -1px; bottom: -1px;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: #007AFF;
  color: #fff;
  font-size: 14px;
  line-height: 20px;
  border: 2px solid #1C1C1E;
}

.tg-search-wrap { padding: 8px 16px 10px; position: relative; z-index: 10; }
.tg-search-bar {
  height: 36px;
  border-radius: 18px;
  background: #323234; /* opaque stand-in for glass fill */
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #8E8E93;
  font-size: 17px;
}

.tg-chat-list {
  position: relative;
  z-index: 5;
  padding-bottom: 120px; /* clearance under island+FAB */
}
.tg-chat-row {
  height: 76px;
  display: grid;
  grid-template-columns: 60px 1fr auto;
  column-gap: 12px;
  padding: 8px 16px;
  align-items: center;
}
.tg-chat-avatar { width: 60px; height: 60px; border-radius: 50%; }
.tg-chat-main {
  min-width: 0;
  border-bottom: 0.5px solid #2C2C2C;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding-right: 4px;
}
.tg-chat-title {
  font-size: 17px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tg-chat-snippet {
  font-size: 15px;
  color: #8E8E93;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tg-chat-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  font-size: 14px;
  color: #8E8E93;
}
.tg-badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.tg-badge--muted { background: #3A3A3C; }
.tg-badge--active { background: #0A84FF; }
.tg-badge--tab {
  background: #FF3B30;
  position: absolute;
  top: -4px; right: -10px;
  min-width: 18px;
  height: 18px;
  font-size: 12px;
}

.tg-bottom-chrome {
  position: absolute;
  left: 0; right: 0; bottom: 20px;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 16px;
  gap: 10px;
  pointer-events: none;
}
.tg-tab-island {
  pointer-events: auto;
  width: 300px;
  height: 62px;
  border-radius: 31px;
  background: rgba(22, 22, 22, 0.72);
  backdrop-filter: blur(30px) saturate(160%);
  -webkit-backdrop-filter: blur(30px) saturate(160%);
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 0 6px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}
.tg-tab {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: #fff;
}
.tg-tab--active { color: #0A84FF; }
.tg-tab--active .tg-tab-icon-wrap {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  width: 44px; height: 32px;
  display: grid; place-items: center;
}
.tg-fab-search {
  pointer-events: auto;
  width: 58px; height: 58px;
  border-radius: 50%;
  background: rgba(22, 22, 22, 0.72);
  backdrop-filter: blur(30px) saturate(160%);
  -webkit-backdrop-filter: blur(30px) saturate(160%);
  display: grid;
  place-items: center;
  color: #fff;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  margin-left: auto;
}
```

## 10. Неуверенности
1. **Geo-banner:** несколько VLM-просмотров (и уменьшенная копия в промпте) уверенно описывают плашку `Трансляция геопозиции` / `доступна для Моя❤️` под поиском. **Пиксельный разбор оригинала** показывает между stories и первой ячейкой **одну** stadium-капсулу (y 208–252 pt): left/right icon-zones пусты, яркость только в центре → это `Поиск`. Отдельного второго elevated-слоя нет. Возможна галлюцинация модели на типичном паттерне Telegram; на кадре живая геолокация подтверждается только **стрелкой в StatusBar**. Если баннер есть, он либо совпал по luminance с bg, либо вне этого кадра — **не включать в вёрстку без нового скрина**.
2. **Search height 44 pt AABB vs канон 36 pt:** замер по luminance включает AA/blur кромку; визуальное «тело» ближе к 36–40 pt. Радиус брать от visual-h.
3. **Glass alpha / blur radius:** по JPEG восстанавливаются только opaque-эквиваленты; `blur(20–40px)` и alpha 0.55–0.85 — оценка по виду, не инструментальный замер runtime.
4. **Accent blues/reds:** JPEG уводит `#007AFF`/`#FF3B30` в более серо-синие/кирпичные (`#6183C7`, `#D9544D`). Для реализации брать system dark accents, сверяя форму/контраст с кадром.
5. **Settings badge glyph:** на зуме читается **`!`**; часть описаний путает с красной точкой/`1`.
6. **FAB badge:** один зум-кроп показал серый `1` у FAB — с высокой вероятностью это badge ячейки списка, просвечивающий рядом, а не badge на FAB.
7. **Home indicator:** на pure black внизу почти не детектится; стандарт iOS ~134×5 pt @ ~30–40% white — по аналогии, не по замеру этого кадра.
8. **Pinned row background:** отдельного `#161618`-пласта как в S01 не выделено; pinned отличаются иконкой pin, не заливкой ряда.
