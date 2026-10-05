# S14 — telegram-calls-ios-dark

## 1. Мета

| Поле | Значение |
|---|---|
| **Slug** | `telegram-calls-ios-dark` |
| **Референс** | `TG-DESIGN-BOOK/REFS/S14.jpg` |
| **Масштаб** | **Источник 828×1792 px, база 414×896 pt @2x, pt = px/2** |
| Устройство | iPhone класса XR / 11 (вырез-«чёлка», не Dynamic Island), @2x |
| Платформа | Telegram iOS, редизайн в стиле iOS 26 (стеклянные капсулы, плавающий tab bar) |
| Экран | Вкладка «Звонки», фильтр «Все», список недавних звонков |
| Тема | Тёмная, фон чисто чёрный `#000000` |
| Локаль | ru-RU (формат дат `MM/DD` / `MM/DD/YY`) |
| Шрифт | SF Pro (`-apple-system`) |
| Метод замеров | Pillow по 828-px файлу: полосы строк, края заливок, cap/x-height глифов, медианы цветов. Все размеры ниже в **pt (база 414)**, в скобках — px@2x |

Порядок сверху вниз: status bar → nav (капсула «Изм.» + сегмент «Все / Пропущ.») → строка «Новый звонок» → заголовок секции «НЕДАВНИЕ ЗВОНКИ» → 11 полных ячеек + 1 под доком → плавающий док (капсула tab bar на 4 вкладки + круглая кнопка поиска).

## 2. Иерархия слоёв

```
[L0] .tg-screen                        414×896, bg #000000
 ├─ [L1] .tg-status-bar                0–48 pt
 │    ├─ время «09:55» + стрелка геолокации
 │    ├─ .tg-status-capsule            синяя капсула «TELEGRAM» по центру
 │    └─ сигнал / LTE / батарея 51
 ├─ [L1] .tg-nav                       y 58–102 pt (контролы 44 pt)
 │    ├─ .tg-glass-pill.tg-nav-edit    «Изм.», слева
 │    └─ .tg-segment                   «Все» (active) | «Пропущ.»
 ├─ [L1] .tg-scroll
 │    ├─ .tg-new-call                  иконка трубки с «+» и «Новый звонок»
 │    ├─ .tg-section-header            «НЕДАВНИЕ ЗВОНКИ»
 │    └─ .tg-call-list
 │         └─ .tg-call-cell × N        шаг 54 pt
 │              ├─ .tg-call-dir        только у исходящих
 │              ├─ .tg-avatar          40 pt (фото / градиент с инициалами / логотип / призрак)
 │              ├─ .tg-call-title      имя (white | red у удалённого)
 │              ├─ .tg-call-sub        «Исходящий (16 сек.)» и т.п.
 │              ├─ .tg-call-date
 │              └─ .tg-info-btn        «i» в кольце
 └─ [L2] .tg-dock                      y 812–876 pt, над контентом
      ├─ .tg-tabbar                    стеклянная капсула 300×64
      │    ├─ .tg-tab ×4 (Контакты, Звонки*, Чаты [51], Настройки [!])
      │    └─ .tg-tab-active-pill      подложка под «Звонки»
      └─ .tg-search-fab                круг 64, лупа
```

Z-порядок: док > status bar > прокручиваемый контент > фон. Список уходит под док: строка «Удалённый аккаунт» и следующая видны сквозь размытую капсулу.

## 3. Геометрия

Все координаты в pt (база 414), в скобках px@2x. `x` отсчитывается от левого края, `y` — от верха экрана.

### 3.1 Status bar

| Элемент | Значение |
|---|---|
| Высота зоны | ≈ 48 pt (контролы nav начинаются с y 58) |
| Время «09:55» | x 20.5–81 (41–162), глифы y 19–30.5 (38–61), высота цифр ≈ 11.5 pt |
| Синяя капсула «TELEGRAM» | x 160.5–253 (321–506) → **92.5 × 22.5 pt**, y 4.5–27 (9–54), радиус = h/2 ≈ 11 pt |
| Батарея | x 372.5–391.5 (745–783), центр по y ≈ 18 |

### 3.2 Nav

| Элемент | Значение |
|---|---|
| Капсула «Изм.» | x **16–80**, y **58–102** (32–160 / 116–204) → **64 × 44 pt**, радиус **22** |
| Текст «Изм.» | x 29.5–66 (59–131), по центру капсулы |
| Трек сегмента | x **125–288**, y **58–102** (250–576 / 116–204) → **163 × 44 pt**, радиус **22**, центр по x 206.5 ≈ центр экрана (207) |
| Активная подложка «Все» | x **127.5–185**, y **61.5–98.5** (255–370 / 123–197) → **57 × 37 pt**, радиус **18.5** (капсула), отступ от трека ≈ 2.5–3.5 pt |
| «Все» | x 145.5–170 (291–339), центр 157.5 = центр подложки |
| «Пропущ.» | x 205.5–266.5 (411–533), центр 236 = центр свободной части трека (185–288) |
| Промежуток «Изм.» → трек | 45 pt |

### 3.3 «Новый звонок»

| Элемент | Значение |
|---|---|
| Иконка (трубка с «+») | x **19.5–40.5** (39–81) → 21 × 21 pt, y 123–144 (246–288) |
| Текст | старт x **60.5** (121), конец ≈ 170.5 (341); cap «Н» y 128–139.5 (256–279) |
| Ось строки по y | ≈ 133.5 (267) |
| Разделитель под строкой | y **159.5** (319), x **59–397.5** (118–795): левый inset 59 pt (по тексту), правый inset **16 pt**, толщина **0.5 pt** (1 px) |

### 3.4 Заголовок секции

| Элемент | Значение |
|---|---|
| «НЕДАВНИЕ ЗВОНКИ» | x **17–144** (34–288), ширина 127 pt; cap y 169.5–178 (339–356), базовая линия ≈ y 178 |
| Отступ от разделителя «Новый звонок» до cap | 10 pt |
| От базовой линии до верха первой ячейки | 10.5 pt |

### 3.5 Ячейка звонка

Первая ячейка: y **188.5–242.5** (377–485). **Шаг ячеек 54 pt (108 px)**, разделители на y 242.5, 296.5, 350.5, 404.5, 458.5, 512.5, 566.5, 620.5, 674.5, 728.5, 782.5.

Горизонталь (одинаково для всех ячеек):

| Элемент | x, pt | Размер |
|---|---|---|
| Иконка направления (только у исходящих) | **11–23** (22–46) | 12 × 12 pt, центр по y = центр ячейки ± 0.5 |
| Аватар | **34–74** (68–148) | **40 × 40**, `border-radius: 50%`, центр x 54 |
| Отступ аватар → текст | 13 pt | |
| Колонка текста | старт **87** (174) | гибкая, обрезка «…» (у самого длинного имени конец ≈ 290.5) |
| Дата | правый край **366.5** (733) | выравнивание вправо, по центру ячейки по y |
| Отступ дата → info | ≈ 9.5–10 pt | |
| Кнопка info | **376–397.5** (752–795) | **22 × 22**, правый inset **16 pt** |
| Разделитель ячеек | от **86** (172) до 397.5 (795) | 0.5 pt, правый inset 16 pt, левый совпадает с текстом |

Вертикаль внутри ячейки высотой 54 pt (от верха ячейки):

| Элемент | Смещение |
|---|---|
| Аватар | 7.5 → 47 (сверху и снизу ≈ 7 pt) |
| Имя: верх «О» / x-height / базовая линия | 6.5 / 9.5 / **24** |
| Подпись: верх «И» / базовая линия | 26.5 / **42** |
| Дата: верх цифр / базовая линия | 23 / 33 (центр цифр ≈ центр ячейки) |

### 3.6 Док

| Элемент | Значение |
|---|---|
| Капсула tab bar | x **20.5–320.5**, y **812–876** (41–641 / 1624–1752) → **300 × 64 pt**, радиус **32** |
| Кнопка поиска | x **330.5–393.5**, y **811.5–876** (661–787 / 1623–1752) → **≈ 64 pt** круг |
| Промежуток капсула ↔ кнопка поиска | **10 pt** (20 px) |
| Левый / правый отступ дока | **20.5 / 20.5 pt** |
| Нижний отступ дока (от низа кадра) | **20 pt** (40 px); Home Indicator на скриншоте не виден |
| Подложка активной вкладки | x **106–172**, y ≈ 816–872 (212–344 / 1632–1744) → **66 × ≈ 56 pt**, радиус ≈ 28, отступ от капсулы ≈ 4 pt |
| Иконки вкладок | y **821–848** (1642–1696), высота ≈ 27 pt (иконка «Контакты» 22.5 pt шириной) |
| Подписи вкладок | cap y 855.5–862 (1711–1724), базовая линия ≈ y 862 |
| Центры подписей по x | Контакты **63.75**, Звонки **137.75**, Чаты **199**, Настройки **271.5** (не равномерная сетка) |
| Бейдж «51» | x **200.5–223.5**, y **821–837.5** (401–447 / 1642–1675) → **23 × 17 pt**, радиус 8.5 |
| Бейдж «!» | x **279–295**, y **821.5–837.5** (558–590 / 1643–1675) → **16 × 16 pt**, круг |
| Лупа в кнопке поиска | x 351–371.5 (702–743) → ≈ 20.5 pt, центр 361 = центр круга |

## 4. Цвет

«Замер» — медиана/пик по 828-px JPEG. «Рекомендация» — значение для воспроизведения (там, где JPEG заметно искажает тонкие штрихи, это оговорено).

### 4.1 Поверхности

| Токен | Замер | Рекомендация | Где |
|---|---|---|---|
| `--tg-bg` | `#000000` | `#000000` | фон экрана |
| `--tg-glass` | `#181818` (над чёрным) | `rgba(255,255,255,0.094)` поверх blur | капсула «Изм.», трек сегмента, tab bar, кнопка поиска |
| `--tg-glass-rim-top` | `#2F2F2F`…`#494748` (1 px) | `rgba(255,255,255,0.20)` | верхний блик стеклянных капсул |
| `--tg-glass-rim-bottom` | `#303030`…`#353535` (1 px) | `rgba(255,255,255,0.18)` | нижний край капсул |
| `--tg-segment-active` | `#393939` | `#393939` (≈ `rgba(255,255,255,0.22)`) | подложка «Все» |
| `--tg-tab-active-bg` | `#393939`…`#3B3B3B` | `#3A3A3A` | подложка под «Звонки» |
| `--tg-separator` | `#292929`…`#2F2F2F` | `#2C2C2E` | разделители списка (1 px@2x) |

### 4.2 Текст и акцент

| Токен | Замер | Рекомендация | Где |
|---|---|---|---|
| `--tg-label` | `#FCFCFC` | `#FFFFFF` | имена, «Изм.», **оба** сегмента, неактивные подписи и иконки вкладок, лупа |
| `--tg-secondary` | `#969696` (подпись и дата) | `#98989E` | «Исходящий…», даты |
| `--tg-section` | `#8A8A8A` | `#8D8D93` | «НЕДАВНИЕ ЗВОНКИ» |
| `--tg-accent` | пик `#458AFF` (заливка активной иконки); тонкий текст размыт до `#6684CC`…`#6984EB` | `#3E88F7` | «Новый звонок» с иконкой, кольцо info, активная иконка и подпись «Звонки» |
| `--tg-call-dir` | `#424242`…`#484848` | `#48484A` | иконка исходящего звонка (тусклая) |
| `--tg-destructive` | `#B46660` (под blur дока) | `#EB5545` | «Удалённый аккаунт» |

### 4.3 Бейджи, аватары, status bar

| Объект | Замер | Рекомендация |
|---|---|---|
| Бейджи «51», «!» | заливка `#D6614D` / `#DC5F4D` | `#EB5545`, текст `#FFFFFF` |
| Аватар с инициалами («ОВ», «В») | верх `#EF8969` → низ `#EC636B` | `linear-gradient(180deg, #FF885E, #FF516A)`, инициалы `#FFFFFF` |
| Аватар «Хайс» | белый круг `#FFFFFF`, чёрный «X» `#313035`, синяя точка | логотип как картинка |
| Удалённый аккаунт | круг `#C5C5C5`, призрак `#FEFEFE` | `#C7C7CC` + белая иконка |
| Фото-аватары | фото (тёплые тона, `#AB775E`…`#C49A86`) | `object-fit: cover` |
| Капсула «TELEGRAM» | `#3078F0` / `#3672F6`, текст `#EDFFFF` | `#3478F6`, текст `#FFFFFF` |

## 5. Типографика

Кегль восстановлен по высоте прописных (`cap ≈ 0.705 em`) и строчных (`x ≈ 0.53 em`) SF Pro; поправка на размытие JPEG ≈ −1 px.

| Роль | Замер, pt (px) | Кегль, pt | Насыщенность | Цвет |
|---|---|---|---|---|
| Время status bar | цифры 11.5–12 (23–24) | **17** | 600 | `#FFFFFF` |
| «TELEGRAM» в капсуле | — | ≈ 11, caps | 600 | `#FFFFFF` |
| «Изм.» | cap 12 (24), x 9 (18) | **17** | 400 | `#FFFFFF` |
| «Все» | cap 10.5 (21), x 8 (16) | **14** | 600 | `#FFFFFF` |
| «Пропущ.» | cap 10.5 (21), x 8 (16) | **14** | 500 | `#FFFFFF` |
| «Новый звонок» | cap 12 (24), x 9 (18) | **17** | 400 | accent |
| «НЕДАВНИЕ ЗВОНКИ» | cap 9 (18), ширина 127 pt | **13**, uppercase, tracking ≈ 0 | 400 | `#8D8D93` |
| Имя | «О» 12 (24) с компенсацией, x 9 (18) | **17** (допуск 16) | 600 | `#FFFFFF` / `#EB5545` |
| Подпись | cap 10 (20), x 7.5 (15) | **14** | 400 | `#98989E` |
| Дата | цифры 10.5 (21), «/» 13.5 (27) | **14** | 400 | `#98989E`, `font-variant-numeric: tabular-nums` |
| Подпись вкладки | cap 7 (14), x 5.5 (11) | **10** | 500 | `#FFFFFF` / accent |
| Цифры бейджа | — | ≈ 12 | 600 | `#FFFFFF` |

Межстрочное расстояние в ячейке: от базовой линии имени до базовой линии подписи **18 pt**.

## 6. Иконки/контролы

| Контрол | Описание |
|---|---|
| «Изм.» | Не синяя ссылка, а **белый текст в стеклянной капсуле** 64×44 |
| Сегмент | Стеклянный трек 163×44, активная подложка `#393939` 57×37; подпись неактивного сегмента тоже белая, отличие только подложкой |
| «Новый звонок» | Контурная трубка с «+» (21 pt, штрих ≈ 1.5 pt, accent) + accent-текст |
| Иконка направления | Маленькая трубка со стрелкой исходящего (12 pt, `#48484A`), **только у исходящих**; у входящих («Хайс», «Русланчик») слот пустой, аватар не сдвигается |
| Кнопка info | Кольцо 22 pt со штрихом ≈ 1.25 pt (2.5 px) + «i» со штрихом ≈ 1.25 pt, accent; зона нажатия ≥ 44 pt |
| Контакты | Силуэт в круге, залитая белая иконка |
| Звонки (active) | Залитая трубка в accent, подложка 66×56, подпись accent |
| Чаты | Белые пузыри + бейдж «51» |
| Настройки | Белая шестерёнка + бейдж «!» |
| Поиск | Отдельная стеклянная круглая кнопка 64 pt, белая лупа ≈ 20.5 pt со штрихом ≈ 2 pt |

## 7. Тени / бордеры / разделители

**Разделители** — 0.5 pt (1 px@2x) `#2C2C2E`, правый inset 16 pt. Левый inset: 59 pt под «Новый звонок» и 86 pt между ячейками (с начала текста). Под последней видимой ячейкой разделитель уходит под док.

**Стеклянные капсулы** («Изм.», трек сегмента, tab bar, кнопка поиска) — общий рецепт:

```css
background: rgba(255,255,255,0.094);
backdrop-filter: blur(20px) saturate(160%);
box-shadow:
  inset 0  0.5px 0 rgba(255,255,255,0.20),   /* верхний блик 1 px */
  inset 0 -0.5px 0 rgba(255,255,255,0.18);   /* нижний край 1 px */
```

Внешней тени на чёрном фоне не видно (за пределами капсул пиксели `#000000`–`#010101`), поэтому `box-shadow` наружу не добавляется.

**Активные подложки** (`#393939` у сегмента, `#3A3A3A` у вкладки) — без обводки и тени.

**Аватары и бейджи** — без обводки.

## 8. Состояния на кадре

| Объект | Состояние |
|---|---|
| Сегмент | «Все» выбран, «Пропущ.» нет |
| Вкладка | «Звонки» активна, остальные неактивны |
| Бейджи | «Чаты» = 51, «Настройки» = «!» |
| Режим правки | выключен |
| Скролл | самый верх (видны «Новый звонок» и заголовок секции) |
| Status bar | синяя капсула «TELEGRAM» (системный индикатор приложения), LTE, батарея 51 |

Видимые ячейки (имя — подпись — дата, направление по иконке):

| № | Имя | Подпись | Дата | Аватар | Иконка |
|---|---|---|---|---|---|
| 1 | Олег Викторович Асгар… | Исходящий (16 сек.) | 06/16 | градиент «ОВ» | исходящий |
| 2 | Олег Викторович Асгар… | Исходящий | 06/15 | градиент «ОВ» | исходящий |
| 3 | Моя❤️ | Исходящий | 04/16 | фото | исходящий |
| 4 | Моя❤️ | Исходящий | 11/30/25 | фото | исходящий |
| 5 | Вологда | Исходящий (7 мин.) | 07/12/23 | градиент «В» | исходящий |
| 6 | арт. | Исходящий | 06/30/23 | фото | исходящий |
| 7 | Хайс | Входящий (3 мин.) | 10/03/22 | белый логотип «X» | нет |
| 8 | Andrei | Исходящий | 07/22/22 | фото | исходящий |
| 9 | Русланчик | Входящий (1 мин.) | 07/19/22 | фото | нет |
| 10 | Andrei | Исходящий | 07/12/22 | фото | исходящий |
| 11 | Русланчик | Входящий (1 мин.) | 07/09/22 | фото | нет |
| 12 | Удалённый аккаунт (красный) | — (под доком) | 06/10/22 | призрак | — |

Даты: текущий год без года (`06/16`), прошлые годы — с годом (`11/30/25`).

## 9. CSS-скелет

```css
:root {
  --tg-bg: #000000;
  --tg-glass: rgba(255, 255, 255, 0.094);
  --tg-rim-top: rgba(255, 255, 255, 0.20);
  --tg-rim-bottom: rgba(255, 255, 255, 0.18);
  --tg-active-fill: #393939;
  --tg-separator: #2C2C2E;
  --tg-label: #FFFFFF;
  --tg-secondary: #98989E;
  --tg-section: #8D8D93;
  --tg-accent: #3E88F7;
  --tg-call-dir: #48484A;
  --tg-destructive: #EB5545;
  --tg-badge: #EB5545;
  --tg-font: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
}

.tg-screen {
  position: relative;
  width: 414px;
  height: 896px;
  overflow: hidden;
  background: var(--tg-bg);
  color: var(--tg-label);
  font-family: var(--tg-font);
}

.tg-glass {
  background: var(--tg-glass);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  box-shadow: inset 0 0.5px 0 var(--tg-rim-top), inset 0 -0.5px 0 var(--tg-rim-bottom);
}

.tg-status-bar { position: absolute; inset: 0 0 auto; height: 48px; }
.tg-status-time { position: absolute; left: 20px; top: 15px; font-size: 17px; font-weight: 600; }
.tg-status-capsule {
  position: absolute; left: 160.5px; top: 4.5px;
  width: 92.5px; height: 22.5px; border-radius: 11.25px;
  background: #3478F6; color: #FFFFFF;
  font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
  display: flex; align-items: center; justify-content: center;
}

.tg-nav { position: absolute; top: 58px; left: 0; right: 0; height: 44px; }

.tg-nav-edit {
  position: absolute; left: 16px; top: 0;
  width: 64px; height: 44px; border-radius: 22px; border: 0;
  color: var(--tg-label); font: 400 17px/44px var(--tg-font);
}

.tg-segment {
  position: absolute; left: 125px; top: 0;
  width: 163px; height: 44px; border-radius: 22px;
  display: flex; align-items: center; padding: 0 3px 0 2.5px; box-sizing: border-box;
}
.tg-segment-item {
  height: 37px; border: 0; border-radius: 18.5px; background: transparent;
  color: var(--tg-label); font: 500 14px/37px var(--tg-font);
}
.tg-segment-item:first-child { width: 57px; }
.tg-segment-item:last-child { flex: 1; }
.tg-segment-item.is-active { background: var(--tg-active-fill); font-weight: 600; }

.tg-scroll { position: absolute; top: 108px; left: 0; right: 0; bottom: 0; overflow-y: auto; }

.tg-new-call {
  position: relative; display: flex; align-items: center;
  height: 51.5px; padding-left: 19.5px;
  color: var(--tg-accent); font: 400 17px/22px var(--tg-font);
}
.tg-new-call-icon { width: 21px; height: 21px; margin-right: 20px; color: var(--tg-accent); }
.tg-new-call::after {
  content: ""; position: absolute; left: 59px; right: 16px; bottom: 0;
  height: 0.5px; background: var(--tg-separator);
}

.tg-section-header {
  height: 28.5px; padding: 4px 17px 0; box-sizing: border-box;
  color: var(--tg-section); font: 400 13px/18px var(--tg-font);
  text-transform: uppercase;
}

.tg-call-list { margin: 0; padding: 0; list-style: none; }

.tg-call-cell {
  position: relative; display: flex; align-items: center;
  height: 54px; padding-right: 16px; box-sizing: border-box;
}
.tg-call-cell::after {
  content: ""; position: absolute; left: 86px; right: 16px; bottom: 0;
  height: 0.5px; background: var(--tg-separator);
}
.tg-call-dir { width: 12px; height: 12px; margin-left: 11px; color: var(--tg-call-dir); flex: none; }
.tg-call-cell.is-incoming .tg-call-dir { visibility: hidden; }

.tg-avatar {
  width: 40px; height: 40px; margin-left: 11px; margin-right: 13px; flex: none;
  border-radius: 50%; overflow: hidden; object-fit: cover;
  display: flex; align-items: center; justify-content: center;
  color: #FFFFFF; font: 600 16px/1 var(--tg-font);
}
.tg-avatar.is-red { background: linear-gradient(180deg, #FF885E 0%, #FF516A 100%); }
.tg-avatar.is-deleted { background: #C7C7CC; }

.tg-call-body { flex: 1; min-width: 0; padding-top: 1px; }
.tg-call-title {
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font: 600 17px/22px var(--tg-font); color: var(--tg-label);
}
.tg-call-title.is-deleted { color: var(--tg-destructive); }
.tg-call-sub {
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font: 400 14px/18px var(--tg-font); color: var(--tg-secondary);
}
.tg-call-date {
  flex: none; margin-left: 8px; margin-right: 9.5px;
  font: 400 14px/18px var(--tg-font); color: var(--tg-secondary);
  font-variant-numeric: tabular-nums; text-align: right;
}
.tg-info-btn {
  flex: none; width: 22px; height: 22px; padding: 0; box-sizing: border-box;
  border: 1.25px solid var(--tg-accent); border-radius: 50%; background: transparent;
  color: var(--tg-accent); font: 500 13px/1 var(--tg-font);
  display: flex; align-items: center; justify-content: center;
}

.tg-dock {
  position: absolute; left: 20.5px; right: 20.5px; bottom: 20px; height: 64px;
  display: flex; gap: 10px; z-index: 10;
}
.tg-tabbar {
  position: relative; width: 300px; height: 64px; border-radius: 32px;
}
.tg-tab-active-pill {
  position: absolute; left: 85.5px; top: 4px;
  width: 66px; height: 56px; border-radius: 28px;
  background: #3A3A3A;
}
.tg-tab {
  position: absolute; top: 9px; width: 66px; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  border: 0; background: transparent;
  color: var(--tg-label); font: 500 10px/12px var(--tg-font);
}
.tg-tab:nth-child(2) { left: 43.25px; }
.tg-tab:nth-child(3) { left: 117.25px; }
.tg-tab:nth-child(4) { left: 178.5px; }
.tg-tab:nth-child(5) { left: 251px; }
.tg-tab.is-active { color: var(--tg-accent); }
.tg-tab-icon { width: 27px; height: 27px; }

.tg-badge {
  position: absolute; top: 0; left: calc(50% + 1.5px);
  min-width: 17px; height: 17px; padding: 0 3px; box-sizing: border-box;
  border-radius: 8.5px; background: var(--tg-badge);
  color: #FFFFFF; font: 600 12px/17px var(--tg-font); text-align: center;
}
.tg-tab:nth-child(5) .tg-badge { left: calc(50% + 7.5px); }
.tg-badge.is-alert { width: 16px; min-width: 16px; height: 16px; padding: 0; line-height: 16px; border-radius: 50%; }

.tg-search-fab {
  width: 64px; height: 64px; border-radius: 50%; border: 0; flex: none;
  display: flex; align-items: center; justify-content: center; color: var(--tg-label);
}
.tg-search-fab svg { width: 20.5px; height: 20.5px; stroke: currentColor; stroke-width: 2; fill: none; }
```

Разметка дока: `.tg-dock > .tg-tabbar.tg-glass + .tg-search-fab.tg-glass`; внутри `.tg-tabbar` первым идёт `.tg-tab-active-pill`, затем 4 `.tg-tab` (отсюда `nth-child(2…5)`). Центры вкладок взяты из замеров (Контакты 63.75, Звонки 137.75, Чаты 199, Настройки 271.5 pt от края экрана, минус 20.5 pt отступа дока).

## 10. Неуверенности

1. **Акцент.** Пик заливки активной иконки `#458AFF`; тонкий текст и кольцо info из-за JPEG выглядят как `#6684CC`…`#6984EB`. Рекомендация `#3E88F7` (тёмная тема Telegram) — по пику заливки, а не по тексту.
2. **Красный.** Бейджи в JPEG `#D6614D`; «Удалённый аккаунт» замерен под blur (`#B46660`). `#EB5545` — рекомендация, точный HEX кадр не даёт.
3. **Кегль имени.** Высота «О» показывает 16 pt, x-height — 17 pt. Взято 17, допуск ±1 pt.
4. **Стекло.** Над чёрным заливка даёт ровно `#181818` (≈ 9.4 % белого); радиус blur и saturate по статичному кадру не измерить — 20 px / 160 % оценочно.
5. **Подложка активной вкладки.** Нижний край сливается с нижним краем капсулы (обе ≈ y 876), поэтому высота 56 pt и inset 4 pt оценочны (±2 pt).
6. **Центры вкладок** неравномерны (шаг 74 / 61 / 72.5 pt). Возможно, это центры подписей разной ширины, а не слотов; при сетке «4 равных слота» центры были бы 58 / 133 / 208 / 283.
7. **Home Indicator** на скриншоте отсутствует (iOS не рисует его в снимке), отступ 20 pt под доком — от низа кадра.
8. **Капсула «TELEGRAM»** — системный индикатор iOS; её точная форма и текст на других моделях могут отличаться.
9. **Строка «Новый звонок».** Верх строки не отделён линией; высота 51.5 pt выведена из позиций nav и разделителя.
10. **Цвет иконки исходящего** (`#48484A`) замерен по 12-pt глифу, JPEG мог его затемнить; реальный цвет может быть ближе к `#636366`.
