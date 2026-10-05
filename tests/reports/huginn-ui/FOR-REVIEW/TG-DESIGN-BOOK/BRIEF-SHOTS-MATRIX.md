# Brief ↔ Shots ↔ Huginn — матрица решений

Краткая таблица для верификаторов и кодеров. Полный канон: [`HUGINN-LIQUID-GLASS-DS.md`](HUGINN-LIQUID-GLASS-DS.md).

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
| 9 | Context menus glass + scale | S16 S19 | F6 + F9 | AGREE |
| 10 | Профиль: round actions + soft cards | S03 S17 S23 | F7 | AGREE |
| 11 | Мягкие анимации + Power Saving | бриф §1/§8 | F0 + F9 | BRIEF_ONLY |
| 12 | AI Editor | — | BE → F11 | DEFER_BE |
| 13 | iPad ⌘+Enter | — | F12 | BRIEF_ONLY |
| 14 | Цвета свои (CRM) | shots purple/OLED | только `--bg* --t* --blue-l` | OVERRIDE_CRM |

## Удалённые фичи (не реализовывать)

Стикер/GIF/эмодзи панель (редизайн), клавиатура как продукт, Gift Crafting, AI Summaries+Cocoon, Live/Motion Photos, Document Scanner, Colored Bot Buttons, Mighty Polls, радиальное меню реакций, refraction при скролле.

## Backend gaps

| Feature | Действие |
|---------|----------|
| folders | BE before F10 |
| AI Editor | BE before F11 |
| power saving | F0 localStorage; API later optional |
| chat/media/SSE | already OK |
