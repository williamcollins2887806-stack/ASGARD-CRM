# S06 — profile-main

## 1. Мета
- **Приложение:** Telegram iOS (русский UI).
- **Экран:** главный экран вкладки «Настройки» / профиль текущего пользователя (Profile Settings Main).
- **Тема:** Pure Black / OLED Night (`#000000`).
- **Файл-референс:** `REFS/S06.jpg`, физический размер **828 × 1792 px** (≈ **414 × 896 pt** @2x).
- **Ориентация:** портрет.
- **StatusBar:** время `15:52` + location-arrow слева; центр — синий pill `✈ TELEGRAM` (фоновая активность); справа LTE + батарея **51%** (жёлтый fill = Low Power Mode).
- **Safe Area:** верх ≈ 44–48 pt (status); низ home-indicator ≈ 34 pt; floating TabBar + Search FAB поверх контента.
- **Язык UI:** русский.

## 2. Иерархия слоёв
Сверху вниз (z от дальнего к ближнему):

1. **`.tg-screen-bg`** — сплошной `#000000` на всю высоту.
2. **`.tg-scroll`** — вертикальный скролл-контент профиля:
   1. крупный аватар + имя + meta-строка;
   2. одиночная группа «Изменить фотографию»;
   3. карточка-алерт подтверждения номера (title / body / 2 action-row);
   4. группы меню (`Мой профиль` → `Избранное` → `Недавние звонки` / далее частично под TabBar).
3. **`.tg-nav-chrome`** — круглые кнопки Stories-grid (←) и «Изм.» (→) поверх верха аватара.
4. **`.tg-status-bar`** — системный слой.
5. **`.tg-tab-bar`** — нижняя floating-капсула с blur.
6. **`.tg-search-fab`** — отдельный круг поиска справа от капсулы.
7. **`.tg-home-indicator`** — системная полоска в самом низу.

## 3. Геометрия
Все значения — **логические pt** (кадр @2x ⇒ pt = px/2), если не указано иное.

### Экран / chrome
| Элемент | Значение |
|---|---|
| Ширина экрана | **414 pt** |
| Высота экрана | **896 pt** |
| StatusBar высота | ~44 pt |
| Горизонтальный inset групп | **16 pt** (карточки ≈ 382 pt wide) |
| Gap между группами | **24–26 pt** (edit→alert ≈ 24.5 pt) |
| Home indicator | ширина ~134 pt, высота ~5 pt, центр, `#FFFFFF` @ ~0.3–0.4 alpha |
| TabBar капсула | высота **~62–68 pt**, bottom inset над home ≈ **8–12 pt**, left inset ≈ **16–18 pt** |
| Search FAB | диаметр **≈ высота TabBar** (~56–64 pt), gap от капсулы **~8–12 pt**, right inset **~16 pt** |

### Header / профиль
| Элемент | Значение |
|---|---|
| Stories-btn (слева) | круг **32 × 32 pt**, left inset **16 pt**, top ≈ **58 pt** |
| Edit-btn «Изм.» (справа) | pill высота **32 pt**, ширина ≈ **48 pt**, right inset **16 pt** |
| Аватар | круг **100 × 100 pt** (измерено: 200 px diam), центр X = 207 pt |
| Аватар top | ≈ **63 pt** от верха кадра |
| Gap аватар → имя | **~18–22 pt** |
| Имя «Никита» | center, высота строки ≈ **28–32 pt** |
| Gap имя → meta | **4–6 pt** |
| Meta-row | center, height ≈ **18–20 pt** |
| Shield badge | **16–18 pt** tall (форма щита) |
| Dot separator | **≈ 3 pt** круг / glyph `•` |

### Группа «Изменить фотографию»
| Параметр | Значение |
|---|---|
| Top Y | ≈ **279 pt** |
| Высота | **≈ 52 pt** |
| Corner radius | **≈ 24–26 pt** (stadium / pill; radius ≈ height/2) |
| Icon size | **22–24 pt** |
| Padding L | **16 pt** |
| Gap icon → text | **12 pt** |

### Карточка подтверждения номера
| Параметр | Значение |
|---|---|
| Top Y | ≈ **355 pt** |
| Высота блока | **≈ 234–236 pt** |
| Corner radius | **12–14 pt** |
| Padding | **16 pt** |
| Warning icon | круг **20–22 pt** |
| Gap icon → title | **8–10 pt** |
| Body left indent | ≈ icon+gap = **28–32 pt** (текст под заголовком, не под иконкой) |
| Action row height | **44–48 pt** каждая |
| Actions | 2 строки: «Оставить +7 …» / «Изменить номер» |

### List groups (меню)
| Параметр | Значение |
|---|---|
| Corner radius | **10–12 pt** |
| Row height | **44–48 pt** |
| Icon tile | **29–30 × 29–30 pt**, radius **7–8 pt** (профиль — круглый силуэт на цветной плитке) |
| Gap icon → label | **12–15 pt** |
| Chevron right | ~12–14 pt, inset R **16 pt** |
| Divider inset-left | **≈ 60 pt** (после иконки) |
| Section gap | **~20–36 pt** между группами |

### Видимые пункты меню (сверху вниз)
1. **Мой профиль** — отдельная/верхняя группа (1 row).
2. **Избранное**
3. **Недавние звонки** (иконка зелёная трубка)
4. Ниже под TabBar частично видны следующие rows (напр. «Папки с чатами») — обрезаны blur-ом.

## 4. Цвет
| Роль | HEX / RGBA | Где |
|---|---|---|
| Screen BG | `#000000` | весь фон |
| Cell / card surface | `#1C1C1E` | edit-pill, alert, list groups |
| Nav button fill | `#2C2C2E` … `rgba(255,255,255,0.12–0.18)` | Stories / «Изм.» |
| Primary text | `#FFFFFF` | имя, list labels, alert title |
| Secondary text | `#8E8E93` | phone, username, alert body |
| Accent blue (links/actions) | `#0A84FF` / `#007AFF` (сэмпл JPEG ≈ `#408AEF`…`#4C8FF4`) | «Изменить фотографию», «Подробнее», action rows, active tab |
| Telegram brand blue (shield) | `#3390EC` | premium/status shield «1» |
| Status TELEGRAM pill | ≈ `#0A84FF`…`#4086F4` | Dynamic Island / status activity |
| Warning red | `#FF3B30` (сэмпл JPEG ≈ `#EE5E50` / `#D75F4D`) | `!` circle в алерте; tab badges |
| Profile icon tile | ≈ `#FF6B5C` / `#EE5E50` | «Мой профиль» |
| Favorites icon tile | ≈ `#3390EC` / `#4C8FF4` | «Избранное» |
| Calls icon tile | ≈ `#34C759` / `#84E686` | «Недавние звонки» |
| Divider | `#38383A` | hairline внутри групп |
| Chevron | `#545458` / `#3A3A3C` | `›` |
| TabBar / FAB glass | `rgba(28,28,30,0.78–0.88)` | floating chrome |
| Tab inactive | `#FFFFFF` или `#8E8E93` | иконки+labels |
| Tab active | `#0A84FF` + highlight `rgba(255,255,255,0.08–0.14)` | «Настройки» |
| Battery Low Power | `#FFD60A` | fill 51% |
| FAB ring | `rgba(255,255,255,0.08–0.12)` | тонкая обводка |

## 5. Типографика
Семейство: **SF Pro Text / SF Pro Display** (системный iOS).

| Элемент | Size | Weight | Color | Notes |
|---|---|---|---|---|
| Status time | 15–16 pt | Semibold | `#FFFFFF` | `15:52` |
| TELEGRAM pill | 11–12 pt | Bold | `#FFFFFF` | ALL CAPS |
| «Изм.» | 15–17 pt | Regular/Medium | `#FFFFFF` | в сером pill |
| Имя «Никита» | **24–28 pt** | Semibold/Bold (600–700) | `#FFFFFF` | center, Display |
| Meta phone / @user | **14–15 pt** | Regular | `#8E8E93` | center row |
| «Изменить фотографию» | **17 pt** | Regular | accent blue | |
| Alert title | **16–17 pt** | Semibold | `#FFFFFF` | «+7 916 061 4809 всё ещё Ваш номер?» |
| Alert body | **14–15 pt** | Regular | `#8E8E93` | line-height ≈ 1.25–1.35 |
| «Подробнее» | 14–15 pt | Regular | accent blue | inline link |
| Action rows | **17 pt** | Regular | accent blue | center text |
| List labels | **17 pt** | Regular | `#FFFFFF` | tracking ≈ −0.4 pt |
| Tab labels | **10–11 pt** | Medium | inactive gray / active blue | |
| Badge digits | **11–12 pt** | Semibold/Bold | `#FFFFFF` | `38`, `!` |

## 6. Иконки/контролы

### StatusBar
- Location arrow (filled, белый) справа от времени.
- Центр: paper-plane glyph + `TELEGRAM` в синем stadium-pill (высота ≈ 20–24 pt, radius ≈ 12 pt).
- Signal: 4 bars (≈ 2–3 filled), текст `LTE`, battery outline + yellow fill **51** + tip.

### Nav chrome
- **Left:** сетка 2×2 скруглённых квадрата (Stories / widgets), stroke `#FFFFFF`, на круглой подложке 32 pt.
- **Right:** текстовый pill `Изм.` (Edit profile).

### Profile identity
- **Avatar:** круглая фото-маска 100 pt, без обводки; на кадре — портрет (светлый фон кадра ≈ `#9DBEC3` / серо-зелёный).
- **Shield:** синий щит с белой цифрой **`1`** (Telegram account rank / premium-like mark) слева от телефона.
- Meta: `[shield] +7 916 061-48-09 • @…` (username secondary gray).

### «Изменить фотографию»
- Outline camera + `+` в углу корпуса, stroke accent blue, ~1.5–2 pt.
- Текст той же синей заливки, одна строка, left-aligned в pill-группе.

### Alert подтверждения номера
- Красный круг `!` (белый глиф).
- Title с номером.
- Body: «Чтобы Вы всегда могли зайти в Telegram…» + ссылка **Подробнее**.
- Action 1: **Оставить +7 916 061-48-09** (или полный формат номера).
- Action 2: **Изменить номер**.

### List icons (цветные плитки 29–30 pt)
| Пункт | Иконка | Tile |
|---|---|---|
| Мой профиль | person silhouette | coral/orange `#FF6B5C` |
| Избранное | bookmark fill | blue `#3390EC` |
| Недавние звонки | phone | green `#34C759` |

- Справа у каждого row: `chevron.right`.

### TabBar (4 колонки + FAB)
1. **Контакты** — person.crop.circle outline.
2. **Звонки** — phone outline.
3. **Чаты** — bubbles; red badge **`38`** (top-right иконки).
4. **Настройки** — gear; **active** (blue tint + oval highlight); red badge **`!`**.
5. **Search FAB** — `magnifyingglass`, белый stroke на стеклянном круге.

## 7. Тени / бордеры / разделители
- **Ячейки/карточки:** без drop-shadow; отделение только fill `#1C1C1E` на `#000`.
- **Dividers:** `0.5 pt` solid `#38383A`; в list — inset-left ≈ **60 pt**; в alert actions — почти full-bleed (inset L ≈ 16 pt или 0).
- **Nav buttons:** без бордера; возможен лёгкий ring `rgba(255,255,255,0.06)`.
- **TabBar / FAB:** `backdrop-filter: blur(20–40px)`; outer shadow `0 8px 24px rgba(0,0,0,0.40–0.50)`; тонкий light edge `rgba(255,255,255,0.10–0.15)`.
- **Active tab highlight:** внутренний stadium `rgba(255,255,255,0.08–0.14)`, radius ≈ 16–20 pt.
- **Avatar:** без ring/shadow.
- **Alert warning icon:** плоский круг, без glow.

## 8. Состояния на кадре
- **Tab selected:** «Настройки» (синий + highlight + badge `!`).
- **Tab badges:** Чаты = unread **38**; Настройки = attention **!**.
- **Phone verification alert:** раскрыт/виден (не dismiss-нут) — блокирует визуальный «чистый» профиль.
- **Battery:** Low Power Mode (жёлтый), 51%.
- **Status activity:** Telegram foreground/background indicator (синий pill).
- **Scroll:** контент уходит под floating TabBar; нижние rows частично видны через blur.
- **Press states:** нет (все контролы default/rest).
- **Тема:** dark pure-black, без wallpaper.

### Текстовый inventory (видимое)
| Зона | Текст |
|---|---|
| Status | `15:52`, `TELEGRAM`, `LTE`, `51` |
| Nav | `Изм.` |
| Identity | `Никита`, `+7 916 061 4809`, username `@…` |
| Action | `Изменить фотографию` |
| Alert | `+7 916 061 4809 всё ещё Ваш номер?` + body + `Подробнее` |
| Alert actions | `Оставить +7 …` / `Изменить номер` |
| List | `Мой профиль`, `Избранное`, `Недавние звонки`, (частично) далее |
| Tabs | `Контакты`, `Звонки`, `Чаты`, `Настройки` |

## 9. CSS-скелет
```css
.tg-screen {
  width: 414px;
  height: 896px;
  background: #000000;
  color: #ffffff;
  font-family: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
  position: relative;
  overflow: hidden;
}

.tg-status-bar {
  height: 44px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 0 16px 4px;
  font-size: 15px;
  font-weight: 600;
  z-index: 50;
}

.tg-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px;
  border-radius: 11px;
  background: #0a84ff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2px;
  text-transform: uppercase;
}

.tg-battery--lpm {
  /* yellow fill @ 51% */
  --fill: #ffd60a;
}

.tg-nav-chrome {
  position: absolute;
  top: 54px;
  left: 16px;
  right: 16px;
  height: 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 40;
}

.tg-nav-btn {
  height: 32px;
  min-width: 32px;
  padding: 0 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
}

.tg-nav-btn--icon {
  width: 32px;
  padding: 0;
}

.tg-profile-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 63px 16px 20px;
}

.tg-avatar-big {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  overflow: hidden;
  margin-bottom: 18px;
}

.tg-name {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.15;
  color: #fff;
  margin-bottom: 4px;
}

.tg-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #8e8e93;
  font-size: 15px;
}

.tg-shield {
  width: 16px;
  height: 18px;
  background: #3390ec;
  /* mask: shield shape */
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: grid;
  place-items: center;
}

.tg-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #8e8e93;
}

.tg-list-group {
  background: #1c1c1e;
  border-radius: 12px;
  margin: 0 16px 24px;
  overflow: hidden;
}

.tg-list-group--pill {
  border-radius: 26px; /* «Изменить фотографию» */
  margin-bottom: 24px;
}

.tg-list-item {
  display: flex;
  align-items: center;
  min-height: 46px;
  padding: 0 16px;
  gap: 12px;
  position: relative;
}

.tg-list-item + .tg-list-item::before {
  content: "";
  position: absolute;
  left: 60px;
  right: 0;
  top: 0;
  height: 0.5px;
  background: #38383a;
}

.tg-list-item__icon {
  width: 29px;
  height: 29px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: #fff;
  flex: 0 0 auto;
}

.tg-list-item__icon--profile { background: #ff6b5c; border-radius: 50%; }
.tg-list-item__icon--fav { background: #3390ec; }
.tg-list-item__icon--calls { background: #34c759; }

.tg-list-item__label {
  flex: 1;
  font-size: 17px;
  color: #fff;
}

.tg-list-item__chevron {
  color: #545458;
  font-size: 14px;
}

.tg-blue-link {
  color: #0a84ff;
  font-size: 17px;
}

.tg-edit-photo {
  composes: tg-list-item;
  color: #0a84ff;
}

.tg-alert-card {
  background: #1c1c1e;
  border-radius: 14px;
  margin: 0 16px 24px;
  overflow: hidden;
}

.tg-alert-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px 16px 8px;
}

.tg-alert-bang {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #ff3b30;
  color: #fff;
  font-weight: 700;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.tg-alert-title {
  font-size: 17px;
  font-weight: 600;
  color: #fff;
  line-height: 22px;
}

.tg-alert-body {
  padding: 0 16px 16px 48px;
  font-size: 15px;
  line-height: 1.3;
  color: #8e8e93;
}

.tg-alert-body a {
  color: #0a84ff;
  text-decoration: none;
}

.tg-alert-action {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #0a84ff;
  font-size: 17px;
  border-top: 0.5px solid #38383a;
}

.tg-floating-dock {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 60;
}

.tg-tab-bar {
  flex: 1;
  height: 64px;
  border-radius: 32px;
  background: rgba(28, 28, 30, 0.85);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 4px 8px;
}

.tg-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 64px;
  height: 56px;
  color: #8e8e93;
  font-size: 10px;
  font-weight: 500;
  border-radius: 18px;
}

.tg-tab--active {
  color: #0a84ff;
  background: rgba(255, 255, 255, 0.10);
}

.tg-tab__icon {
  width: 26px;
  height: 26px;
}

.tg-badge {
  position: absolute;
  top: 2px;
  right: 10px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #ff3b30;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: grid;
  place-items: center;
  line-height: 1;
}

.tg-search-fab {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(28, 28, 30, 0.85);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  display: grid;
  place-items: center;
  color: #fff;
  flex: 0 0 auto;
}

.tg-home-indicator {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 134px;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.35);
  z-index: 70;
}
```

## 10. Неуверенности
- **Точный username** в meta-строке: на JPEG слабо читается (`@elite…` / возможны иные символы); цифры телефона в алерте читаются стабильнее как **`+7 916 061 4809`**.
- **Accent blue:** JPEG/Display-P3 сдвигает системный `#0A84FF` / `#007AFF` к более светлым сэмплам (`#408AEF`…`#5A74B1`); для воссоздания брать iOS dark system blue, не raw sample.
- **Warning / badge red:** аналогично — канон `#FF3B30`, сэмпл кадра теплее (`#EE5E50`).
- **Точный blur radius** TabBar/FAB (20–40 px) и alpha стекла зависят от iOS version / wallpaper под blur.
- **Полный список меню** ниже «Недавние звонки» обрезан TabBar — на кадре видны только верхние пиксели следующих rows.
- **Форма shield «1»:** не круг и не звезда Premium; кастомный глиф Telegram — для пиксель-паритета нужен SVG/asset, не CSS `border-radius`.
- **Высота Search FAB vs TabBar:** визуально почти равны (~56–64 pt); точный gap к капсуле ≈ 8–12 pt.
