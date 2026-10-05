# Telegram iOS 26 → Huginn Design Book (Phase 1)

**Статус:** Phase 1 complete — vision + measured consensus. Код Huginn **не** менялся.  
**Viewport канон:** **414 × 896 pt @2x** (`pt = px_828 / 2`). Все `shots/S*.md` нормализованы к этой базе.  
**Артефакты:**

| Файл | Назначение |
|------|------------|
| [`MANIFEST.json`](MANIFEST.json) | S01…S38 → source JPG + slug + status |
| [`shots/`](shots/) | 38 попиксельных описаний (10 секций каждое) |
| [`TG-DESIGN-TOKENS.json`](TG-DESIGN-TOKENS.json) | канонические токены + coverage + diff для кодеров |
| [`PIXEL-SAMPLE.json`](PIXEL-SAMPLE.json) | Pillow samples + конфликты с ATLAS |
| [`../TG-ATLAS.json`](../TG-ATLAS.json) | предшествующий машинный слой (не затираем) |

**Как читать:** book = истина по **геометрии/стеклу iOS 26 Liquid Glass** на этих рефах. ATLAS = полезный baseline + то, что уже вшито в `huginn_dock.css`. Конфликты — явная таблица ниже, без усреднения «на глаз».

---

## 1. Foundations

### 1.1 Палитра (dark OLED)

| Роль | Значение | Доказательство |
|------|----------|----------------|
| Screen BG | `#000000` | S01, S07, S28 |
| Card / grouped surface | `#1C1C1E` | S03, S16, S20, S32 |
| Glass fill (over black) | `#171717`…`#181818` | S18, S36 |
| Separator (in card) | `#3C3C3E` | S29, S32 |
| Text primary | `#FFFFFF` | почти все |
| Text secondary / meta | `#8E8E93` | S01, S36 |
| Placeholder / secondary glyph | `rgba(255,255,255,0.60)` | S28 |
| Accent blue (links, active glyph, send) | `#3E88F7` (JPEG; канон рядом `#0A84FF` / `#007AFF`) | S14, S22, S36 |
| **User accent (outgoing)** | **`#7358FF`…`#894DE9`** | S07, S11, S30 — **не** default TG blue |
| Danger / badge | `#FF3B30` (канон; JPEG → `#D94F42`…`#DC614F`) | S36, S01, S29 |

### 1.2 Типографика (типичные классы)

| Класс | Size | Weight | Color |
|-------|------|--------|-------|
| Nav title / chat title | 17 pt | Semibold | `#FFF` |
| Large profile title | 28 pt | Semibold | `#FFF` |
| Body bubble | 17 pt | Regular | `#FFF` |
| Meta / time | 13–14 pt | Regular | `#8E8E93` или `rgba(255,255,255,0.55)` в пузыре |
| Tab label | 10–11 pt | Medium | active = accent blue; inactive = `#FFF` |
| Badge digit | 11–12 pt | Bold | `#FFF` on `#FF3B30` |
| Placeholder composer | 17 pt | Regular | `rgba(255,255,255,0.60)` |
| Settings row | 17 pt | Regular | `#FFF`; value right = secondary |

Шрифт: SF Pro (iOS). Для Huginn — системный / UI stack CRM, не подменять метриками Inter без проверки.

---

## 2. Effects — Liquid Glass

iOS 26 chrome = **отдельные стеклянные объекты**, не сплошные бары во всю ширину.

| Слой | Fill | Rim | Blur (est.) | Где |
|------|------|-----|-------------|-----|
| Composer tool/input | `rgba(35,35,34,0.65)` | `1pt rgba(255,255,255,0.11)` + spec `0.22` | ~20 pt | S28 |
| Nav island + FAB | `rgba(28,28,30,0.82)` obs `#171717` | top rim `rgba(255,255,255,0.10–0.18)` | ~40 pt | S36 |
| Header capsules | ~`rgba(22,19,20,0.48)` | тонкий white rim | ~28–36 pt | S04, S05, S24 |
| Segmented capsule | `#181818` + active pill `rgba(255,255,255,0.15)` | rim `0.10` | — | S17–S23 |
| Selection disc (active tab) | `#393939` | — | — | S36 — **не** blue bloom |

CSS-намёк:

```css
.tg-glass {
  background: var(--tg-glass-fill);
  -webkit-backdrop-filter: blur(var(--tg-glass-blur)) saturate(180%);
  backdrop-filter: blur(var(--tg-glass-blur)) saturate(180%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.11);
}
```

---

## 3. Layout

| Токен | pt | Shots |
|-------|----|-------|
| Side inset (cards / media) | **16** | S03, S18, S20 |
| Composer side inset (S28 crop) | **26** | S28 |
| Chat list row | **68–76** (канон book **72**) | S01, S37 |
| Contact row | **53** | S02 |
| Settings row | **52** | S32 |
| List avatar (chats) | **54–62** | S01, S37 |
| Contact avatar | **42** | S02 |
| Msg avatar | **~32** | S05 |
| Card radius | **22–26** (канон **26**) | S03, S20, S32 |
| Segmented capsule | **382 × 40** | S17–S23 |

---

## 4. Components

### 4.1 Composer (эталон S28 + S27)

Три **независимых** объекта, общей подложки-бара нет:

| Элемент | Геометрия | Заметки |
|---------|-----------|---------|
| Attach | круг **Ø 40** | paperclip stroke ~1.75–2 pt, white |
| Input | капсула **h 40**, radius **20** | placeholder «Сообщение»; справа sticker icon ~18.5 pt @ 0.6 white |
| Mic | круг **Ø 40** | mic glyph ~19×25 pt |
| Gaps | **6** / **≈7** pt | ATLAS имел 8 — soft |
| Material | `rgba(35,35,34,0.65)` | dual-bg alpha solve S28 |

Состояния: empty → mic; typing → send (синий FAB, см. S09/S10 recording flows).

### 4.2 Bottom nav + FAB (эталон S36)

| Элемент | Геометрия |
|---------|-----------|
| Island | ≈ **299–303 × 64**, radius **32** (stadium) |
| FAB search | **Ø 63.5–64** (= высота island) |
| Gap island→FAB | **~8** |
| Tabs | Contacts / Calls / Chats / Settings |
| Active | charcoal disc `#393939` + blue glyph/label |
| Inactive icons | white; labels white |
| Badge | `#FF3B30`, ~18 pt min, digits white |

**Конфликт с ATLAS/Huginn:** ATLAS и текущий `huginn_dock.css` держат **56**. Book для паритета iOS 26 → **64**. Tradeoff зафиксирован в токенах (`hg_current_tradeoff`).

### 4.3 Chat header (эталон S04 / S05 / S24)

Floating capsules вместо continuous bar:

- Back pill **h 44** + **white badge** с числом непрочитанных (чёрные цифры).
- Title pill **h 44** (имя + subtitle).
- Avatar circle **Ø 44**.
- Pin / live-location / reply bar: ширина ≈ **382**, высота **40–50**, radius ≈ half-height.

### 4.4 Bubbles

| | Out (me) | In (them) |
|--|----------|-----------|
| Fill | **user accent** `#7358FF…#894DE9` на этих рефах | `rgba(36,36,38,0.92)` или glass-gradient на wallpaper |
| Radius | ~15–18 pt | ~17 pt |
| Tail corner | ~6–7 pt | ~6–7 pt |
| Meta | time + ✓✓ white @ ~0.55 | time; sender name colored in groups |

**Huginn:** `--hg-tg-bubble-me` **не** хардкодить в purple и **не** слепо брать ATLAS `#2B5278` — брать accent темы.

### 4.5 Voice

- Play disc: white circle on bubble; glyph = accent purple.
- Waveform: played `#FFF`, rest `rgba(255,255,255,0.40–0.50)`.
- Duration under waveform; checks bottom-right.
- Shared voice list (S22): blue play Ø40 `#3E88F7`, row 57 pt, card `#1C1C1E`.

### 4.6 Segmented tabs (profile / shared media)

Капсула **382 × 40**, active inner pill inset ~3 pt, fill `rgba(255,255,255,0.15)`, labels 16 pt white. Горизонтальный scroll без fade (S20).

### 4.7 Lists

- **Chats (S01/S37/S38):** Stories Ø62 pitch ~74; search stadium ~44×382; pinned block on `#1C1C1E`; unread badges; geo/birthday banners.
- **Contacts (S02/S12):** search 44; invite row; alphabet optional (S13); glass tab + FAB.
- **Settings (S29–S34):** photo hero 474 pt или compact avatar Ø100; cards radius 26; rows 52; glass tab Settings active.

### 4.8 Overlays

- Mute menu / more menu: glass sheets, separators, destructive red (S16, S19).
- Dim: часто **нет** полного scrim — вместо этого приглушаются соседние контролы (S19).
- Alerts (phone check S06/S29): card `#1C1C1E`, blue confirm / red decline rows.

---

## 5. Motion / states (зафиксированы на кадрах)

| Состояние | Shot |
|-----------|------|
| Keyboard open (RU) | S04, S15, S25, S27 |
| Voice playing / locked record | S07, S09 |
| Video note recording | S10 |
| Live location banner | S08, S11, S25, S30 |
| Reply + reactions + unread separator | S26 |
| Search in chat | S15 |
| Mute menu / more menu | S16, S19 |
| Stories row | S35, S37, S38 |
| Shared media / files / links / voice | S18, S20, S21, S22 |

---

## 6. Token map → Huginn (`--hg-tg-*`)

См. полный JSON: [`TG-DESIGN-TOKENS.json`](TG-DESIGN-TOKENS.json) → `components.*.hg_map` и `hg_token_diff_proposal`.

### Предложение кодерам (не применено)

**Обновить:**

```
--hg-tg-tool-bg / --hg-tg-input-bg → rgba(35,35,34,0.65)
--hg-tg-composer-gap               → 6px
--hg-tg-nav-h / --hg-tg-fab-size   → 64px
--hg-tg-nav-radius                 → 32px
--hg-tg-nav-bg                     → rgba(28,28,30,0.82)
--hg-tg-active-circle              → #393939
--hg-tg-nav-icon-active            → #3E88F7
--hg-tg-header-h                   → 44px
--hg-tg-bubble-radius              → 17px
```

**Оставить:** tool/input 40, input-radius 20, badge `#FF3B30`, back-badge white/black, nav-blur 40.

**Не хардкодить:** `--hg-tg-bubble-me` (accent темы).

### Конфликты Book ↔ ATLAS (кратко)

| Тема | ATLAS | Book | Вердикт Phase 1 |
|------|-------|------|-----------------|
| Composer size | 40 | 40 | AGREE |
| Composer alpha | ~0.34–0.44 | **0.65** | Book |
| Nav/FAB | 56 | **64** | Book (TG); Huginn 56 = craft tradeoff |
| Active tab | blue bloom | **charcoal disc** | Book (= уже R100 в CSS) |
| Bubble me | `#2B5278` | purple accent | THEME — не копировать purple в CRM |
| Header | continuous 56 bar | **floating 44 pills** | Book описывает iOS 26 |

Подробности: [`PIXEL-SAMPLE.json`](PIXEL-SAMPLE.json) → `conflicts_vs_atlas`.

---

## 7. Coverage matrix

| Компонент | Shots |
|-----------|-------|
| composer | S04 S05 S08 S25 S27 **S28** S30 |
| nav_tabbar | S01 S02 S06 S12 S14 S29 S31–S34 **S36** S37 S38 |
| header | S04 S05 S08 S15 **S24** S25 S26 S30 |
| list_chats | S01 S35 S36 S37 S38 |
| list_contacts | S02 S12 S13 |
| thread_bubbles | S04 S05 S07 S08 S11 S15 S25 S26 S30 |
| voice | S07 S09 S22 |
| video_note | S08 S09 S10 |
| overlays_menus | S06 S13 S16 S19 |
| profile_group | S03 S16 S17 S19 S23 |
| shared_media | S18 S20 S21 S22 |
| settings | S06 S29 S31–S34 |
| calls | S14 |
| keyboard | S04 S15 S25 S27 |
| live_location | S08 S09 S11 S25 S30 |
| reactions_reply_unread | S26 |
| stories | S35 S37 S38 |

**Дыр по обязательным chrome-блокам плана нет** (composer, nav, header, list, thread, bubbles, voice, overlays — все покрыты ≥1 shot).

---

## 8. Индекс shots

| ID | Slug | Source |
|----|------|--------|
| S01 | chat-list-dark | IMG_20261003_194819 |
| S02 | contacts-list | IMG_20261003_194820 |
| S03 | group-profile | IMG_20261003_194821 |
| S04 | group-chat-keyboard | IMG_20261003_194822 (1) |
| S05 | group-chat-ios-dark | IMG_20261003_194822 |
| S06 | profile-main | IMG_20261003_194823 |
| S07 | outgoing-voice-messages | IMG_20261005_110200 |
| S08 | chat-live-location | IMG_20261005_110201 |
| S09 | voice-record-locked | IMG_20261005_110202 |
| S10 | video-message-recording | IMG_20261005_110203 (1) |
| S11 | ios-chat-bubbles | IMG_20261005_110203 |
| S12 | contacts-glass-nav-dark | IMG_20261005_110204 |
| S13 | add-contacts-dark | IMG_20261005_110205 |
| S14 | telegram-calls-ios-dark | IMG_20261005_110206 |
| S15 | chat-search-ios-dark | IMG_20261005_110207 |
| S16 | group-profile-mute-menu | IMG_20261005_110208 |
| S17 | group-profile-photo-expanded | IMG_20261005_110209 |
| S18 | group-shared-media-grid | IMG_20261005_110210 (1) |
| S19 | group-profile-more-menu | IMG_20261005_110210 |
| S20 | shared-files-list | IMG_20261005_110211 |
| S21 | shared-links-list | IMG_20261005_110212 |
| S22 | shared-voice-list-dark | IMG_20261005_110213 |
| S23 | group-profile-members-glass | IMG_20261005_110214 |
| S24 | group-header-pinned | IMG_20261005_110215 |
| S25 | chat-keyboard-geo-media | IMG_20261005_110216 (1) |
| S26 | group-chat-reply-reactions-unread | IMG_20261005_110216 |
| S27 | keyboard-ru-composer | IMG_20261005_110217 |
| S28 | composer-glass-dark | IMG_20261005_110218 |
| S29 | settings-profile-phone-check | IMG_20261005_110220 (1) |
| S30 | chat-album-live-location | IMG_20261005_110220 |
| S31 | profile-expanded-avatar | IMG_20261005_110221 |
| S32 | settings-root-scrolled | IMG_20261005_110222 |
| S33 | settings-menu-scrolled | IMG_20261005_110223 |
| S34 | settings-compact-avatar-phone-check | IMG_20261005_110224 |
| S35 | chats-stories-search-header | IMG_20261005_110225 (1) |
| S36 | chats-glass-tabbar-fab | IMG_20261005_110225 |
| S37 | chats-stories-liquid-glass | IMG_20261005_110226 |
| S38 | chats-stories-liquid-glass | IMG_20261005_110227 |

Skipped dupe: `IMG_20261005_110228.jpg` (= S38 source).

---

## 9. Phase 2 (бриф + CRM overlay) — готово

Наложение брифа Telegram iOS 2026 + CRM palette выполнено в отдельных канон-файлах (этот Phase-1 book остаётся геометрическим слоем shots):

1. [`HUGINN-LIQUID-GLASS-DS.md`](HUGINN-LIQUID-GLASS-DS.md) — единая DS Huginn
2. [`HUGINN-LIQUID-GLASS-TOKENS.json`](HUGINN-LIQUID-GLASS-TOKENS.json) — токены + BE gaps + waves
3. [`BRIEF-SHOTS-MATRIX.md`](BRIEF-SHOTS-MATRIX.md) — матрица решений
4. [`AGENT-IMPLEMENT-PROMPT.md`](AGENT-IMPLEMENT-PROMPT.md) — промпт кодера
5. [`VERIFY-PROTOCOL.md`](VERIFY-PROTOCOL.md) — тройная верификация

Код `huginn_dock.css` / `.js` — только после команды «кодить Wave F0».

---

## 10. Ограничения Phase 1

- Зрение + JPEG: мелкий цвет (accent blue, badge red) смягчён — в токенах помечено `estimated-jpeg`, канон зафиксирован отдельно.
- Агентам вложение приходило даунскейлом 473×1024; размеры перемеривались по `REFS/*.jpg` 828 px. Ранние версии S02–S05/S08–S09/S14–S16/S23 были переписаны на базу 414.
- Автосемплер luminance в `PIXEL-SAMPLE.json` на wallpaper дал ложные bbox для S28/S36 — не использовать его raw runs как канон; канон = shots + tokens.
- Светлой темы в наборе нет.
