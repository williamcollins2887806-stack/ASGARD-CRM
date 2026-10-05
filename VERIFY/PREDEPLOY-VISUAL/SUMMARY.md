# PREDEPLOY-VISUAL SUMMARY — Huginn visual wave

**Дата:** 2026-10-05  
**Статус:** REVIEW → **human-gate** (деплой только по команде)  
**ACK:** [`ACK-SCOPE.md`](./ACK-SCOPE.md) — OUT = live-geo only

## Сделано (код)

| Зона | Доказательство |
|------|----------------|
| Chips removed | `#hgAiChips` / `loadAiChips` удалены; CSS `display:none` |
| List header hybrid | `Изм.` \| `Чаты` \| compose; `LIST-HEADER-HYBRID.md` |
| Multi-select → folder | `PUT /:id/folder` из edit bar |
| Stories rail | `#hgStoriesRail` + viewer + `POST .../view` |
| Birthday banners | `/api/birthdays` + dismiss + settings toggle; **no geo** |
| Pinned block | `.hg-pinned-block` отдельная секция |
| Glass island | nav/FAB blur↑ sat↑ rim↑ shadow↑; size **64** retained |
| Thread pin/file | pin jump + flash; file card as download link |
| AI 1в1 | Ai над attach; tab icons; copy/expand/refresh; New Style sheet |
| Mock-overlay | `tools/huginn_visual_mock_overlay.js` → `MOCKS/pair-*-diff.png` |

## V-PAIR (mock)

| Pair | File |
|------|------|
| List | `MOCKS/pair-list-diff.png` |
| Thread | `MOCKS/pair-thread-diff.png` |
| AI | `MOCKS/pair-ai-diff.png` |

Live CRM captures поверх mock — следующий шаг human-gate (≤3 shots / batch). Placeholder mocks без `--crm` валидны как zone annotation tool smoke.

## OUT

- Live-location / geo banners — **не** реализовано (намеренно).

## Вердикт для человека

Код волны IN-scope закрыт на уровне SELF-CHECK/REVIEW.  
**DONE/deploy запрещён** без вашей явной команды после просмотра SUMMARY + live shots.
