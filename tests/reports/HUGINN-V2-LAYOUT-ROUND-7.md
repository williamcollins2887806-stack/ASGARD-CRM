# HUGINN-V2-LAYOUT-ROUND-7

**Дата:** 2026-10-05

## Layout checks (code + e2e)

- Rail attribute isolated: `data-hg-tab` only (verified by browser_rail_toggle)
- Composer capsule: glass bg + 0.5px border + blur
- Bubbles: unified `--hg-tg-bubble-radius` + tail corners (me/them)
- Lightbox: blur backdrop + glass close control
- Settings profile actions: 4 circular icons
- Bottom nav glass layer via `::before` (transform-safe)

## Вердикт

**PASS** (структурный; pixel LIVE — Phase 4 recapture)
