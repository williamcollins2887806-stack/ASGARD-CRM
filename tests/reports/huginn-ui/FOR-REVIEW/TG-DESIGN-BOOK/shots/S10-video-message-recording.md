# S10 — video-message-recording

## 1. Мета
- **Платформа:** iOS (портрет; status-bar + home-indicator зона).
- **Приложение:** Telegram (клиент iOS).
- **Экран:** запись / предпросмотр **видеосообщения** («кружочек» / video note) — полноэкранный camera overlay.
- **Тема:** тёмный camera UI (фон = размытый кадр камеры, не chat wallpaper).
- **Состояние кадра:** запись уже стартовала и **на паузе** (иконка Pause; таймер `0:00,00`; кнопка Send активна).
- **Исходник:** `REFS/S10.jpg`, phys **828×1792** (= logical **414×896** @2×; iPhone XR/11 class).
- **Ориентация:** portrait.
- **OS chrome:** время слева; синяя pill `✈ TELEGRAM` по центру status-bar; LTE + батарея **51%** (Low Power Mode — жёлтая заливка).

## 2. Иерархия слоёв
Сверху вниз / z от низкого к высокому:

1. **`.tg-cam-bg`** — live camera feed, сильно размытый (Gaussian ≈40–60 px phys / ≈20–30 pt), тёмно-коричневые / почти чёрные тона вокруг круга.
2. **`.tg-cam-scrim`** (опционально) — лёгкое затемнение низа экрана под контролы; отдельного сплошного `#000` fullscreen нет — «чёрнота» = blur камеры.
3. **`.tg-video-circle`** — центральная круглая маска с **неразмытым** (или слабо размытым) превью лица/сцены; основной визуальный якорь.
4. **`.tg-ctrl-col.tg-ctrl-col--left`** — колонка: flip-camera + flash-off (полупрозрачные круги).
5. **`.tg-ctrl-col.tg-ctrl-col--right`** — колонка: view-once (`1` в dashed-кольце) + pause.
6. **`.tg-rec-panel`** — нижняя тёмная glass-плашка: rec-dot + timer + «Отмена».
7. **`.tg-btn-send`** — крупная синяя FAB со стрелкой вверх + soft blue halo.
8. **`.tg-status-bar`** / **`.tg-os-pill`** — iOS status + Telegram activity pill.
9. **`.tg-home-indicator`** — системная home-капсула у низа (на кадре слабо контрастирует с тёмным низом).

## 3. Геометрия
Все размеры ниже — **logical pt** (= phys/2), если не сказано иное. Phys в скобках где критично.

### Кадр / chrome
- **Viewport logical:** 414×896 (phys 828×1792).
- **Status-bar content band:** ≈ y 14–32 (phys y 28–64); safe-area top ≈44–47.
- **TELEGRAM pill:** bbox phys ≈(322–505)×(10–53) → logical ≈ **W 91.5 × H 21.5**; **radius ≈10.5–11** (полная капсула); центр по X ≈206.
- **Time cluster:** phys x≈41–162, y≈38–61 → logical ≈ x20–81, y19–30.5.
- **Battery yellow fill:** phys ≈(741–766)×(36–62) → logical ≈(370–383)×(18–31).
- **Home-indicator зона:** y ≳ 875; отдельная серая капсула на кадре **слабо читается** (см. §10).

### Video circle (`.tg-video-circle`)
- **Диаметр:** ≈ **362** (phys ≈724; на экваторе span left≈51 → right≈775).
- **Центр:** ≈ **(206, 355.5)** (phys cx≈412, cy≈711; top≈174.5 / phys 349, bottom≈536.5 / phys 1073).
- **Горизонтальные поля:** left margin ≈25.5, right ≈19–20 (круг чуть левее идеального центра из‑за JPEG/AA).
- **Вертикаль:** круг выше геометрического центра экрана (центр круга ≈40% высоты).
- **Маска:** `border-radius: 50%` / `clip-path: circle(50%)`; **overflow: hidden**.
- **Feather края:** переход blur↔sharp на экваторе ≈ **2–3 pt** (phys x47→52: L 29→151→209); отдельного толстого white stroke **нет**.

### Right controls (`.tg-ctrl-col--right`)
- **View-once btn:** центр ≈ **(368, 698)** (phys 736, 1396).
- **Pause btn:** центр ≈ **(368, 749)** (phys 736, 1498).
- **Диаметр круга:** ≈ **36–38** (phys radius fill ≈36–38 → D≈72–76; dark fill до r≈36, bg с r≳40).
- **Center-to-center gap:** ≈ **51** (phys 102) → **edge gap ≈13–15**.
- **Right margin** (центр→край): ≈ **46** (414−368).
- **Icon hit (view-once glyph bbox):** phys ≈41×43 → logical ≈20.5×21.5 (глиф, не весь круг).

### Left controls (`.tg-ctrl-col--left`)
- **Зеркало правой колонки** по Y (flip ≈ y698, flash ≈ y749).
- **Диаметр:** тот же ≈36–38.
- **Left margin центра:** ≈ **46** (симметрия к правой колонке; точный x по пикселям слабый — глифы тонкие, JPEG съел контраст; см. §10).
- **Вертикальный gap** между кнопками: ≈13–15 (edge).

### Recording panel (`.tg-rec-panel`)
- **Полоса контента (глифы таймера):** phys y≈1578–1599 → logical y≈ **789–800**; x≈ **35–100** (phys 70–200).
- **Высота плашки (визуально, glass):** ≈ **44–52** (выше чистого bbox глифов; глифы сидят по вертикальному центру).
- **Ширина плашки:** от ≈ x16–24 до ≈ x300–320 (не доходит до Send; справа остаётся gap перед FAB/halo).
- **Corner radius:** ≈ **22–26** (полная капсула / near-pill).
- **Позиция:** над/на уровне **верхней кромки Send** (Send top phys≈1580 → logical≈790).

### Send button (`.tg-btn-send`)
- **Центр:** ≈ **(364.5, 845)** (phys 729, 1690).
- **Диаметр solid:** ≈ **92** (phys ≈184; left solid ≈318.5 / phys 637).
- **Halo / glow outer:** до ≈ phys x625 → logical ≈312.5 → **halo thickness ≈6–12** за пределами solid (мягкий falloff, не hard ring).
- **Right:** почти у края экрана (center + r ≈410.5; margin ≈3–4 — FAB «прижата» вправо-вниз).
- **Bottom margin** (низ круга→низ экрана): ≈ **5–6** (круг почти касается низа; часть halo клипается кадром).
- **Arrow glyph:** высота ≈0.35–0.45 диаметра; центрирован; на выборке центр стрелки даёт почти белый `#F2F7FA`.

## 4. Цвет
Выборки с phys JPEG; ±2–4 из‑за chroma noise.

### Фон / круг
- **Blur bg (углы / beside circle):** `#1A1A18` (26,26,24), `#171715` (23,23,21), локально теплее `#29241E` / `#312726`.
- **Circle content (кожа/сцена, не UI):** бежево-розовые `#E7D7C3`…`#EAD5BA` на экваторе внутри маски; **не токен UI**.
- **Circle edge AA mix:** `#61564B` / `#A29588` на 1–2 pt перехода.

### Status / OS
- **Time / status icons (ядро глифа):** `#FFFFFF` (на выборке вокруг времени фон `#181A19` — тёмный blur).
- **TELEGRAM pill fill:** ядро ≈ **`#247DE5` / `#007AFF`-семейство**; JPEG interior samples дают `(36,125,229)` и AA-смеси `#7DC1E8`.
- **Pill text / plane:** `#FFFFFF`.
- **Battery Low Power fill:** жёлтый `#FFD60A`-класс (phys bbox жёлтых пикселей подтверждён; точный HEX ядра см. §10 — выборка `(51,30,0)` попала в тёмный контур/цифру).

### Controls
- **Ctrl circle fill:** визуально `rgba(0,0,0,0.40–0.55)` поверх blur; квант внутри круга ≈ `#232322` / lum≈34–37 vs bg lum≈42 → **ΔL≈5–8** (очень низкий контраст fill↔bg).
- **Ctrl circle border (если есть):** `1px solid rgba(255,255,255,0.20–0.35)` — на JPEG едва читается; pause/once опираются больше на glyph contrast, чем на stroke.
- **Icons (pause bars, «1», flip, flash):** `#FFFFFF` / `#FEFEFE` (pause bars sampling до 254–255).
- **View-once dashed ring:** тот же белый, stroke ≈1.5–2 pt, dashes.

### Rec panel / typography colors
- **Panel glass fill:** ≈ `#1C1C1C`…`#202020` @ alpha **0.75–0.85** + `backdrop-filter`; квант рядом с таймером `#1E1E1E` / `#202020`.
- **Timer digits:** `#FFFFFF` (ядро 255; AA `#D7D7D7`…`#C9C9C9`).
- **Rec dot:** **`#FF3B30`** (Apple system red) — на JPEG **не пойман** чистый кластер (см. §10); цвет по визуалу кадра + канон iOS/TG.
- **«Отмена»:** Telegram accent ≈ **`#3EABF8` / `#40A7E3` / `#3390EC`**; пиксельный кластер на этом кадре **сливается с верхним halo Send** (см. §10).

### Send
- **Solid fill (flat / near-flat):** **`#2F78E7`** (47,120,231) top/mid/bot выборки почти совпадают → **градиент слабый или отсутствует** на этом JPEG (в UI-каноне TG часто `linear-gradient(180deg, #40A7E3, #2481CC)` — зафиксировать оба в §10).
- **Halo:** `rgba(47,120,231,0.25–0.45)` soft; сэмпл на краю halo `#3981E0`.
- **Arrow:** `#FFFFFF` (AA `#F2F7FA`).

## 5. Типографика
- **Семейство:** SF Pro Text / SF Pro Display (system `-apple-system`).
- **Timer `0:00,00`:** ≈ **17–18 pt**, weight **Medium (500)**; `font-variant-numeric: tabular-nums`; цвет `#FFFFFF`; формат **m:ss,CC** (запятая — локаль RU).
- **«Отмена»:** ≈ **17 pt**, Regular (400), accent blue (см. §4).
- **TELEGRAM pill:** ≈ **11–12 pt**, Semibold/Bold, **ALL CAPS**, tracking слегка положительный, `#FFFFFF`.
- **Status time:** ≈ **15–16 pt**, Semibold, `#FFFFFF`.
- **View-once «1»:** ≈ **13–15 pt**, Medium/Semibold, центрирован в dashed-кольце.
- **Letter-spacing:** системный default; таймер визуально стабилен за счёт tabular figures.

## 6. Иконки/контролы
- **Flip camera (left top):** контур «камера»/прямоугольник со скруглением + две дуговые стрелки обмена; stroke ≈1.5–2 pt; white.
- **Flash off (left bottom):** молния + диагональный strikethrough ↘; состояние **off**.
- **View once (right top):** цифра **`1`** внутри **dashed circle** (≈8–12 сегментов); режим разового просмотра (не «скорость 1×»).
- **Pause (right bottom):** две вертикальные **capsule**-полоски; каждая ≈ W 2.5–3.5 × H 12–14; gap ≈3.5–4.5; white на dark circle.
- **Rec dot:** круг D≈6–8; `#FF3B30`; слева от таймера; gap до цифр ≈6–8.
- **Send arrow:** ↑ из вертикального stem + V-head (~90°); `stroke-linecap: round`; stroke ≈3–3.5 pt logical на FAB D92.
- **Нет на кадре:** lock-to-record, mute, beauty, grid, gallery thumb, shutter ring (это post-record / paused send UI, не hold-to-record).

## 7. Тени / бордеры / разделители
- **Video circle:** без drop-shadow; объём = контраст sharp preview ↔ blur bg; возможен hairline `rgba(255,255,255,0.08–0.15)` — **не подтверждён** как отдельный слой (feather 2–3 pt выглядит как AA маски).
- **Ctrl circles:** flat glass; тени нет; слабый light border опционален.
- **Rec panel:** `backdrop-filter: blur(16–24px)`; без hard border; края = alpha falloff капсулы.
- **Send:** **glow**, не чёрная drop-shadow:
  - `box-shadow: 0 0 24px 8px rgba(47, 120, 231, 0.35), 0 4px 12px rgba(0,0,0,0.25);`
  - визуально 1–2 «кольца» мягкой синевы вокруг FAB.
- **Разделители:** линий между колонками/панелью нет — только whitespace.

## 8. Состояния на кадре
- **Recording session:** да (есть timer + rec chrome), но **playback/record на паузе** (иконка `Pause`, не `Record`/shutter).
- **Timer value:** `0:00,00` (нулевая длительность на кадре — либо только что старт/сброс, либо пауза на нуле; UI уже в «есть клип → можно Send»).
- **Flash:** **off** (перечёркнутая молния).
- **View-once:** контрол виден, активное включение по кадру **не доказано** (белый idle glyph).
- **Send:** enabled (solid accent + arrow).
- **Cancel:** доступна (текст «Отмена»).
- **OS:** Telegram background-activity pill в status-bar; Low Power Mode (жёлтая батарея 51%); LTE.
- **Camera:** front-facing selfie ракурс внутри круга (по содержанию кадра).

## 9. CSS-скелет
```css
.tg-screen {
  width: 414px;
  height: 896px;
  position: relative;
  overflow: hidden;
  background: #0b0b0b;
  font-family: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
  color: #ffffff;
}

.tg-cam-bg {
  position: absolute;
  inset: 0;
  background-image: var(--tg-cam-frame);
  background-size: cover;
  background-position: center;
  filter: blur(28px);
  transform: scale(1.08); /* убрать светлые края blur */
}

.tg-cam-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.15) 0%,
    rgba(0, 0, 0, 0.05) 40%,
    rgba(0, 0, 0, 0.55) 100%
  );
  pointer-events: none;
}

.tg-status-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 47px;
  padding: 14px 20px 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  z-index: 50;
  box-sizing: border-box;
}

.tg-status-time {
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
}

.tg-os-pill {
  position: absolute;
  left: 50%;
  top: 10px;
  transform: translateX(-50%);
  height: 22px;
  padding: 0 12px 0 10px;
  border-radius: 11px;
  background: #247de5;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #ffffff;
}

.tg-os-pill__plane {
  width: 12px;
  height: 12px;
}

.tg-video-circle {
  position: absolute;
  left: 50%;
  top: 174px;
  width: 362px;
  height: 362px;
  margin-left: -181px;
  border-radius: 50%;
  overflow: hidden;
  background: #2a221c;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.tg-video-circle__feed {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tg-ctrl-col {
  position: absolute;
  top: 680px;
  display: flex;
  flex-direction: column;
  gap: 15px;
  z-index: 30;
}

.tg-ctrl-col--left { left: 28px; }
.tg-ctrl-col--right { right: 28px; }

.tg-ctrl-btn {
  width: 37px;
  height: 37px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  padding: 0;
}

.tg-ctrl-btn__icon {
  width: 20px;
  height: 20px;
  stroke: #ffffff;
  fill: none;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tg-ctrl-btn--view-once {
  font-size: 14px;
  font-weight: 600;
}

.tg-view-once-ring {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px dashed rgba(255, 255, 255, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tg-icon-pause {
  display: flex;
  gap: 4px;
}

.tg-icon-pause__bar {
  width: 3px;
  height: 13px;
  border-radius: 2px;
  background: #ffffff;
}

.tg-rec-panel {
  position: absolute;
  left: 20px;
  bottom: 96px;
  height: 48px;
  min-width: 220px;
  max-width: 280px;
  padding: 0 18px;
  border-radius: 24px;
  background: rgba(28, 28, 28, 0.82);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 40;
  box-sizing: border-box;
}

.tg-rec-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ff3b30;
  flex: 0 0 auto;
}

.tg-rec-timer {
  flex: 1 1 auto;
  font-size: 17px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: #ffffff;
  letter-spacing: 0.01em;
}

.tg-rec-cancel {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: #40a7e3;
  font-size: 17px;
  font-weight: 400;
  padding: 8px 0 8px 8px;
}

.tg-btn-send {
  position: absolute;
  right: 4px;
  bottom: 5px;
  width: 92px;
  height: 92px;
  border-radius: 50%;
  border: 0;
  background: #2f78e7; /* JPEG flat; канон TG: linear-gradient(180deg,#40a7e3,#2481cc) */
  box-shadow:
    0 0 0 10px rgba(47, 120, 231, 0.18),
    0 0 28px 10px rgba(47, 120, 231, 0.35),
    0 6px 16px rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 45;
}

.tg-btn-send__arrow {
  width: 28px;
  height: 28px;
  stroke: #ffffff;
  fill: none;
  stroke-width: 3.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tg-home-indicator {
  position: absolute;
  left: 50%;
  bottom: 8px;
  width: 134px;
  height: 5px;
  margin-left: -67px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.28);
  z-index: 60;
}
```

## 10. Неуверенности
- **Rec-dot HEX:** визуально красный, но чистый кластер `#FF3B30` на JPEG **не извлечён** (мало пикселей / compression) — цвет канонический.
- **«Отмена» vs Send halo:** синие пиксели у y≈790–800 / x≳320 в основном = верх FAB/glow; точный bbox и HEX текста «Отмена» **оценочные** (`#40A7E3`).
- **Left controls x:** flip/flash на кадре есть, но thin white strokes почти растворились в blur — координата X **по симметрии** к правой колонке, не по жёсткому bbox.
- **Send fill gradient:** выборки top/mid/bot ≈ один `#2F78E7`; UI Telegram часто рисует вертикальный градиент `#40A7E3→#2481CC` — на этом скрине градиент **не доказан**.
- **Ctrl diameter:** 36–38 pt по radial fill; в HIG/TG часто 40–44 — возможна недооценка из‑за soft alpha края.
- **Backdrop blur px:** bg camera blur ≈20–30 pt; panel/btn blur 16–24 pt — порядок величины, не лабораторный σ.
- **Home-indicator:** геометрия/цвет на низу кадра **слабо отделяются** от тёмного blur + Send clip.
- **Battery exact yellow HEX:** жёлтый кластер есть, но ядро часто смешано с чёрной цифрой «51» / контуром.
- **Точный смысл «1»:** в video-note UI Telegram это **view-once**, не playback-speed; на кадре нет подписи.
