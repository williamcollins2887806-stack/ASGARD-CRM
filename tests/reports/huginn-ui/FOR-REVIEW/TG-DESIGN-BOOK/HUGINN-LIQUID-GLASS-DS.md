# Huginn Liquid Glass — Design System (канон для кодеров)

**Статус:** Phase 2 overlay — бриф Telegram iOS 2026 + **58** vision-shots (Batch 1 S01–S38 + Batch 2 S39–S58) + CRM tokens + UX/tap-maps Batch 2.  
**Код Huginn не менять**, пока нет команды «кодить Wave F0».  
**Viewport эталона shots:** 414×896 pt @2x (`pt = px_828/2`). Huginn dock — CSS px в том же логическом масштабе.

**Источники (слои, сверху вниз по приоритету решений):**

1. Этот документ + [`HUGINN-LIQUID-GLASS-TOKENS.json`](HUGINN-LIQUID-GLASS-TOKENS.json)
2. Бриф пользователя «Telegram для iOS (2026): функциональность и дизайн» (оставленные фичи)
3. Phase-1 book: [`TG-DESIGN-SYSTEM.md`](TG-DESIGN-SYSTEM.md), [`shots/`](shots/), [`REFS/`](REFS/)
4. Batch 2 UX: [`BATCH-2-UX/`](BATCH-2-UX/) (merged descriptions + tap maps + [`FACT-CHECK.md`](BATCH-2-UX/FACT-CHECK.md))
5. [`../TG-ATLAS.json`](../TG-ATLAS.json) — baseline размеров, не палитра TG
6. Текущий [`public/assets/css/huginn_dock.css`](../../../../public/assets/css/huginn_dock.css) — craft tradeoffs (помечать TARGET)

---

## 0. Закон единого стиля

1. **Один материал стекла** — `.hg-glass` + роли (`composer|nav|header|menu|pin|card|fab|segment|media-chrome|edit-action`). Запрещены разовые `background`/`backdrop-filter` вне ролей.
2. **Только CRM-цвета** — `--bg2`, `--bg3`, `--t1`, `--t2`, `--t3`, `--blue-l`, `--brd-m`, `--gold` (только rail). Светлее/темнее/прозрачнее — через `color-mix`, не hex TG.
3. **Геометрия из shots**, палитра из CRM. Purple `#7358FF` с рефов — **запрещён** в Huginn.
4. **Screen bg = `--bg2`**, не OLED `#000` (мессенджер сливается с CRM canvas).
5. **Нет stub-фич без API.** Нет API → backend task, фронт стоп.
6. **Один wave → тройная верификация → правки.** Верификаторы код не трогают.

---

## 1. Матрица бриф ↔ shots ↔ Huginn decision

| # | Бриф | Shots | Decision Huginn |
|---|------|-------|-----------------|
| 1 | Liquid Glass сквозной: полупрозрачность + blur | S04/S05/S28/S36 floating layers | `.hg-glass` + роли |
| 2 | Tab bar парит, blur при скролле | S36 island ~299×64, FAB Ø64 | TARGET nav/fab **64**; CURRENT CSS 56 = tradeoff до F1 |
| 3 | Бокового меню нет | tabs в S01/S02/S14/S29 | Без drawer; CRM rail + bottom nav |
| 4 | Папки — capsule active | почти нет в shots | Токен `--hg-folder-capsule-*`; UI после BE |
| 5 | Строка чата: аватар, имя, превью, badge, время | S01/S37 | Как shots; **превью 1 строка** (не 2) |
| 6 | Composer капсула + rim + glass | **S28** 40/40/r20 α≈0.65 | Три независимых объекта |
| 7 | Пузыри: единый радиус с хвостом | shots: body 15–18, tail 6–7 | **r17 + tail 7** (unified family, asymmetric tail) |
| 8 | Media viewer glass + dim | S18/S30 частично | F8: glass controls + dim/blur |
| 9 | Context menus glass + scale | S16/S19 | F6 |
| 10 | Профиль: 4 round actions + soft cards | S03/S17/S23 | F7: 3–4 circles + `--bg3` cards r26 |
| 11 | Анимации морфинг / scale; Power Saving | бриф §1/§8 | F0 prefs + F9 motion |
| 12 | AI Editor после 3 строк | нет TG-shot; BE V366 ready | **TARGET** [`PIXEL-SPEC-F11-AI-EDITOR.md`](PIXEL-SPEC-F11-AI-EDITOR.md) → front F11 |
| 13 | iPad ⌘+Enter | бриф §9 | F12 polish |
| 14 | Цвета «свои» | shots purple/OLED | **CRM only** |
| 15 | List Edit Mode + 3 action pills | **S46** | `.hg-glass` role `edit-action`; не tabbar |
| 16 | Member long-press menu | **S52** | menu role + preview card; Member Tags DEFER if no API |
| 17 | Connecting subtitle | S46 S56–S58 | `header.connecting` state |
| 18 | Checklist bubble | **S56** | bubble layout; Premium TG ≠ Huginn stub — DEFER_BE if no todo API |
| 19 | Publications / Archive segment | S39 S40 | segment role + stories grid |
| 20 | Reply strip in composer + keyboard | **S58** | composer.reply; keyboard insets (не продукт-клавиатура) |
| 21 | Sound / mute submenu | **S50** | F6 menu variant |

**Вне скоупа (удалено брифом):** sticker panel redesign, keyboard product, Gift Crafting, AI Summaries, Live Photos, Document Scanner, Colored Bot Buttons, Mighty Polls, radial reactions, refraction scroll.

---

## 2. Foundations — CRM map

| Роль | CRM token / формула | Не использовать |
|------|---------------------|-----------------|
| Screen / thread / panel | `var(--bg2)` | `#000`, TG OLED |
| Elevated / card / glass base | `var(--bg3)` | `#1C1C1E` literal |
| Text primary | `var(--t1)` | |
| Text secondary / meta | `var(--t2)` / `var(--t3)` | `#8E8E93` literal если нет в теме |
| Placeholder | `color-mix(in srgb, var(--t1) 60%, transparent)` | |
| Accent (links, send, active glyph, bubble me mix) | `var(--blue-l)` | purple shot, ATLAS `#2B5278` hardcode |
| Rail chrome ONLY | `var(--gold)` | gold в bubbles/nav active |
| Separator | `var(--brd-m)` | |
| Badge unread | `--hg-tg-badge` (danger family; проверить light) | JPEG-смягчённый sample |
| Back unread badge | bg `var(--t1)` / fg контраст к `--bg1`/`#000` | |
| Selection disc (active tab) | `color-mix(in srgb, var(--bg3) 92%, var(--t1))` ≈ charcoal | blue bloom `rgba(10,132,255,…)` |
| Bubble them | `color-mix(in srgb, var(--bg3) 92%, transparent)` | |
| Bubble me | `color-mix(in srgb, var(--blue-l) 72%, var(--bg3))` | purple |

Light theme: те же роли; проценты glass могут быть выше fill (как ветка light в `huginn_dock.css`).

### Типографика

| Класс | Size | Weight | Color |
|-------|------|--------|-------|
| Chat/list title | 17px | 600 | `--t1` |
| Bubble body | 17px | 400 | `--t1` |
| Meta / time | 13–14px | 400 | `--t2` или `color-mix(t1 55%, transparent)` в пузыре |
| Tab label | 10–11px | 500 | active `--blue-l`; inactive `--t1` |
| Badge | 11–12px | 700 | `#fff` on badge |
| Placeholder | 17px | 400 | t1 @ 60% |
| Settings row | 17px | 400 | `--t1` |

Шрифт: UI stack CRM / system, не SF Pro метрики ради копирования.

---

## 3. Единый материал Liquid Glass

### 3.1 Примитив

```css
.hg-glass {
  background: color-mix(
    in srgb,
    var(--bg3) var(--hg-glass-fill-pct),
    transparent
  );
  -webkit-backdrop-filter: blur(var(--hg-glass-blur)) saturate(var(--hg-glass-sat));
          backdrop-filter: blur(var(--hg-glass-blur)) saturate(var(--hg-glass-sat));
  box-shadow: inset 0 0 0 1px color-mix(
    in srgb,
    var(--t1) var(--hg-glass-rim-pct),
    transparent
  );
  border-radius: var(--hg-glass-radius);
}
```

Роль задаётся data-атрибутом или модификатором:

```css
.hg-glass[data-role="composer"] { /* vars ниже */ }
.hg-glass[data-role="nav"] { }
/* … */
```

### 3.2 Роли стекла

| Role | `--hg-glass-fill-pct` | `--hg-glass-blur` | `--hg-glass-rim-pct` | `--hg-glass-radius` | `--hg-glass-sat` | Эталон |
|------|----------------------|-------------------|----------------------|---------------------|------------------|--------|
| `composer` | 65% | 20px | 11% | 20px (capsule) / 50% (circle tool) | 180% | S28 |
| `nav` | 82% | 40px | 12% (top rim может быть сильнее) | 32px | 180% | S36 |
| `fab` | 82% | 40px | 12% | 50% | 180% | S36 |
| `header` | 48% | 32px | 10% | 22px | 160% | S04/S24 |
| `pin` | 72% | 20px | 8% | 20px | 160% | S24 |
| `menu` | 80% | 32px | 10% | 18px | 180% | S16/S19 |
| `card` | 100% (solid `--bg3`) | 0 | 0; separator `--brd-m` | 26px | — | S20/S32 |
| `segment` | 55% | 16px | 10% | 20px | 160% | S17–S23, **S39–S40** |
| `media-chrome` | 70% | 28px | 10% | 50% / 16px | 180% | F8 |
| `edit-action` | 75% | 24px | 10% | 22px (pill) | 160% | **S46** — три отдельные pills, не nav |

Опциональный specular (блик): `inset 0 0.5px 0 color-mix(t1 22%, transparent)` — только composer/nav.

### 3.3 Power Saving

| Level | Класс на `#huginnDock` | Blur | Sat | Fill pct | Motion |
|-------|------------------------|------|-----|----------|--------|
| `full` | (default) | 100% | 100% | 100% | full |
| `reduced` | `hg-power-reduced` | 50% | 120% (меньше «сока») | +8% denser | shorten 0.6× |
| `off` | `hg-power-off` | 0; solid mix | 100% | → solid `--bg3` | `transition: none` + respect `prefers-reduced-motion` |

Хранение Phase F0: `localStorage.hg_power_saving = full|reduced|off`.  
UI: пункт в настройках Huginn / CRM «Экономия эффектов» (не обязательно полный TG Settings).  
Позже: user prefs API.

---

## 4. Геометрия-канон

| Token | TARGET | CURRENT (css) | Notes |
|-------|--------|---------------|-------|
| `--hg-tg-tool-size` | 40px | 36px | F2 → 40 |
| `--hg-tg-input-h` | 40px | 36px | F2 |
| `--hg-tg-input-radius` | 20px | 18px | F2 |
| `--hg-tg-composer-gap` | 6px | 6px | OK |
| `--hg-tg-nav-h` | **64px** | 56px | F1 TARGET |
| `--hg-tg-nav-radius` | 32px | 28px | F1 |
| `--hg-tg-fab-size` | **64px** | 56px | F1 |
| `--hg-tg-fab-gap` | 8px | 8px | OK |
| `--hg-tg-header-h` | 44px | 36px | F3 floating capsules |
| `--hg-tg-header-radius` | 22px | 17px | F3 |
| `--hg-tg-pin-h` | 40px | 40px | OK; alt 50 when content |
| `--hg-tg-pin-radius` | 20px | 16px | F3 |
| `--hg-tg-bubble-radius` | 17px | 18px | F5 |
| `--hg-tg-bubble-tail-radius` | 7px | (нет) | F5 добавить |
| `--hg-tg-row-h` | 72px (68–76) | 68px | F4 |
| `--hg-tg-contact-row-h` | 53px | 64px | F4 align shots |
| `--hg-tg-av-msg` | 32px | 32px | OK |
| `--hg-side-inset` | 16px | — | cards/media |
| `--hg-folder-capsule-h` | 32px | — | F10 after BE |
| `--hg-folder-capsule-radius` | 16px | — | F10 |

Active tab: disc under icon from `--bg3` mix — **not** blue bloom (R100 already in spirit).

---

## 5. Components (единый стиль)

### 5.1 Composer (S28, S27, S04)

- Три **отдельных** `.hg-glass` объекта: attach (circle), input (capsule), mic/send (circle).
- **Нет** сплошного composer bar-подложки на всю ширину.
- Placeholder «Сообщение» / CRM copy.
- Empty → mic; non-empty → send (accent `--blue-l` solid or glass+glyph).
- Sticker icon внутри input — secondary opacity; **не** открывать полную sticker panel redesign (вне скоупа); существующий picker OK.

### 5.2 Bottom nav + FAB (S36)

- Stadium island + отдельный FAB search.
- Tabs: Contacts / Calls / Chats / Settings (или текущий набор Huginn — не добавлять drawer).
- Active: charcoal disc + `--blue-l` icon/label.
- Badge: `--hg-tg-badge`.
- При скролле списка island остаётся; контент блюрится под стеклом.

### 5.3 Header (S04, S05, S24, **S56–S58**)

- Floating capsules: back(+badge), title, avatar — не continuous bar.
- Pin / live-location / reply: glass `pin` role, width ~ content max with 16 inset.
- **Connecting:** subtitle `соединение…` + spinner в title-pill (`header.connecting`) — S46/S56–S58.

### 5.4 Chat list (S01, S37, **S46**)

Structure top→bottom in row: avatar → name → preview (1 line) → time; unread badge.
Thin separators via `--brd-m`.
Pinned block: `card` role.
**Edit Mode (S46):** left checkboxes; pinned reorder handles; nav «Готово»; bottom **три** `.hg-glass[data-role=edit-action]` pills (`Прочитать все` / `В архив` / `Удалить`) — **запрещено** сливать с tabbar/FAB.

### 5.5 Bubbles (S05, S07, S11, **S56**)

- Radius 17; **tail corner 7** (asymmetric, same family).
- me / them CRM mixes (**не** purple с рефа).
- Meta in-bubble ~55% white/`t1`.
- Voice: play disc; waveform played = t1, rest = t1@45%.
- **Checklist (S56):** structured todo rows внутри bubble-me; без stub API — если нет todo endpoint → DEFER_BE.

### 5.6 Context menus (S16, S19, **S49–S52**)

- `.hg-glass[data-role=menu]`.
- Appear: scale from touch point (F9); underlay blur; full scrim optional — shots often dim sibling controls instead of heavy overlay.
- **S50** sound submenu; **S52** member preview card + Написать / тег / Исключить.

### 5.7 Profile (S03, S17, **S39–S40, S45, S47, S53**)

- 3–4 round glass action buttons.
- Soft cards `--bg3` r26; rows 52.
- **Publications | Archive** segment (S39–S40); group edit form (S53).

### 5.8 Media viewer (F8)

- Dimmed+blurred backdrop.
- Glass close/zoom/share controls.
- Open/close: scale from thumbnail (F9).

### 5.9 Segmented / folders

- Segment (profile media tabs): 382×40 pattern scaled to panel width; Batch2 publications segment same role.
- Folder capsule: token only until BE.

### 5.10 AI Editor (F11)

**BE:** ready (`V366`, `BE-READY.md`) — **no Premium**; `POST /ai/rewrite` + styles.  
**Pixel-spec:** [`AI-EDITOR-PIXEL-SPEC.md`](AI-EDITOR-PIXEL-SPEC.md) (Desktop A01–A07) + [`PIXEL-SPEC-F11-AI-EDITOR.md`](PIXEL-SPEC-F11-AI-EDITOR.md) (dock fixture)  
**Gap:** [`AI-EDITOR-GAP.md`](AI-EDITOR-GAP.md)  
**Desktop refs:** [`REFS-DESKTOP/Новая папка (2)/`](REFS-DESKTOP/Новая%20папка%20(2)/) (`INDEX.json`) + `FOR-REVIEW/F11-AI-EDITOR/`

| Rule | TARGET |
|------|--------|
| Trigger | Ai glyph **28×28** inside input capsule after **>3 lines**; hide otherwise |
| Sheet | `.hg-glass[data-role="card"]` — r**28–32**, tabs Перевод/Стилизация/Исправление, primary pill h48 |
| Actions | `translate` / `style` (+ presets) / `grammar` → `/ai/rewrite` |
| Colors | CRM only; no Premium star / purple |
| Stub | forbidden — real API or disable+error |

Do not ship fake rewrite. Live 1в1 vs Desktop — PREDEPLOY-VISUAL.

### 5.11 Composer reply + keyboard (S58)

- Reply strip **внутри** input glass (не отдельный continuous bar).
- Keyboard open: поднимает composer; **не** редизайнить iOS keyboard (вне скоупа).
- Scroll-down FAB над composer — circle glass.

### 5.12 Batch 2 UX layer

Поведение / tap maps / фактчек: [`BATCH-2-UX/README.md`](BATCH-2-UX/README.md). Пиксели — `shots/S39*…S58*`.

---

## 6. Motion

| Motion | Behavior | Power Saving |
|--------|----------|--------------|
| Send morph | text → bubble ease | off → instant |
| Menu open | scale from touch + fade | off → opacity only |
| Media open | thumbnail scale | reduced → shorter |
| Tab / route | soft crossfade | reduced |
| Scroll under glass | blur stays; content moves | off → solid chrome |

Всегда уважать `prefers-reduced-motion: reduce` как минимум `reduced`.

---

## 7. Backend gaps

| Feature | API now | Gate |
|---------|---------|------|
| Chat/messages/upload/SSE | yes ([HUGINN-API-CONTRACT](../../../HUGINN-API-CONTRACT.md)) | front OK |
| Context menu / reactions UI | front | OK |
| Media viewer chrome | media exists | F8 OK |
| Power saving | no | F0 localStorage |
| Chat folders | no | **BE → F10** |
| AI Editor | **yes** (`/ai/rewrite`, styles) | **front F11** + pixel-spec |
| iPad ⌘+Enter | n/a | F12 front |

---

## 8. Waves (порядок)

| Wave | Scope | Refs | BE? |
|------|-------|------|-----|
| F0 | `--hg-glass-*`, roles, power-saving classes; kill one-off fills | DS | no |
| F1 | Nav 64 + FAB 64 + charcoal disc + scroll blur | S36 S01 S12 | no |
| F2 | Composer 3 glass + rim + mic/send + **reply strip** | S28 S27 S04 **S58** | no |
| F3 | Header capsules + pin + **connecting** | S04 S05 S24 **S56–S58** | no |
| F4 | List row / separators / badges / 1-line preview + **Edit Mode pills** | S01 S37 **S46** | no |
| F5 | Bubbles r17/tail7 + CRM colors + voice + **checklist layout** | S05 S07 S11 **S56** | checklist API? DEFER |
| F6 | Context menus glass + scale + **member/sound** | S16 S19 **S50 S52** | member tags? DEFER |
| F7 | Profile round actions + cards + **publications/archive** | S03 S17 **S39 S40 S53** | no |
| F8 | Media viewer chrome | S18 S30 | no |
| F9 | Motion + power-saving wiring | brief §8 | no |
| F10 | Folder capsules | token | **BE first** |
| F11 | AI Editor | PIXEL-SPEC-F11 + F11-AI-EDITOR | BE ready → front |
| F12 | iPad ⌘+Enter + wide polish | brief §9 | no |

После каждого F0–F9: [`VERIFY-PROTOCOL.md`](VERIFY-PROTOCOL.md).

---

## 9. Анти-паттерны (FAIL сразу)

1. Отдельный blur/background на контрол без `data-role` / `.hg-glass`
2. Hex TG purple / OLED `#000` screen
3. Blue bloom под активным табом
4. Continuous header или composer bar вместо floating objects
5. Считать CURRENT nav 56 «финалом» без TARGET 64 в комментарии/токене
6. Stub AI Editor / folders без API
7. Верификатор правит CSS
8. Hardcode `--hg-tg-bubble-me: #2B5278` или purple
9. Gold вне rail chrome
10. 2-line list preview ломающий row height

---

## 10. Acceptance (глобально)

- Визуально: один glass language на всех chrome.
- Цвета: неотличимы по семье от CRM dark/light.
- Геометрия: composer/nav/header/bubbles в пределах ±2px от TARGET после F1–F5.
- Power saving: `off` убирает blur, UI остаётся читаемым.
- Нет новых фич вне оставленного брифа.

---

## 11. Depth & Juice (СОЧНОСТЬ)

**Задача заказчика:** «дотянуть Хугинн до Telegram» — сейчас верстка плоская, нет теней/градиентов/глубины.
**Ограничение канона:** §0 п.2, §2 и §9 **прямо запрещают** литеральные TG-hex (`#17212B`, `#232E3C`, `#2AABEE`) и purple/OLED.
**Решение:** CRM-токены **остаются** как единственная палитра; «сочность» добавляется отдельным слоем поверх них —
тени, градиенты, толщина стекла, микро-интерактив. Все цветовые эффекты строятся **только** через `color-mix`,
нейтральный тёмный шум — только `rgba(0,0,0,…)`. Литеральные hex из ТЗ разрешены **исключительно** как справка в §11.8
(пометка `not_for_use`) и в CSS не попадают.

**Статус:** `docs_only_until_wave_F0_command` — слой описывает целевые токены; код Huginn не трогать до команды «кодить Wave F0».

### 11.1 Elevation-уровни (e0…e4, роль `--hg-elev-*`)

Пять уровней глубины. Для **поверхностей** — нейтральная тёмная тень `rgba(0,0,0,…)` (не чёрный TG, не цветная),
для **CTA и активных элементов** — цветная акцентная тень от `--blue-l` (только она даёт «сок», остальное — нейтраль).

| Уровень | Что тенится | Тень (TARGET) | Роль токена | Wave |
|---------|-------------|---------------|-------------|------|
| `e0` | canvas / screen, строки списка, текст | тени нет (`box-shadow: none`) | `--hg-elev-0: none` | F0 |
| `e1` | карточки, `card`-glass, инпуты в покое | `0 1px 2px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.12)` | `--hg-elev-1` | F0 |
| `e2` | плавающий chrome: `header`, `nav`, `pin`, `segment`, `fab` | `0 4px 14px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0, 0, 0, 0.16)` | `--hg-elev-2` | F1/F3 |
| `e3` | оверлеи: `menu`, sheet, `media-chrome`, `edit-action` | `0 12px 32px rgba(0, 0, 0, 0.34), 0 2px 8px rgba(0, 0, 0, 0.20)` | `--hg-elev-3` | F6 |
| `e4` | верхний слой / акцент dragover, поднятая карточка | `0 20px 48px rgba(0, 0, 0, 0.42)` | `--hg-elev-4` | F0 |
| `e-accent` | **CTA / активный элемент / фокус** | `0 4px 14px color-mix(in srgb, var(--blue-l) 40%, transparent)` | `--hg-elev-accent` | F0 |

Правила:

- Тень **всегда с размытием** (blur > 0). `box-shadow` без blur — анти-паттерн (§11.9).
- На `:active` тень `e-accent` уменьшается (offset 2px, blur 8px, alpha 32%) вместо смены цвета — «вдавливание».
- На `prefers-reduced-motion` / power-saving `off` — тени остаются (это статика глубины, не motion), меняется только переход.
- Один элемент = один уровень. Не суммировать `e2 + e3` вручную; комбинировать только `eN + accent` (CTA).

**Статус определения токенов (сверено с кодом `huginn_dock.css`):**

| Токены | Статус в коде |
|--------|---------------|
| `--hg-elev-0`, `--hg-elev-accent`, `--hg-elev-accent-active` | **определены** (`:root`) |
| `--hg-dur-press`, `--hg-dur-base` | **определены** |
| `--hg-ease-standard`, `--hg-ease-emphasized`, `--hg-ease-exit` | **определены** |
| `--hg-glass-specular-pct`, `--hg-ripple-x`, `--hg-ripple-y`, `--hg-segment-offset` | **определены** и задействованы |
| `--hg-folder-capsule-h`, `--hg-folder-capsule-radius` | `PENDING` — ждут BE (F10), в UI пока нет |
| `--hg-header-connecting` | `PENDING` — состояние connecting (F3, доработка) |
| `--hg-ai-btn-size`, `--hg-ai-row-h`, `--hg-ai-sheet-max-w`, `--hg-ai-sheet-radius` | `PENDING` — спека F11 (AI-редактор), введены в шелле, но не в `:root` |
| `--hg-edit-action-h`, `--hg-edit-action-radius` | `PENDING` — edit-mode pill, значения пока в правилах `.hg-list-edit-bar` |

Пометка `PENDING` означает: токен — **целевой контракт для будущей волны**, а не «уже реализовано».
Документ обязан совпадать с кодом: пока токен не определён в `:root`, он не пишется в блоке «implemented».

### 11.2 Градиенты поверхностей

Объём делается **не** новым цветом, а мягким переходом от чуть высветленного `--bg3`/`--bg2` к базовому. Направление — `180deg`.

```css
/* базовая поверхность: верх чуть светлее, низ = база */
background-image: linear-gradient(
  180deg,
  color-mix(in srgb, var(--t1) 6%, var(--bg3)) 0%,
  var(--bg3) 100%
);

/* панель/sheet: ещё мягче, от --bg2 к --bg3 */
background-image: linear-gradient(
  180deg,
  var(--bg2) 0%,
  color-mix(in srgb, var(--t1) 4%, var(--bg3)) 100%
);
```

Правила:

- Только `color-mix` из `--t1` / `--bg2` / `--bg3`. Никаких TG-hex (§11.8 — справочно, `not_for_use`).
- Градиент кладётся в `background-image` **поверх** уже существующего glass-`background` (не заменяет его): стекло задаёт прозрачность+blur, градиент — объём.
- Диапазон высветления — **4–8%** `--t1`. Больше 8% = «пластиковый» градиент, FAIL дизайн-ревью.
- В light-теме проценты те же, направление инвертируется (`--t1` работает как затемнитель на светлом фоне).
- На `card`-glass (solid `--bg3`) градиент — единственный объём, т.к. blur = 0.

### 11.3 Стекло — specular / rim / толщина

Роли и параметры `--hg-glass-*` из §3 **не меняются**. Слой сочности добавляет три слоя к примитиву `.hg-glass`:

```css
.hg-glass {
  box-shadow:
    /* 1. rim — существующая обводка-граница */ 
    inset 0 0 0 1px color-mix(in srgb, var(--t1) var(--hg-glass-rim-pct), transparent),
    /* 2. specular — верхний блик «отражения» */
    inset 0 1px 0 color-mix(in srgb, var(--t1) var(--hg-glass-specular-pct, 14%), transparent),
    /* 3. thickness — мягкая внутренняя тень даёт «толщину» стекла */
    inset 0 -2px 6px rgba(0, 0, 0, 0.18),
    /* 4. внешняя глубина по уровню eN */
    var(--hg-elev-2);
}
```

| Слой | Роль | Значение | Применение |
|------|------|----------|------------|
| specular | верхний блик | `--hg-glass-specular-pct` = 14 (composer/nav/menu), 10 (остальные) | все роли, кроме `card` |
| rim | граница | существующий `--hg-glass-rim-pct` | без изменений |
| thickness | внутренняя тень | `inset 0 -2px 6px rgba(0, 0, 0, 0.18)` | `composer`, `nav`, `fab`, `menu` |
| depth | внешняя тень | `--hg-elev-*` по §11.1 | по уровню компонента |

`card`-роль (solid `--bg3`, blur 0): specular и thickness **не** применять — вместо стекла работает градиент §11.2 + `--brd-m`-separator.

### 11.4 Ripple / микро-интерактив

Единый набор токенов движения для кнопок, полей и сегмент-контрола.

| Токен | Значение | Роль |
|-------|----------|------|
| `--hg-dur-press` | `90ms` | `:active` scale/тень (мгновенный отклик) |
| `--hg-dur-fast` | `120ms` | hover/фокус, ripple fade |
| `--hg-dur-base` | `180ms` | сегмент-бегунок, слайд, смена состояния |
| `--hg-dur-slow` | `260ms` | появление sheet/menu (общий motion §6) |
| `--hg-ease-standard` | `cubic-bezier(.2, .6, .2, 1)` | вход/смена состояния |
| `--hg-ease-emphasized` | `cubic-bezier(.2, .8, .2, 1)` | бегунок сегмента, морфинг |
| `--hg-ease-exit` | `cubic-bezier(.4, 0, 1, 1)` | уход, закрытие |

Рецепты:

```css
/* нажатие: лёгкое «вдавливание», не масштаб-зум */
.hg-pressable:active {
  transform: scale(0.98);
  box-shadow: var(--hg-elev-accent-active, 0 2px 8px color-mix(in srgb, var(--blue-l) 32%, transparent));
  transition: transform var(--hg-dur-press) var(--hg-ease-standard),
              box-shadow var(--hg-dur-press) var(--hg-ease-standard);
}

/* focus-ring: 2px --blue-l, offset 2 (клавиатура + тач-фокус) */
.hg-pressable:focus-visible {
  outline: 2px solid var(--blue-l);
  outline-offset: 2px;
}

/* ripple: волна от точки касания, только по --t1 с малой альфой */
.hg-ripple {
  background-image: radial-gradient(
    circle at var(--hg-ripple-x, 50%) var(--hg-ripple-y, 50%),
    color-mix(in srgb, var(--t1) 10%, transparent) 0%,
    transparent 70%
  );
  transition: opacity var(--hg-dur-fast) var(--hg-ease-exit);
}
```

`scale(0.98)` — **только** на нажатие (не больше 0.96, не меньше 0.99). Ripple отключается при power-saving `off` и `prefers-reduced-motion: reduce`.

### 11.5 8pt-сетка

Базовая единица — 4px. Разрешённые шаги кратны 4: **4 / 8 / 12 / 16 / 24 / 32**.

| Шаг | Назначение |
|-----|------------|
| `4px` | зазор иконка↔текст, `--hg-tg-composer-gap`, внутренние микрозазоры |
| `8px` | gap между капсулами chrome, `--hg-tg-fab-gap`, между полями формы |
| `12px` | вертикаль внутри карточек, между строками списка и разделителями |
| `16px` | **боковые поля экрана** (`--hg-side-inset`), паддинг карточек, горизонталь инпутов |
| `24px` | **между смысловыми блоками** страницы/секции |
| `32px` | отступ секции от chrome, вертикаль пустых состояний/drop-zone |

Правила:

- Боковые поля экрана — **всегда 16px** (совпадает с `--hg-side-inset`, §4).
- Между блоками — **24px**; 32 — только перед/после chrome (nav/header) и в пустых состояниях.
- Внутри инпутов — **14/16**: горизонталь 16 (совпадает с боковым инсетом, поле «читается» на всю ширину), вертикаль **14** — **исключение** из 4-сетки, обоснование: при шрифте 16px и `line-height ≈ 1.25` контент поля = 15–17px; паддинг 16 сверху и снизу даёт высоту ≥47px и ломает TARGET-высоту поля 40px (§4, `--hg-tg-input-h`). Вертикаль 14 → поле ровно 40px и оптическая центровка текста сохраняется. Это **единственное** разрешённое некратное-4 значение; любое другое (14 вне инпутов) — FAIL.
- Отступы не сочинять числом «на глаз»: только шаг из таблицы.

### 11.6 Типографика (шкала сочности)

Размеры согласованы с §2 и не отменяют его; ниже — фиксированные роли для слоя глубины.

| Роль | Size | Weight | Line-height | Color |
|------|------|--------|-------------|-------|
| Заголовок экрана / sheet | 17px | 600 | 1.3 | `--t1` |
| Имя в списке чатов | 17px | **600 (жирное)** | 1.3 | `--t1` (белое в тёмной теме) |
| Тело пузыря / сообщение | 16px | 400 | **≥ 1.35** | `--t1` |
| Превью в списке | 15px | 400 | 1.3 | `--t2` (серое, **меньше** имени) |
| Второстепенный текст / подписи | 13px | 400 | 1.35 | `--t3` / `--t2` |
| Время / meta в списке | 12px | 400 | 1.2 | `--t3` (приглушённое) |
| Meta внутри пузыря | 12px | 400 | 1.2 | `color-mix(in srgb, var(--t1) 55%, transparent)` |

Правила:

- Имя в списке — жирное и максимально контрастное; превью — приглушённое и **мельче** имени. Иерархия читается по весу/яркости/размеру, а не по цвету-акценту.
- Время — самое мелкое и приглушённое (не акцент).
- В пузырях line-height **не менее 1.35** (плотный текст «сплющивает» и выглядит плоско даже с тенями).
- Заголовок экрана — 17/600 по центру (см. sheet-header §11.7).

### 11.7 Компонентные рецепты (ТЗ §1.5 / §1.6 → CRM-токены + сочность)

Все рецепты — CRM-токены + `color-mix`; ни одного TG-hex.

**Поля ввода (input)**

```css
.hg-field {
  background: var(--bg3);
  border: 1px solid var(--brd-m);
  border-radius: 12px;
  padding: 14px 16px;              /* вертикаль 14 — исключение §11.5 */
  color: var(--t1);
  font-size: 16px;
  line-height: 1.25;
  transition: border-color var(--hg-dur-fast) var(--hg-ease-standard),
              box-shadow var(--hg-dur-fast) var(--hg-ease-standard);
}
.hg-field::placeholder {
  color: color-mix(in srgb, var(--t3) 60%, transparent);
}
.hg-field:focus {
  border-color: var(--blue-l);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue-l) 25%, transparent);
  outline: none;
}
```

**Сегмент-контрол (segment)**

```css
.hg-segment {
  position: relative;
  background: var(--bg3);
  border-radius: 12px;
  padding: 4px;                     /* inner 4px §11.5 */
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
}
.hg-segment__thumb {
  position: absolute;
  top: 4px; bottom: 4px; left: 4px;
  width: calc(50% - 8px);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg3) 60%, var(--t1));
  box-shadow: var(--hg-elev-1);
  transform: translateX(var(--hg-segment-offset, 0));
  transition: transform var(--hg-dur-base) var(--hg-ease-emphasized);
}
```

Бегунок слайдом: `transform: translateX(…)`, `duration` ≈ 180ms, `ease`. Активный элемент — светлый `color-mix(bg3 60%, t1)`, r8, мягкая тень `--hg-elev-1`. Активная **подпись** — `--t1`; неактивная — `--t3`.

**Главная CTA-кнопка (cta)**

```css
.hg-cta {
  height: 50px;
  border-radius: 12px;
  background-image: linear-gradient(
    180deg,
    color-mix(in srgb, var(--blue-l) 92%, #fff) 0%,
    var(--blue-l) 100%
  );
  box-shadow: var(--hg-elev-accent);
  color: #fff;                      /* единственный допустимый литерал — белый текст на акценте */
  font-size: 16px;
  font-weight: 600;
  transition: transform var(--hg-dur-press) var(--hg-ease-standard),
              box-shadow var(--hg-dur-press) var(--hg-ease-standard);
}
.hg-cta:active {
  transform: scale(0.98);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--blue-l) 32%, transparent);
}
```

**Drop Zone («История»)**

```css
.hg-dropzone {
  border: 2px dashed var(--brd-m);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg2) 88%, #000);   /* чуть темнее панели */
  padding: 32px 16px;
  text-align: center;
  icon: var(--blue-l);
  caption: 13px var(--t3);
  transition: border-color var(--hg-dur-fast) var(--hg-ease-standard),
              background var(--hg-dur-fast) var(--hg-ease-standard);
}
.hg-dropzone:hover,
.hg-dropzone.is-dragover {
  border-style: solid;
  border-color: var(--blue-l);
  background: color-mix(in srgb, var(--bg3) 80%, var(--blue-l) 6%);
}
.hg-cta[disabled] {
  opacity: 0.5;
  pointer-events: none;
}
```

Центральная иконка — `--blue-l`, подпись — 13px `--t3`. Disabled CTA — `opacity: .5`.

**Заголовок sheet'а (sheet-header)**

```css
.hg-sheet__header {
  display: flex;
  align-items: center;
  justify-content: center;          /* 17/600 по центру */
  height: 44px;
  font-size: 17px;
  font-weight: 600;
  color: var(--t1);
}
.hg-sheet__close {
  position: absolute;
  left: 16px;
  color: var(--t3);                 /* крестик слева — приглушённый */
}
```

### 11.8 Палитра из ТЗ — справочно, **не применять**

Ниже — литеральные hex из ТЗ заказчика. Приведены **только** как справка о намерении
(«серо-синие подложки + голубой акцент»); в CSS Huginn они **запрещены** (§0 п.2, §9 п.2).
Соответствие CRM-токенов — рабочий слой, hex — справочный. Пометка: `not_for_use`.

| Hex из ТЗ | Намерение ТЗ | Чем заменяется в CRM |
|-----------|--------------|----------------------|
| `#17212B` | фон/панель | `var(--bg2)` |
| `#232E3C` | поднятая поверхность/карточка | `var(--bg3)` |
| `#2AABEE` | акцент CTA/ссылок | `var(--blue-l)` |
| `#F5F5F5` (текст) | текст | `var(--t1)` |
| `#8E8E93` (meta) | второстепенный | `var(--t2)` / `var(--t3)` |
| `#2B5278` | исходящий пузырь | `color-mix(in srgb, var(--blue-l) 72%, var(--bg3))` |

**not_for_use:** прямые `#17212B`, `#232E3C`, `#2AABEE`, `#2B5278`, purple, OLED `#000` — FAIL (§9).

### 11.9 Анти-паттерны слоя «сочность» (FAIL сразу)

11. Плоский solid-фон без глубины и без градиента (§11.1 `e0` допустим только для canvas/строк, не для карточек/chrome).
12. Единый серый бордер (`--brd-m`) **везде**: граница есть только там, где нет глубины (rim стекла или разделитель) — иначе «таблица».
13. Тень **без размытия** (`0 2px 0 …`, `0 0 0 1px` как единственная тень) — читается как плоская рамка.
14. Любой **хардкод TG-hex** (`#17212B`, `#232E3C`, `#2AABEE`, `#2B5278`) в CSS/токенах — см. §11.8 `not_for_use`.
15. **Тень от purple** или любого не-CRM цвета; цветная тень допускается **только** от `--blue-l` (§11.1 `e-accent`).
16. Литерал `#000` в качестве цвета тени при наличии `rgba(0, 0, 0, …)` — использовать rgba.
17. Отступы/высоты вне 8pt-сетки (кроме вертикали инпутов 14, §11.5).
18. `scale` нажатия вне диапазона 0.96–0.99 или зум вместо «вдавливания».

Связанные файлы: [`AGENT-IMPLEMENT-PROMPT.md`](AGENT-IMPLEMENT-PROMPT.md), [`VERIFY-PROTOCOL.md`](VERIFY-PROTOCOL.md), [`BRIEF-SHOTS-MATRIX.md`](BRIEF-SHOTS-MATRIX.md).
