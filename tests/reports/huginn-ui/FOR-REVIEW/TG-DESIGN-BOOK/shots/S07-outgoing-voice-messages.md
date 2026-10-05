# S07 — outgoing-voice-messages

## 1. Мета
- **Платформа:** iOS (портрет; home-indicator зона внизу кадра).
- **Приложение:** Telegram (клиент iOS).
- **Тема:** Dark / OLED-чёрный фон чата.
- **Экран:** фрагмент ленты исходящих голосовых сообщений (nav/composer вне кадра или закрыты чёрным letterbox).
- **Состояние кадра:** верхний voice на паузе с прогрессом ~70%; нижний voice в idle (play), низ пузыря обрезан краем видимой зоны.
- **Исходник:** `REFS/S07.jpg`, phys **828×1792** (= logical **414×896** @2×).
- **Ориентация:** portrait; контент пузырей прижат вправо (outgoing).

## 2. Иерархия слоёв
Сверху вниз / z от низкого к высокому:

1. **`.tg-letterbox`** — почти чистый `#000000` выше ~y_log 390 и ниже ~y_log 510 (большая часть кадра — чёрные поля; это кроп/фокус на voice-зоне, не полный chat chrome).
2. **`.tg-chat-bg`** — в полосе вокруг пузырей: OLED base `#000000`…`#0F0F11` + едва читаемые doodle-линии паттерна (`#151517`…`#202020`, alpha визуально ≈0.04–0.08).
3. **`.tg-msg-out.tg-voice`** (верхний) — фиолетовый исходящий bubble с pause-кнопкой, waveform, duration, timestamp, double-check.
4. **`.tg-msg-out.tg-voice`** (нижний) — второй исходящий voice (play), частично обрезан снизу.
5. **`.tg-os-badge`** — синяя капсула «✈ TELEGRAM» у верхнего края кадра (chrome/watermark, не nav чата).
6. **`.tg-home-indicator`** (низ кадра) — серая капсула у нижней safe-area.

## 3. Геометрия
Все размеры ниже — **logical pt** (= phys/2), если не сказано иное.

### Кадр / chrome
- **Viewport logical:** 414×896.
- **TELEGRAM badge:** ≈92×22; центр по X ≈206–207; top ≈5; capsule radius ≈11 (полукруглые торцы).
- **Home-indicator-like:** H≈3; W≈106; y≈859–862; на кадре смещена влево (x≈26–132) — см. §10.
- **Видимая voice-полоса:** ≈ y_log 395–502 (phys y 790–1004).

### Верхний bubble (paused)
- **BBox approx:** left≈84, top≈395, right≈413 (упирается в правый край кадра — правый margin/хвост **обрезаны**), bottom≈464–470.
- **H ≈ 70–75**; **W видимая ≈ 330** (полная ширина на экране телефона больше — кадр обрезан справа).
- **Corner radius:** дальние углы **R≈18** (проверено по дуге top-left: phys R≈36 @2×).
- **Хвост (bottom-right):** на кадре не виден целиком (clip у x=413); ожидаемый Telegram out-tail **R≈4–6** на нижнем правом углу.
- **Padding:** left (bubble→btn) ≈12–13; top/bottom вокруг кнопки ≈6–8; gap btn→waveform ≈14–16; right padding до clip ≈8–12.

### Pause / Play button
- **Диаметр круга:** ≈44–46 (phys white-blob ≈92×88; AA-края).
- **Центр верхнего btn:** ≈(119, 428).
- **Нижний btn:** центр ≈(192, ≈490); низ круга обрезан (видимая высота phys≈49 вместо ≈88).

### Waveform (верхний)
- **Число столбиков:** ≈50–52.
- **Ширина столбика:** ≈2.0–2.5; **pitch центр→центр:** ≈4.25 (gap ≈1.5–2.0).
- **Высота столбиков:** ≈2–14 (от «точки» до высоких пиков); выравнивание по вертикальному центру ряда.
- **Старт ряда:** x≈168–170; **конец:** x≈387–388.
- **Playhead / progress:** переход played→unplayed около x≈325–328 (**≈70–72%** длины waveform).

### Нижний bubble
- **Top:** ≈466–468; **bottom visible:** ≈502 (далее letterbox).
- **Left:** ≈157–168 (уже верхнего — возможно shorter voice / другой layout inset); right снова у края кадра.
- **Вертикальный gap** между пузырями: ≈2–4 (почти вплотную, same-author consecutive).

### Meta-строка (внутри верхнего bubble)
- **Duration «0:11»:** под кнопкой слева, baseline ≈ y 450–453; блок ≈ x 105–132.
- **Timestamp «21:09» + double-check:** правый низ пузыря, ≈ x 340–411, y≈450–460.
- **Reply affordance («↩ 1»):** на кадре читается слева в meta-зоне у duration (см. §10 — низкая уверенность по глифу).

## 4. Цвет
- **Letterbox / chat base:** `#000000` (доминанта); локально `#0F0F11` / `#030305`.
- **Doodle strokes:** `#151517`…`#202020` (очень низкий контраст на OLED).
- **Outgoing bubble fill (верх):** доминанта **`#6844FC`** / `#6C44FC` (квант phys `(104,68,252)`); локальные вариации JPEG `#6941F9`…`#7145FC`.
- **Outgoing bubble fill (низ):** чуть холоднее **`#5C4CFC`** / `#5C48FC` (квант `(92,76,252)`).
- **Play/Pause circle fill:** `#FFFFFF` (с AA `#FEFCFD`…`#FBF3FF` на периметре).
- **Pause/Play glyph:** тот же violet bubble **`#6844FC`…`#6A43FF`**.
- **Waveform played:** почти белый **`#FFF2FF`…`#FFF8FF`** (на фиолетовом даёт лёгкий magenta tint).
- **Waveform unplayed:** **`#B49AFF`…`#BC9BFF`** ≈ белый @ 0.45–0.55 поверх `#6844FC` (не чистый `rgba(255,255,255,0.4)`, а lavander-mix).
- **Duration / meta text:** на выборке **`#9A86FF`…`#A18DFF`** ≈ white @ ~0.55–0.70 на violet (не чистый `#FFFFFF`).
- **Double-check:** светлее meta, ближе к **`#C8C0FF` / white @ 0.75–0.85** (JPEG шум; классический TG out-check на accent — бледно-белый).
- **TELEGRAM badge fill:** **`#007BFF`…`#047EFB`** (iOS/Telegram blue); иконка/текст на капсуле светлые (`#CDFFFF` / `#FFFFFF` в центре выборки).
- **Home-indicator-like:** `#707070`…`#767676`.

## 5. Типографика
- **Семейство:** SF Pro Text (iOS system).
- **Badge «TELEGRAM»:** ≈11–12 pt, Semibold/Bold caps, tracking слегка увеличенный, color `#FFFFFF`.
- **Duration «0:11»:** ≈11–12 pt, Regular/Medium, tabular-ish digits, color lavander `#9A86FF`–`#A18DFF`.
- **Timestamp «21:09»:** ≈11–12 pt, Regular, тот же lavander/white@0.6–0.7.
- **Reply count «1» (если есть):** ≈11–12 pt, рядом с reply-стрелкой, тот же secondary tint.
- **Letter-spacing:** системный default; цифры времени без моноширинного шрифта, но визуально ровные.

## 6. Иконки/контролы
- **Pause (верхний btn):** две вертикальные Capsule-полоски; каждая ≈ W 2.5–3.5, H ≈12–14; gap ≈3.5–4.5; цвет = bubble violet; скруглённые торцы.
- **Play (нижний btn):** равносторонний треугольник ▶ вершиной вправо; цвет violet; вписан в белый круг D≈44–46; низ глифа/круга обрезан кадром.
- **Waveform:** дискретная гистограмма амплитуд (не continuous Bezier); столбики скруглены (radius ≈1 = half-width).
- **Double-check (reads):** две галочки SF-style, stroke ≈1.5–2, правее timestamp.
- **Reply (спорно):** изогнутая стрелка влево + «1» у левой meta-зоны — на JPEG слабо контрастирует с violet.
- **Badge leading:** бумажный самолётик Telegram (белый) слева от слова TELEGRAM внутри синей капсулы.
- **Нет на кадре:** nav back/title/avatar, composer, keyboard, reaction bar, speed chip (1.5×/2×), scrubber-thumb отдельным кружком (playhead выражен только сменой alpha столбиков).

## 7. Тени / бордеры / разделители
- **Bubbles:** flat, **без drop-shadow**; объём = контраст violet на OLED.
- **Btn perimeter:** мягкий AA/`premultiply` переход white→violet на 1–2 pt; отдельного halo-кольца `rgba(255,255,255,0.15)` как самостоятельного слоя **не подтверждено** пикселями (rad≈46 ещё белый, rad≈48 уже violet-mix).
- **Borders:** у пузыря stroke нет.
- **Letterbox ↔ chat:** резкая/почти резкая граница к `#000` (не glass blur навбара).
- **Badge:** без тени или очень слабая; fill solid blue.
- **Разделитель между сообщениями:** только вертикальный gap 2–4 pt, линии нет.

## 8. Состояния на кадре
- **Верхний voice:** `paused` (иконка Pause, не Play); **progress ≈70%** waveform в состоянии played (яркие столбики), хвост unplayed (lavander); duration показывает оставшееся/текущее **`0:11`**; status **read** (double-check); time **`21:09`**.
- **Нижний voice:** `idle` / ready-to-play (▶); waveform целиком в unplayed-tint; пузырь **обрезан снизу** (кнопка и низ не полные).
- **Оба:** исходящие, accent violet (не серый incoming `#242F3D`).
- **Chrome:** badge TELEGRAM сверху; home-indicator-like снизу; остальной UI скрыт letterbox’ом.
- **Нет:** recording overlay, pinned, selection, context menu, typing.

## 9. CSS-скелет
```css
.tg-screen {
  width: 414px;
  height: 896px;
  background: #000000;
  position: relative;
  overflow: hidden;
  font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
}

.tg-os-badge {
  position: absolute;
  top: 5px;
  left: 50%;
  transform: translateX(-50%);
  height: 22px;
  padding: 0 12px 0 10px;
  border-radius: 11px;
  background: #007bff;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tg-os-badge__plane {
  width: 12px;
  height: 12px;
  /* telegram paper-plane glyph */
}

.tg-chat-bg {
  position: absolute;
  inset: 0;
  background-color: #000000;
  background-image: url("tg-doodles-dark.svg");
  background-size: 240px auto;
  opacity: 1; /* сами doodles уже ~4–8% белого */
}

.tg-msg-list {
  position: absolute;
  left: 0;
  right: 0;
  top: 390px; /* на этом кадре — зона фокуса */
  padding: 0 0 0 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}

.tg-msg-out.tg-voice {
  box-sizing: border-box;
  width: min(330px, 80vw);
  min-height: 70px;
  padding: 8px 12px 8px 12px;
  background: #6844fc;
  border-radius: 18px 18px 6px 18px; /* tail BR ≈4–6; на кадре BR клипнут */
  display: grid;
  grid-template-columns: 46px 1fr;
  grid-template-rows: 1fr auto;
  column-gap: 14px;
  row-gap: 2px;
  color: rgba(255, 255, 255, 0.65);
}

.tg-msg-out.tg-voice--paused {
  /* верхний на кадре */
}

.tg-msg-out.tg-voice--idle {
  background: #5c4cfc;
}

.tg-voice-btn {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: #ffffff;
  display: grid;
  place-items: center;
  grid-row: 1 / span 2;
  align-self: center;
}

.tg-voice-btn__pause {
  display: flex;
  gap: 4px;
}
.tg-voice-btn__pause-bar {
  width: 3px;
  height: 14px;
  border-radius: 1.5px;
  background: #6844fc;
}

.tg-voice-btn__play {
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 7px 0 7px 12px;
  border-color: transparent transparent transparent #5c4cfc;
  margin-left: 2px;
}

.tg-waveform {
  display: flex;
  align-items: center;
  gap: 2px; /* pitch ~4.25 с учётом width bar */
  height: 28px;
  min-width: 0;
}

.tg-waveform__bar {
  width: 2px;
  border-radius: 1px;
  background: #b49aff; /* unplayed mix */
  /* height: set per-bar via style/var --h */
  height: var(--h, 8px);
}

.tg-waveform__bar.is-played {
  background: #fff6ff;
}

.tg-voice-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  line-height: 1;
  color: #9a86ff;
}

.tg-voice-meta__duration {
  font-variant-numeric: tabular-nums;
}

.tg-voice-meta__right {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.tg-voice-meta__checks {
  width: 16px;
  height: 10px;
  opacity: 0.85;
  /* double-check stroke ≈ white/lavender */
}

.tg-home-indicator {
  position: absolute;
  bottom: 8px;
  /* на референсе смещена влево — в продукте обычно left:50% + translateX(-50%) */
  left: 26px;
  width: 106px;
  height: 3px;
  border-radius: 1.5px;
  background: #747474;
}
```

## 10. Неуверенности
- **Правый край / хвост пузыря:** кадр клипает bubble на x=413 — точный right margin и R хвоста (4 vs 6) не измерить.
- **Нижний bubble:** обрезан снизу; полный H, meta-строка и низ play-кнопки не видны.
- **Reply «↩ 1»:** упоминается визуально у duration, но контраст на JPEG низкий — глиф может быть артефактом/частичным AA.
- **Точный HEX accent:** JPEG даёт разброс `#6844FC`…`#7145FC`; живой клиент может быть ближе к системному `#665CFF` / theme accent.
- **Waveform unplayed alpha:** это mix lavander `#B49AFF`, не чистый white@0.4 — точный blend mode (src-over vs screen) не восстановить.
- **Home indicator:** серая капсула **не по центру** — либо кроп экрана со смещением, либо не системный indicator; W≈106 vs канон ≈134.
- **Letterbox:** большая чёрная площадь — артефакт кадрирования референса, не «пустой чат на весь экран».
- **Speed control / scrub thumb:** на кадре отсутствуют; при паузе в части сборок TG показывает кружок-playhead — здесь прогресс только сменой яркости bars.
- **Паттерн doodles:** слева от пузырей едва различим; точный SVG/растр паттерна и alpha не калиброваны.
