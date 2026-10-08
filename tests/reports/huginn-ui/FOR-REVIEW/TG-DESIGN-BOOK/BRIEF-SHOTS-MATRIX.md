# Brief ↔ Shots ↔ Huginn — матрица решений

Краткая таблица для верификаторов и кодеров. Полный канон: [`HUGINN-LIQUID-GLASS-DS.md`](HUGINN-LIQUID-GLASS-DS.md).  
Batch 2 UX/tap: [`BATCH-2-UX/`](BATCH-2-UX/). Фактчек: [`BATCH-2-UX/FACT-CHECK.md`](BATCH-2-UX/FACT-CHECK.md).

| ID | Бриф (оставленные фичи) | Доказательство shots | Decision | Статус |
|----|-------------------------|----------------------|----------|--------|
| 1 | Liquid Glass сквозной | S04 S05 S28 S36 | `.hg-glass` + роли | AGREE |
| 2 | Tab bar парит + blur при скролле | S36 S01 S12 | island/FAB TARGET **64** | AGREE_TARGET |
| 3 | Нет бокового меню | S01 S02 S14 S29 | только bottom nav (+ CRM rail) | AGREE |
| 4 | Папки capsule | — | токен; UI после BE | DEFER_BE |
| 5 | Превью до 2 строк | S01 S37 → 1 строка | **1 строка** | OVERRIDE_SHOTS |
| 6 | Composer капсула + rim + glass | S28 | 3 объекта 40/40/r20 α65% | AGREE |
| 7 | Единый радиус пузыря с хвостом | body 17 / tail 7 | r17 + tail7 family | OVERRIDE_SHOTS_GEOMETRY |
| 8 | Media viewer glass + dim | S18 S30 | Wave F8 | AGREE_PARTIAL |
| 9 | Context menus glass + scale | S16 S19 S50 S52 | F6 + F9 | AGREE |
| 10 | Профиль: round actions + soft cards | S03 S17 S23 S39 S53 | F7 | AGREE |
| 11 | Мягкие анимации + Power Saving | бриф §1/§8 | F0 + F9 | BRIEF_ONLY |
| 12 | AI Editor | PIXEL-SPEC-F11 (no TG shot) | BE V366 ready → front F11 | BE_READY_TARGET_REFS |
| 13 | iPad ⌘+Enter | — | F12 | BRIEF_ONLY |
| 14 | Цвета свои (CRM) | shots purple/OLED | только `--bg* --t* --blue-l` | OVERRIDE_CRM |
| 15 | List Edit Mode + 3 pills | **S46** | role `edit-action`; не tabbar | AGREE_BATCH2 |
| 16 | Member context + tags | **S52** | menu+card; tags API → DEFER | AGREE_PARTIAL |
| 17 | Header connecting… | S46 S56–S58 | `header.connecting` | AGREE_BATCH2 |
| 18 | Checklist bubble | **S56** | layout OK; todo API → DEFER_BE | DEFER_BE |
| 19 | Publications / Archive | S39 S40 | segment role | AGREE_BATCH2 |
| 20 | Composer reply + keyboard open | **S58** | reply strip; no keyboard product | AGREE_BATCH2 |
| 21 | Sound submenu | **S50** | F6 variant | AGREE_BATCH2 |

## Удалённые фичи (не реализовывать)

Стикер/GIF/эмодзи панель (редизайн), клавиатура как продукт, Gift Crafting, AI Summaries+Cocoon, Live/Motion Photos, Document Scanner, Colored Bot Buttons, Mighty Polls, радиальное меню реакций, refraction при скролле.

## Backend gaps

| Feature | Действие |
|---------|----------|
| folders | BE before F10 |
| AI Editor | BE ready; Desktop refs in `F11-AI-EDITOR/` |
| power saving | F0 localStorage; API later optional |
| chat/media/SSE | already OK |
| member tags / checklist todo | DEFER_BE until Huginn API; UI layout may land without live data |
| chat automation bots | out of Huginn scope unless CRM bot bridge exists |
