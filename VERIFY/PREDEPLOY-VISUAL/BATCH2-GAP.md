# BATCH2-GAP — S39–S58 vs Huginn (2026-10-06)

**Источники:** `Desktop/Новая папка (3)` → `TG-DESIGN-BOOK/REFS/S39…S58.jpg`; код `huginn_dock.*`.

Легенда: **HAVE** · **PARTIAL** · **MISSING** · **DEFER_BE** · **OUT**

## Сводка

| Статус | Count | Shots / темы |
|--------|------:|--------------|
| HAVE | 6 | S39 pubs · S40 archive layout · S46 pills · S50 sound · S52 menu · S58 reply-in-input |
| PARTIAL | 6 | S42 S43 S45 S48 S54 S55 |
| MISSING | 6 | S41 S44 S47 S49/S51 polish · S53 · cover |
| DEFER_BE | 2 темы | member tags (S52); checklist API (S56) |
| OUT | keyboard | S58 OS keyboard |

## Per-shot (обновлено после glass-first)

| Shot | Status | Доказательство |
|------|--------|----------------|
| S39 | HAVE | segment Публикации/Архив на DM; CAPTURE `CRM-S39-publications.png` |
| S40 | HAVE | archive empty grid; `CRM-S40-archive.png` |
| S41 | MISSING | нет form «О себе» |
| S42–S43 | PARTIAL | compose sheet |
| S44 | MISSING | edit profile card |
| S45/S48/S55 | PARTIAL | members card + row menu |
| S46 | HAVE | 3× `edit-action` pills; `body.hg-list-edit`; CAPTURE `CRM-S46-list-edit.png` — drag≡ нет |
| S47 | MISSING | cover |
| S49/S51 | PARTIAL | more + sound |
| S50 | HAVE | submenu 8h/1d/forever/off |
| S52 | HAVE | member preview menu; tags disabled DEFER_BE |
| S53 | MISSING | group edit |
| S54 | PARTIAL | contacts |
| S56 | PARTIAL | connecting subtitle + checklist layout; API DEFER |
| S57 | PARTIAL | pin |
| S58 | HAVE | reply strip inside `.hg-input-wrap`; kbd OUT |

## Glass roles

| Role | Status |
|------|--------|
| composer nav fab header pin menu card segment media-chrome | HAVE |
| **edit-action** | HAVE |

## Expand after L3 anchors (2026-10-06)

- Settings: `hg-glass` cards/alert; phone actions visible
- S46: edit-action glass fill55/blur40; labels white (REF)
- S18: gallery chrome (hide actions); grid gap 1px (excl. from `app.css` `[class*="-grid"]`)
- Front Batch2: **open** (нет Task-verifier на этих кадрах)

## Suite (этот проход)

- AI anti-stub Flash: PASS
- Media E2E STT done: PASS
- scene-gate: **20/20** PASS
