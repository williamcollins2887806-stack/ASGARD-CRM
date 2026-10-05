# HUGINN-V4-FRONTEND-ROUND-7

**Дата:** 2026-10-05  
**Файлы:** `huginn_dock.js`, `huginn_sse.js`, `huginn_ting.js`, `huginn_dock.css`

## Evidence

| Claim | Evidence |
|-------|----------|
| D-260 `data-hg-tab` | rail markup `data-hg-tab=`; no rail `data-tab` |
| Toggle | `if (!state.collapsed && state.tab === tab) setCollapsed(true)` |
| Fade on tab change only | `if (!state.collapsed && tabChanged) { opacity 0→1 }` |
| Mount guard | `_mounting` promise re-entry guard |
| SSE no full refresh | `huginn_sse.js` catch-up only `emit()` — **no** `refreshOpenChat` (confirmed `rg refreshOpenChat huginn_sse.js` → 0) |
| transcript patch | `chat:transcript_ready` → `renderMessagesIntoBox()` when `.hg-msgs` present |
| FX settings | `applyFxMode` + UI full/reduced/off |

## E2E

```
node tests/huginn/browser_rail_toggle.spec.js
→ ALL PASS / fails 0 / exit 0
```

## Вердикт

**PASS**
