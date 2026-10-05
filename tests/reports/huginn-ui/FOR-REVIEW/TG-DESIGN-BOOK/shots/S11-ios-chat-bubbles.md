# S11 — ios-chat-bubbles

## 1. Мета
- **Кадр:** `REFS/S11.jpg`, физический размер **828×1792** px → логический **414×896** @2x (iPhone XR / 11 / SE-класса без Dynamic Island; статус-бар с LTE + иконкой Telegram).
- **Платформа:** iOS Telegram, тёмная тема чата с **кастомным фоном** (фото пары, сильно размыто).
- **Контекст:** личный чат «Анна Скворцова»; под хедером активна **трансляция геопозиции** («Трансляция Вы»).
- **Содержимое ленты:** исходящие фиолетовые текстовые пузыри; разделитель даты «13 сентября»; два входящих **пересланных файла** `.docx` (47 КБ / 635,5 КБ) со стеклянными пузырями; внизу обрез превью медиа.
- **Состояние скролла:** пользователь **не у низа** — видна FAB «вниз» над инпутом.
- **Slug:** `ios-chat-bubbles`.

## 2. Иерархия слоёв
Снизу вверх (z-order):

1. **`.tg-chat-bg`** — полноэкранный `background-image` (кастомное фото), `background-size: cover`, `background-position: center`. Поверх — сильное размытие сцены (визуально ~20–40 px Gaussian на самом ассете / wallpaper blur Telegram).
2. **`.tg-message-list`** — вертикальный скролл: исходящие пузыри → date chip → входящие file-bubbles → медиа-превью (обрезано инпутом).
3. **`.tg-header`** — верхняя полупрозрачная шапка (safe-area + nav row): back+badge, title/subtitle, avatar справа. `backdrop-filter` + тёмная вуаль.
4. **`.tg-live-geo`** — отдельная плашка под хедером (не часть пузырей): иконка трансляции, текст «Трансляция Вы», крестик закрытия.
5. **`.tg-scroll-down`** — плавающая круглая кнопка над инпутом, справа.
6. **`.tg-composer`** — нижняя панель: attach | pill-input | timer + mic; home-indicator зона.
7. **Системный status bar** — поверх всего в safe-area (время 10:10, LTE, иконка Telegram `#007AFF`, батарея ~51% жёлтая).

## 3. Геометрия
Все размеры ниже — **логические pt** (физические px кадра ÷ 2), если не указано иное.

### Экран / safe areas
- Viewport: **414×896**.
- Status bar высота: **~44** (до нижней кромки статус-иконок).
- Header (status + nav): суммарно **~88–96**; nav-row контент **~44**.
- Composer + home indicator: **~72–84** от низа; поле ввода **~36–38** высотой.
- Боковые поля ленты: **~8–10** от края экрана до внешнего края пузыря.

### Исходящие пузыри (`.tg-bubble-out`)
- Выравнивание: `flex-end`, правый край ~**8–10** от края.
- `border-radius`: **18** на «свободных» углах; внутренний нижний правый (хвост группы) **~4–6**.
  - Одиночный / последний в группе: `18px 18px 4px 18px` (TL TR BR BL).
- Padding текста: **~8–10** вертикаль × **~12–14** горизонталь.
- Межпузырьковый gap в одной группе: **~2–3**; между группами: **~6–8**.
- Замеры с кадра (@2x → /2):
  - средний пузырь: физ. ширина **~394** → лог. **~197** (~48% экрана);
  - короткий пузырь: физ. **~234** → лог. **~117**;
  - max-width типичный Telegram: **~75%** ширины контента (~290–300 pt).

### Входящие file-bubbles (`.tg-bubble-in-file`)
- Выравнивание: `flex-start`, левый край **~8–10**.
- `border-radius`: **16–18** со всех сторон (у файла хвост слабее / почти квадратный стеклянный блок).
- Внутренняя сетка: иконка **40×40** (круг) + текстовая колонка; gap иконка→текст **~10–12**.
- Padding блока: **~10–12**.
- Справа от bubble (на пересланных) — круг кнопки forward **~28–32** диаметром, отступ **~6–8**.

### Иконка файла
- Диаметр круга: физ. **~85** → лог. **~42–43** (цель UI-kit: **40**).
- Иконка документа внутри: белый glyph ~**18–20**.

### Live-geo banner (`.tg-live-geo`)
- Высота плашки: **~40–44**.
- Горизонтальные inset: **~8–12**; `border-radius`: **10–12**.
- Слева иконка в круге **~28–32**; справа hit-area крестика **~28–32**.

### Header
- Avatar справа: **36×36**, `border-radius: 50%`.
- Back chevron + badge «51»: badge капсула высота **~20–22**, `border-radius: 11`.
- Title block по центру/слева от аватара, max-width с ellipsis.

### Composer
- Attach (скрепка): слева, hit **44×44**, glyph **22–24**.
- Input pill: высота **36–38**, `border-radius: 18–19`, горизонтальный padding **12–14**.
- Справа от pill: timer + mic, glyphs **22–24**, gap **~12–16**.

### FAB scroll-down
- Диаметр **36–40**, позиция: right **~10–14**, bottom над composer **~8–12**.
- Chevron вниз ~**14–16**.

### Date separator
- Центр по горизонтали; chip padding **~2–4 × 10–12**; `border-radius: 10–12`.

## 4. Цвет
Сэмплы с JPEG (искажение сжатия учтено; «канон» = целевое значение для воссоздания).

### Исходящие пузыри
- Замер solid fill (центр пузыря): верх **`#8E54CB`** (142,84,203), низ **`#8F55D0`** / **`#9153DC`** (145,83,220).
- **Канон для UI:** вертикальный/диагональный градиент  
  `linear-gradient(180deg, #8E5AF7 0%, #7037D9 100%)`  
  или близкий Telegram-accent: `#A855F7` → `#7C3AED`.
- Текст: **`#FFFFFF`**.
- Мета (время + галочки) на исходящем: **`rgba(255,255,255,0.55–0.70)`** (на фиолетовом выглядит светло-лавандовой).

### Входящие / файлы (glass)
- Замер «дна» пузыря над фото: **`#1D1D1D`** … **`#1E1E1C`** (фактически смесь с фоном).
- **Канон:** `background: rgba(28, 28, 30, 0.62–0.72)`; `backdrop-filter: blur(12px) saturate(1.2)`.
- Альтернатива (если blur слабый): `rgba(255,255,255,0.10–0.14)` поверх тёмного blur — на кадре доминирует именно тёмное стекло.
- Текст имени файла: **`#FFFFFF`** / **`rgba(255,255,255,0.95)`**.
- Secondary (размер, «N просмотров», время): **`rgba(255,255,255,0.45–0.55)`**.
- Акцент «Пересланное сообщение» / имя источника: **`#64B5EF`** … **`#7AC3FF`** (светло-голубой, не чистый `#007AFF`).

### Иконка файла
- Замер кольца: avg **`#5586E9`** (85,134,233) — осветлён JPEG+бликом.
- **Канон Telegram/iOS:** **`#007AFF`** (круг) + glyph **`#FFFFFF`**.

### Live-geo
- Плашка: `rgba(18, 18, 20, 0.78–0.88)` + blur.
- Иконка/акцент «Вы»: фиолетовый близкий к исходящим **`#8E5AF7` / `#AF52DE`**.
- Текст: **`#FFFFFF`**; secondary слабее **`rgba(255,255,255,0.6)`**.
- Крестик: **`rgba(255,255,255,0.55)`**.

### Header / composer
- Header вуаль: `rgba(0,0,0,0.35–0.50)` + `backdrop-filter: blur(20px)`.
- Composer: `rgba(0,0,0,0.45–0.60)` + `blur(20–30px)`.
- Input pill fill: `rgba(255,255,255,0.08–0.12)`; stroke **`0.5px rgba(255,255,255,0.18–0.25)`**.
- Placeholder «Сообщение»: **`rgba(255,255,255,0.35–0.45)`**.
- Иконки outline: **`rgba(255,255,255,0.85–1.0)`**.

### Status bar
- Время / LTE: белые.
- Иконка Telegram в статус-баре: **`#007AFF`**.
- Батарея (замер жёлтого залива): **`#FBDA3F` … `#F3DD49`**; канон Low Power: **`#FFD60A`**.

### Фон
- Доминирующие тона размытого фото: тёплый серо-коричневый **`#1E1E1C`**, **`#2A241C`**, кожаные **`#C3A5A3`** в светлых зонах — не использовать как UI-fill, только как wallpaper.

## 5. Типографика
- **Семейство:** SF Pro Text / SF Pro Display (system `-apple-system`).
- **Антиалиасинг:** subpixel / default iOS.

| Элемент | Size | Weight | Line-height | Color |
|---|---|---|---|---|
| Status time | 15–16 | Semibold 600 | 1 | `#FFF` |
| Chat title «Анна Скворцова» | 17 | Semibold 600 | 22 | `#FFF` |
| Subtitle «был(а) недавно» | 13 | Regular 400 | 16 | `rgba(255,255,255,0.55)` |
| Live-geo title | 15–16 | Medium/Semibold 500–600 | 20 | `#FFF` |
| Bubble body text | 17 | Regular 400 | 22 | `#FFF` |
| Bubble time | 11–12 | Regular 400 | 14 | `rgba(255,255,255,0.55)` |
| Date chip «13 сентября» | 13 | Semibold 600 | 16 | `#FFF` (+ лёгкая тень) |
| Forward label | 13–14 | Regular 400 | 18 | `#7AC3FF` |
| File title | 16 | Medium 500 | 20 | `#FFF` |
| File meta (КБ / просмотры) | 13 | Regular 400 | 16 | `rgba(255,255,255,0.5)` |
| Composer placeholder | 17 | Regular 400 | 22 | `rgba(255,255,255,0.4)` |
| Unread badge «51» | 13 | Semibold 600 | 16 | `#FFF` |

## 6. Иконки/контролы
- **Back:** SF chevron.left, stroke ~**2.0–2.5**, цвет `#FFF`; рядом badge unread «51» в капсуле `rgba(255,255,255,0.18)`.
- **Header avatar:** круг 36, фото контакта, без обводки (или hairline `rgba(255,255,255,0.1)`).
- **Live-geo icon:** «вышка / волны» в фиолетовом круге; стиль filled.
- **Close (✕):** тонкий glyph 1.5–2 pt в hit-area 28–32.
- **File document:** белый лист/загнутый угол на синем круге `#007AFF`.
- **Forward:** круглая полупрозрачная кнопка `rgba(0,0,0,0.35)` / `rgba(255,255,255,0.12)` + стрелка «изогнутая вправо».
- **Outgoing checks:** double-check, stroke **~1.5**, цвет `rgba(255,255,255,0.85)` (прочитано).
- **Composer:** paperclip (outline), timer (outline), mic (outline); line-weight **~1.5–1.75**.
- **Scroll-down:** chevron.down в круге `rgba(30,30,30,0.55)` + blur; возможен маленький unread-dot сверху (на кадре слабо/отсутствует).

## 7. Тени / бордеры / разделители
- **Тени пузырей:** практически **нет** (flat + прозрачность). Допустима лёгкая `box-shadow: 0 1px 2px rgba(0,0,0,0.15)` только если без blur фон «плоский».
- **Header/composer:** глубина за счёт `backdrop-filter`, не за счёт большой тени; опционально `box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset`.
- **Date separator:** либо текст с `text-shadow: 0 1px 2px rgba(0,0,0,0.45)`, либо chip `rgba(0,0,0,0.28)` без бордера.
- **Input pill:** hairline **`0.5px solid rgba(255,255,255,0.2)`**.
- **Разделители списка:** нет линий — только spacing + date chip.
- **FAB:** мягкая тень `0 2px 8px rgba(0,0,0,0.35)`.

## 8. Состояния на кадре
- **Live location ON:** баннер «Трансляция Вы», крестик доступен (можно остановить).
- **Outgoing read:** двойные галочки на фиолетовых пузырях.
- **Forwarded docs:** два входящих файла с forward-кнопкой; метаданные размера и просмотров видны.
- **Scroll not pinned:** FAB «вниз» видима → есть контент ниже фолда.
- **Composer idle:** пустой placeholder «Сообщение», mic готов (не режим записи).
- **Battery Low Power / yellow:** заливка батареи жёлтая при ~51%.
- **Wallpaper custom:** фото пары, сильный blur под UI-стеклами.
- **Partial media:** нижний пузырь/превью фото обрезан панелью ввода.

## 9. CSS-скелет
```css
/* S11 — ios-chat-bubbles ; logical px ≈ CSS px @1x */

.tg-chat {
  position: relative;
  width: 414px;
  height: 896px;
  overflow: hidden;
  font-family: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
  color: #ffffff;
  background: #121212;
}

.tg-chat-bg {
  position: absolute;
  inset: 0;
  background: url("wallpaper.jpg") center / cover no-repeat;
  filter: blur(24px);
  transform: scale(1.08); /* компенсировать края blur */
}

.tg-chat-bg-dim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
}

.tg-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 96px; /* status 44 + nav 52 */
  padding: 44px 8px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  z-index: 20;
}

.tg-header-back {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #ffffff;
}

.tg-header-badge {
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  text-align: center;
}

.tg-header-titles {
  flex: 1;
  min-width: 0;
  text-align: center;
}

.tg-header-title {
  font-size: 17px;
  font-weight: 600;
  line-height: 22px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tg-header-subtitle {
  font-size: 13px;
  font-weight: 400;
  line-height: 16px;
  color: rgba(255, 255, 255, 0.55);
}

.tg-header-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
}

.tg-live-geo {
  position: absolute;
  top: 100px;
  left: 10px;
  right: 10px;
  height: 42px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 12px;
  background: rgba(18, 18, 20, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  z-index: 19;
}

.tg-live-geo-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(180deg, #8E5AF7 0%, #7037D9 100%);
}

.tg-live-geo-text {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
}

.tg-live-geo-close {
  width: 28px;
  height: 28px;
  color: rgba(255, 255, 255, 0.55);
}

.tg-message-list {
  position: absolute;
  inset: 148px 0 84px;
  padding: 8px 10px 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 10;
}

.tg-date-chip {
  align-self: center;
  margin: 8px 0;
  padding: 2px 10px;
  border-radius: 11px;
  background: rgba(0, 0, 0, 0.28);
  font-size: 13px;
  font-weight: 600;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}

.tg-bubble-out {
  align-self: flex-end;
  max-width: 75%;
  padding: 8px 12px 6px;
  border-radius: 18px 18px 4px 18px;
  background: linear-gradient(180deg, #8E5AF7 0%, #7037D9 100%);
  color: #ffffff;
  font-size: 17px;
  line-height: 22px;
}

.tg-bubble-out-meta {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

.tg-bubble-out-checks {
  width: 16px;
  height: 10px;
  opacity: 0.9;
}

.tg-bubble-in-file {
  align-self: flex-start;
  max-width: 78%;
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 18px;
  background: rgba(28, 28, 30, 0.68);
  backdrop-filter: blur(12px) saturate(1.2);
  -webkit-backdrop-filter: blur(12px) saturate(1.2);
}

.tg-file-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #007AFF;
  display: grid;
  place-items: center;
  color: #ffffff;
}

.tg-file-title {
  font-size: 16px;
  font-weight: 500;
  line-height: 20px;
  color: #ffffff;
}

.tg-file-forward-label {
  font-size: 13px;
  color: #7AC3FF;
  margin-bottom: 2px;
}

.tg-file-meta {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}

.tg-forward-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(8px);
}

.tg-scroll-down {
  position: absolute;
  right: 12px;
  bottom: 96px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(28, 28, 30, 0.55);
  backdrop-filter: blur(12px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  display: grid;
  place-items: center;
  z-index: 18;
}

.tg-composer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  min-height: 72px;
  padding: 8px 10px 28px; /* + home indicator */
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(24px) saturate(1.3);
  -webkit-backdrop-filter: blur(24px) saturate(1.3);
  z-index: 20;
}

.tg-composer-icon {
  width: 24px;
  height: 24px;
  color: rgba(255, 255, 255, 0.92);
  stroke-width: 1.6px;
}

.tg-composer-input {
  flex: 1;
  height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.1);
  border: 0.5px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
  font-size: 17px;
  line-height: 36px;
}

.tg-composer-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}
```

## 10. Неуверенности
- **Точный blur wallpaper:** на кадре wallpaper уже «запечён» в JPEG; runtime Telegram blur может быть 20–40 px — указан рабочий диапазон 20–24 px + dim.
- **Градиент исходящих:** замеры дают почти плоский `#8E54CB`→`#9153DC`; визуально читается как лёгкий вертикальный градиент — канон `#8E5AF7`→`#7037D9` может чуть ярче оригинала на OLED.
- **Alpha стеклянных входящих:** из-за смеси с фото невозможно вытащить точный alpha; коридор **0.62–0.72** при blur 10–16 px.
- **Синий файла:** замер `#5586E9` vs системный `#007AFF` — брать `#007AFF`, JPEG завышает яркость.
- **Точная высота live-geo / header:** зависят от safe-area конкретной модели; на кадре 828×1792 без Dynamic Island.
- **Badge unread стиль** (заливка vs tint): на тёмном wallpaper выглядит как `rgba(255,255,255,0.18)`, не system blue.
- **Наличие точки-счётчика на FAB:** на кадре неуверенно — в скелете не рисуем.
)
