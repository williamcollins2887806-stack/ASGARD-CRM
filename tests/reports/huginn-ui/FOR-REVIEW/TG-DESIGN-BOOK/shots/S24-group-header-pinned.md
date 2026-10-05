# S24 — group-header-pinned

## 1. Мета
- **Приложение:** Telegram iOS (русский UI).
- **Экран:** верхняя зона группового чата «АСГАРД: Замена факель…» (title truncated).
- **Тема:** Dark / OLED Night; фон ленты почти чёрный `#000000`, chrome — floating glass (liquid-glass капсулы).
- **Ориентация:** портрет.
- **Файл-референс:** `REFS/S24.jpg`, физический размер **828 × 347 px** (кроп верха экрана; ≈ **414 × 174 pt** @2x). Полный viewport на устройстве класса iPhone 14/15 Pro ≈ **414 × 896 pt** — на кадре только StatusBar + Nav + Pinned.
- **Системное время:** `09:55`.
- **Сеть / батарея:** LTE; батарея **~52%**, fill **жёлтый** (Low Power Mode).
- **Status chrome:** слева время; по центру — синяя Live Activity / return-pill «✈ TELEGRAM»; справа LTE + батарея.
- **Контекст:** открыт групповой чат с **1** видимым закрепом; подзаголовок «9 участников»; back-counter **51**; лента сообщений сильно размыта под glass-хедером.
- **Slug:** `group-header-pinned`.

## 2. Иерархия слоёв
Порядок отрисовки (z от дальнего к ближнему):

1. **`.tg-chat-bg` / message list** — тёмный фон + размытые пузыри/аватарки ленты (видны только как цветные пятна под blur).
2. **`.tg-pinned-capsule`** — отдельная плавающая glass-капсула закрепа (не full-bleed bar классического Telegram, а inset pill).
3. **`.tg-nav-cluster`** — три floating-элемента в один ряд:
   - `.tg-back-pill` (шеврон + счётчик `51`);
   - `.tg-title-pill` (title + subtitle);
   - `.tg-avatar` (круглый аватар группы).
4. **`.tg-status-bar`** — системный iOS слой (время / TELEGRAM-pill / LTE+battery) поверх Dynamic Island.

Blur ленты читается сквозь все glass-капсулы (`backdrop-filter`).

## 3. Геометрия
Все значения — **логические pt** (кадр @2x ⇒ pt = px/2), если не указано иное. Измерения по пикселям `REFS/S24.jpg`.

### Кроп / экран
| Элемент | Значение |
|---|---|
| Ширина кадра | **414 pt** (828 px) |
| Высота кадра | **~174 pt** (347 px) — только верх |
| Safe-area top / StatusBar зона | **~47–54 pt** до центра nav-ряда |
| Dynamic Island + TELEGRAM pill | центр сверху; pill ≈ **92 × 17 pt** (bbox px 322…505 × 20…53) |

### Nav cluster (floating glass)
| Элемент | Значение |
|---|---|
| Ряд nav (центр капсул) | Y ≈ **72–78 pt** от верха кадра |
| Back pill left inset | **~16 pt** (px left edge ≈ 32) |
| Back pill size | ≈ **54 × 40 pt** (stadium/capsule; не узкий круг-only) |
| Back pill radius | **~20 pt** (половина высоты → stadium) |
| Chevron hit | слева внутри pill, glyph ≈ **12–14 pt** |
| Counter «51» | справа от шеврона внутри той же pill; цифры ≈ **14–15 pt** |
| Gap back → title pill | **~6–10 pt** |
| Title pill | высота **~40–44 pt**; ширина **~250–280 pt** (от ~72 pt до ~350 pt по X) |
| Title pill radius | **~20–22 pt** (stadium) |
| Title stack | 2 строки; gap title↔subtitle **~1–2 pt**; H-padding внутри **~14–16 pt** |
| Gap title → avatar | **~8–12 pt** |
| Avatar | **Ø 36–40 pt** (фото ≈ 37–38 pt по ширине px 714…789); right inset **~12–16 pt** |
| Avatar radius | **50%** (идеальный круг) |

### Pinned capsule
| Элемент | Значение |
|---|---|
| Top (после nav) | ≈ **116–118 pt** (px y ≈ 233–236); gap nav→pin **~14–18 pt** чёрного воздуха |
| H-margin | **~12–16 pt** с каждой стороны (px left≈37, right≈813 → W≈388 pt) |
| Width | **~382–390 pt** (`100% − 24…32 pt`) |
| Height | **~50–56 pt** |
| Corner radius | **~18–20 pt** |
| Inner padding | V **~8–10 pt**, H **~12–14 pt** |
| Accent v-line | W **2 pt** (px 68…71 ≈ 4 px @2x), H **~20–22 pt**, radius **~1 pt**; left inset внутри pill **~14–16 pt** |
| Gap v-line → text | **~8–10 pt** |
| Text block | 2 строки (label + preview), max-width до X-кнопки |
| Close (X) | glyph ≈ **12–14 pt**; hit ≈ **28–32 pt**; right inset **~12–14 pt**; вертикально по центру pill |

## 4. Цвет
Сэмплы усреднены по локальным окнам пикселей кадра (JPEG → ±2…4 на канал).

| Роль | HEX / RGBA | Где / заметка |
|---|---|---|
| Screen / gap BG | `#000000` | поля вокруг капсул, gap nav↔pin |
| Glass fill (back / pin body) | `#171718`…`#1C1C1E` @ **0.72–0.88** | измеренный flat ≈ `#171718`; визуально `rgba(23, 23, 25, 0.80)` |
| Glass fill (title pill) | `#25192E`…`#2B1E33` @ **0.70–0.85** | чуть теплее/фиолетовистее из-за bleed размытого аватара/ленты |
| Backdrop blur | `blur(20–30 px)` + `saturate(1.2–1.6)` | сильный frosted glass; точный σ по JPEG не восстанавливается |
| Title primary | `#FFFFFF` / `#FDFBFF` | «АСГАРД: Замена факель…» |
| Subtitle secondary | `#8C8592`…`#98939C` | «9 участников»; ближе к iOS secondary `rgba(235,235,245,0.60)` на чёрном |
| Back chevron + «51» | `#FFFFFF` | на этом кадре **не** синий accent (в отличие от классического TG back) |
| TELEGRAM Live Activity pill | `#3B77EA`…`#3779F2` | avg ≈ `#3B77EA`; iOS system-blue семейство |
| Battery Low Power fill | `#EED35C`…`#F2D54B` | avg ≈ `#EED35C`; iOS yellow `#FFD60A` в JPEG чуть приглушён |
| StatusBar time / LTE | `#FFFFFF` @ ~0.95–1.0 | |
| Pinned label | `#F3F3F4`…`#FFFFFF` | «Закреплённое сообщение» — почти белый, **без** TG-blue tint на этом кадре |
| Pinned preview | `#979799`…`#878788` | secondary, 1 line ellipsis |
| Pinned accent v-line | `#FDFDFF` / `#FFFFFF` @ **0.95–1.0** | не синяя (отличие от классического pinned bar S05) |
| Close X | `#FFFFFF` @ **0.55–0.75** | тонкие штрихи; на кадре ближе к белому ~0.7 |
| Hairline / rim glass | `rgba(255,255,255,0.08–0.14)` | едва читаемая обводка капсул |

## 5. Типографика
- **Семейство:** SF Pro Text / SF Pro Display (системный iOS).
- **StatusBar time `09:55`:** ~15–16 pt, Semibold/Medium, `#FFFFFF`.
- **TELEGRAM pill label:** ~11–12 pt, Semibold, `#FFFFFF` на синем; tracking слегка сжатый.
- **Nav title «АСГАРД: Замена факель…»:** ~17 pt, Semibold (600), `#FFFFFF`, 1 line, **truncating tail** (ellipsis).
- **Nav subtitle «9 участников»:** ~13 pt, Regular, secondary `#8C8592`…`#98939C`.
- **Back counter `51`:** ~14–15 pt, Medium/Semibold, `#FFFFFF`; визуально чуть сжатый tracking в узкой pill.
- **Pinned label «Закреплённое сообщение»:** ~13–14 pt, Semibold/Medium, почти `#FFFFFF`.
- **Pinned preview:** ~13–14 pt, Regular, secondary, 1 line ellipsis.
- **Letter-spacing:** системный default; у counter — лёгкое уплотнение.
- **Line-height:** title stack ≈ 1.15–1.25; pinned stack ≈ 1.20–1.30.

## 6. Иконки/контролы
- **Back chevron:** SF-style `<`, stroke ~2–2.5 pt, белый; внутри левой glass-pill вместе со счётчиком.
- **Unread/stack counter `51`:** не отдельный синий badge-круг (как в S05), а **цифры внутри** той же back-pill.
- **Group avatar:** круг Ø 36–40 pt; фото промышленного факела/трубы; `clipsToBounds`; без видимого ring.
- **Pinned accent:** вертикальный rounded-rect 2×(20–22) pt, белый.
- **Close X:** два тонких диагональных штриха (~12–14 pt bounding), trailing в pinned capsule; dismiss закрепа (не «список закрепов» из классического bar).
- **Live Activity / return pill:** paper-plane glyph + слово `TELEGRAM` в синей stadium-капсуле над Dynamic Island.
- **Battery:** стандартный iOS глиф; fill жёлтый (LPM).
- **Нет на кадре:** mute glyph у title, кнопки attach/mic, keyboard, home indicator (обрезаны кропом).

## 7. Тени / бордеры / разделители
- **Glass rim:** hairline **0.33–0.5 pt** `rgba(255,255,255,0.08–0.14)` по контуру back / title / pinned капсул.
- **Drop shadow (pinned):** мягкая, `0 4–8 pt / blur 10–16 pt / rgba(0,0,0,0.25–0.40)`; nav-капсулы — тень слабее или почти только blur-контраст.
- **Accent v-line:** solid white, без собственной тени; radius ~1 pt.
- **Нет** full-width hairline-разделителя под nav (в отличие от классического sticky bar S05) — капсулы «висят» над чёрным gap.
- **Blur:** nav + pinned ≈ `backdrop-filter: blur(20–30px)`; лента под ними нечитаема (сильный frosted).

## 8. Состояния на кадре
- **StatusBar:** `09:55`; LTE; battery ~52% **Low Power** (жёлтый fill).
- **Live Activity:** активен return-to-Telegram pill («TELEGRAM») в зоне Dynamic Island.
- **Chat:** групповой, 9 участников; title truncated.
- **Back stack:** counter **51** (непрочитанные / глубина стека чатов).
- **Pinned:** ровно один видимый закреп; label «Закреплённое сообщение»; preview обрезан ellipsis; справа **X** (можно снять/скрыть закреп с UI).
- **Scroll:** лента ушла под chrome (контент виден только как blur) — типичный mid/top scroll с overlapping header.
- **Composer / keyboard / menus:** вне кадра.
- **Selection / context menu:** нет.

## 9. CSS-скелет
```css
:root {
  --tg-bg: #000000;
  --tg-glass: rgba(23, 23, 25, 0.80);
  --tg-glass-title: rgba(40, 30, 48, 0.78);
  --tg-hairline: rgba(255, 255, 255, 0.10);
  --tg-text: #ffffff;
  --tg-text-secondary: rgba(235, 235, 245, 0.60); /* ≈ #8C8592 on black */
  --tg-accent-ios: #3b77ea;
  --tg-battery-lpm: #ffd60a;
  --tg-blur: blur(25px) saturate(1.4);
  --tg-radius-pill: 20px;
  --tg-radius-pin: 18px;
}

.tg-screen-top {
  position: relative;
  width: 414px;
  background: var(--tg-bg);
  color: var(--tg-text);
  font-family: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
}

/* Status / Live Activity — системные; здесь только маркер */
.tg-live-pill {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  height: 17px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--tg-accent-ios);
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
}

.tg-nav-cluster {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  margin-top: 54px; /* ниже status/island */
}

.tg-glass {
  background: var(--tg-glass);
  backdrop-filter: var(--tg-blur);
  -webkit-backdrop-filter: var(--tg-blur);
  border: 0.5px solid var(--tg-hairline);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.30);
}

.tg-back-pill {
  composes: tg-glass;
  height: 40px;
  min-width: 54px;
  padding: 0 12px 0 10px;
  border-radius: var(--tg-radius-pill);
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 15px;
  font-weight: 600;
}

.tg-back-pill .chevron {
  font-size: 20px;
  line-height: 1;
  font-weight: 400;
}

.tg-title-pill {
  composes: tg-glass;
  background: var(--tg-glass-title);
  flex: 1;
  height: 44px;
  padding: 4px 16px;
  border-radius: var(--tg-radius-pill);
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}

.tg-title-pill .title {
  font-size: 17px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tg-title-pill .subtitle {
  font-size: 13px;
  font-weight: 400;
  color: var(--tg-text-secondary);
}

.tg-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.tg-pinned-capsule {
  composes: tg-glass;
  margin: 14px 14px 0;
  min-height: 52px;
  border-radius: var(--tg-radius-pin);
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.tg-pinned-capsule .accent {
  width: 2px;
  height: 32px;
  border-radius: 1px;
  background: #ffffff;
  flex-shrink: 0;
}

.tg-pinned-capsule .text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tg-pinned-capsule .label {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
}

.tg-pinned-capsule .preview {
  font-size: 14px;
  font-weight: 400;
  color: var(--tg-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tg-pinned-capsule .close {
  width: 28px;
  height: 28px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.70);
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}
```

## 10. Неуверенности
- **Точный `backdrop-filter` σ** (20 vs 30 vs material thick) по JPEG не восстановить — диапазон 20–30 px.
- **Alpha glass** (0.72–0.88): измеренный RGB — композит blur+tint; «чистый» fill без подложки неизвестен.
- **Высота back-pill / title-pill** (±2–4 pt): JPEG AA на скруглениях размывает край.
- **Pinned label tint:** на классическом TG label часто `#5BA4D9`; здесь сэмпл почти белый — возможно редизайн iOS liquid-glass / настройка темы; синий tint **не подтверждён**.
- **Back accent color:** на части билдов шеврон синий (`#007AFF`); на S24 — белый внутри dark glass.
- **Полная высота экрана / composer** вне кропа — не документированы.
- **Точный текст preview закрепа** не читается (ellipsis + blur/JPEG).
- **Тень:** наличие мягкой drop-shadow у pin уверенное визуально; точные x/y/blur/alpha — оценка.
