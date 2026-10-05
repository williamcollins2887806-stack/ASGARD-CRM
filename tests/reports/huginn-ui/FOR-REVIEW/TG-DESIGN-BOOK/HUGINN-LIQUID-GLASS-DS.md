# Huginn Liquid Glass — Design System (канон для кодеров)

**Статус:** Phase 2 overlay — бриф Telegram iOS 2026 + 38 vision-shots + CRM tokens.  
**Код Huginn не менять**, пока нет команды «кодить Wave F0».  
**Viewport эталона shots:** 414×896 pt @2x (`pt = px_828/2`). Huginn dock — CSS px в том же логическом масштабе.

**Источники (слои, сверху вниз по приоритету решений):**

1. Этот документ + [`HUGINN-LIQUID-GLASS-TOKENS.json`](HUGINN-LIQUID-GLASS-TOKENS.json)
2. Бриф пользователя «Telegram для iOS (2026): функциональность и дизайн» (оставленные фичи)
3. Phase-1 book: [`TG-DESIGN-SYSTEM.md`](TG-DESIGN-SYSTEM.md), [`shots/`](shots/), [`REFS/`](REFS/)
4. [`../TG-ATLAS.json`](../TG-ATLAS.json) — baseline размеров, не палитра TG
5. Текущий [`public/assets/css/huginn_dock.css`](../../../../public/assets/css/huginn_dock.css) — craft tradeoffs (помечать TARGET)

---

## 0. Закон единого стиля

1. **Один материал стекла** — `.hg-glass` + роли (`--hg-glass-role: composer|nav|header|menu|pin|card|fab`). Запрещены разовые `background`/`backdrop-filter` вне ролей.
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
| 12 | AI Editor после 3 строк | нет в API | **BE first** → F11 |
| 13 | iPad ⌘+Enter | бриф §9 | F12 polish |
| 14 | Цвета «свои» | shots purple/OLED | **CRM only** |

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
| `segment` | 55% | 16px | 10% | 20px | 160% | S17–S23 |
| `media-chrome` | 70% | 28px | 10% | 50% / 16px | 180% | F8 |

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

### 5.3 Header (S04, S05, S24)

- Floating capsules: back(+badge), title, avatar — не continuous bar.
- Pin / live-location / reply: glass `pin` role, width ~ content max with 16 inset.

### 5.4 Chat list (S01, S37)

Structure top→bottom in row: avatar → name → preview (1 line) → time; unread badge.
Thin separators via `--brd-m`.
Pinned block: `card` role.

### 5.5 Bubbles (S05, S07, S11)

- Radius 17; **tail corner 7** (asymmetric, same family).
- me / them CRM mixes.
- Meta in-bubble ~55% white/`t1`.
- Voice: play disc; waveform played = t1, rest = t1@45%.

### 5.6 Context menus (S16, S19)

- `.hg-glass[data-role=menu]`.
- Appear: scale from touch point (F9); underlay blur; full scrim optional — shots often dim sibling controls instead of heavy overlay.

### 5.7 Profile (S03, S17)

- 3–4 round glass action buttons.
- Soft cards `--bg3` r26; rows 52.

### 5.8 Media viewer (F8)

- Dimmed+blurred backdrop.
- Glass close/zoom/share controls.
- Open/close: scale from thumbnail (F9).

### 5.9 Segmented / folders

- Segment (profile media tabs): 382×40 pattern scaled to panel width.
- Folder capsule: token only until BE.

### 5.10 AI Editor (F11, BE first)

- Icon «Ai» after >3 lines in composer.
- Sheet: grammar / rewrite / translate; encrypted; Premium gate policy на бэке.
- Не рисовать stub.

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
| AI Editor | no | **BE → F11** |
| iPad ⌘+Enter | n/a | F12 front |

---

## 8. Waves (порядок)

| Wave | Scope | Refs | BE? |
|------|-------|------|-----|
| F0 | `--hg-glass-*`, roles, power-saving classes; kill one-off fills | DS | no |
| F1 | Nav 64 + FAB 64 + charcoal disc + scroll blur | S36 S01 S12 | no |
| F2 | Composer 3 glass + rim + mic/send | S28 S27 S04 | no |
| F3 | Header capsules + pin | S04 S05 S24 | no |
| F4 | List row / separators / badges / 1-line preview | S01 S37 | no |
| F5 | Bubbles r17/tail7 + CRM colors + voice | S05 S07 S11 | no |
| F6 | Context menus glass + scale | S16 S19 | no |
| F7 | Profile round actions + cards | S03 S17 | no |
| F8 | Media viewer chrome | S18 S30 | no |
| F9 | Motion + power-saving wiring | brief §8 | no |
| F10 | Folder capsules | token | **BE first** |
| F11 | AI Editor | brief §10 | **BE first** |
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

Связанные файлы: [`AGENT-IMPLEMENT-PROMPT.md`](AGENT-IMPLEMENT-PROMPT.md), [`VERIFY-PROTOCOL.md`](VERIFY-PROTOCOL.md), [`BRIEF-SHOTS-MATRIX.md`](BRIEF-SHOTS-MATRIX.md).
