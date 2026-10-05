# S21 — shared-links-list

## 1. Мета
- **ОС / тема**: iOS, Telegram Dark (чистый чёрный `#000000`), визуальный язык iOS 26 «стекло» (круглые стеклянные кнопки навигации + капсульный сегмент-контрол).
- **Экран**: «Общие материалы» чата/группы → вкладка **«Ссылки»** (Shared Media → Links). Заголовок «АСГАРД: Замена фа…», подзаголовок «13 ссылок».
- **Файл-источник**: `REFS/S21.jpg`, **фактический размер 473 × 1024 px** (а не 828 px — скрин уменьшен, JPEG, хрома-субдискретизация).
- **Пересчёт**: по заданию логическая ширина = **414 pt** → коэффициент `k = 473 / 414 = 1.1425 px/pt`. Все размеры ниже даны в **pt (= CSS px)**, в скобках — сырые px кадра; для @2x (828 px) умножить pt × 2.
  - Самопроверка коэффициента: левый отступ разделителей = 74 px → **64.8 pt ≈ 65 pt** (классический inset Telegram 65 pt), круглые кнопки 51–52 px → **44.6 pt ≈ 44 pt** (стандартный hit-target iOS). Масштаб 414 согласуется.
- **Высота кадра**: 1024 px → **896 pt** (отношение 2.165 — класс iPhone 414×896).
- **Статус-бар**: `09:54` + стрелка геолокации слева; по центру синяя системная капсула «✈ TELEGRAM»; справа сигнал (2/4), `LTE`, батарея **51 %** жёлтая (режим энергосбережения).
- **Контент**: 6 видимых элементов списка ссылок; группа без заголовка сверху (3 шт.), затем секция «ИЮЛЬ 2026» (3 шт., последний обрезан низом кадра).
- **Home indicator**: на кадре отсутствует (низ 1000–1024 px чисто чёрный).

## 2. Иерархия слоёв
1. `tg-screen` — фон `#000000`, на весь viewport.
2. `tg-status-bar` — системный (iOS chrome, не часть макета Telegram), 0–~50 pt.
   - `time` + `location-arrow` слева; `sys-pill` «TELEGRAM» по центру; `signal` / `LTE` / `battery` справа.
3. `tg-navbar` — прозрачная полоса (фон = фон экрана, без blur-подложки на кадре):
   - `tg-glass-btn--back` (круг 44 pt, шеврон) слева;
   - `tg-nav-title` (2 строки, по центру): `title` + `subtitle`;
   - `tg-glass-btn--search` (круг 44 pt, лупа) справа.
4. `tg-segmented` — капсула-переключатель вкладок на всю ширину с inset 16 pt; внутри скролл-ряд `tg-segmented__item` × 4 видимых, активный — `tg-segmented__thumb` (светлая капсула).
5. `tg-link-list` — плоский список на чёрном фоне (без карточек/скруглений):
   - `tg-link-item` × N: `tg-link-thumb` (40 × 40, скруглённый квадрат) + `tg-link-body` (title / description / url-строки);
   - `tg-link-item::after` — hairline-разделитель от x = 65 pt до правого края;
   - `tg-section-header` «ИЮЛЬ 2026» (uppercase, серый) между группами месяцев.

## 3. Геометрия
Координаты: x — от левого края, y — от верха кадра. pt (px кадра).

**Навбар**
| Элемент | x | y | W × H | Прочее |
|---|---|---|---|---|
| Back (круг) | 16 (18) | 58 (66) | 44 × 44 (52 × 51) | центр y ≈ 79.6 pt (91 px) |
| Шеврон «‹» | 31.5–41 (36–47) | 71–88.4 (81–101) | ≈ 10.5 × 18.4 (12 × 21) | штрих ≈ 2.5 pt, скруглённые концы; смещён на ~2 pt влево от центра круга (оптика) |
| Search (круг) | right 16 (x 403–455) | 58 (66) | 44 × 44 | — |
| Лупа | 365–385 (417–440) | 69–89 (79–102) | ≈ 21 × 21 (24 × 24) | штрих ≈ 1.8–2 pt, ручка вниз-вправо 45° |
| Title | центр x = 207 | cap-top 64.8 (74), baseline ≈ 76 (87) | видимая ширина ≈ 165 pt (141–329 px) | обрезка «…» |
| Subtitle | центр x = 207 (202–271 px, ≈ 60 pt) | cap-top 85 (97), baseline ≈ 93.6 (107) | — | — |

**Сегмент-контрол**
- Внешняя капсула: x **16 → 398** (18–454 px), y **117.3 → 158.4** (134–180 px) → **382 × 41 pt**, `border-radius: 20.5pt` (полная капсула).
- Активный thumb «Ссылки»: x 303.7–393.9 (347–450 px), y 121.7–154 (139–176 px) → **≈ 91 × 33 pt**, capsule `radius 16.5pt`. Inset thumb от краёв капсулы: сверху/снизу ≈ **4 pt**, справа ≈ **4 pt**.
- Лейблы (центр x, pt): «Медиа» 70 · «Файлы» 151.4 · «Голосовые» 249.5 · «Ссылки» 349.7. Ширины текста: 45.5 / 47.3 / 77.9 / 53.4 pt.
- Просвет между словами стабильно **35 pt** (40 px) → у каждого item `padding: 0 17.5pt` (≈ 17–19 pt), items вплотную.
- Слева от «Медиа» до края капсулы 31.5 pt (36 px), справа от «Ссылки» до края 21 pt → ряд **прокручен к концу** (асимметрия = горизонтальный скролл; слева могут быть скрытые вкладки).
- Вертикаль лейблов: cap-top ≈ 132.2 pt (151 px), cap-height ≈ 11.4 pt → оптический центр = центр капсулы (≈ 137.8 pt).

**Список ссылок**
- Начало списка (верх 1-го item): **≈ 173.7 pt** (198 px) → зазор под сегментом **16 pt**.
- `tg-link-thumb`: x **11.4 → 51.6** (13–59 px), **40 × 40 pt** (46–47 px), `top = item.top + 12pt`; `border-radius ≈ 10pt` (continuous/squircle, оценка).
- Текстовая колонка: x = **65 pt** (75 px; glyph-bearing ~0.5 pt), правая граница текста ≈ **379 pt** (≈ 433 px) → ширина текста ≈ **314 pt**, правый отступ ≈ 35 pt (оценка по переносам/обрезке «an…»).
- Вертикальный ритм item: `padding: 12pt 0`, **каждая строка (title и тело) = 20 pt**; высота item = 24 + 20 × N строк. Сверено с разделителями:

| # | Item | Строк | Расчёт | Факт (sep→sep) |
|---|---|---|---|---|
| 1 | www.instagram.com | 1 + 3 опис. + 2 url = 6 | 144 | верх ≈ 173.7 → sep **317.7** (363 px) |
| 2 | a.litvinenko@panh.ru | 1 + 1 url = 2 | 64 | 317.7 → **381.6** (436 px) = 63.9 |
| 3 | boec.68@mail.ru | 1 + «-------» + пустая + «Для инфо:…» + url = 5 | 124 | 381.6 → **505.5** (577.5 px) = 123.9 |
| — | Секция «ИЮЛЬ 2026» | — | 28 | 505.5 → 533.5 |
| 4 | Групповой звонок 7 июля | 1 + 2 url = 3 | 84 | 533.5 → **617.5** (705.5 px) = 84 |
| 5 | TrueConf … App Store | 2 + 3 опис. + 4 url = 9 | 204 | 617.5 → **822.8** (940 px) = 205.3 |
| 6 | tc2.pp.gazprom-neft.ru | ≥ 2 (обрезан) | — | 822.8 → край кадра |

- Межстрочный шаг тела замерен: 23 px = **20.1 pt** (238 → 261 → 284 px). Title→первая строка тела: 26 px (у title выше ascender-зона).
- Разделитель: `left: 65pt; right: 0; height: hairline` — у ВСЕХ item, включая последний перед секцией (sep 505.5 pt тоже inset 65).
- Секция «ИЮЛЬ 2026»: блок **28 pt**, текст x = **16 pt** (20 px с bearing → 17.5), cap-top 514.7 pt (588 px), cap-height ≈ 9.6 pt, центр по вертикали ≈ 519.3 pt (= центр блока 519.5).
- Буква в плитке: cap-height **18.4 pt** (21 px), по центру плитки (W: 23–49 px по x, 226–246 px по y).

**Статус-бар (справочно)**
- Время `09:54`: x 20 pt (23 px), cap 19.3–29.8 pt (22–34 px) → cap-height 11.4 pt.
- Системная капсула «TELEGRAM»: x 161–252 pt (184–288 px), y 5.3–26.3 pt (6–30 px) → **92 × 21 pt**, радиус полный.

## 4. Цвет
Замеры — медианы/пики пикселей JPEG; рекомендуемые токены — с учётом сжатия.

| Токен | Замер | Рекомендуется | Где |
|---|---|---|---|
| `--tg-bg` | `#000000` | `#000000` | экран, навбар, список, секция |
| `--tg-glass-fill` | `#181818`–`#191919` | `rgba(255,255,255,0.094)` поверх чёрного ≈ `#181818` | круги back/search, капсула сегмента |
| `--tg-glass-rim` | верх `#2E2E2E`, бока `#1F1F1F`–`#222222`, низ `#222222` | `rgba(255,255,255,0.10)` 0.5–1 pt, сверху светлее (`0.16`) | кромка стеклянных элементов |
| `--tg-seg-thumb` | `#3A3A3A` / `#393939` | `#3A3A3A` (= `rgba(255,255,255,0.15)` поверх `#181818`) | активная вкладка |
| `--tg-text` | `#FFFFFF` | `#FFFFFF` | title навбара, лейблы вкладок (все, и активная, и нет), title ссылки |
| `--tg-text-secondary` | тело `#9C9C9E`–`#9E9E9E` | `#98989E` | описания (превью текста) |
| `--tg-text-tertiary` | подзаголовок `#8D8D8F`–`#939395`, секция `#919191`–`#929196` | `#8D8E93` | «13 ссылок», «ИЮЛЬ 2026» |
| `--tg-link` | пики `#5B81C8`, `#687ED1`, `#7082CC` (обесцвечено хрома-субдискретизацией) | **`#3E88F7`** (luma совпадает: 126 vs 129) | URL / email строки |
| `--tg-separator` | 1 px кадра `#151515`–`#1F1F1F` | hairline `#3D3D40` (1/3 pt @3x) ≈ `rgba(84,84,88,0.65)`; для CSS 1px — `#1C1C1E` | разделители item |
| `--tg-thumb-letter-bg` | `#F09A37` (`#EB9A3D`…`#F59B2E`) | `#F09A37` (оранжевая заглушка домена) | плитки W / A / B / T |
| `--tg-thumb-letter-fg` | `#FFFFFF` (центр букв `#FEFBEA`…`#FFFFFF`) | `#FFFFFF` | буква |
| превью «звонок» | фон `#DBEAFD`/`#DCE8F4`, трубка `#3F74DC` | — (картинка превью) | item 4 |
| превью TrueConf | рамка `#F2F2F3`/`#F9F9F9`, внутр. плитка бирюза `#5DB4C5`→`#3E8C96` | — (иконка App Store) | item 5 |
| sys-pill | `#2E78FD`…`#2F77FF` | `#2F77FF` (≈ iOS systemBlue) | системная капсула статус-бара |
| батарея | `#F6D838`…`#FBD93A` | `#FFD60A` (iOS systemYellow dark) | Low Power |

## 5. Типографика
Шрифт: SF Pro (`-apple-system, "SF Pro Text", "SF Pro Display", system-ui`). Кегли выведены из cap-height (SF: cap ≈ 0.705 em).

| Роль | Кегль / вес | Line-height | Цвет | Замер |
|---|---|---|---|---|
| Nav title «АСГАРД: Замена фа…» | **17 pt / 600** | 22 pt | `#FFFFFF` | cap 14 px = 12.25 pt → 17.4 pt; 1 строка, `text-overflow: ellipsis` |
| Nav subtitle «13 ссылок» | **13 pt / 400** | 16 pt | `#8D8E93` | цифры 11 px = 9.6 pt → 13.6 pt |
| Лейбл вкладки | **16 pt / 500** | 20 pt | `#FFFFFF` (активная и неактивные одинаково) | cap 13 px = 11.4 pt → 16.1 pt |
| Title ссылки (домен / заголовок превью) | **16 pt / 600** | 20 pt | `#FFFFFF` | ascender→descender 17 px = 14.9 pt (≈ 0.93 em); до 2 строк (TrueConf переносится) |
| Описание | **14 pt / 400** | 20 pt | `#98989E` | cap+desc 15 px = 13.1 pt (≈ 0.915 em → 14.3); обрезка «…» по 3-й строке |
| URL / email | **14 pt / 400** | 20 pt | `#3E88F7` | как описание; перенос по любому символу (`word-break: break-all` — `%D0%BE%` рвётся посреди) ; последняя видимая строка с «…» |
| Секция «ИЮЛЬ 2026» | **13 pt / 400**, `uppercase` | 28 pt (блок) | `#8D8E93` | cap 11 px = 9.6 pt → 13.6; letter-spacing ≈ 0 (+0.2 pt возможно) |
| Буква-плитка | **26 pt / 600–700** | 40 pt | `#FFFFFF` | cap 21 px = 18.4 pt → 26.1 pt |
| Время статус-бара | 17 pt / 600 | — | `#FFFFFF` | cap 11.4 pt (системное) |
| «TELEGRAM» в sys-pill | ≈ 12 pt / 700, uppercase, tracking +0.3 | — | `#FFFFFF` | системное |

- Описание и URL — разные строки-блоки: сначала превью-текст (серый), затем URL (синий); пустая строка внутри описания сохраняется (item 3: «-------», пусто, «Для инфо:…»).
- Перенос title: `TrueConf: Business Messenger App -` / `App Store` — по словам; URL — по символам.

## 6. Иконки/контролы
- **Back**: стеклянный круг 44 pt, внутри chevron-left 10.5 × 18.4 pt, stroke `#FFFFFF` ≈ 2.5 pt, `stroke-linecap: round`, `stroke-linejoin: round`.
- **Search**: стеклянный круг 44 pt, лупа 21 pt: кольцо Ø ≈ 14 pt + ручка ≈ 6 pt под 45°, stroke `#FFFFFF` ≈ 1.8 pt.
- **Segmented**: капсула с 4 видимыми вкладками «Медиа · Файлы · Голосовые · Ссылки»; активная — светло-серая капсула-thumb, текст у всех белый (активность — только фоном, не цветом/весом).
- **Плитки-превью 40 × 40, r ≈ 10 pt**:
  - буквенные (нет картинки превью): оранжевый `#F09A37` + белая заглавная первая буква домена — «W» (www.instagram.com), «A» (a.litvinenko@…), «B» (boec.68@…), «T» (tc2.pp.gazprom-neft.ru);
  - картиночные: item 4 — светло-голубая плитка с синей трубкой (favicon max.ru), item 5 — иконка TrueConf (белая рамка + бирюзовая плитка с контуром «группы людей»). Картинка вписана `object-fit: cover` в ту же маску r ≈ 10 pt.
- **Статус-бар**: стрелка геолокации (filled), сигнал 4 столбика (2 белых + 2 тусклых), `LTE`, батарея с числом «51» внутри, жёлтая заливка.
- Аффордансов справа у item (шевроны, кнопки) нет.

## 7. Тени / бордеры / разделители
- **Тени**: нет ни у одного элемента (flat на чистом чёрном).
- **Стеклянные элементы** (back / search / сегмент): заливка `rgba(255,255,255,0.094)` + тонкая кромка `rgba(255,255,255,0.10)` 0.5–1 pt; верхняя кромка светлее (`#2E2E2E` против `#222222` снизу) → имитация specular-подсветки Liquid Glass. Реальный backdrop-blur на кадре не проявляется (под элементами чёрный фон); для веба: `backdrop-filter: blur(20px) saturate(180%)` — только если под навбар скроллится контент.
- **Thumb сегмента**: без бордера и тени, только fill `#3A3A3A`.
- **Разделители списка**: hairline 1/3 pt (на кадре — 1 px с пиком `#151515`–`#1F1F1F`), `left: 65pt`, до правого края экрана (без правого inset). Есть после каждого item, включая последний перед секцией.
- **Навбар/сегмент → список**: нижней линии под навбаром нет; граница только за счёт отступа 16 pt.
- **Секция-заголовок**: без фона и без линии (на кадре не sticky-подложка — фон прозрачный/чёрный).
- **Плитки**: без бордера (у TrueConf белая рамка — часть картинки).

## 8. Состояния на кадре
- Вкладка **«Ссылки» — active** (thumb), остальные idle.
- Navbar title — **truncated** «АСГАРД: Замена фа…» (ellipsis хвостом).
- Сегмент — **прокручен вправо** до конца (асимметричные поля 31.5 / 21 pt).
- Список — прокручен в начало (сразу под сегментом), последний item обрезан низом кадра → scrollable.
- Item 1 — описание обрезано «…» на 3-й строке, URL на 2 строках полностью.
- Item 5 — описание обрезано «an…» (лимит 3 строки), URL обрезан «…» на 4-й строке (лимит 4 строки URL).
- Item 3 — многострочное описание с пустой строкой (whitespace сохраняется).
- Группировка по месяцам: верхняя группа (текущий/последний месяц) без видимого заголовка, далее «ИЮЛЬ 2026».
- Ни одного pressed/highlighted/selected item; режим выбора не активен.
- Системно: геолокация используется (стрелка + синяя капсула), Low Power Mode (жёлтая батарея).

## 9. CSS-скелет
```css
:root {
  --tg-bg: #000000;
  --tg-glass-fill: rgba(255, 255, 255, 0.094);
  --tg-glass-rim: rgba(255, 255, 255, 0.10);
  --tg-glass-rim-top: rgba(255, 255, 255, 0.16);
  --tg-seg-thumb: #3a3a3a;
  --tg-text: #ffffff;
  --tg-text-secondary: #98989e;
  --tg-text-tertiary: #8d8e93;
  --tg-link: #3e88f7;
  --tg-separator: rgba(84, 84, 88, 0.65);
  --tg-thumb-letter-bg: #f09a37;
  --tg-font: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, "Segoe UI", Roboto, sans-serif;
}

.tg-screen {
  width: 414px;
  min-height: 896px;
  background: var(--tg-bg);
  color: var(--tg-text);
  font-family: var(--tg-font);
  -webkit-font-smoothing: antialiased;
}

/* ---- navbar ---- */
.tg-navbar {
  position: relative;
  height: 44px;
  margin-top: 58px;              /* под статус-бар; top кругов = 58pt */
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tg-glass-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--tg-glass-fill);
  box-shadow:
    inset 0 0.5px 0 var(--tg-glass-rim-top),
    inset 0 0 0 0.5px var(--tg-glass-rim);
  display: grid;
  place-items: center;
  color: var(--tg-text);
  border: 0;
}
.tg-glass-btn--back svg { width: 11px; height: 19px; margin-left: -2px; stroke-width: 2.5; }
.tg-glass-btn--search svg { width: 21px; height: 21px; stroke-width: 1.8; }

.tg-nav-title {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translateX(-50%);
  max-width: 230px;              /* обрезка «…»; видимая ширина ≈165pt */
  text-align: center;
  white-space: nowrap;
}
.tg-nav-title__main {
  font-size: 17px;
  font-weight: 600;
  line-height: 22px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tg-nav-title__sub {
  font-size: 13px;
  font-weight: 400;
  line-height: 16px;
  color: var(--tg-text-tertiary);
}

/* ---- segmented ---- */
.tg-segmented {
  margin: 15px 16px 0;           /* верх капсулы = 117.3pt */
  height: 41px;
  border-radius: 20.5px;
  background: var(--tg-glass-fill);
  box-shadow:
    inset 0 0.5px 0 var(--tg-glass-rim-top),
    inset 0 0 0 0.5px var(--tg-glass-rim);
  padding: 4px;
  display: flex;
  overflow-x: auto;
  scrollbar-width: none;
}
.tg-segmented::-webkit-scrollbar { display: none; }

.tg-segmented__item {
  flex: 0 0 auto;
  height: 33px;
  padding: 0 18px;
  border-radius: 16.5px;
  display: flex;
  align-items: center;
  font-size: 16px;
  font-weight: 500;
  color: var(--tg-text);
  background: transparent;
  white-space: nowrap;
}
.tg-segmented__item.is-active { background: var(--tg-seg-thumb); }

/* ---- list ---- */
.tg-link-list { margin-top: 16px; }

.tg-link-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  padding: 12px 35px 12px 0;
}
.tg-link-item::after {
  content: "";
  position: absolute;
  left: 65px;
  right: 0;
  bottom: 0;
  height: 0.33px;                /* на 1x-экране: 1px #1c1c1e */
  background: var(--tg-separator);
}

.tg-link-thumb {
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  margin: 0 13.6px 0 11.4px;     /* текст стартует с x = 65pt */
  border-radius: 10px;
  overflow: hidden;
  object-fit: cover;
}
.tg-link-thumb--letter {
  display: grid;
  place-items: center;
  background: var(--tg-thumb-letter-bg);
  color: #ffffff;
  font-size: 26px;
  font-weight: 600;
  line-height: 1;
}

.tg-link-body { flex: 1; min-width: 0; }

.tg-link-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 20px;
  color: var(--tg-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tg-link-desc {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  color: var(--tg-text-secondary);
  white-space: pre-line;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tg-link-url {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  color: var(--tg-link);
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-decoration: none;
}

.tg-section-header {
  height: 28px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 400;
  text-transform: uppercase;
  color: var(--tg-text-tertiary);
  background: transparent;
}
```

## 10. Неуверенности
- **Масштаб**: кадр 473 px, а не 828 px. Перевод в pt через 414 pt (по условию) — подтверждён косвенно (inset 65 pt, кнопки 44 pt), но при базе 390 pt все размеры были бы на ~6 % больше (k = 1.213). Погрешность замеров ±1 px кадра = **±0.9 pt**.
- **Цвет ссылок `#3E88F7`** — вывод, а не замер: тонкий текст в JPEG обесцвечен (пики `#5B81C8`…`#7082CC`); значение подобрано по совпадению яркости (luma). Возможны `#3B82F6`…`#4C8BF5`.
- **Серые текста** (`#98989E` / `#8D8E93`) — по пикам антиалиасинга, ±4 по каналу; может быть один токен на всё.
- **Разделитель**: реальная толщина/цвет hairline восстановлены из усреднённого 1 px (`#151515`–`#1F1F1F`); `#3D3D40 @ 1/3 pt` — расчётная оценка.
- **Радиус плиток ≈ 10 pt** и squircle-форма — на глаз по зуму ×8 (JPEG размывает угол; пороговый замер давал 9–13 pt).
- **Стекло**: заливка `#181818` и светлая верхняя кромка замерены; наличие blur/vibrancy на кадре не проверяемо (под элементами чёрный) — указано как предположение.
- **Кегли** выведены из cap-height (SF cap ≈ 0.705 em): title ссылки 16/600, тело 14/400, вкладки 16/500, секция 13 — точность ±0.5 pt; вес (500 vs 600) — на глаз.
- **Line-height 20 pt** выведен из суммы высот item (расчёт сходится с разделителями до ±1.3 pt); отдельная высота title-строки (20 vs 22 pt) не различима.
- **Правая граница текста ≈ 379 pt** (padding-right ≈ 35 pt) — по самым длинным строкам и местам переноса/обрезки, ±4 pt.
- **Лимиты строк** (title 2, описание 3, URL 4) — по наблюдённым обрезкам «…» на кадре, а не по коду Telegram.
- **Скрытые вкладки слева** в сегменте — предположение из асимметрии полей; что там (напр. «Музыка», «GIF») — не видно, маски-фейда на кадре не обнаружено.
- **max-width заголовка навбара** (230 pt в скелете) — подобран: видимая ширина 165 pt до «…», реальная граница обрезки не измерима.
- **Буквенная плитка оранжевая у всех 4 доменов** — на кадре так; зависит ли цвет от хеша домена/темы — неизвестно.
- Отсутствие заголовка у верхней группы (текущий месяц) и отсутствие home indicator — зафиксированы как факт кадра, причина не установлена.
- Статус-бар (капсула «TELEGRAM», батарея, время) — системный iOS chrome, размеры даны справочно.
