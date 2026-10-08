# ACK-SCOPE — Huginn visual wave

**Дата:** 2026-10-05  
**План:** `huginn_visual_ai_wave_c370007b`

## OUT of scope (единственное)

| Пункт | Почему |
|-------|--------|
| Live-location / геолокация | Баннеры, шаринг live-geo, map bubbles — **не** реализуем в этой волне |
| TG Premium / Stars / Business / Help rows | Telegram-only marketing rows в REF settings — **не** продукт Huginn |

## DEFER (вне знаменателя 3/3 — triple cert)

| Shot | Почему |
|------|--------|
| S15 chat-search | in-chat search не в продукте dock |
| S17 profile-photo-expanded | нет отдельного UI expanded photo |
| S31 profile-expanded-avatar | нет отдельного UI |
| ~~STT-infra~~ | **CLOSED 2026-10-06:** media E2E transcript `done` (Yandex AQVN 401 → local Whisper fallback in `speechkit.js`) |
| ~~AI-provider-auth~~ | **CLOSED 2026-10-06:** RouterAI DeepSeek 4.1 Flash + anti-stub exit 0 + apply PASS |

## Rematrix 2026-10-06

Close 2026-10-05 отозван (batch 1в1 / synth BE / AI·STT stubs). См. `SHOT-MATRIX.md`.  
Anti-stub AI (2026-10-06): grammar/translate/style → **502** «Ошибка авторизации в AI-провайдере» — **не** закрывать stub'ом.  
Honest V-PAIR: **0×1в1** / 39× `не 1в1` + REWORK. Scene-gate / full_matrix / media / stress / realtime — PASS без stub.  
3/3 = **0** (не прод-ready).

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
| Voice/circle/STT quality | КРИТ triple-cert |
| Per-shot V-BE / V-TEST / V-FRONT | Обязательно |

## Правило

Раньше часть пунктов ошибочно попала в «не трогать». Этот ACK отменяет то чтение: **OUT = только geo**.  
DEFER ≠ OUT: shot не в приёмке 3/3, пока нет спека.
