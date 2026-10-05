# S17 — group-profile-photo-expanded

## 1. Мета
- **ОС / тема**: iOS (поколение iOS 26, «стеклянные» контролы), Telegram iOS, **Dark**.
- **Экран**: профиль группы (Group Info) в режиме **раскрытого фото-хедера** — аватар группы растянут на всю ширину (full-bleed), заголовок и действия лежат поверх фото, ниже — glass-сегмент вкладок и inset-карточка участников.
- **Контент**: группа «АСГАРД: Замена фа…» (усечено), «9 участников»; вкладка «Участники» активна; список: «Добавить участников», Никита (в сети), Олег Сергеевич Асгарт Сервис ★, Олег Викторович Асгарт Сервис ★ (аватар-инициалы «ОВ»), Виктор Баринов, Андрей Сторожев Асг… + emoji-статус + бейдж «владелец», 6-я строка обрезана низом.
- **Исходник**: файл 473×1024 px (JPEG, даунскейл с 828×1792 @2x). Логический вьюпорт **414×896 pt** (iPhone XR/11, вырез-«чёлка», без Dynamic Island).
- **Пересчёт**: `1 pt = 1.1425 px исходника = 2 device px`. Все размеры ниже — в **pt (= CSS px)**, в скобках — px исходника, где полезно.
- **Статус-бар**: `09:54` + стрелка геолокации слева; по центру синяя системная капсула «✈ TELEGRAM»; справа сигнал (3/4), `LTE`, батарея жёлтая (режим энергосбережения) с цифрой `51`.

## 2. Иерархия слоёв
```
tg-screen (#000)
├─ tg-hero (full-bleed фото группы, 414×512)
│  ├─ tg-hero__img            — фото (object-fit: cover)
│  ├─ tg-hero__scrim-top      — затемнение под статус-бар
│  ├─ tg-hero__blur-bottom    — прогрессивный blur + затемнение нижней трети
│  ├─ tg-hero__title          — «АСГАРД: Замена фа…» (left-aligned)
│  ├─ tg-hero__subtitle       — «9 участников»
│  └─ tg-actions (3 × tg-action, стекло поверх фото)
├─ tg-status-bar (системный, поверх фото)
├─ tg-nav-btn--back (стеклянный круг ‹)        — absolute, поверх фото
├─ tg-nav-btn--pill «Изм.» (стеклянная пилюля)  — absolute, поверх фото
├─ tg-segmented (glass-капсула вкладок, горизонтальный скролл)
│  ├─ tg-segmented__item.is-active «Участники»
│  └─ tg-segmented__item «Медиа» / «Файлы» / «Голосовые» (+ хвост за краем)
└─ tg-list-card (inset-карточка #1C1C1E, верхние углы скруглены, уходит за низ экрана)
   ├─ tg-list-row--action «Добавить участников»
   └─ tg-member-row × N (аватар 40, имя, статус, опц. ★ / emoji-статус / бейдж роли)
```

## 3. Геометрия
Сетка: горизонтальные поля экрана **16 pt** (19 px) слева и справа для всех блоков ниже фото и для текста/кнопок поверх фото. Рабочая ширина **382 pt**.

| Элемент | x (pt) | y (pt) | w × h (pt) | Источник, px |
|---|---|---|---|---|
| Статус-бар | 0 | 0 | 414 × 44 | — |
| Время `09:54` | 21 | cap 19…30 | ~60 × cap 11.4 | 24–92 × 22–34 |
| Капсула «TELEGRAM» | 160 | 4 | 93 × 23, radius 11.5 | 183–289 × 5–31 |
| Кнопка «‹» (круг) | 16 | 58.5 | **44 × 44**, Ø 44 | 19–67 × 67–115 |
| Шеврон внутри | центр | центр | глиф ~10 × 18, штрих ~2.2 | 36–47 × 81–101 |
| Пилюля «Изм.» | 335 (right 16) | 58.5 | **63 × 44**, radius 22 | 382–453 |
| Текст «Изм.» внутри | pad-left 13, pad-right 14 | — | — | 397–437 |
| Hero-фото | 0 | 0 | **414 × 512** | низ фото = 585 px |
| Title | 16 | cap 376.5…391 (baseline ≈ 391) | обрезан на ~236 pt | 19–270 × 430–447 |
| Subtitle | 16 | cap 402.5…413 (baseline ≈ 413) | — | 19–131 × 460–472 |
| Gap title→subtitle (baseline→baseline) | — | 22 | — | — |
| Action-кнопки | 16 / 146 / 276 | 438.5 | **122 × 58**, gap **8**, radius ≈ 12 | 19–157 / 167–305 / 316–454 × 501–567 |
| Иконка в action | центр | глиф 449…468 | ~20 × 20 (bbox 22–24) | bell 78–97 × 513–535 |
| Подпись action | центр | baseline ≈ 483 | — | 546–555 |
| Низ actions → низ фото | — | 16 | — | 567 → 585 |
| Фото → сегмент | — | gap **6–7** | — | 585 → 593 |
| Сегмент (glass-капсула) | 16 | 519 | **382 × 40**, radius 20 | 18–455 × 593–638 |
| Активная пилюля в сегменте | 19.5 (inset 3.5) | 522.5 | **108.5 × 33**, radius 16.5 | 22–146 × 597–635 |
| Паддинг вкладки | 17–19 по горизонтали, без gap между вкладками | — | — | «Участники» 41–125, «Медиа» 166–218, «Файлы» 258–312, «Голосовые» 354–440 |
| Сегмент → карточка | — | gap **16** | — | 638 → 657 |
| Карточка списка | 16 | 575 | **382 × (до низа и дальше)**, radius **24** только сверху видно | 19–454 × 657–1024+ |
| Строка «Добавить участников» | 0 (в карточке) | 575 | 382 × **44** | 657–707 |
| Иконка add-user | центр колонки аватара (x≈35 от карточки) | центр строки | глиф ~18 × 22 | 46–67 × 669–693 |
| Строка участника | 0 | 619, 672, 725, 777, 830.5, 883 | 382 × **52.9 (≈53)** | шаг 60.4 px; разделители 707/767/828/888/949/1009 |
| Аватар | 15 от края карточки (31 от экрана) | центр строки | **40 × 40**, круг | 36–82 × 714–760 |
| Текстовая колонка | **65** от края карточки (81 от экрана) | — | до бейджа / края − 15 | 93 px |
| Gap аватар → текст | — | — | 10 | — |
| Имя (baseline) | — | 27 от верха строки | — | Никита: cap 721–734 |
| Статус (baseline) | — | ~46 от верха строки | — | 753 |
| Звезда Premium | gap ~6–8 после имени | по cap-линии имени | глиф ~10.5, box 14 | 393–404 × 783–794 |
| Emoji-статус | gap ~4 после «…» | — | **15 × 15** | 317–333 × 963–979 |
| Бейдж «владелец» | right 15 в карточке | центр строки | **73 × 19**, radius 9.5 | 354–437 × 969–990 |
| Разделитель | left **65** (от текста), right **0** | низ строки | 0.5 pt | 93–454 |

Скругление карточки рассчитано по профилю угла (смещение кромки 19.5 / 8.5 / 3.5 / 0 px на глубине 1 / 8 / 13 / 23 px) → R ≈ 27–28 px ≈ **24 pt**.

## 4. Цвет
| Токен | Значение | Замер / комментарий |
|---|---|---|
| `--tg-bg` экран | `#000000` | 586+ px, вне карточки |
| `--tg-card` | `#1C1C1E` | чисто на 760/900 px |
| `--tg-separator` | `#38383A` (≈ `rgba(84,84,88,0.65)`) | на кадре `#28282A…#2F2F31` из-за даунскейла hairline |
| `--tg-segment-bg` | `#181818…#1C1C1C` → делать `rgba(28,28,30,0.92)` + blur | замер внутри капсулы |
| `--tg-segment-rim` | `rgba(255,255,255,0.10)` | 1 px светлее кромка `#282828…#313131` по контуру капсулы |
| `--tg-segment-active` | `#3A3A3C` | замер `#383838…#3A3A3A` |
| `--tg-glass-dark` (‹, «Изм.») | визуально `#222222` над фото `#888886` → `rgba(18,18,18,0.88)` + `backdrop-filter: blur(20px)` | одинаково у круга и пилюли |
| `--tg-glass-light` (actions) | `rgba(255,255,255,0.07)` поверх размытого фото | кнопка светлее зазора на ~+8…10 уровней L (`#5B5B59` vs `#535351`) |
| Текст primary | `#FFFFFF` | имена, вкладки, title, иконки actions, «Изм.» |
| Текст поверх фото — subtitle | `rgba(255,255,255,0.75)` (визуально светло-серый) | ядро глифов до `#FDFFFC`, на глаз заметно тусклее title |
| Подписи actions | `rgba(255,255,255,0.90)` | ядро `#EEEEEC…#F8F8F6` |
| Текст secondary | `#8E8E93` (замер ядра `#96959A`) | «был(а) недавно» |
| Accent (Telegram dark) | `#3E88F7` (рекомендуемый токен) | замер JPEG `#5D80DC…#6586D7` (хрома срезана сабсэмплингом): «Добавить участников», иконка add-user, «в сети», ★ Premium |
| Системный синий (капсула статус-бара) | `#0A84FF` / замер `#207BFF` | системный chrome, не токен приложения |
| Батарея (Low Power) | `#FFD60A` / замер `#FED73E` | цифра `51` чёрная |
| Бейдж owner — фон | `rgba(150,110,230,0.14)` ≈ на карточке `#292232` | замер `#292232…#2A2132` |
| Бейдж owner — текст | `#A28BD6` (рекоменд.) | замер ядра `#8878A7…#8876AA` (занижено JPEG) |
| Аватар «ОВ» — градиент | `linear-gradient(180deg, #FF885E 0%, #FF516A 100%)` | замер насыщенных точек `#FA6C60`, `#F2715C`, `#F75F6B` (красная палитра Telegram) |
| Инициалы на аватаре | `#FFFFFF` | — |
| Hero: верхний скрим | `linear-gradient(180deg, rgba(0,0,0,0.38) 0, rgba(0,0,0,0) 140pt)` | небо у края: `#636361` (y=0) → `#A0A29F` (y≈160–360 px) |
| Hero: нижний скрим | `linear-gradient(180deg, rgba(0,0,0,0) 0, rgba(0,0,0,0.30) 100%)` на нижних ~180 pt | `#9C9E9B` (y 360 px) → `#80827F` (480) → `#70706E` (560) |

## 5. Типографика
Шрифт: SF Pro (`-apple-system, "SF Pro Text", "SF Pro Display", system-ui`). Кегль выведен из высоты прописных (cap ≈ 0.70 em) и x-height (≈ 0.52 em).

| Роль | Размер / вес | Цвет | Прочее |
|---|---|---|---|
| Время статус-бара | 17 / 600 | `#FFF` | cap 11.4 pt |
| «TELEGRAM» в капсуле | ~13 / 600, uppercase | `#FFF` | + иконка бумажного самолётика ~13 pt |
| `LTE`, `51` | 14…12 / 600 | `#FFF` / `#000` на жёлтом | — |
| «Изм.» | 17 / 400 | `#FFF` | cap 11.4 pt, по центру пилюли |
| Title группы | **22 / 600** | `#FFF` | cap 15.7 pt; одна строка, `…` на ~236 pt; выровнен влево |
| Subtitle «9 участников» | 16 / 400 | `rgba(255,255,255,.75)` | цифры 11.4 pt |
| Подписи actions | 12 / 500 | `rgba(255,255,255,.9)` | нижний регистр («звук», «поиск», «ещё») |
| Вкладки сегмента | **15 / 600** | `#FFF` (активная и неактивные одинаково) | cap 10.5 pt, без uppercase |
| «Добавить участников» | 17 / 400 | accent | baseline совпадает с колонкой имён |
| Имя участника | **17**; имя — 400, **фамилия/остальное — 600** | `#FFF` | «Олег **Сергеевич Асгарт Сервис**», «Виктор **Баринов**», «Андрей **Сторожев Асг…**»; одиночное имя «Никита» — 400; `…` при переполнении |
| Статус | 15 / 400 | `#8E8E93`; онлайн — accent | «был(а) недавно» / «в сети» |
| Бейдж роли | 13 / 400–500 | owner-фиолетовый | «владелец», без uppercase |
| Инициалы аватара | 16 / 600 | `#FFF` | «ОВ», cap 11.4 pt |

Межбуквенный — системный (0); title с лёгким отрицательным трекингом Display-начертания допустим.

## 6. Иконки/контролы
- **Назад**: шеврон-влево, белый, штрих ~2.2 pt, скруглённые концы, глиф 10×18, в стеклянном круге Ø 44.
- **«Изм.»**: текстовая glass-пилюля, высота 44, полностью скруглённая.
- **Action «звук»**: колокольчик **залитый** (filled), белый, ~20 pt; без перечёркивания.
- **Action «поиск»**: лупа (outline, штрих ~2.2), белая, ~20 pt.
- **Action «ещё»**: три точки по горизонтали, Ø точки ~4 pt, шаг ~7 pt, белые.
- **Сегмент вкладок**: glass-капсула + подвижная тёмно-серая пилюля под активной вкладкой (iOS 26 segmented / tab-strip). Вкладки: «Участники» (active), «Медиа», «Файлы», «Голосовые», далее — хвост за правой кромкой (горизонтальный скролл, предположительно «Ссылки»).
- **Add-user**: контурный силуэт человека + «+» слева-снизу, accent, глиф ~18×22, выровнен по центру колонки аватара (40 pt).
- **Аватары**: круг 40; фото (Никита, Олег С., Виктор, Андрей — медведь) и инициалы на градиенте (ОВ, красная палитра).
- **★ Premium**: пятиконечная залитая звезда, accent, глиф ~10.5 pt, после имени.
- **Emoji-статус** (Андрей): кастомный эмодзи ~15 pt (сине-белый «джойкон»), после усечённого имени.
- **Бейдж «владелец»**: текстовая пилюля роли, справа, вертикально по центру строки.

## 7. Тени / бордеры / разделители
- **Тени**: нет ни у карточки, ни у кнопок (flat). Глубину даёт только стекло/blur.
- **Glass-кнопки на фото** («‹», «Изм.»): тёмное стекло, `backdrop-filter: blur(20px) saturate(160%)`; заметного светлого рима на JPEG не видно (переход 1 px антиалиас).
- **Action-кнопки**: светлое стекло `rgba(255,255,255,.07)` поверх **уже размытой** нижней части фото; без бордера; углы ≈ 12 pt.
- **Сегмент**: rim 0.5–1 pt `rgba(255,255,255,.10)` по всему контуру капсулы (хорошо видно сверху и по бокам); активная пилюля без рима.
- **Hero**: нижняя треть фото — **прогрессивный blur** (нарастает от ~y 333 pt к низу 512 pt; основание факельной трубы полностью размыто) + нижний скрим `0→0.30`. Сверху — скрим под статус-бар `0.38→0` на ~140 pt. Край фото внизу — жёсткий, без градиента в чёрный (`#0F0F0F` → `#000` за 1 px).
- **Разделители списка**: hairline 0.5 pt `#38383A`, начинаются от колонки текста (65 pt от края карточки), доходят до правого края карточки без отступа; под последней видимой строкой тоже есть.
- **Карточка**: без бордера, радиус 24 сверху; кромка к чёрному фону с 1 px антиалиасом (`#141416`).

## 8. Состояния на кадре
- Hero-фото **раскрыто** (expanded avatar): title и subtitle — left-aligned поверх фото, а не по центру под круглым аватаром.
- Title усечён на ~236 pt при доступных ~382 pt — похоже, усечение посчитано под компактную (центрированную) ширину заголовка и перенесено в раскрытый режим.
- Вкладка «Участники» — **active** (пилюля `#3A3A3C`); остальные — idle без фона, цвет текста тот же белый.
- Action-кнопки, «‹», «Изм.» — idle (не pressed).
- Колокольчик залитый, подпись «звук» — состояние уведомлений неоднозначно (см. §10).
- Никита — онлайн («в сети», accent); остальные — «был(а) недавно».
- Олег С. и Олег В. — Premium (★).
- Андрей — emoji-статус + роль «владелец»; имя усечено `…`, чтобы влезли эмодзи и бейдж.
- Список прокручиваемый: 6-я строка (аватар) обрезана низом экрана; home-indicator перекрыт/не виден.

## 9. CSS-скелет
```css
:root {
  --tg-bg: #000000;
  --tg-card: #1c1c1e;
  --tg-separator: #38383a;
  --tg-text: #ffffff;
  --tg-text-2: #8e8e93;
  --tg-accent: #3e88f7;
  --tg-seg-bg: rgba(28, 28, 30, 0.92);
  --tg-seg-rim: rgba(255, 255, 255, 0.10);
  --tg-seg-active: #3a3a3c;
  --tg-glass-dark: rgba(18, 18, 18, 0.88);
  --tg-glass-light: rgba(255, 255, 255, 0.07);
  --tg-owner-fg: #a28bd6;
  --tg-owner-bg: rgba(150, 110, 230, 0.14);
  --tg-gutter: 16px;
}

.tg-screen {
  position: relative;
  width: 414px;
  min-height: 896px;
  background: var(--tg-bg);
  color: var(--tg-text);
  font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ---------- Hero ---------- */
.tg-hero {
  position: relative;
  height: 512px;
  overflow: hidden;
}
.tg-hero__img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
}
.tg-hero__scrim-top {
  position: absolute; left: 0; right: 0; top: 0; height: 140px;
  background: linear-gradient(180deg, rgba(0,0,0,.38) 0%, rgba(0,0,0,0) 100%);
  pointer-events: none;
}
.tg-hero__blur-bottom {
  position: absolute; left: 0; right: 0; bottom: 0; height: 180px;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 45%);
          mask-image: linear-gradient(180deg, transparent 0%, #000 45%);
  background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,.30) 100%);
  pointer-events: none;
}
.tg-hero__title {
  position: absolute; left: var(--tg-gutter); top: 371px;
  max-width: 236px;
  font: 600 22px/26px -apple-system, "SF Pro Display", system-ui, sans-serif;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tg-hero__subtitle {
  position: absolute; left: var(--tg-gutter); top: 398px;
  font: 400 16px/20px -apple-system, "SF Pro Text", system-ui, sans-serif;
  color: rgba(255,255,255,.75);
}

/* ---------- Actions over photo ---------- */
.tg-actions {
  position: absolute; left: var(--tg-gutter); right: var(--tg-gutter); top: 438px;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
}
.tg-action {
  height: 58px;
  border-radius: 12px;
  background: var(--tg-glass-light);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px;
  color: #fff; border: 0;
}
.tg-action__icon { width: 22px; height: 22px; }
.tg-action__label { font: 500 12px/14px -apple-system, system-ui, sans-serif; color: rgba(255,255,255,.9); }
.tg-action:active { background: rgba(255,255,255,.14); }

/* ---------- Floating nav ---------- */
.tg-status-bar {
  position: absolute; inset: 0 0 auto 0; height: 44px; z-index: 3;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 21px; font: 600 17px/1 -apple-system, system-ui, sans-serif;
}
.tg-status-capsule {
  position: absolute; left: 50%; top: 4px; transform: translateX(-50%);
  height: 23px; padding: 0 10px; border-radius: 11.5px;
  background: #0a84ff; color: #fff;
  font: 600 13px/23px -apple-system, system-ui, sans-serif; letter-spacing: .02em;
}
.tg-nav-btn {
  position: absolute; top: 58px; z-index: 3;
  height: 44px;
  background: var(--tg-glass-dark);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  color: #fff; border: 0;
  display: flex; align-items: center; justify-content: center;
}
.tg-nav-btn--back { left: var(--tg-gutter); width: 44px; border-radius: 50%; }
.tg-nav-btn--back svg { width: 10px; height: 18px; stroke: #fff; stroke-width: 2.2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.tg-nav-btn--pill {
  right: var(--tg-gutter); padding: 0 14px 0 13px; border-radius: 22px;
  font: 400 17px/1 -apple-system, system-ui, sans-serif;
}
.tg-nav-btn:active { filter: brightness(1.25); }

/* ---------- Segmented tabs ---------- */
.tg-segmented {
  margin: 7px var(--tg-gutter) 0;
  height: 40px; padding: 3.5px;
  border-radius: 20px;
  background: var(--tg-seg-bg);
  box-shadow: inset 0 0 0 0.5px var(--tg-seg-rim);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  display: flex; overflow-x: auto; scrollbar-width: none;
  -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 16px), transparent);
          mask-image: linear-gradient(90deg, #000 calc(100% - 16px), transparent);
}
.tg-segmented::-webkit-scrollbar { display: none; }
.tg-segmented__item {
  flex: 0 0 auto;
  height: 33px; padding: 0 18px;
  border-radius: 16.5px;
  font: 600 15px/33px -apple-system, system-ui, sans-serif;
  color: #fff; background: transparent; border: 0;
  white-space: nowrap;
}
.tg-segmented__item.is-active { background: var(--tg-seg-active); }

/* ---------- List card ---------- */
.tg-list-card {
  margin: 16px var(--tg-gutter) 0;
  background: var(--tg-card);
  border-radius: 24px;
  overflow: hidden;
}
.tg-list-row,
.tg-member-row {
  position: relative;
  display: flex; align-items: center;
  padding: 0 15px;
}
.tg-list-row { height: 44px; }
.tg-member-row { height: 53px; }
.tg-list-row::after,
.tg-member-row::after {
  content: ""; position: absolute; left: 65px; right: 0; bottom: 0;
  height: 0.5px; background: var(--tg-separator);
}
.tg-list-row--action { color: var(--tg-accent); font: 400 17px/22px -apple-system, system-ui, sans-serif; }
.tg-list-row__icon { width: 40px; height: 22px; margin-right: 10px; display: flex; justify-content: center; color: var(--tg-accent); }

.tg-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  flex: 0 0 40px; margin-right: 10px;
  object-fit: cover; background: #3a3a3c;
  display: flex; align-items: center; justify-content: center;
  font: 600 16px/1 -apple-system, system-ui, sans-serif; color: #fff;
}
.tg-avatar--red { background: linear-gradient(180deg, #ff885e 0%, #ff516a 100%); }

.tg-member-row__meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.tg-member-row__name {
  display: flex; align-items: center; gap: 6px;
  font: 400 17px/22px -apple-system, system-ui, sans-serif; color: #fff;
  white-space: nowrap; overflow: hidden;
}
.tg-member-row__name-text { overflow: hidden; text-overflow: ellipsis; }
.tg-member-row__name b { font-weight: 600; }
.tg-member-row__status { font: 400 15px/20px -apple-system, system-ui, sans-serif; color: var(--tg-text-2); }
.tg-member-row__status.is-online { color: var(--tg-accent); }

.tg-premium-star { flex: 0 0 auto; width: 14px; height: 14px; color: var(--tg-accent); }
.tg-emoji-status { flex: 0 0 auto; width: 15px; height: 15px; margin-left: -2px; }

.tg-role-badge {
  flex: 0 0 auto; margin-left: 8px;
  height: 19px; padding: 0 8px; border-radius: 9.5px;
  background: var(--tg-owner-bg); color: var(--tg-owner-fg);
  font: 400 13px/19px -apple-system, system-ui, sans-serif;
}
.tg-member-row:active { background: rgba(255,255,255,.06); }
```

## 10. Неуверенности
- **Масштаб**: исходник 473 px, а не 828 px — это даунскейл ×0.571. Все размеры получены из 473-px кадра и пересчитаны через 1.1425 px/pt; погрешность ±0.5–1 pt для линий/радиусов, ±1 pt для кеглей.
- **Цвета мелких элементов** (accent, ★, «в сети», бейдж) занижены по насыщенности JPEG-сабсэмплингом. `#3E88F7` и `#A28BD6` — рекомендуемые токены, на глаз и по памяти о Telegram dark, а не прямой замер. Прямые замеры приведены рядом.
- **Стекло** (`rgba` + blur): вывод по итоговому пикселю поверх известного фона; реальный материал iOS 26 (Liquid Glass) даёт преломление и блик, которые CSS-значениями не повторить — альфа и blur подобраны на глаз.
- **Радиус action-кнопок** ≈ 12 pt оценён по контрастному кропу (края размыты blur'ом фото); возможен диапазон 11–14 pt.
- **Радиус карточки** 24 pt — из профиля угла; диапазон 22–26.
- **Высота строки участника** 52.9 pt — среднее по 5 шагам (60–61 px); в реализации допустимо 52 или 53.
- **Прогрессивный blur и скримы** — на глаз (граница начала blur ~333 pt, сила ~24 px); фото само по себе может содержать градиент неба, поэтому альфы скримов (0.38 / 0.30) — верхняя оценка.
- **Subtitle**: ядро глифов почти белое, но визуально он тусклее title — взял `rgba(255,255,255,.75)` на глаз.
- **Вес** вкладок (600) и подписей actions (500) — на глаз; кегли выведены из cap/x-height.
- **Колокольчик + «звук»**: нельзя однозначно сказать, включены ли сейчас уведомления (подпись может означать «включить звук»). Перечёркивания у иконки нет.
- **Хвост вкладок** за «Голосовые» не виден; наличие fade-маски у правого края — предположение (текст заканчивается за 14 px до кромки, следующая вкладка за кадром).
- **Усечение title на ~236 pt** — гипотеза о переносе ширины из компактного режима; может быть и явный `max-width`.
- **Emoji-статус** Андрея — кастомный эмодзи; конкретный стикер не идентифицирован.
- **Статус-бар и синяя капсула** — системный chrome iOS, к токенам приложения не относятся; размеры даны для полноты кадра.
