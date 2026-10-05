# ACK-SCOPE — Huginn visual wave

**Дата:** 2026-10-05  
**План:** `huginn_visual_ai_wave_c370007b`

## OUT of scope (единственное)

| Пункт | Почему |
|-------|--------|
| Live-location / геолокация | Баннеры, шаринг live-geo, map bubbles — **не** реализуем в этой волне |

## IN scope (чинить / доводить)

| Пункт | Статус волны |
|-------|--------------|
| Quick-reply chips (`#hgAiChips`) | Убрать полностью |
| List header hybrid (Изм. \| Чаты \| compose) | IN |
| Folders + CRM tabs | Сохранить |
| Multi-select → folder | IN |
| Stories rail + BE feed/view | IN |
| Glass island nav/FAB (размер **64**) | Усилить glass, не откат к 56 |
| Pinned block в списке | Отдельная секция |
| Birthday banners (`/api/birthdays`) | dismiss + toggle; **без geo** |
| Thread pin banner / file / media | Polish + captures |
| AI editor 1в1 + RouterAI | BE + UI |
| Mock-overlay tool | Обязателен в visual-батче |

## Правило

Раньше часть пунктов ошибочно попала в «не трогать». Этот ACK отменяет то чтение: **OUT = только geo**.
