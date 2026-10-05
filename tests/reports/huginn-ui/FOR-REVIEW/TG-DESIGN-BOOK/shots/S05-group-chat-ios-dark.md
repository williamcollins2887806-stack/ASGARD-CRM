# S05 — group-chat-ios-dark

## 1. Мета
- **Источник 828×1792 px, база 414×896 pt @2x, pt = px/2.** Все размеры ниже в pt; в скобках px@2x, если они полезны.
- Устройство: iPhone класса 11/XR (414×896 pt, вырез-notch). Safe-area top ≈ 44–48 pt, bottom ≈ 34 pt. Home Indicator на кадре **не виден**: системный скриншот iOS его не захватывает.
- Приложение: Telegram iOS, тёмная тема, **новый «liquid glass» хром**. Полноширинного навбара нет: шапка собрана из плавающих стеклянных капсул (back, title, avatar), закреп и composer тоже плавающие капсулы.
- Экран: групповой чат «Офис АСГАРД-Сервис», подзаголовок «21 участник», чат заглушён (mute).
- Лента: два входящих сообщения одного автора подряд (группа из 2 пузырей), время 16:28 и 16:29, у последнего аватар слева. Composer пустой.
- Статус-бар: 15:51 + стрелка геолокации, синяя пилюля «TELEGRAM», сигнал, LTE, батарея 51 % в режиме энергосбережения (жёлтая).

## 2. Иерархия слоёв
Порядок по z снизу вверх:
1. `.tg-chat-bg` — почти чёрный фон `#010101` + дудл-паттерн Telegram (линии ≈ `#403B44`, покрытие ≈ 10 % площади).
2. `.tg-message-list` — пузыри + аватар; лента уходит **под** стеклянные капсулы сверху (через стекло видны верхние строки длинного пузыря).
3. `.tg-top-chrome` (без собственного фона):
   - `.tg-glass-pill.tg-nav-back` — шеврон + белый бейдж «38»;
   - `.tg-glass-pill.tg-nav-title` — заголовок + mute + подзаголовок;
   - `.tg-glass-circle.tg-nav-avatar` — фото группы в стеклянном кольце.
4. `.tg-glass-pill.tg-pinned` — отдельная капсула закрепа под шапкой.
5. `.tg-status-bar` — системный слой (время, синяя пилюля, индикаторы).
6. `.tg-composer` (без собственного фона): `.tg-glass-circle` скрепка, `.tg-glass-pill` поле ввода, `.tg-glass-circle` микрофон.

## 3. Геометрия
Все значения в pt (px@2x в скобках).

**Статус-бар**
- Время «15:51»: цифры x 23.5–60.5, y 19.5–30 (cap ≈ 11.5); стрелка геолокации x 67–78.5, y 19–30.5.
- Синяя пилюля: x 161–252.5, y 5–26.5 → **92×22, radius 11**. Самолётик x 166.5–179 (≈ 12.5×10.5); текст «TELEGRAM» x 186–244, cap y 12.5–19.5 (≈ 7.5).
- Сигнал x 326.5–339.5 (13×8.5, y 21.5–30); «LTE» x 349.5–365.5 (y 21–29); батарея x 361–396.5 (корпус ≈ 27×13, y 18–31), жёлтая заливка x 370.5–383.

**Верхние капсулы (все y 58–102, h 44 (88), центр y 80)**
- Back: x 16–85 → **69×44, radius 22**. Шеврон x 32–47 (15.5×18, y 71–88.5); бейдж x 46–73.5, y 71–88.5 → **28×18, radius 9**. Отступ слева до шеврона 16, справа от бейджа 11.
- Title: x 103–335 → **232×44, radius 22**. Текст заголовка начинается с x 119 (inset 16), mute-иконка x 300–317.5 (y 70–79), inset справа ≈ 18. Заголовок: cap top y 67, baseline y 78.75. Подзаголовок: x 185–252.5, baseline y 93.75.
- Avatar: стеклянный круг x 354–398, **D 44**; фото x 357–394.5, y 61.5–97 → **D ≈ 38**, кольцо стекла ≈ 3.
- Горизонтальный ритм: 16 | back 69 | 18.5 | title 232 | 19 | avatar 44 | 16.

**Капсула закрепа**
- x 16–397.5, y 112–162 → **382×50, radius 25**. Отступ от шапки 10.
- Сегментный индикатор: x 34–36 (**w 2**), y 119–155 (h 36), 3 сегмента с зазорами ≈ 2; inset от левого края капсулы 18.
- Текст: x 45 (зазор от индикатора 9). Лейбл: cap top y 121, baseline y 131.75. Превью: baseline y 150.75, правый край текста x 343.5 (многоточие). Шаг базовых линий 19.
- Иконка списка закрепов: x 358.5–378 (19.5×15), y 128.5–143, inset справа 19.5.

**Лента**
- Пузырь 1 (длинный, 16:28): x 48–371 (**w 323**), низ y 755.5; верх уходит за верх экрана, под капсулы.
- Пузырь 2 (16:29): x 48–360 (**w 312**), y 757.5–813 (**h 55.5**). Зазор между пузырями **2**.
- Радиусы: внешние углы (TR, BR и TL первого пузыря) **16** (32); внутренние «склеенные» углы слева (BL пузыря 1, TL пузыря 2) **8** (16); BL пузыря 2 — хвост: выступ влево ≈ 2–3 за корпус на нижних ≈ 4 pt.
- Текст: кегль 17, **шаг строк 22.5** (45 px; по 22 строкам пузыря 1 — 45.45 px). Левый край глифов x 58.5–59 (inset ≈ 10.5–11), правый край самой длинной строки x 358.5 (inset справа ≈ 12.5).
- Пузырь 2: cap top первой строки y 767.25 (9.75 от верха), baselines y 779.25 и 801.75; от последней базовой линии до низа 11.25.
- Время 16:29: x 320.5–348 (≈ 27.5×8), baseline y 805.25 → 7.75 от низа, 12 от правого края. Время 16:28: x 332–359, inset справа ≈ 12, baseline ≈ 747.5 (7.75 от низа).
- Аватар: x 7–41, y 780–814 → **D 34**; низ совпадает с низом пузыря 2 (±1); зазор аватар → пузырь 7.

**Composer (все y 828–868, h 40 (80))**
- Скрепка: круг x 26–66, **D 40**; глиф x 35.5–55 (≈ 20×23), y 836.5–859.
- Поле: x 72–342 → **270×40, radius 20**; плейсхолдер с x 85 (inset 13), baseline y 853.75; иконка стикера x 312–331, y 838.5–857.5 (≈ 19.5×19.5), inset справа 10.5.
- Микрофон: круг x 348–388, **D 40**; глиф x 358.5–377 (≈ 19×24.5), y 836–860.
- Ритм: 26 | 40 | 6 | 270 | 6 | 40 | 26. От низа composer до края экрана 28; от пузыря 2 до composer 15.

## 4. Цвет
Пипетка по 828-px файлу (JPEG, ±2–3 по каналу).
- **Фон:** `#010101` / `#010102`. Дудлы: яркие линии ≈ `#403B44` (лавандово-серый), полутона ≈ `#24212A`; покрытие ≈ 10 %.
- **Стекло (все капсулы и круги):** заливка поверх чёрного `#171717`–`#1B1A1C` (≈ `rgba(28,28,30,0.85–0.9)` + blur). Поверх пузыря стекло чуть светлее: `#1D1C1B` (title), `#1F1D1E` (закреп).
  - Ободок сверху: 1 px@2x `#3B363A`–`#403E3F`, следующий px `#2D282C`.
  - Ободок снизу: `#363437`–`#373739`, ≈ `rgba(255,255,255,0.14–0.18)`.
- **Поле ввода и круги composer:** `#18181A` / `#1A1A1C`.
- **Входящие пузыри — градиент, привязанный к экрану** (не к пузырю):
  - левая кромка: `#312334` (y ≈ 210–370) → `#2D2334` (450) → `#282133` (650) → `#252132` (730);
  - правая кромка: тёплый `#322723` (y ≈ 210–290) → `#2E272C` (410) → `#262632` (530) → `#1C2632` (730);
  - пузырь 2: слева `#252133`, справа `#1D2533`, по центру низа `#242233`.
  - Итог: диагональ «фиолетово-коричневый сверху → тёмно-синий снизу справа».
- **Основной текст** (сообщения, заголовок, лейбл и превью закрепа, иконки в шапке и composer): `#FFFFFF`.
- **Подзаголовок «21 участник»:** ядро глифа ≈ `#A09F9D` (≈ `rgba(255,255,255,0.6)`).
- **Время в пузыре:** ядро ≈ `#9AA0AE` (≈ `rgba(255,255,255,0.55)` поверх синеватого фона).
- **Плейсхолдер «Сообщение»:** ≈ `#ACACAE`. **Иконка стикера:** ≈ `#A5A6A8`.
- **Mute-иконка:** серая ≈ `#8E8E93` (ядро светлеет до белого из-за AA).
- **Сегменты закрепа:** неактивные `#898989`–`#8C8C8C`, активный (нижний) `#FFFFFF`.
- **Бейдж «38»:** заливка `#FFFFFF`, цифры тёмные ≈ `#000000`–`#1C1C1E`.
- **Пилюля «TELEGRAM»:** `#347AFE` / `#3575F0` (≈ iOS system blue `#3478F6`), текст и самолётик `#FFFFFF`.
- **Батарея:** заливка `#EED966` (Low Power Mode yellow), цифры «51» тёмные; корпус серый ≈ `rgba(255,255,255,0.35)`.

## 5. Типографика
Семейство SF Pro (системное iOS); кегль считан по cap height ≈ 0.705 em.
- **Время в статус-баре:** 17 / Semibold (cap 11.5).
- **«TELEGRAM» в пилюле:** ≈ 11 / Semibold, капс, tracking ≈ +0.3 (cap 7.5).
- **Заголовок чата:** 17 / Semibold (cap 11.75), белый, 1 строка, ellipsis.
- **Подзаголовок:** 12 / Regular (цифры 8.5, x-height 6.25), серый.
- **Бейдж «38»:** ≈ 14 / Semibold, тёмный на белом.
- **Лейбл «Закреплённое сообщение»:** 15 / Medium–Semibold (cap 10.75, x-height 7.75), белый.
- **Превью закрепа:** 15 / Regular (x-height 7.75), белый, 1 строка, многоточие; содержит emoji 📣.
- **Текст сообщения:** **17 / Regular** (cap 12.25, x-height 9), line-height **22.5**, белый, `pre-wrap`.
- **Время в пузыре:** ≈ 11 / Regular (цифры 8, «16:29» ≈ 27.5 шириной), `tabular-nums`.
- **Плейсхолдер:** 17 / Regular (x-height 8.75).
- Emoji (🙏, 👆, 📣) — Apple Color Emoji ≈ 1 em строки.

## 6. Иконки/контролы
- **Back:** шеврон «<» 15.5×18, обводка ≈ 2.5 (5 px), белый; бейдж непрочитанных «38» — белая капсула 28×18.
- **Mute:** перечёркнутый динамик ≈ 17.5×9, серый, правее заголовка с зазором ≈ 6.
- **Аватар группы:** фото (люди на природе) D 38 в стеклянном кольце D 44.
- **Индикатор закрепов:** вертикальная полоска 2×36 из 3 сегментов, активен нижний (белый) — признак нескольких закрепов.
- **Список закрепов:** иконка «строки + булавка» 19.5×15, белая, справа в капсуле.
- **Скрепка:** диагональная, белая, ≈ 20×23, по центру стеклянного круга D 40.
- **Стикер / emoji:** круг с загнутым углом, ≈ 19.5, серый `#A5A6A8`, внутри поля справа.
- **Микрофон:** контурный, белый, ≈ 19×24.5, в стеклянном круге D 40. Режим голосового сообщения, потому что поле пустое.
- **Аватар автора:** фото D 34 (женщина на фоне моря).
- **Статус-бар:** стрелка геолокации, синяя пилюля «TELEGRAM» с самолётиком, 4 полосы сигнала, «LTE», батарея с числом «51».
- **На кадре нет:** кнопки «вниз», индикатора набора, разделителя дат, reply-цитат, реакций, галочек прочтения (сообщения входящие).

## 7. Тени / бордеры / разделители
- **Стеклянные капсулы и круги:** ободок по периметру 0.5 (1 px), светлее сверху (`#3B363A`–`#403E3F` + `#2D282C`), чуть темнее снизу (`#363437`). Это эффект specular-highlight, не сплошной border.
- **Тень у капсул:** явной drop-shadow нет, за краем сразу `#000`. Возможна очень мягкая тень ≈ 0 2 8 `rgba(0,0,0,0.3)`, на чёрном фоне неразличима.
- **Blur стекла:** контент под title и закрепом размыт до нечитаемости → ≈ `blur(16–24px)`, `saturate(1.2–1.5)`.
- **Пузыри:** без бордера и тени; объём только за счёт градиента на чёрном.
- **Разделителей нет вообще:** ни hairline под шапкой, ни над composer — пространство между капсулами прозрачное.
- **Зазоры:** между пузырями одной группы 2 (видна чёрная щель 4 px@2x).

## 8. Состояния на кадре
- **Скролл:** у самого низа истории; длинный пузырь 1 уходит под шапку, его верхние строки просвечивают сквозь стекло title и закрепа.
- **Чат заглушён:** mute рядом с заголовком.
- **Несколько закрепов:** 3 сегмента, показан закреп, соответствующий нижнему сегменту; превью «Коллеги, доброго дня! 📣 Напомню, что…».
- **Счётчик непрочитанных в списке чатов:** 38.
- **Группировка сообщений:** 2 входящих пузыря одного автора. Склеенные углы слева 8, хвост и аватар только у последнего.
- **Composer:** пустой, клавиатура скрыта, справа микрофон (не кнопка отправки).
- **Система:**
  - геолокация активна (стрелка);
  - синяя пилюля «TELEGRAM» — системный индикатор активности приложения в статус-баре;
  - батарея 51 % в Low Power Mode.

## 9. CSS-скелет
```css
:root {
  --tg-bg: #010101;
  --tg-doodle: #403b44;
  --tg-glass: rgba(28, 28, 30, 0.88);
  --tg-glass-rim-top: rgba(255, 255, 255, 0.2);
  --tg-glass-rim-bottom: rgba(255, 255, 255, 0.14);
  --tg-text: #ffffff;
  --tg-text-secondary: #a09f9d;
  --tg-meta: rgba(255, 255, 255, 0.55);
  --tg-placeholder: #acacae;
  --tg-icon-muted: #a5a6a8;
  --tg-bubble-r: 16px;
  --tg-bubble-r-joined: 8px;
  --tg-system-blue: #3478f6;
}

.tg-screen {
  position: relative;
  width: 414px;
  height: 896px;
  overflow: hidden;
  background: var(--tg-bg);
  color: var(--tg-text);
  font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
}

.tg-chat-bg {
  position: absolute;
  inset: 0;
  background: var(--tg-bg) url("tg-doodles.svg") repeat;
  background-size: 414px auto;
}

/* ---- status bar ---- */
.tg-status-bar { position: absolute; inset: 0 0 auto; height: 44px; z-index: 50; }
.tg-status-time {
  position: absolute; left: 23.5px; top: 15px;
  font: 600 17px/20px -apple-system; letter-spacing: -0.2px;
}
.tg-status-pill {
  position: absolute; left: 161px; top: 5px;
  width: 92px; height: 22px; border-radius: 11px;
  background: var(--tg-system-blue);
  display: flex; align-items: center; gap: 7px; padding-left: 5.5px;
  font: 600 11px/1 -apple-system; letter-spacing: 0.3px; text-transform: uppercase;
}

/* ---- glass primitives ---- */
.tg-glass-pill,
.tg-glass-circle {
  position: absolute;
  background: var(--tg-glass);
  -webkit-backdrop-filter: blur(20px) saturate(1.3);
  backdrop-filter: blur(20px) saturate(1.3);
  box-shadow:
    inset 0 0.5px 0 var(--tg-glass-rim-top),
    inset 0 -0.5px 0 var(--tg-glass-rim-bottom),
    inset 0.5px 0 0 rgba(255, 255, 255, 0.12),
    inset -0.5px 0 0 rgba(255, 255, 255, 0.12);
}
.tg-glass-pill { border-radius: 999px; }
.tg-glass-circle { border-radius: 50%; }

/* ---- top chrome ---- */
.tg-nav-back {
  left: 16px; top: 58px; width: 69px; height: 44px;
  display: flex; align-items: center; gap: 0; padding: 0 11px 0 16px;
}
.tg-nav-back__chevron { width: 15.5px; height: 18px; color: #fff; }
.tg-nav-back__badge {
  margin-left: -1px;
  min-width: 28px; height: 18px; border-radius: 9px; padding: 0 6px;
  background: #fff; color: #000;
  font: 600 14px/18px -apple-system; text-align: center;
}

.tg-nav-title {
  left: 103px; top: 58px; width: 232px; height: 44px;
  padding: 0 18px 0 16px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.tg-nav-title__name {
  display: flex; align-items: center; gap: 6px; max-width: 100%;
  font: 600 17px/20px -apple-system;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tg-nav-title__mute { width: 17.5px; height: 9px; color: #8e8e93; flex: none; }
.tg-nav-title__sub {
  font: 400 12px/15px -apple-system; color: var(--tg-text-secondary);
}

.tg-nav-avatar { left: 354px; top: 58px; width: 44px; height: 44px; padding: 3px; }
.tg-nav-avatar img { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; }

/* ---- pinned ---- */
.tg-pinned {
  left: 16px; top: 112px; width: 382px; height: 50px;
  display: grid; grid-template-columns: 2px 1fr 19.5px; column-gap: 9px;
  align-items: center; padding: 0 19.5px 0 18px;
}
.tg-pinned__segments { display: flex; flex-direction: column; gap: 2px; height: 36px; }
.tg-pinned__segment { flex: 1; width: 2px; border-radius: 1px; background: #8a8a8a; }
.tg-pinned__segment--active { background: #fff; }
.tg-pinned__label { font: 600 15px/19px -apple-system; color: #fff; }
.tg-pinned__preview {
  font: 400 15px/19px -apple-system; color: #fff;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tg-pinned__list-icon { width: 19.5px; height: 15px; color: #fff; }

/* ---- messages ---- */
.tg-message-list {
  position: absolute; left: 0; right: 0; top: 0; bottom: 83px; /* 896 - 813 */
  display: flex; flex-direction: column; justify-content: flex-end; gap: 2px;
  padding: 0 0 0 48px;
}
.tg-bubble {
  position: relative;
  max-width: 323px;
  padding: 4.5px 12.5px 6px 10.5px;
  border-radius: var(--tg-bubble-r);
  background: linear-gradient(160deg, #322723 0%, #312334 35%, #282133 70%, #1c2632 100%);
  background-attachment: fixed; /* screen-anchored gradient */
  font: 400 17px/22.5px -apple-system;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.tg-bubble--first { border-bottom-left-radius: var(--tg-bubble-r-joined); }
.tg-bubble--last  { border-top-left-radius: var(--tg-bubble-r-joined); border-bottom-left-radius: 4px; }
.tg-bubble--last::before { /* tail */
  content: ""; position: absolute; left: -3px; bottom: 0;
  width: 10px; height: 8px; background: inherit;
  -webkit-mask: url("tg-tail-left.svg") no-repeat; mask: url("tg-tail-left.svg") no-repeat;
}
.tg-bubble__meta {
  float: right; margin: 9px -0.5px -2px 8px;
  font: 400 11px/13px -apple-system; font-variant-numeric: tabular-nums;
  color: var(--tg-meta);
}
.tg-msg-avatar {
  position: absolute; left: 7px; bottom: 83px;
  width: 34px; height: 34px; border-radius: 50%; object-fit: cover;
}

/* ---- composer ---- */
.tg-composer {
  position: absolute; left: 26px; right: 26px; bottom: 28px; height: 40px;
  display: flex; align-items: center; gap: 6px;
}
.tg-composer .tg-glass-circle,
.tg-composer .tg-glass-pill { position: relative; }
.tg-composer__attach,
.tg-composer__mic {
  width: 40px; height: 40px; flex: none;
  display: grid; place-items: center; color: #fff;
}
.tg-composer__attach svg { width: 20px; height: 23px; }
.tg-composer__mic svg { width: 19px; height: 24.5px; }
.tg-composer__field {
  flex: 1; height: 40px; border-radius: 20px;
  display: flex; align-items: center; padding: 0 10.5px 0 13px;
  background: rgba(24, 24, 26, 0.9);
}
.tg-composer__placeholder { flex: 1; font: 400 17px/22px -apple-system; color: var(--tg-placeholder); }
.tg-composer__sticker { width: 19.5px; height: 19.5px; color: var(--tg-icon-muted); }
```

## 10. Неуверенности
- **Градиент пузырей:** по замерам он привязан к экрану (кромки одной высоты одинаковы у разных пузырей), но точное направление и стопы восстановлены по 2 колонкам пипетки. Возможно, это wallpaper-tinted backdrop Telegram, а не CSS-градиент. JPEG — ±2–3 по каналу.
- **Хвост пузыря 2:** выступ ≈ 2–3 pt выделен порогом яркости на фоне с дудлами; точная форма хвоста (у Telegram ≈ 6 pt) не восстановлена.
- **Padding пузыря** (4.5 сверху / 6 снизу) выведен из базовых линий через типовые ascent/descent SF 17 pt (0.952 / 0.241 em); реальный Telegram может считать иначе, но визуальные отступы (cap top 9.75 от верха, baseline 11.25 до низа) замерены напрямую.
- **Кегли** считаны по cap/x-height (SF cap 0.705, x 0.52). Время в пузыре 11 vs 12 pt и вес лейбла закрепа (Medium vs Semibold) — на грани различимости.
- **Стекло:** «прозрачность + blur» восстановлены по разнице заливки поверх чёрного (`#181818`) и поверх пузыря (`#1D1C1B`–`#1F1D1E`); точные alpha, blur radius и saturate без исходников iOS не определить.
- **Синяя пилюля «TELEGRAM»:** системный индикатор iOS. Причина появления (фоновая геолокация, возврат в приложение и т.п.) по кадру не определяется.
- **Батарея:** границы корпуса и «носика» размыты AA; размеры ±1 pt.
- **Внутренние зазоры бейджа и шеврона** (≈ 0–1 pt) на грани AA.
