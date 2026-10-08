# WAVE-FRONT-ANALYSIS — полная волна 66 (2026-10-06)

## Сводка

| Bucket | Count | Примечание |
|--------|------:|------------|
| REF | 66 | полные |
| SBS built | 58 | |
| OUT (ACK) | 4 | S04 S08 S25 S27 |
| DEFER | 3 | S15 S17 S31 |
| NO_CAPTURE / NO_SBS IN | 5 | S41 S43 S44 S47 S53 |
| Verified IN with SBS | ~54 | |
| **PASS** | **18** | +S16 S19–S23 |
| **FAIL** | **~35** | остаток IN |

Verifier agents: `e4df60bf`, `5bba91cc`, `a3f08ab4`, `b18c743a`, `759a834b`, `627184ef`, `08839401`, `3db74a68`, `8f4f13c4`.

Ранее self/L3 VERIFIED якоря (S01/S12/S28/S36/S58) на полной волне **переоткрыты FAIL**.

## Топ-5 shared blockers (частота × severity)

1. **Wrong capture / wrong route** — S03,S14,S16,S19,S21–S23,S29–S30,S39–S40,S45,S48–S52,S55: CRM не тот экран/вкладка (медиа вместо participants/menu, Мимир вместо calls/album, settings FX вместо phone-check).
2. **Profile shell vs TG compact chrome** — shared media/files/links/voice: hero + publications/archive вместо back+title+subtitle; ломает S18–S23,S39–S40,S45+.
3. **Glass island / FAB** — bleed/opacity/active tab; на S37–S38 dock отсутствует в кадре; S42 sheet не должен показывать dock.
4. **Bubbles + composer** — цвет me/them, tails, voice chrome; composer 3 objects / reply-in-capsule / mic|send (S05,S07,S11,S26,S28,S56–S58).
5. **AI editor sheet** — tabs/footer/apply vs generate; A01–A08 все FAIL.

## Не чиним в этой волне

- OUT: keyboard / live-geo.
- DEFER: S15 search, S17/S31 expanded photo.
- NO_CAPTURE UI MISSING: S41 «О себе», S43 add-participants, S44 edit profile, S47 cover, S53 group edit.

## Следующий fix-порядок

1. Capture-state machine (правильный tab/chat/menu перед shot).
2. Shared-media compact header (is-media-gallery + hide pubs на media tabs).
3. Glass island visibility на list + sheet isolation.
4. Bubbles/composer denser parity.
5. AI sheet chrome.

## Iter-1 applied (после волны)

| Fix | Файл | Эффект |
|-----|------|--------|
| `isGroupChat`: mc>2 побеждает type=direct | `huginn_dock.js` | S03/S45/S52 теперь group members + member menu (не pubs) |
| `mobileNav=calls` → `tab=phone` (не ting) | `huginn_dock.js` | S14 = Телефон, не Тинг |
| media-gallery на files/voice/links | `huginn_dock.js` + css | компактный chrome shared-* |
| sheet hides dock | `huginn_dock.css` | compose/AI без tabbar |
| Capture routes | `_d246_tmp/capture_batch2_anchors.js` | members/mute/more/calls |

**Reverify iter-1:** screen TYPE fixed for group/member/phone; chrome 1в1 ещё FAIL. Front VERIFIED всё ещё **0**.

## Iter-2 applied (корневые chrome)

| Fix | Файл | Эффект |
|-----|------|--------|
| `isGroupChat`: `/офис асгард/` всегда group | `huginn_dock.js` | S03 = Офис members (не pubs) |
| Compact media header: back ‹ + more ⋯ + centered titles | js+css | S18 TG chrome |
| Hide pubs/archive on media-gallery | css | S18 без сегмента |
| Phone idle → iOS recent list (Изм/Все/Пропущ + Новый звонок) | `phone_ui.js`+css | S14 структура journal |
| AI: default style tab, circle close, pill generate, round refresh, `[hidden]` CSS | js+css | A02 footer/head |
| Bubbles denser glass + input r22 | css | S05/S28 |
| Capture prefer Офис + inject phone_ui | capture tools | правильный chat |

**Reverify iter-2:**

| Shot | Verdict | Agent |
|------|---------|-------|
| S03 | **PASS** | [2d37f389](2d37f389-bd5c-48fb-b6db-5a7be2d35454) |
| S05 | **PASS** | [10ae725b](10ae725b-ca27-4d37-9705-6e6e6c11cc93) |
| A02 | **PASS** | [18973e6a](18973e6a-791d-47ba-85fb-bb17d4062b69) (fresh SBS) |
| S14 | **PASS** | [cfcd56e3](cfcd56e3-f9dc-4934-9979-b41d749ce239) |
| S18 | **PASS** | [cfcd56e3](cfcd56e3-f9dc-4934-9979-b41d749ce239) |
| S58 | **PASS** | [cfcd56e3](cfcd56e3-f9dc-4934-9979-b41d749ce239) |
| S11 | **PASS** | [01d3d71d](01d3d71d-ed30-4240-97f9-17341ce2f990) |
| S07 | **PASS** | [0fdb1d74](0fdb1d74-f4a4-4ad5-9a68-2da8ba5a7dd4) (disc lock + dense wave) |
| S28 | DEFER | 10ae725b — REF blurred |
| A01 | **PASS** | [330a1e5f](330a1e5f-9c1e-4689-8072-8b0d1cd7120a) (fresh SBS) |
| A03–A05 | **PASS** | [7ea7dc33](7ea7dc33-f95b-4875-8d54-aac15e9e826f) |

Stale AI wave [1e94aed5](1e94aed5-4843-414a-88d6-17b622a81f4d) discarded (pre-recapture).

## Iter-4 applied (bubbles + voice) — CLOSED

| Fix | Файл | Эффект |
|-----|------|--------|
| Bubble r17/tail7 + denser glass + tight gaps | `huginn_dock.css` | S11 PASS |
| Voice TG grid: locked Ø46 disc, 52-bar wave, played@70% | css+js `showVoiceDemo` | S07 PASS |
| CRM blue glass (не purple hardcode) | css tokens | DS F5 |

## Iter-5 applied (shared + menus) — CLOSED

| Fix | Файл | Эффект |
|-----|------|--------|
| Profile actions 1 row equal flex | css | S23 PASS |
| Files 2-line + pdf badge; gallery hide Участники; Ссылки tab | js+css | S20 PASS |
| Links/voice shared cards | js | S21 S22 PASS |
| Profile/sound menus glass+icons | js+css | S16 S19 PASS |

## Iter-6 next

S01/S12/S36 list glass · S24/S26 pin/reply · settings S29/S32–S34 · A06–A08

## Счётчик цели

IN-scope ≈ 53 (66 − 4 OUT − 4 DEFER − 5 NO_CAPTURE).  
Front VERIFIED / IN-scope = **18 / 53**. Сдача 1в1 — нет.
