# S25 — chat-keyboard-geo-media

## 1. Мета
- **Приложение**: Telegram iOS, дизайн-поколение «Liquid Glass» (iOS 26): плавающие стеклянные «пилюли» вместо сплошного navbar, клавиатура со скруглёнными верхними углами.
- **Тема**: Dark + кастомный фото-wallpaper (пара, поцелуй; тот же фон, что в S08).
- **Экран**: личный чат «Моя❤️🍭», статус «был(а) недавно»; активна **собственная трансляция геопозиции** («Вы»); в ленте виден один **входящий медиа-пузырь** (скриншот Instagram Reels, время `11:49`); поле ввода в фокусе, **системная клавиатура открыта** (русская раскладка, QuickType-подсказки).
- **Исходный файл**: `REFS/S25.jpg`, **фактически 473×1024 px** (а не 828 px). Соотношение 0.4619 = 828×1792 → это даунскейл кадра iPhone **414×896 pt @2x** (XR / 11 / 11 Pro Max, экран с чёлкой).
- **Пересчёт единиц** (используется во всём документе):
  - 1 pt = **1.1425 px файла**; px файла → pt: `÷ 1.1425`;
  - pt → px @2x (база 828): `× 2`;
  - все размеры ниже — в **pt** (= CSS px при viewport 414), в скобках иногда px файла `f…`.
- **Статус-бар**: `09:53` + стрелка геолокации (геосервисы активны — согласуется с трансляцией), 4 палки сигнала (2 яркие / 2 тусклые), `LTE`, батарея «52» на жёлтом (Low Power Mode).

## 2. Иерархия слоёв
Снизу вверх (z-order):
1. **Wallpaper** — фото на весь экран 414×896, `cover`; слева сверху почти чёрный `#040903`, справа сверху светлый пыльно-розовый `#B6A0AC…#B9A58D`, центр `#26231C`, справа внизу `#676360`. Отдельного сплошного dim-слоя на кадре не видно — фото уже тёмное/приглушённое.
2. **Лента сообщений** — скролл-колонка; виден один входящий медиа-пузырь (верх уехал под geo-бар).
3. **Scroll-edge-эффект сверху** — лента проходит под статус-бар и пилюли, размыта (видна сиреневатая размытая полоса `f210–462 × f46–70` — вероятно пузырь, уехавший под шапку). Сплошной плашки navbar **нет**.
4. **Navbar (floating glass)** — три независимых элемента в одну строку: пилюля «назад + badge», пилюля «заголовок/статус», круглый аватар.
5. **Geo-бар (floating glass pill)** — отдельная пилюля под navbar с зазором, не прилегает к краям экрана.
6. **Composer (floating glass)** — три отдельных стеклянных элемента: круг «скрепка», пилюля ввода, круг «микрофон». Сплошной плашки composer нет — между элементами просвечивает wallpaper.
7. **Системная клавиатура** — полупрозрачный тёмный лист с радиусом верхних углов ~23 pt, внутри: полоса подсказок, 4 ряда клавиш, нижняя зона (глобус / диктовка).
8. **System chrome** — статус-бар (без подложки, белый контент). Home indicator на кадре не виден.

## 3. Геометрия
Экран: **414 × 896 pt**. Координаты: `x, y` — левый верхний угол; `w × h`.

### 3.1 Статус-бар
- Высота ≈ **48 pt** (центр строки ≈ y 24.5).
- Время `09:53`: x ≈ 21, cap-height y 19.3–29.8 (≈ 10.5 pt → шрифт 17 pt). Стрелка геолокации сразу за временем, x ≈ 53–74 (вместе с отступом), глиф ≈ 9×10 pt.
- Справа: сигнал x 319–344 (4 палки, ширина палки ≈ 3 pt, шаг ≈ 5 pt, высоты 4/6/8/10 pt), `LTE` x 349–366, батарея x ≈ 369–397 (≈ 28 × 14 pt, radius ≈ 4.5 pt, «носик» справа ≈ 1.5 × 5 pt), правый inset ≈ 17 pt.

### 3.2 Navbar (floating)
| Элемент | x | y | w × h | radius |
|---|---|---|---|---|
| Пилюля «назад» | 16 | 58 | 68 × 44 | 22 (full) |
| Пилюля «заголовок» | 117 | 58 | 179 × 44 | 22 (full) |
| Аватар (круг) | 354 | 58 | 44 × 44 | 50 % |

- Боковые inset: **16 pt** слева и справа.
- Пилюля заголовка центрирована по экрану (центр x ≈ 206.9 при центре экрана 207), поэтому зазоры асимметричны: back → title ≈ **33 pt**, title → avatar ≈ **58 pt**.
- Внутри пилюли «назад»: chevron x 32–40 (≈ 8–9 × 16–17 pt), отступ слева от края пилюли ≈ **16.5 pt**; зазор chevron → badge ≈ **5 pt**; badge `52`: x 46–72, y 71–88 → **26 × 18 pt**, radius 9 pt; отступ badge → правый край пилюли ≈ **12 pt**.
- Внутри пилюли заголовка: строка 1 «Моя❤️🍭» — cap-height y ≈ 64–78; строка 2 «был(а) недавно» — y ≈ 85–100. Обе строки по центру пилюли. Текст «Моя» ≈ x 166–200, ❤️ ≈ x 202–221 (≈ 19 pt), пробел, 🍭 (emoji-статус) ≈ x 235–247, высота ≈ 19–20 pt.
- Аватар: внешний стеклянный круг 44 pt; фото вписано с тёмным ободком ≈ 2–3 pt (фото ≈ 38–40 pt).

### 3.3 Geo-бар («Трансляция геопозиции»)
- Рамка: **x 16, y 113, 382 × 40 pt**, radius **20 pt** (full pill). Зазор от низа navbar ≈ **11 pt**.
- Иконка-маяк слева: бокс ≈ 28 × 23 pt, центр x ≈ 40 (= 24 pt от левого края пилюли), центр y ≈ 132–133 (центр пилюли).
  - «пин»: круглая головка Ø ≈ 6–7 pt + вертикальная ножка ≈ 1.5 × 9 pt, белые;
  - радиоволны «(( ))» — две пары дуг по бокам, толщина ≈ 1.5 pt, серые.
- Текст по **центру пилюли** (центр x ≈ 207): заголовок cap-height y ≈ 120.8–130.4; подзаголовок «Вы» y ≈ 136.5–142.7. Межстрочный шаг ≈ 15–16 pt.
- Кнопка закрытия `×`: глиф ≈ 11 × 11 pt, центр x ≈ 374 (≈ 24 pt от правого края пилюли), центр y ≈ 132; hit-area ≈ 32 × 32 pt.

### 3.4 Лента / входящий медиа-пузырь
- Пузырь: **x 10 → 180 (w ≈ 170 pt)**, низ **y ≈ 487.5**; верх скрыт под geo-баром (видимая часть y ≈ 153–487).
- Радиус нижнего правого угла ≈ **14 pt** (≈ 16 px файла); нижний левый — **хвост**: кромка уходит из x ≈ 10 в кончик x ≈ 6 у y ≈ 487 (хвост ≈ 4 pt наружу, ≈ 8–10 pt по высоте).
- Медиа (скриншот Reels, портрет ≈ 9:19) заполняет пузырь без видимых внутренних отступов (фон картинки чёрный, совпадает с подложкой).
- Время `11:49` поверх медиа: x ≈ 141–166, cap-height y ≈ 468–475; отступ от правого края пузыря ≈ **14 pt**, от низа ≈ **11 pt**.
- Отступ пузыря от левого края экрана ≈ **10 pt**; от composer — ≈ **15.5 pt** (низ пузыря 487.5 → верх composer 503).

### 3.5 Composer (floating)
| Элемент | x | y | w × h | radius |
|---|---|---|---|---|
| Круг «скрепка» | 8 | 503 | 40 × 40 | 50 % |
| Пилюля ввода | 54 | 503 | 305 × 40 | 20 |
| Круг «микрофон» | 366 | 503 | 40 × 40 | 50 % |

- Боковые inset: **8 pt**; зазоры между элементами: **6 pt** (скрепка → поле) и **7 pt** (поле → микрофон).
- Внутри поля: каретка x ≈ 65.5 (≈ 11.5 pt от левого края поля), w ≈ 2 pt, h ≈ 20–22 pt; плейсхолдер «Сообщение» начинается x ≈ 68 (≈ 14 pt от края поля), заканчивается ≈ 157.
- Иконка стикера справа в поле: ≈ 20 × 20 pt, x ≈ 330–349, отступ справа ≈ **10 pt**, по центру по вертикали.
- Скрепка: глиф ≈ 20 × 22 pt (повёрнут ≈ 45°), по центру круга.
- Микрофон: глиф ≈ 17–19 × 25 pt (капсула + дуга-подставка + ножка), по центру круга.
- Низ composer (y 543.5) → верх клавиатуры (y 552) ≈ **9 pt**.

### 3.6 Клавиатура (iOS, RU)
- Лист: **x 0, y 552, 414 × 344 pt**, радиус верхних углов ≈ **23 pt** (вычислено по кривой: ≈ 26 px файла).
- **Полоса подсказок**: зона y 552–605; текст по центру трёх равных колонок (по 138 pt): центры x ≈ 69 / 207 / 345; cap-height y ≈ 571–581 (центр ≈ 576). Разделители: x ≈ 137.5 и 275.5, **1 px @2x (0.5 pt)**, высота ≈ 24 pt (y 564–587).
- **Сетка клавиш** (ряды 1–3 — по 11 равных слотов):
  - высота клавиши **42 pt**, шаг рядов **56 pt**, вертикальный зазор **14 pt**;
  - верх рядов: **605 / 661 / 717 / 773**; низ: 647 / 703 / 759 / 815;
  - ширина клавиши ≈ **31 pt** (30.6), шаг **37 pt**, горизонтальный зазор ≈ **6 pt**, поля слева/справа ≈ **7 / 6 pt**;
  - ряд 1: Й Ц У К Е Н Г Ш Щ З Х; ряд 2: Ф Ы В А П Р О Л Д Ж Э; ряд 3: ⇧ Я Ч С М И Т Ь Б Ю ⌫ (shift и delete — **той же ширины**, что буквы).
  - Радиус клавиши ≈ **7.5 pt** (оценка по сужению верхней кромки).
- **Ряд 4** (y 773, h 42):
  | Клавиша | x | w |
  |---|---|---|
  | `123` | 7 | 45 |
  | 😊 (emoji) | 58 | 45 |
  | пробел (метка «ру» справа внизу) | 108.5 | 198 |
  | ⏎ (return) | 312.5 | 96 |
  Зазоры ≈ 5.5–6 pt. Метка «ру»: от правого края пробела ≈ 5 pt, от низа ≈ 5 pt.
- **Нижняя зона** (y 815–896): глобус — центр x ≈ 45, y ≈ 855, глиф ≈ 26 × 26 pt; диктовка (mic) — центр x ≈ 368.5, y ≈ 855, глиф ≈ 18 × 28 pt.

## 4. Цвет
Замеры — пиксели JPEG (медиана/максимум глифа). Для полупрозрачных слоёв приведена реконструкция `rgba` + наблюдаемый итоговый цвет.

### 4.1 Glass-материал (пилюли navbar, geo-бар, composer)
- Над тёмным фоном итог: **`#1A1C17` … `#1E1F1A`** (пилюля «назад», левая часть geo-бара, круг скрепки `#151716`, левая часть поля ввода `#151918`).
- Над светлым фоном итог: **`#363428` … `#4C4034`** (правая часть заголовка), круг микрофона **`#4A4742`**, правая часть поля **`#484540`**, правая часть geo-бара `#2C2922…#312D22`.
- Реконструкция: `background: rgba(28, 28, 26, 0.60)` + `backdrop-filter: blur(20px) saturate(140%)`. Материал заметно пропускает тон фона (тёплый беж справа) — это не сплошной `#1C1C1E`.
- Кромка (specular rim): верхняя кромка светлее заливки на ≈ +10 по яркости (`#282A27` над `#1C1E1B`), нижняя кромка поля ввода тоже светлее (`#3D3B2E` над `#2A281C`) → `inset 0 0 0 0.5pt rgba(255,255,255,0.10–0.12)`.

### 4.2 Текст и глифы
| Элемент | Замер | Рекомендуемое значение |
|---|---|---|
| Время статус-бара, стрелка, LTE, яркие палки сигнала | `#FCFEFB` / `#FEFBEC` | `#FFFFFF` |
| Тусклые палки сигнала | ≈ `#BAB0A4` поверх светлого фона | `rgba(255,255,255,0.35)` |
| Батарея (Low Power) | `#DFCF81` (JPEG-приглушение) | `#FFD60A`, цифры `#000000` |
| Chevron «назад» | `#FDFDFB` | `#FFFFFF` |
| Badge `52`: подложка / цифры | `#FFFFFF` (медиана `#F0F0F0`) / `#111111` | `#FFFFFF` / `#000000` |
| Имя «Моя» | `#FFFEFC` | `#FFFFFF` |
| «был(а) недавно» | max `#93908B` | `rgba(255,255,255,0.50)` → итог ≈ `#8E8B86` на стекле |
| Заголовок geo «Трансляция геопозиции» | `#FAFAF2` | `#FFFFFF` |
| «Вы» | `#EFEEEA` | `#FFFFFF` (≥ 0.85) |
| Пин маяка / `×` | `#FFFFFB` / `#FCFDF8` | `#FFFFFF` |
| Радиоволны маяка | яркость 107–138 | `rgba(255,255,255,0.45)` |
| Плейсхолдер «Сообщение» | max `#8C8E8D` | `rgba(255,255,255,0.50)` |
| Каретка | `#6383D8` (2 pt линия, JPEG обесцветил) | accent ≈ `#3E88F7` (сверять с темой) |
| Иконка стикера в поле | `#ADAAA1` | `rgba(255,255,255,0.60)` |
| Скрепка / микрофон | `#FBFFFF` / `#FEFDF9` | `#FFFFFF` |
| Время `11:49` на медиа | `#E5E5E7` | `#FFFFFF` (≈ 0.9) |

### 4.3 Пузырь
- Подложка под медиа: **`#000000…#010101`** (совпадает с чёрным фоном скриншота).
- Кромка пузыря: линия яркостью 17–19 между внутренним `#020202` и внешним `#070707…#090909` → `1px @2x rgba(255,255,255,0.07)`.
- Плашка под временем на чёрном не различима; по паттерну Telegram — `rgba(0,0,0,0.35–0.5)`, radius ≈ 9 pt.

### 4.4 Клавиатура
- Лист: **`#161616` … `#191B18`** (на светлом участке фона снизу по центру итог поднимается до `#302D28…#31302E` → лист полупрозрачный). Реконструкция: `rgba(18,18,18,0.86)` + `blur(30px)`.
- Клавиши (буквенные и служебные — **один тон**): слева `#3A3C3B…#3D3D3D`, справа `#504F4D…#55514E`; пробел `#494846…#51504E`, return `#4F4B48…#575350`, `123` `#3E3E3E`. Реконструкция: `rgba(255,255,255,0.17)` поверх листа.
- Буквы на клавишах, ⇧, ⌫, ⏎, 😊, `123`, глобус, mic: `#FEFEFE` → `#FFFFFF`.
- Метка «ру» на пробеле: `#878380` → `rgba(255,255,255,0.45)`.
- Подсказки «Я / Ну / Как»: max `#B1B1B1` → `rgba(255,255,255,0.70)` (см. неуверенности).
- Разделители подсказок: `#242625…#282723` на `#171717` → `rgba(255,255,255,0.06–0.08)`.

## 5. Типографика
Шрифт — системный **SF Pro** (Text ≤ 19 pt, Display ≥ 20 pt), `-apple-system`.

| Роль | Размер | Насыщенность | Цвет | Примечание |
|---|---|---|---|---|
| Время статус-бара | 17 pt | Semibold 600 | `#FFF` | cap ≈ 10.5–12 pt по замеру |
| `LTE` | 12–13 pt | Semibold 600 | `#FFF` | |
| Цифры в батарее | 12 pt | Bold 700 | `#000` | |
| Badge `52` | 13 pt | Semibold 600 | `#000` | цифры ≈ 8.8 pt высотой, tabular |
| Имя «Моя» | 17 pt | Semibold 600 | `#FFF` | letter-spacing ≈ −0.4 px; emoji ≈ 19–20 pt |
| «был(а) недавно» | 13 pt | Regular 400 | `rgba(255,255,255,.5)` | ширина строки ≈ 95 pt |
| Заголовок geo | 14 pt | Regular/Medium 400–500 | `#FFF` | ширина ≈ 141 pt на 21 символ |
| «Вы» | 12 pt | Regular 400 | `#FFF` | |
| Плейсхолдер | 17 pt | Regular 400 | `rgba(255,255,255,.5)` | ширина «Сообщение» ≈ 90 pt |
| Время на медиа `11:49` | 11–12 pt | Regular/Medium | `#FFF` | |
| Подсказки QuickType | 16 pt | Regular 400 | `rgba(255,255,255,.7)` | |
| Буквы клавиш | 22 pt | Regular 400 | `#FFF` | заглавные (shift авто), высота «Ф» ≈ 15 pt |
| `123` | 16–17 pt | Regular 400 | `#FFF` | |
| «ру» на пробеле | 11–12 pt | Regular 400 | `rgba(255,255,255,.45)` | правый нижний угол пробела |

Содержимое скриншота Reels внутри пузыря (заголовок «УЧЕНЫЕ ВЫЯСНИЛИ» золотисто-бежевым, основной текст белым, ник `kreativ_motivation`, кнопка «Подписаться», счётчики 20,7 тыс. / 119 / 307 / 20,3 тыс.) — чужой UI в bitmap, типографикой Telegram не пересобирается.

## 6. Иконки/контролы
- **Back**: SF `chevron.left`, ≈ 9 × 17 pt, штрих ≈ 2.2 pt, скруглённые концы; рядом белый badge-капсула с числом непрочитанных `52`.
- **Аватар**: круглое фото собеседника в стеклянном круге 44 pt (тап → профиль).
- **Emoji-статус**: 🍭 (Premium emoji status) справа от имени, отделён пробелом ≈ 12 pt; ❤️ — часть имени контакта.
- **Маяк трансляции**: кастомный глиф Telegram «пин + радиоволны» (белая середина, серые волны).
- **Close**: SF `xmark`, ≈ 11 pt, штрих ≈ 1.8 pt, белый.
- **Скрепка**: SF `paperclip`, ≈ 20 × 22 pt, белый, штрих ≈ 1.8 pt.
- **Стикер в поле**: круглый «стикер с загнутым углом» (Telegram sticker/emoji toggle), контурный, ≈ 20 pt, `rgba(255,255,255,.6)`.
- **Микрофон**: SF `mic` (контур), ≈ 18 × 25 pt, белый — показывается потому что черновик пуст (вместо кнопки отправки).
- **Клавиатура**: ⇧ — **залитая** стрелка (автозаглавная активна), ⌫ — контурный «delete.left», ⏎ — `return.left`, 😊 — залитый смайлик, глобус (`globe`) и mic (`mic`) в нижней зоне.
- **Каретка**: вертикальная синяя линия ≈ 2 × 21 pt со скруглёнными концами (radius 1 pt).

## 7. Тени / бордеры / разделители
- **Glass-пилюли/круги (navbar, geo, composer)**: без внешней тени (на тёмном фоне не видна); specular-кромка `inset 0 0 0 0.5pt rgba(255,255,255,0.10–0.12)`, с более яркой верхней и нижней дугой (эффект Liquid Glass). `backdrop-filter: blur(20px) saturate(140%)`.
- **Аватар**: тёмный стеклянный ободок ≈ 2–3 pt вокруг фото.
- **Badge `52`**: без обводки, без тени.
- **Пузырь**: кромка `1px @2x rgba(255,255,255,0.07)`; тени нет.
- **Scroll-edge сверху**: контент под статус-баром размыт (≈ 10–20 px) и слегка затемнён к верху; жёсткой границы нет.
- **Клавиатура**: без верхнего hairline; отделяется только тоном листа и радиусом 23 pt. Разделители подсказок — вертикальные `0.5 pt rgba(255,255,255,0.07)`, высота 24 pt. Клавиши без тени (у iOS 26 dark нижняя «подложка»-тень не читается).

## 8. Состояния на кадре
- **Трансляция геопозиции**: активна, источник — текущий пользователь («Вы»); geo-бар раскрыт, `×` доступен; стрелка геолокации в статус-баре.
- **Navbar**: собеседник не в сети («был(а) недавно»), не печатает; непрочитанных в списке чатов — **52**.
- **Лента**: прокручена так, что верх входящего медиа-пузыря ушёл под geo-бар; пузырь — входящий (слева, хвост слева, без галочек), отправлен в 11:49. Кнопки «вниз» (scroll FAB) и даты-разделителя нет.
- **Composer**: поле в фокусе (каретка), черновик пуст → справа микрофон, внутри поля — переключатель стикеров.
- **Клавиатура**: открыта, русская раскладка, авто-shift (заглавные буквы, залитая ⇧), подсказки «Я / Ну / Как».
- **Система**: 09:53, LTE, 2 из 4 палок сигнала, батарея 52 % в Low Power (жёлтая).

## 9. CSS-скелет
```css
:root {
  --tg-glass: rgba(28, 28, 26, 0.60);
  --tg-glass-rim: rgba(255, 255, 255, 0.11);
  --tg-text: #FFFFFF;
  --tg-text-2: rgba(255, 255, 255, 0.50);
  --tg-accent: #3E88F7;
  --tg-kb-bg: rgba(18, 18, 18, 0.86);
  --tg-kb-key: rgba(255, 255, 255, 0.17);
}

.tg-screen {
  position: relative;
  width: 414px; height: 896px;
  overflow: hidden;
  background: #000 center / cover no-repeat; /* wallpaper-couple.jpg */
  color: var(--tg-text);
  font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
}

/* Общий материал Liquid Glass */
.tg-glass {
  background: var(--tg-glass);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
          backdrop-filter: blur(20px) saturate(140%);
  box-shadow: inset 0 0 0 0.5px var(--tg-glass-rim);
}

/* Scroll-edge: размытие ленты под шапкой */
.tg-scroll-edge {
  position: absolute; inset: 0 0 auto 0; height: 160px; z-index: 20;
  -webkit-backdrop-filter: blur(14px);
          backdrop-filter: blur(14px);
  -webkit-mask: linear-gradient(#000 55%, transparent);
          mask: linear-gradient(#000 55%, transparent);
  background: linear-gradient(rgba(0,0,0,0.25), transparent);
  pointer-events: none;
}

.tg-statusbar {
  position: absolute; top: 0; left: 0; right: 0; height: 48px; z-index: 50;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 17px 0 21px;
  font: 600 17px/1 -apple-system, "SF Pro Text", sans-serif;
}
.tg-statusbar__battery {
  width: 28px; height: 14px; border-radius: 4.5px;
  background: #FFD60A; color: #000;
  font: 700 12px/14px -apple-system, sans-serif; text-align: center;
}

/* Navbar: три плавающих элемента */
.tg-navbar { position: absolute; top: 58px; left: 16px; right: 16px; height: 44px; z-index: 40; }
.tg-navbar__back {
  position: absolute; left: 0; top: 0;
  width: 68px; height: 44px; border-radius: 22px;
  display: flex; align-items: center; gap: 5px;
  padding: 0 12px 0 16px; box-sizing: border-box;
}
.tg-navbar__chevron { width: 9px; height: 17px; color: #fff; }
.tg-badge {
  min-width: 26px; height: 18px; border-radius: 9px; padding: 0 6px; box-sizing: border-box;
  background: #fff; color: #000;
  font: 600 13px/18px -apple-system, sans-serif; text-align: center;
  font-variant-numeric: tabular-nums;
}
.tg-navbar__title-pill {
  position: absolute; left: 50%; top: 0; transform: translateX(-50%);
  margin-left: -16px; /* центр по экрану, а не по .tg-navbar */
  width: 179px; height: 44px; border-radius: 22px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.tg-navbar__title { font: 600 17px/20px -apple-system, "SF Pro Text", sans-serif; letter-spacing: -0.4px; }
.tg-navbar__emoji-status { width: 20px; height: 20px; margin-left: 12px; vertical-align: -3px; }
.tg-navbar__status { font: 400 13px/16px -apple-system, sans-serif; color: var(--tg-text-2); }
.tg-navbar__avatar {
  position: absolute; right: 0; top: 0;
  width: 44px; height: 44px; border-radius: 50%; padding: 2.5px; box-sizing: border-box;
}
.tg-navbar__avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }

/* Geo-бар */
.tg-geo-bar {
  position: absolute; left: 16px; top: 113px; z-index: 39;
  width: 382px; height: 40px; border-radius: 20px;
  display: grid; grid-template-columns: 48px 1fr 48px; align-items: center;
}
.tg-geo-bar__icon { justify-self: center; width: 28px; height: 23px; color: #fff; }
.tg-geo-bar__icon .wave { stroke: rgba(255,255,255,0.45); stroke-width: 1.5px; }
.tg-geo-bar__text { text-align: center; }
.tg-geo-bar__title { font: 400 14px/16px -apple-system, sans-serif; }
.tg-geo-bar__sub { font: 400 12px/14px -apple-system, sans-serif; color: #fff; }
.tg-geo-bar__close { justify-self: center; width: 32px; height: 32px; display: grid; place-items: center; color: #fff; }
.tg-geo-bar__close svg { width: 11px; height: 11px; stroke-width: 1.8px; }

/* Лента */
.tg-messages { position: absolute; inset: 0 0 353px 0; z-index: 1; overflow-y: auto; padding: 0 10px 15.5px; }
.tg-message-in--media {
  position: relative;
  width: 170px;
  border-radius: 17px 17px 14px 6px; /* нижний левый — под хвост */
  background: #000;
  box-shadow: 0 0 0 0.5px rgba(255,255,255,0.07);
  overflow: visible;
}
.tg-message-in--media img { display: block; width: 100%; border-radius: inherit; }
.tg-message-in--media::after { /* хвост */
  content: ""; position: absolute; left: -4px; bottom: 0;
  width: 10px; height: 10px; background: #000;
  -webkit-mask: radial-gradient(circle at 0 0, transparent 9.5px, #000 10px);
          mask: radial-gradient(circle at 0 0, transparent 9.5px, #000 10px);
}
.tg-message__time-badge {
  position: absolute; right: 14px; bottom: 11px;
  padding: 1px 6px; border-radius: 9px;
  background: rgba(0,0,0,0.40);
  font: 400 11.5px/14px -apple-system, sans-serif; color: #fff;
}

/* Composer: три плавающих элемента */
.tg-composer {
  position: absolute; left: 8px; right: 8px; top: 503px; height: 40px; z-index: 40;
  display: grid; grid-template-columns: 40px 1fr 40px; column-gap: 6.5px;
}
.tg-composer__attach,
.tg-composer__mic { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: #fff; }
.tg-composer__attach svg { width: 20px; height: 22px; }
.tg-composer__mic svg { width: 18px; height: 25px; }
.tg-composer__field {
  position: relative; height: 40px; border-radius: 20px;
  display: flex; align-items: center; padding: 0 40px 0 14px;
}
.tg-composer__input {
  flex: 1; border: 0; outline: 0; background: transparent;
  font: 400 17px/22px -apple-system, "SF Pro Text", sans-serif; color: #fff;
  caret-color: var(--tg-accent);
}
.tg-composer__input::placeholder { color: var(--tg-text-2); }
.tg-composer__sticker { position: absolute; right: 10px; top: 10px; width: 20px; height: 20px; color: rgba(255,255,255,0.6); }

/* Клавиатура iOS (RU) */
.tg-keyboard {
  position: absolute; left: 0; right: 0; bottom: 0; height: 344px; z-index: 60;
  border-radius: 23px 23px 0 0;
  background: var(--tg-kb-bg);
  -webkit-backdrop-filter: blur(30px) saturate(120%);
          backdrop-filter: blur(30px) saturate(120%);
}
.tg-keyboard__suggest {
  height: 53px; display: grid; grid-template-columns: repeat(3, 1fr); align-items: center;
  font: 400 16px/1 -apple-system, sans-serif; color: rgba(255,255,255,0.70); text-align: center;
}
.tg-keyboard__suggest > * + * { border-left: 0.5px solid rgba(255,255,255,0.07); line-height: 24px; }
.tg-keyboard__row {
  display: grid; grid-template-columns: repeat(11, 31px); column-gap: 6px;
  padding: 0 6px 0 7px; margin-bottom: 14px; height: 42px;
}
.tg-key {
  height: 42px; border-radius: 7.5px;
  background: var(--tg-kb-key);
  display: grid; place-items: center;
  font: 400 22px/1 -apple-system, "SF Pro Display", sans-serif; color: #fff;
}
.tg-key--shift.is-on svg { fill: #fff; }
.tg-keyboard__row--bottom { grid-template-columns: 45px 45px 198px 96px; column-gap: 6px; }
.tg-key--123 { font-size: 16px; }
.tg-key--space { position: relative; }
.tg-key--space::after {
  content: "ру"; position: absolute; right: 5px; bottom: 4px;
  font: 400 11.5px/1 -apple-system, sans-serif; color: rgba(255,255,255,0.45);
}
.tg-keyboard__dock {
  position: absolute; left: 0; right: 0; bottom: 0; height: 81px;
  display: flex; justify-content: space-between; align-items: center;
  padding: 0 32px 0 32px; color: #fff;
}
.tg-keyboard__dock .globe { width: 26px; height: 26px; }
.tg-keyboard__dock .dictation { width: 18px; height: 28px; }
```

## 10. Неуверенности
- **Масштаб**: в задаче заявлено 828 px, а реальный файл — 473×1024. Перевод в pt сделан через 414×896 (совпадает по соотношению сторон и даёт «круглые» 44/40 pt у контролов). Если исходник был 390/393 pt, все размеры надо умножить на ≈ 0.95. Погрешность замеров — **±1 px файла ≈ ±0.9 pt** плюс размытие JPEG на краях.
- **Оценено глазом / по косвенным признакам**: blur-радиусы всех стёкол (20 / 30 / 14 px), alpha glass-заливки (0.60), alpha клавиатурного листа (0.86), наличие и интенсивность scroll-edge-эффекта сверху, толщины штрихов иконок, радиус клавиш (7.5 pt), форма хвоста пузыря, плашка под временем `11:49` (на чёрном фоне не видна — взята из паттерна Telegram).
- **Цвета мелких глифов** занижены JPEG: каретка (`#6383D8` замер → accent подобран), подсказки QuickType (замер `#B1B1B1`; в живом iOS они могут быть чисто белыми), «Вы» в geo-баре, тусклые палки сигнала, батарея (`#DFCF81` замер → взят системный `#FFD60A`).
- **Кегли** восстановлены по cap-height и ширине строк, а не по метаданным: заголовок geo-бара 14 pt (может быть 15 pt), «Вы» 12 pt, `123` 16–17 pt, «ру» 11–12 pt, время на медиа 11–12 pt.
- **Сиреневатая полоса за шапкой** (`f210–462 × f46–70`) — вероятно, исходящий пузырь под scroll-edge-размытием, но может быть и участком фото-wallpaper.
- **Верх медиа-пузыря** скрыт под geo-баром: верхние радиусы (17 pt в скелете) и полная высота картинки — экстраполяция.
- **Shift**: залитая стрелка трактуется как авто-заглавная (типично для начала пустого поля); иной вариант — вручную включённый shift.
- **Home indicator** на кадре не виден (возможно, обрезан или слился с листом клавиатуры) — в скелете не отрисован.
- **Внешние тени** у glass-элементов не детектируются на тёмном фоне; если они есть, то не сильнее `0 2px 8px rgba(0,0,0,0.25)`.
