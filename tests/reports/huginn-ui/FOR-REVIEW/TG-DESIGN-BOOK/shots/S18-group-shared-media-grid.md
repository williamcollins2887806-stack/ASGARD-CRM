# S18 — group-shared-media-grid

## 1. Мета

| Поле | Значение |
|---|---|
| **Shot** | S18 |
| **Slug** | `group-shared-media-grid` |
| **Источник** | `TG-DESIGN-BOOK/REFS/S18.jpg` |
| **Файл** | 473 × 1024 px, JPEG RGB — даунскейл с 828 × 1792 (@2x), коэффициент 1.7505 по обеим осям (равномерный) |
| **Логический кадр** | **414 × 896 pt** (iPhone XR / 11 / 11 Pro Max class, @2x) — по условию задачи |
| **Пересчёт** | `pt = px_файла × 0.8753` · `px@2x = px_файла × 1.7505` · `1 pt ≈ 1.1425 px_файла` |
| **ОС / тема** | iOS 26-стиль (Liquid Glass-кнопки и капсула-таббар), Dark Mode, фон OLED `#000000` |
| **Приложение** | Telegram iOS |
| **Экран** | «Общие медиа» группы (Shared Media), вкладка **«Медиа»** — сетка 3 колонки |
| **Язык UI** | RU |

Видимый текст UI:
- Status bar: `09:54` + стрелка геолокации · капсула `TELEGRAM` · сигнал 3/4 · `LTE` · батарея `51` (жёлтая).
- Заголовок: `АСГАРД: Замена фа…` (обрезка многоточием) · подзаголовок `84 фото, 7 видео`.
- Табы: `Участники` · **`Медиа`** (выбран) · `Файлы` · `Голосовые`.
- Сетка: 5 полных рядов + 6-й обрезан низом кадра (скриншоты писем, акты-отчёты, скриншоты чатов, фото неба/промобъекта). Контент миниатюр — пользовательские данные, в спецификацию не переносится (только как «контент тайла»).

## 2. Иерархия слоёв

Сверху вниз по z-order:

1. **System status bar** (0–~46 pt): время + location-arrow слева; синяя капсула `TELEGRAM` по центру; сигнал / LTE / батарея справа.
2. **Floating nav header** (поверх контента, фон экрана `#000`):
   - 2.1 Круглая glass-кнопка «назад» (chevron.left) слева.
   - 2.2 Центральный блок: title (1 строка, truncation tail) + subtitle (счётчик медиа).
   - 2.3 Круглая glass-кнопка «ещё» (ellipsis.circle) справа.
3. **Segmented tab strip** — капсула-контейнер на всю ширину минус 16 pt по краям; внутри 4 текстовых таба; под выбранным — светлая «пилюля»-индикатор.
4. **Media grid** — 3 колонки квадратных тайлов, межтайловый зазор 1 pt (чёрный фон просвечивает), full-bleed по ширине (0 pt боковых отступов), без скругления.
5. **Screen background** — сплошной `#000000`.

Home indicator / нижний таббар на кадре **не видны** (см. §10).

Визуальный приоритет: сетка миниатюр (яркие белые документы) → табы с выбранной пилюлей → title → круглые кнопки.

## 3. Геометрия

Все значения — **pt** (в скобках — px файла 473×1024 там, где это прямой замер).

### 3.1 Status bar

| Элемент | Значение |
|---|---|
| Высота зоны | ~46 pt (контент header начинается ниже, первая кнопка y = 57.8) |
| Время `09:54` | left ≈ 21 pt (24 px), bbox текста+стрелки 21→80 pt, вертикальный центр ≈ 24.5 pt (28 px) |
| Капсула `TELEGRAM` | x 163 → 251 pt (186–287 px) → **88 × 23 pt**, top ≈ 4.4 pt (5 px), центр по X = 207 pt (центр экрана), `border-radius: 11.5pt` (полная капсула) |
| Правый кластер (сигнал + LTE + батарея) | x 326 → 396 pt (373–452 px), центр y ≈ 24.5 pt |
| Батарея | корпус ≈ 23 × 11 pt, x ≈ 371–394 pt, + «пупочка» справа ≈ 1.5 × 4 pt |

### 3.2 Nav header

| Элемент | Значение |
|---|---|
| Кнопка «назад» | x **16 → 60 pt** (19–68 px), y **57.8 → 101.5 pt** (66–116 px) → **44 × 44 pt**, `border-radius: 50%`, центр (38, 80) |
| Кнопка «ещё» | x **354 → 398 pt** (404–455 px), тот же y → **44 × 44 pt**, правый inset 16 pt, центр (376, 80) |
| Chevron «назад» | bbox 9.6 × 17.5 pt (11×20 px), x 31.5–41 pt, y 71–88.5 pt; оптический центр смещён влево от центра кнопки на ~2 pt |
| Иконка ellipsis.circle | внешний круг Ø **21 pt** (24 px), x 365–386 pt, y 69–90 pt |
| Title | bbox x **123 → 288 pt** (141–329 px) → ширина ≈ **165 pt**; cap-top 64.8 pt, нижняя граница (с выносным «Д») 78.8 pt; центр по X = 207 pt |
| Subtitle | bbox x **154 → 259 pt** (176–296 px) → ≈ 105 pt; y 84.9 → 96.3 pt |
| Title→subtitle | baseline-to-baseline ≈ 18–19 pt; блок title+subtitle центрирован по вертикали с кнопками (центр ≈ 80.5 pt) |
| Max-width title | фактически ≈ 165–170 pt (обрезка наступает задолго до кнопок, зазор до кнопок ~63 pt с каждой стороны) |

### 3.3 Segmented tab strip

| Элемент | Значение |
|---|---|
| Контейнер | x **16 → 398 pt** (18–454 px) → **382 × 40 pt**; y **118.2 → 158.4 pt** (135–181 px); `border-radius: 20pt` (полная капсула) |
| Отступ от кнопок header | 101.5 → 118.2 ≈ **16 pt** |
| Пилюля выбранного таба | x **121.7 → 198.7 pt** (139–227 px) → ≈ **77 × 34 pt**; y 121.7 → 154.9 pt; inset от контейнера ≈ **3–3.5 pt** сверху/снизу; `border-radius: 17pt` |
| Label `Участники` | x 29.8 → 104.2 pt (w ≈ 74.4) |
| Label `Медиа` | x 139.2 → 184.7 pt (w ≈ 45.5); padding пилюли ≈ 17.5 pt слева / 14 pt справа → ≈ **16 pt** в среднем |
| Label `Файлы` | x 219.7 → 267.0 pt (w ≈ 47.3) |
| Label `Голосовые` | x 303.7 → 379.9 pt (w ≈ 76.2) |
| Зазор между labels | **35 / 35 / 36.7 pt** — постоянный ≈ 35 pt (≈ 17.5 pt padding на таб) |
| Внешние поля labels | слева 13.8 pt от края контейнера, справа 18 pt — асимметрия ≈ 4 pt (вероятно, горизонтально скроллящаяся лента) |
| Cap-height labels | y 133 → 142.7 pt, центр 137.9 pt = центр контейнера (138.3) |

### 3.4 Media grid

| Параметр | Значение |
|---|---|
| Top сетки | **174.2 pt** (199 px); зазор от низа таб-капсулы ≈ **16 pt** |
| Боковые отступы | **0** (full-bleed) |
| Колонки | 3; x тайлов: 0 → 137.3 · 138.3 → 275.7 · 276.7 → 414 pt (0–155 / 158–313 / 316–472 px) |
| Размер тайла | **137.33 × 137.33 pt** = `(414 − 2×1) / 3`, квадрат (aspect 1:1) |
| Межтайловый зазор | **1 pt** по горизонтали и вертикали (≈ 1.2–1.4 px файла, ≈ 2 px @2x), цвет зазора = фон `#000` |
| Шаг рядов | 138.3 pt (158 px): ряды начинаются на y = 174.2 / 312.5 / 450.8 / 589.1 / 727.4 / 865.7 pt |
| Видимые ряды | 5 полных + 6-й обрезан на ~30 pt |
| Скругление тайлов | 0 |

## 4. Цвет

| Токен | Значение | Где / замер |
|---|---|---|
| `--tg-bg` | `#000000` | фон экрана, header, зазоры сетки (0,0,0) |
| `--tg-glass-fill` | `#181818` (сверху) → `#1A1A1A` (снизу) ≈ `rgba(255,255,255,0.094→0.10)` над чёрным | кнопки 44 pt и таб-капсула (замеры 24→26) |
| `--tg-glass-rim-top` | `#2E2E2E` ≈ `rgba(255,255,255,0.18)` | верхняя 1 px-кромка таб-капсулы (46); у круглых кнопок `#222` (34) |
| `--tg-glass-rim` | `#212121`–`#232323` ≈ `rgba(255,255,255,0.12–0.14)` | боковые и нижняя кромки (29–35) |
| `--tg-seg-pill` | `#393939`–`#3D3D3D` ≈ `rgba(255,255,255,0.15)` поверх glass-fill | пилюля выбранного таба (56–61) |
| `--tg-text` | `#FFFFFF` | title, все labels табов (и невыбранные тоже — 255), chevron, ellipsis, время |
| `--tg-text-secondary` | `#9A9A9C` ≈ `rgba(235,235,245,0.60)` | subtitle «84 фото, 7 видео» (154,154,156) |
| `--tg-sys-pill` | `#027BFF` (замер 2,123,255; края JPEG 0,123,253) ≈ iOS `systemBlue` `#007AFF` | капсула `TELEGRAM` |
| `--tg-battery-lowpower` | `#FCCF1E` (замер 252,207,30; пик 244,210,24) ≈ iOS `systemYellow` dark `#FFD60A` | заполненная часть батареи (Low Power Mode) |
| `--tg-battery-empty` | `#7F7F7F` ≈ `rgba(255,255,255,0.40)` | незаполненная часть корпуса батареи |
| Цифры в батарее | `#000000` | «51» внутри жёлтой заливки |
| Сигнал, неактивный бар | ≈ `rgba(255,255,255,0.35)` | 4-й бар (3/4 активны) |

Контент тайлов (не UI-токены, для справки): белые документы `#FEFEFE`, тёмный скрин письма `#252429`, скрины чата — фон `#363845`, исходящий пузырь `#6460CF`.

## 5. Типографика

Шрифт системный: SF Pro (Display для ≥20 pt, Text ниже), кириллица из SF.

| Роль | Размер | Насыщенность | Цвет | Прочее |
|---|---|---|---|---|
| Status time `09:54` | 17 pt | 600 (Semibold) | `#FFF` | tabular-nums; cap ≈ 10.5–11 pt |
| `TELEGRAM` в капсуле | 12–13 pt | 600–700 | `#FFF` | UPPERCASE, `letter-spacing ≈ 0.3–0.5pt`; слева иконка-самолётик ~13 pt |
| `LTE` | 13–14 pt | 600 | `#FFF` | |
| Title | **17 pt** | **600** | `#FFF` | 1 строка, `text-overflow: ellipsis`; cap ≈ 11.4 pt; средняя ширина знака ≈ 9.2 pt |
| Subtitle | **13 pt** | 400 | `#9A9A9C` | line-height ≈ 16 pt |
| Label таба | **15 pt** | **500** (Medium; возможно 590 Semibold) | `#FFF` у всех | cap ≈ 9.6 pt; выбранный отличается только пилюлей, не цветом/весом |
| Батарея «51» | ~11 pt | 700 | `#000` | внутри корпуса |

Line-heights: title ≈ 22 pt, subtitle ≈ 16 pt, label таба ≈ 20 pt (внутри высоты 34 pt пилюли).

## 6. Иконки/контролы

| Контрол | Описание |
|---|---|
| **Back** | Круг 44 pt, glass-fill + 1 px rim. Глиф SF `chevron.left`, ≈ 9.6 × 17.5 pt, stroke ≈ 2.5 pt, round caps/joins, `#FFF`. Без текста «Назад». |
| **More** | Круг 44 pt, тот же материал. Глиф SF `ellipsis.circle`: окружность Ø 21 pt, stroke ≈ 1.75 pt, внутри 3 точки Ø ≈ 2.6 pt, шаг ≈ 5.25 pt, по центру. |
| **Tab strip** | Капсула-контейнер 382 × 40, 4 таба. Выбранный — пилюля 77 × 34 pt, r = 17. Ленту, вероятно, можно скроллить горизонтально (в Telegram есть ещё «Ссылки», «Музыка», «GIF»). |
| **Media tile** | `img` cover-кроп в квадрат 137.33 pt, без скругления, без рамок. На видимых тайлах нет бейджа длительности видео (7 видео в счётчике — вне кадра). |
| **Status capsule `TELEGRAM`** | Системная iOS-капсула (фоновая активность приложения), белый самолётик + надпись. Не часть UI Telegram — для воссоздания макета опциональна. |
| **Status icons** | location-arrow (заливка, ~10 pt) после времени; signal 4 бара (3 активных); `LTE`; батарея с процентом внутри, жёлтая (Low Power). |

Hit-area: кнопки = 44 × 44 pt (HIG-минимум, совпадает с визуальным кругом); табы — вся высота капсулы 40 pt × ширина таба (≈ label + 35 pt).

## 7. Тени / бордеры / разделители

| Элемент | Значение |
|---|---|
| Glass-кнопки 44 pt | `border: 1px solid rgba(255,255,255,0.12)` (на @2x — 1 физ. px ≈ 0.5 pt); сверху кромка светлее (`#222` vs fill `#181818`); fill с лёгким вертикальным градиентом `#181818 → #1A1A1A`. Внешней тени не видно (на чёрном фоне неразличима). |
| Таб-капсула | Тот же материал; верхняя кромка заметно ярче: `inset 0 1px 0 rgba(255,255,255,0.18)`, остальные кромки ≈ 0.12. Тени нет. |
| Пилюля выбранного таба | Плоская заливка `rgba(255,255,255,0.15)`, без бордера; по боковым краям — мягкий переход 2 px (антиалиас скругления r = 17). Тени нет. |
| Backdrop blur | На кадре glass-элементы лежат над чистым `#000` — размытие не проявляется. По материалу iOS 26 ожидается `backdrop-filter: blur(20–30px) saturate(1.8)` при прокрутке контента под header. |
| Сетка | Разделители — не линии, а **зазоры 1 pt** фона `#000` между тайлами. |
| Header / сетка | Жёсткой линии-разделителя нет; переход «header → сетка» — просто 16 pt чёрного. Scroll-edge-градиента над первым рядом нет (контент не прокручен). |

## 8. Состояния на кадре

| Элемент | Состояние |
|---|---|
| Таб `Медиа` | **selected** — пилюля `rgba(255,255,255,0.15)` |
| Табы `Участники` / `Файлы` / `Голосовые` | normal (цвет текста тот же `#FFF`, без фона) |
| Кнопки back / more | normal (без pressed-подсветки) |
| Title | truncated (`…`) — длинное имя группы |
| Сетка | scroll-offset = 0 (первый ряд ровно на 174.2 pt), загружены все миниатюры, плейсхолдеров/шиммера нет, режим выбора (чекбоксы) выключен |
| Система | Low Power Mode (жёлтая батарея 51 %), активна геолокация (стрелка), фоновая активность Telegram (синяя капсула), LTE, сигнал 3/4 |

## 9. CSS-скелет

```css
:root {
  --tg-bg: #000000;
  --tg-text: #FFFFFF;
  --tg-text-secondary: #9A9A9C;            /* ≈ rgba(235,235,245,.60) */
  --tg-glass-fill-top: rgba(255,255,255,.094); /* #181818 над #000 */
  --tg-glass-fill-bot: rgba(255,255,255,.102); /* #1A1A1A */
  --tg-glass-rim: rgba(255,255,255,.12);
  --tg-glass-rim-top: rgba(255,255,255,.18);
  --tg-seg-pill: rgba(255,255,255,.15);    /* → #3B3B3B поверх fill */
  --tg-sys-pill: #027BFF;
  --tg-font: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
  --tg-grid-gap: 1px;                      /* 1pt */
}

.tg-screen {
  width: 414px; min-height: 896px;
  background: var(--tg-bg);
  color: var(--tg-text);
  font-family: var(--tg-font);
  position: relative; overflow: hidden;
}

/* --- status bar (system, опционально) --- */
.tg-statusbar { position: absolute; inset: 0 0 auto 0; height: 46px; }
.tg-statusbar__time { position: absolute; left: 21px; top: 15px;
  font: 600 17px/20px var(--tg-font); font-variant-numeric: tabular-nums; }
.tg-statusbar__app-pill { position: absolute; left: 163px; top: 4px;
  width: 88px; height: 23px; border-radius: 11.5px;
  background: var(--tg-sys-pill);
  display: flex; align-items: center; justify-content: center; gap: 5px;
  font: 700 12.5px/1 var(--tg-font); letter-spacing: .4px; text-transform: uppercase; }

/* --- floating header --- */
.tg-media-header { position: absolute; top: 0; left: 0; right: 0; height: 174px; z-index: 10; }

.tg-glass-btn {
  position: absolute; top: 58px;
  width: 44px; height: 44px; border-radius: 50%;
  background: linear-gradient(180deg, var(--tg-glass-fill-top), var(--tg-glass-fill-bot));
  border: .5px solid var(--tg-glass-rim);
  box-shadow: inset 0 .5px 0 var(--tg-glass-rim-top);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
          backdrop-filter: blur(24px) saturate(180%);
  display: grid; place-items: center; color: var(--tg-text);
}
.tg-glass-btn--back { left: 16px; }
.tg-glass-btn--back .tg-icon { width: 10px; height: 18px; margin-left: -4px; } /* chevron.left, stroke 2.5 */
.tg-glass-btn--more { right: 16px; }
.tg-glass-btn--more .tg-icon { width: 21px; height: 21px; }                 /* ellipsis.circle, stroke 1.75 */

.tg-media-header__titles {
  position: absolute; top: 61px; left: 50%; transform: translateX(-50%);
  max-width: 170px; text-align: center;
}
.tg-media-header__title {
  font: 600 17px/22px var(--tg-font);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tg-media-header__subtitle {
  font: 400 13px/16px var(--tg-font); color: var(--tg-text-secondary);
}

/* --- segmented tab strip --- */
.tg-seg {
  position: absolute; top: 118px; left: 16px; right: 16px;
  height: 40px; border-radius: 20px; padding: 3px;
  background: linear-gradient(180deg, var(--tg-glass-fill-top), var(--tg-glass-fill-bot));
  border: .5px solid var(--tg-glass-rim);
  box-shadow: inset 0 1px 0 var(--tg-glass-rim-top);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
          backdrop-filter: blur(24px) saturate(180%);
  display: flex; align-items: center; gap: 3px;
  overflow-x: auto; scrollbar-width: none;
}
.tg-seg__tab {
  flex: 0 0 auto; height: 34px; padding: 0 16px; border-radius: 17px;
  font: 500 15px/20px var(--tg-font); color: var(--tg-text);
  background: transparent; border: 0;
  display: inline-flex; align-items: center;
}
.tg-seg__tab--active { background: var(--tg-seg-pill); }

/* --- media grid --- */
.tg-media-grid {
  padding-top: 174px;
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: var(--tg-grid-gap);
  background: var(--tg-bg);
}
.tg-media-grid__tile { aspect-ratio: 1 / 1; overflow: hidden; border-radius: 0; }
.tg-media-grid__tile > img { width: 100%; height: 100%; object-fit: cover; display: block; }
```

Разметка-ориентир:

```html
<div class="tg-screen">
  <header class="tg-media-header">
    <button class="tg-glass-btn tg-glass-btn--back"><svg class="tg-icon"/></button>
    <div class="tg-media-header__titles">
      <div class="tg-media-header__title">АСГАРД: Замена фа…</div>
      <div class="tg-media-header__subtitle">84 фото, 7 видео</div>
    </div>
    <button class="tg-glass-btn tg-glass-btn--more"><svg class="tg-icon"/></button>
    <nav class="tg-seg">
      <button class="tg-seg__tab">Участники</button>
      <button class="tg-seg__tab tg-seg__tab--active">Медиа</button>
      <button class="tg-seg__tab">Файлы</button>
      <button class="tg-seg__tab">Голосовые</button>
    </nav>
  </header>
  <main class="tg-media-grid"><!-- .tg-media-grid__tile × N --></main>
</div>
```

## 10. Неуверенности

| Что | Оценка / почему |
|---|---|
| Логическая ширина 414 pt | Взята из условия. Пропорции 473×1024 также совпадают с **430 × 932 pt** (iPhone Plus/Pro Max @3x, Dynamic Island) — тогда все pt ×1.039. Синяя капсула по центру статус-бара больше похожа на устройство с Dynamic Island; модель девайса не подтверждена. |
| Размеры шрифтов (17 / 13 / 15 pt) и веса (600 / 400 / 500) | **Оценены глазом** по cap-height и средней ширине знака на JPEG 473 px; погрешность ±1 pt, вес таба мог быть Semibold. |
| Альфы glass (0.094 / 0.12 / 0.18 / 0.15) | Выведены из замеров RGB над чистым чёрным; поверх цветного контента реальный материал Liquid Glass даст иной цвет (refraction/saturation) — на кадре не проверяемо. |
| Backdrop blur 24 px, saturate 180 % | **Не наблюдается на кадре** (под элементами только `#000`); значение по типовому iOS-материалу. |
| Толщина rim 0.5 pt vs 1 pt | После даунскейла ×1.75 кромка занимает 1–2 px файла; точная толщина не различима. |
| Зазор сетки 1 pt | Замер 1.2–1.4 px файла (≈ 2 px @2x) — согласуется с 1 pt, но может быть и 1/scale. |
| Раскладка табов | Labels с постоянным зазором ~35 pt, но поля 13.8 / 18 pt асимметричны → предполагаю скроллящуюся ленту с дополнительными табами за правым краем; паддинги 16 pt / gap 3 pt в CSS — реконструкция, не прямой замер. |
| Max-width title ≈ 170 pt | Выведено из точки обрезки; правило Telegram для ширины title не подтверждено. |
| Капсула `TELEGRAM` | Системный индикатор iOS; причина (звонок / трансляция / фоновая активность) и точный шрифт **оценены глазом**. |
| Иконки (stroke 2.5 / 1.75 pt, точки 2.6 pt) | По 11–24 px глифам JPEG — **оценка глазом**, ±0.5 pt. |
| Home indicator | Не виден в нижних 30 px (там яркое фото без белой полосы) — скрыт в этом режиме или срезан при экспорте; не утверждаю. |
| HEX контента миниатюр | Служат только справкой, это не токены UI. |
