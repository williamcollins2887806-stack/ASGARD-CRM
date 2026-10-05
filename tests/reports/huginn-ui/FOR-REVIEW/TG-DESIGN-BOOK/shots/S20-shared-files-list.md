# S20 — shared-files-list

## 1. Мета
- **Платформа**: iOS 26 (Liquid Glass-эпоха: стеклянные круглые кнопки навбара, стеклянная капсула-сегмент), портрет.
- **Приложение**: Telegram iOS.
- **Экран**: «Общие медиа» группы/чата → вкладка **«Файлы»** (список документов чата).
- **Тема**: Dark, чисто чёрный фон `#000000`.
- **Язык UI**: русский.
- **Контекст кадра**: чат «АСГАРД: Замена фа…» (заголовок обрезан многоточием), подзаголовок «48 файлов»; список в самом верху скролла; первая карточка-секция уходит за нижний край.
- **Системное время**: 09:54 (+ стрелка геолокации), по центру — синяя системная пилюля «TELEGRAM» (возврат в приложение / live-индикатор), справа сигнал 2/4, «LTE», батарея 51 % жёлтая (режим энергосбережения).
- **Исходный файл**: `REFS/S20.jpg`, фактический размер **473 × 1024 px** (а не 828 px — это даунскейл). Логическая ширина принята **414 pt** (по ТЗ; подтверждается тем, что боковые отступы = 18 px = 16 pt, кнопки = 50–51 px = 44 pt).
- **Масштаб пересчёта**: `1 pt = 1.1425 px файла` (= 2 px оригинала @2x). Ниже везде: `px` — пиксели файла 473×1024, `pt` — логические точки (= CSS px для воссоздания).

## 2. Иерархия слоёв
Снизу вверх:
1. **Screen background** — сплошной `#000000`, на весь экран.
2. **Status bar** (системный) — время + geo-стрелка слева; синяя пилюля «TELEGRAM» по центру; сигнал/LTE/батарея справа.
3. **Nav header** (без собственной подложки, прозрачный над чёрным):
   - 3.1 круглая стеклянная кнопка **Назад** (шеврон `‹`) — слева;
   - 3.2 **заголовок-блок** по центру: title «АСГАРД: Замена фа…» (белый, semibold) + subtitle «48 файлов» (серый);
   - 3.3 круглая стеклянная кнопка **Поиск** (лупа) — справа.
4. **Segmented tab strip** — стеклянная капсула во всю ширину (минус 16 pt по бокам), внутри горизонтально скроллящаяся лента табов: `[обрезанный предыдущий таб] · Медиа · **Файлы** (выбран, светлая пилюля) · Голосовые · Ссылки · [дальше скрыто]`.
5. **Files section card** — одна большая скруглённая карточка `#1C1C1E` (inset-grouped), без разделителей между строками, уходит за нижний край кадра.
   - 5.1 **File row** × 13 видимых (13-я обрезана снизу): `[иконка-документ 42 pt | превью-миниатюра 39 pt] + [title (1 строка, middle-ellipsis) / subtitle «размер • дата в время»]`.
6. Нижнего таб-бара, FAB, home-indicator на кадре **нет** (список идёт до края).

## 3. Геометрия
Все координаты — от левого верхнего угла экрана.

| Элемент | px (файл) | pt (логика) |
|---|---|---|
| Экран | 473 × 1024 | 414 × 896 |
| Status bar, высота (до верха кнопок) | ~0–60 | ~0–52 |
| Время «09:54», bbox цифр | x 24–92, y 22–34 | x 21–80, y 19–30 (высота цифр ≈ 10.5) |
| Пилюля «TELEGRAM» | x 184–287, y 5–31 | x 161–251, y 4–27 → **90 × 23**, radius 11.5 (полная капсула), центр x = 207 |
| Кнопка «Назад» | x 18–68, y 66–117 | x 16–60, y 58–102 → **Ø 44**, left 16 |
| Шеврон внутри | x 36–47, y 81–101 | 9.6 × 18.4, обводка ≈ 2.6 pt, центрирован (оптически сдвинут влево ~1 pt) |
| Кнопка «Поиск» | x 404–455, y 66–117 | x 354–398, y 58–102 → **Ø 44**, right 16 |
| Лупа внутри | x 418–439, y 80–101 | **18.4 × 18.4**, центрирована |
| Title «АСГАРД: Замена фа…» | x 142–329, y 75–90 | x 124–288 (ширина ≈ 164), центр x ≈ 206; baseline ≈ y 77 |
| Subtitle «48 файлов» | x 199–273, y 97–109 | x 174–239, центр x ≈ 207; baseline ≈ y 94 |
| Зазор title → subtitle (baseline–baseline) | ~19 px | ~16.5 pt |
| Центр блока заголовка по вертикали | ~y 92 px | ~y 80 pt = центр кнопок (58+22) |
| **Segmented strip** (капсула) | x 18–454, y 134–181 | x 16–398, y 117–158 → **382 × 41**, radius 20.5 (pill) |
| Зазор кнопки → strip | 117 → 134 = 17 px | ≈ 15 pt |
| **Selected pill** «Файлы» | x 140–230, y 138–177 | x 122.5–201, y 121–155 → **78.5 × 34**, radius 17; внутренний отступ от края strip сверху/снизу **3.5 pt** |
| Текст «Файлы» внутри pill | x 159–212 | padding слева 16.6 / справа 15.8 pt |
| Лейбл «Медиа» | x 67–118 | x 58.6–103.3 |
| Лейбл «Голосовые» | x 254–341 | x 222–298.5 |
| Лейбл «Ссылки» | x 382–442 | x 334–387 (до правого края strip остаётся ~10.5 pt) |
| Обрезанный левый таб | хвост глифа x 25–26 | x ≈ 22 — клип по маске капсулы |
| Шаг между лейблами (конец → начало) | 41–42 px | **~36 pt** ≈ 16 pt padding + 4 pt gap + 16 pt padding |
| Высота глифов лейблов (с ascender «Ф/й») | y 151–165 | ~12 pt; оптический центр = центр strip (y 137.5) |
| **Files card** | x 18/19–454/455, top y 199 | x 16–398 → **382 wide**, top **174**, низ за краем кадра |
| Зазор strip → card | 181 → 199 = 18 px | **≈ 16 pt** |
| Радиус card | ~26 px (по профилю угла: смещение 16 px на 2 px вниз, ~10 px на 6 px, ~1 px на 21 px) | **≈ 22–23 pt** |
| **Row height (шаг)** | 65.2 px (207→924 за 11 строк) | **57 pt** |
| Иконка-документ (pdf/docx) | x 31–78, y 207–254 (строка 0) | **≈ 42 × 42**, left 27 (≈ 11 pt от края card), top = row_top + 7.5 → вертикально по центру строки |
| Превью-миниатюра (строки 5–12) | x 32–76, 45 × 45 px (строка 5: y 534–578) | **≈ 39 × 39**, по центру того же 42-pt слота (≈1.5 pt внутрь), radius ≈ 5 |
| Загнутый угол иконки | ~12–14 px по катету, справа сверху | ≈ 11–12 pt |
| Текстовая колонка, left | x 93–95 | **x ≈ 82 pt** (66 pt от края card); зазор иконка → текст ≈ 14 pt |
| Title строки: верх → baseline | row_top + 14 px → baseline row_top + 26 px | baseline ≈ row_top + **22.8 pt** |
| Subtitle строки: baseline | row_top + 49 px | ≈ row_top + **43 pt**; baseline-to-baseline title→subtitle ≈ **20 pt** |
| Правая граница текста | max x 412 px | ≤ 360 pt → эффективный правый padding в card ≥ 16 pt (truncation middle) |
| Видимых строк | 13 (13-я: title y 995–1010, subtitle обрезан на 1023) | — |

Строки по порядку (row_top в pt = 174 + 57·i):
0 — `pdf`-иконка: «Исх. №20261002…02.10.2026 г..pdf» / «245.9 Кб • 2 окт. 2026 в 17:37»
1 — `docx`: «Исх. №2026092…29.09.2026.docx» / «43.3 Кб • 29 сен. 2026 в 16:06»
2 — `docx`: «вариант 2.docx» / «43.6 Кб • 28 сен. 2026 в 15:19»
3 — `docx`: «вариант 1.docx» / «44.4 Кб • 28 сен. 2026 в 15:19»
4 — `pdf`: «Исх_в_ООО_Асг…рос_сроков.pdf» / «345.3 Кб • 28 сен. 2026 в 13:52»
5 — превью: «Исх_письмо_в_…_08_09_2026.pdf» / «343.5 Кб • 10 сен. 2026 в 14:00»
6 — превью: «О_предоставлен…нтов_Асгард.pdf» / «314 Кб • 31 авг. 2026 в 15:40»
7 — превью: «Счет № 353 от 21.08.2026.pdf» / «300.6 Кб • 24 авг. 2026 в 14:45»
8 — превью: «АВР № 466 от 21.08.2026.pdf» / «435.5 Кб • 24 авг. 2026 в 14:44»
9 — превью: «Акт-отчет к заявке №03.pdf» / «893 Кб • 21 авг. 2026 в 16:46»
10 — превью: «Акт-отчет к заявке №02.pdf» / «730.6 Кб • 21 авг. 2026 в 16:46»
11 — превью: «ДС6 017ПР2680…12.08.2026 г..pdf» / «319.6 Кб • 18 авг. 2026 в 20:29»
12 — превью: «ДС5 017ПР2680…(подписано).pdf» / «335.2 Кб • 18 авг. 2026 в 20:28» (обрезано)

## 4. Цвет
Значения сняты пипеткой из JPEG (возможен дрейф ±2–4 по каналу из-за компрессии).

| Токен | Значение | Где замерено / эквивалент |
|---|---|---|
| `--tg-bg` | `#000000` | фон экрана (x 5–10, вся высота) |
| `--tg-glass-btn` | `#151515`–`#181818` | заливка круглых кнопок; ≈ `rgba(255,255,255,0.085)` поверх чёрного |
| `--tg-glass-rim` | `#212121`–`#2D2D2D` | 1-px светлая кромка по верху/левому краю кнопок и strip; ≈ `rgba(255,255,255,0.13–0.18)` |
| `--tg-seg-bg` | `#171717`–`#181818` | заливка капсулы-сегмента; ≈ `rgba(255,255,255,0.09)` |
| `--tg-seg-sel` | `#393939` (`#373737`–`#3D3D3F` по краям) | выбранная пилюля; ≈ `rgba(255,255,255,0.22)` поверх чёрного |
| `--tg-card` | `#1C1C1E` | карточка списка (= iOS `secondarySystemGroupedBackground` dark) |
| `--tg-text` | `#FFFFFF` | title строк, заголовок навбара, лейблы табов (все табы белые, выбранность — только пилюлей), шеврон, лупа, время |
| `--tg-text-secondary` | `#8E8E93` (рендер: массово `#828284`–`#8A8A8C`, пик `#9E9EA0`) | subtitle строк и «48 файлов»; ≈ `rgba(235,235,245,0.6)` |
| `--tg-file-pdf` | градиент сверху `#EB8769` → снизу `#E0616C` | иконка pdf (строки 0, 4) |
| `--tg-file-pdf-fold` | ≈ `#F6B89E` | загнутый уголок pdf (светлее, полупрозрачный белый поверх) |
| `--tg-file-doc` | градиент сверху `#86CCF5` → снизу `#559CE2` | иконка docx (строки 1–3) |
| `--tg-file-doc-fold` | ≈ `#C4E6FB` | загнутый уголок docx |
| Надпись на иконке | `#FFFFFF` (на pdf с лёгким розовым ореолом от JPEG) | «pdf», «docx» |
| Превью | белый лист `#FFFFFF`/`#F5F5F5` с серым/синим содержимым документа | строки 5–12 |
| `--tg-sys-pill` | `#3478F6` (центр `#317AFA`, кромка `#3D66BE`) | пилюля «TELEGRAM»; ≈ iOS systemBlue |
| Текст пилюли | `#FFFFFF` (на ярких местах `#D8F9FE` из-за JPEG) | «TELEGRAM» + логотип |
| Батарея | заливка жёлтая ≈ `#FFD60A`, цифры «51» тёмные ≈ `#000000`/`#5B5A56` | энергосбережение |
| Сигнал | 2 полосы `#FFFFFF`, 2 — ≈ `rgba(255,255,255,0.35)` | — |

## 5. Типографика
Шрифт — SF Pro (системный iOS), кириллица SF. Размеры выведены из высоты прописных (cap-height SF ≈ 0.705 em).

| Роль | Размер / вес | Цвет | Прочее |
|---|---|---|---|
| Время в status bar | ~16–17 pt, Semibold | `#FFFFFF` | tabular цифры, + geo-стрелка ~10 pt |
| «TELEGRAM» в пилюле | ~12 pt, Semibold/Bold, CAPS | `#FFFFFF` | letter-spacing ≈ +0.3 pt, логотип 12–13 pt слева, gap ~5 pt |
| Title навбара | **17 pt Semibold** (cap ≈ 11–12 pt) | `#FFFFFF` | 1 строка, `text-overflow: ellipsis` в конце («…»), max-width ≈ 414 − 2·(16+44+16) ≈ 262 pt (фактически обрезан на ~164 pt — значит лимит ≈ 170–180 pt или конец слова; см. §10) |
| Subtitle навбара | **13 pt Regular** | `#8E8E93` | по центру, line-height ≈ 16 pt |
| Лейблы табов | **15 pt Semibold** (глифы ~12 pt с «Ф/й») | `#FFFFFF` у всех | выбранный отличается только подложкой; letter-spacing ≈ −0.2 pt |
| Title файла | **16 pt Semibold** (cap ≈ 10.5–11.3 pt, 12–13 px) | `#FFFFFF` | 1 строка, **middle-ellipsis** («Исх. №20261002…02.10.2026 г..pdf» — сохраняет начало и расширение), letter-spacing ≈ −0.3 pt |
| Subtitle файла | **13 pt Regular** (цифры ≈ 9.2 pt, 10–11 px) | `#8E8E93` | формат `{размер} Кб • {d} {мес.} {yyyy} в {HH:mm}`; разделитель — `•` (U+2022) с пробелами; десятичная **точка** («245.9 Кб») |
| «pdf» на иконке | ~13–14 pt Bold, нижний регистр | `#FFFFFF` | по центру, чуть ниже геометрического центра (~+3 pt) |
| «docx» на иконке | ~12–13 pt Bold | `#FFFFFF` | по центру, ширина почти во всю иконку (паддинг ~3 pt) |

Вертикальный ритм строки (57 pt): верх → 7.5 pt → title (baseline 22.8) → subtitle (baseline 43) → низ; текстовый блок (≈ 36 pt) по центру строки.

## 6. Иконки/контролы
- **Кнопка «Назад»** — круг Ø 44 pt, стеклянная заливка `--tg-glass-btn`, кромка-блик 1 px сверху/слева. Внутри SF Symbol `chevron.left`, ~18.4 pt высотой, weight Semibold, белый, скруглённые концы.
- **Кнопка «Поиск»** — та же капсула Ø 44 pt; SF Symbol `magnifyingglass` 18.4 × 18.4 pt, weight Medium, белый; ручка вниз-вправо.
- **Segmented strip** — капсула 382 × 41 pt, внутри горизонтальный скролл табов; выбранный таб — внутренняя пилюля 34 pt высотой (inset 3.5 pt). Края ленты обрезаются по маске капсулы (слева виден хвостик предыдущего таба, «ı» на x ≈ 22 pt) — **без** fade-градиента (замер: фон `#181818` до самого края, затем сразу кромка).
- **Иконка файла** (pdf/docx) — «лист с загнутым углом»: скруглённый квадрат 42 pt, radius ≈ 10–11 pt на трёх углах, правый верхний угол срезан диагональю (катет ≈ 11–12 pt), в срезе — треугольник «загиба» светлее основного цвета; вертикальный линейный градиент (светлее сверху). По центру белая подпись расширения.
- **Превью PDF** — миниатюра первой страницы, 39 × 39 pt, `object-fit: cover` (видна верхняя часть листа с шапкой/логотипом), radius ≈ 5 pt, без рамки.
- **Пилюля «TELEGRAM»** — системный элемент iOS (не часть приложения): 90 × 23 pt, синяя, белый логотип-самолётик + текст.
- Индикаторов загрузки/скачивания, чекбоксов, chevron'ов справа в строках — **нет**.

## 7. Тени / бордеры / разделители
- **Тени**: нигде не обнаружены (чёрный фон, эффект неотличим). Для воссоздания — `box-shadow: none`.
- **Blur**: под навбаром/strip подложки нет; стеклянный blur Liquid Glass на чёрном фоне визуально не проявляется. Рекомендуется `backdrop-filter: blur(20px) saturate(180%)` на кнопках и strip — проявится только при скролле контента под ними (оценка).
- **Кромки стекла**: у кнопок и strip — 1 px (≈ 0.5–1 pt) светлый блик по верхнему краю `#2D2D2D` (≈ `rgba(255,255,255,0.15)`), по левому/правому боку `#212121`–`#232323`, по нижнему краю strip — `#202020`–`#212121` 2 px (мягче). Реализуемо как `inset 0 0.5px 0 rgba(255,255,255,.15), inset 0 0 0 0.5px rgba(255,255,255,.06)`.
- **Selected pill**: верхний край на 1 px светлее (`#303030` → `#393939`), без выраженной обводки.
- **Card**: бордера нет, только заливка `#1C1C1E` на `#000`.
- **Разделители между строками**: **отсутствуют** — проверено по столбцам x = 150/300/420 px в промежутках между строками: сплошной `#1C1C1E`, ни одного пикселя hairline.

## 8. Состояния на кадре
- Активный таб — **«Файлы»** (selected pill); «Медиа», «Голосовые», «Ссылки» — normal; слева скрыт ещё минимум один таб, справа — вероятно ещё табы (лента скроллится).
- Список — в начальной позиции (card top на 16 pt под strip), скролл-индикатора не видно.
- Строки — default (без highlight/press, без выделения, без режима выбора).
- Две ветки отрисовки «лида» строки: **иконка-заглушка типа** (pdf/docx без превью; строки 0–4) и **миниатюра-превью** (PDF с готовым thumbnail; строки 5–12).
- Заголовок навбара обрезан многоточием (длинное имя чата).
- Батарея в режиме энергосбережения (жёлтая), активна системная пилюля приложения.

## 9. CSS-скелет
```css
:root {
  --tg-bg: #000000;
  --tg-card: #1C1C1E;
  --tg-glass: rgba(255, 255, 255, 0.085);
  --tg-glass-rim: rgba(255, 255, 255, 0.15);
  --tg-seg-bg: rgba(255, 255, 255, 0.09);
  --tg-seg-sel: rgba(255, 255, 255, 0.22);
  --tg-text: #FFFFFF;
  --tg-text-secondary: #8E8E93;
  --tg-file-pdf: linear-gradient(180deg, #EB8769 0%, #E0616C 100%);
  --tg-file-pdf-fold: #F6B89E;
  --tg-file-doc: linear-gradient(180deg, #86CCF5 0%, #559CE2 100%);
  --tg-file-doc-fold: #C4E6FB;
  --tg-font: -apple-system, "SF Pro Text", "SF Pro", system-ui, sans-serif;
  --tg-side: 16px;           /* 1 CSS px = 1 pt */
  --tg-row-h: 57px;
  --tg-lead: 42px;
}

.tg-screen {
  width: 414px; min-height: 896px;
  background: var(--tg-bg);
  font-family: var(--tg-font);
  color: var(--tg-text);
  padding-top: 58px;          /* status bar + верх кнопок */
}

/* ---------- Nav header ---------- */
.tg-nav {
  position: relative;
  height: 44px;
  margin: 0 var(--tg-side);
  display: flex; align-items: center; justify-content: space-between;
}
.tg-glass-btn {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--tg-glass);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
          backdrop-filter: blur(20px) saturate(180%);
  box-shadow: inset 0 0.5px 0 var(--tg-glass-rim),
              inset 0 0 0 0.5px rgba(255, 255, 255, 0.06);
  display: grid; place-items: center;
  border: 0; color: var(--tg-text);
}
.tg-glass-btn--back svg   { width: 10px; height: 18px; margin-left: -1px; } /* chevron.left, stroke 2.6 */
.tg-glass-btn--search svg { width: 18px; height: 18px; }                    /* magnifyingglass */

.tg-nav__title-block {
  position: absolute; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  max-width: 180px;           /* см. §10 */
  text-align: center;
}
.tg-nav__title {
  font-size: 17px; font-weight: 600; line-height: 21px; letter-spacing: -0.4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tg-nav__subtitle {
  font-size: 13px; font-weight: 400; line-height: 16px;
  color: var(--tg-text-secondary);
}

/* ---------- Segmented tab strip ---------- */
.tg-seg {
  margin: 15px var(--tg-side) 0;
  height: 41px; border-radius: 20.5px;
  background: var(--tg-seg-bg);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
          backdrop-filter: blur(20px) saturate(180%);
  box-shadow: inset 0 0.5px 0 var(--tg-glass-rim),
              inset 0 -1px 0 rgba(255, 255, 255, 0.05);
  overflow: hidden;           /* клип хвоста соседних табов, без fade */
}
.tg-seg__track {
  display: flex; align-items: center; gap: 4px;
  height: 100%; padding: 0 3.5px;
  overflow-x: auto; scrollbar-width: none;
}
.tg-seg__tab {
  flex: none; height: 34px; padding: 0 16px; border-radius: 17px;
  display: flex; align-items: center;
  font-size: 15px; font-weight: 600; letter-spacing: -0.2px;
  color: var(--tg-text); background: transparent; border: 0;
}
.tg-seg__tab--active,
.tg-seg__tab[aria-selected="true"] {
  background: var(--tg-seg-sel);
  box-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.06);
}

/* ---------- Files card ---------- */
.tg-card {
  margin: 16px var(--tg-side) 0;
  background: var(--tg-card);
  border-radius: 22px;
  overflow: hidden;
}
.tg-file-row {
  height: var(--tg-row-h);
  display: flex; align-items: center; gap: 14px;
  padding: 0 16px 0 11px;
  /* разделителей нет */
}
.tg-file-row:active { background: rgba(255, 255, 255, 0.06); } /* не на кадре, оценка */

.tg-file-icon {
  position: relative; flex: none;
  width: var(--tg-lead); height: var(--tg-lead);
  border-radius: 10px;
  clip-path: polygon(0 0, 72% 0, 100% 28%, 100% 100%, 0 100%); /* срез правого верхнего угла */
  display: grid; place-items: center;
  padding-top: 6px;
  font-size: 13px; font-weight: 700; color: #FFFFFF;
}
.tg-file-icon::after {            /* загиб уголка */
  content: ""; position: absolute; top: 0; right: 0;
  width: 12px; height: 12px;
  border-bottom-left-radius: 3px;
  background: var(--tg-fold);
}
.tg-file-icon--pdf  { background: var(--tg-file-pdf); --tg-fold: var(--tg-file-pdf-fold); }
.tg-file-icon--docx { background: var(--tg-file-doc); --tg-fold: var(--tg-file-doc-fold); font-size: 12px; }

.tg-file-thumb {
  flex: none;
  width: 39px; height: 39px; margin: 1.5px;   /* в слоте 42 */
  border-radius: 5px;
  object-fit: cover; object-position: top;
  background: #FFFFFF;
}

.tg-file-row__text { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.tg-file-row__title {
  font-size: 16px; font-weight: 600; line-height: 20px; letter-spacing: -0.3px;
  color: var(--tg-text);
  white-space: nowrap; overflow: hidden;
  /* middle-ellipsis делается в JS: head + "…" + tail (с расширением) */
}
.tg-file-row__meta {
  margin-top: 1px;
  font-size: 13px; font-weight: 400; line-height: 17px;
  color: var(--tg-text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tg-file-row__meta-dot::before { content: " • "; }
```

Разметка-скелет:
```html
<div class="tg-screen">
  <header class="tg-nav">
    <button class="tg-glass-btn tg-glass-btn--back" aria-label="Назад"><!-- chevron.left --></button>
    <div class="tg-nav__title-block">
      <div class="tg-nav__title">АСГАРД: Замена файлов…</div>
      <div class="tg-nav__subtitle">48 файлов</div>
    </div>
    <button class="tg-glass-btn tg-glass-btn--search" aria-label="Поиск"><!-- magnifyingglass --></button>
  </header>
  <nav class="tg-seg"><div class="tg-seg__track">
    <button class="tg-seg__tab">Участники</button>
    <button class="tg-seg__tab">Медиа</button>
    <button class="tg-seg__tab tg-seg__tab--active" aria-selected="true">Файлы</button>
    <button class="tg-seg__tab">Голосовые</button>
    <button class="tg-seg__tab">Ссылки</button>
  </div></nav>
  <section class="tg-card">
    <div class="tg-file-row">
      <div class="tg-file-icon tg-file-icon--pdf">pdf</div>
      <div class="tg-file-row__text">
        <div class="tg-file-row__title">Исх. №20261002…02.10.2026 г..pdf</div>
        <div class="tg-file-row__meta">245.9 Кб<span class="tg-file-row__meta-dot"></span>2 окт. 2026 в 17:37</div>
      </div>
    </div>
    <div class="tg-file-row">
      <img class="tg-file-thumb" src="thumb.jpg" alt="">
      <div class="tg-file-row__text">
        <div class="tg-file-row__title">Счет № 353 от 21.08.2026.pdf</div>
        <div class="tg-file-row__meta">300.6 Кб<span class="tg-file-row__meta-dot"></span>24 авг. 2026 в 14:45</div>
      </div>
    </div>
  </section>
</div>
```

## 10. Неуверенности
Измерено пипеткой/сканом пикселей (надёжно, ±1 px файла ≈ ±1 pt): фон `#000`, карточка `#1C1C1E`, заливки кнопок/strip/выбранной пилюли, все bbox элементов, шаг строки 57 pt, отступы 16 pt, отсутствие разделителей, отсутствие fade на краях strip, градиенты иконок (по 2 точкам).

Оценено **глазом / выведено косвенно**:
- **Масштаб**: файл 473 px (не 828). Принято 414 pt по ТЗ; если реальное устройство 390 pt (iPhone 12–16, то же соотношение сторон 0.462), все pt-значения нужно умножить на 0.942 (кнопки станут 42 pt, отступы 15 pt — менее «круглые» числа, поэтому 414 вероятнее).
- **Кегли шрифтов** (17/13/15/16/13 pt) — выведены из высоты прописных на даунскейленном JPEG, погрешность ±1 pt; вес Semibold vs Bold для title файла — на глаз.
- **Радиус карточки** ≈ 22–23 pt — по профилю угла на 3 точках, погрешность ±2 pt.
- **Радиус иконки** (≈10 pt), размер загиба (≈11–12 pt) и **цвета загиба** (`#F6B89E`, `#C4E6FB`) — на глаз по увеличенному кропу; пипетка в точке среза попала в фон.
- **Радиус превью** ≈ 5 pt — на глаз.
- **Alpha-эквиваленты** стекла (`0.085`, `0.09`, `0.22`, кромка `0.15`) — пересчёт из непрозрачных цветов на чёрном; на другом фоне реальный Liquid Glass даст другой вид (преломление/blur/specular), значения blur 20 px и saturate 180 % — **не измеримы на этом кадре**, взяты как типичные.
- **Тени** — не обнаружены, но на чёрном фоне тёмная тень и не была бы видна.
- **max-width заголовка навбара**: обрезка «Замена фа…» на ~164 pt при доступных ~262 pt — неясно, задан ли лимит ширины или Telegram режет по иному правилу; 180 px в CSS — подгонка под кадр.
- **Скрытый левый таб** — по хвостику глифа «ı» видно только, что таб есть; подпись («Участники»/иное) — предположение.
- **Gap 4 pt + padding 16 pt** у табов — разложение шага 36 pt на составляющие неоднозначно (может быть padding 18 + gap 0).
- **Press-state** строки (`rgba(255,255,255,.06)`) и цвета статус-бара (жёлтый `#FFD60A`, тусклые полосы сигнала) — по памяти о системных значениях iOS, на кадре не измерены точно.
- Цвета в целом — из JPEG с хромасубсемплингом: на тонком тексте и цветных краях возможен ореол (розоватый вокруг «pdf», голубой вокруг «TELEGRAM»), реальные значения текста — чистый `#FFFFFF`.
