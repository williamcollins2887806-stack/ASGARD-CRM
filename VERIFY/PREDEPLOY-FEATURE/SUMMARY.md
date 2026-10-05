# PREDEPLOY-FEATURE SUMMARY — Huginn visual wave

**Дата:** 2026-10-05  
**Clone:** `127.0.0.1:3100` + `asgard_crm_test`

## Feature zones

| Zone | Actions | Result | Evidence |
|------|---------|--------|----------|
| **UX-COMP** | chips absent; Ai over attach; composer tools | PASS (static) | no `hgAiChips` in JS; `.hg-composer-left` |
| **UX-LIST** | hybrid header; folders; tabs; edit→folder | PASS (static+BE) | folders API 200; UI markers |
| **UX-STORIES** | feed GET; rail; view POST | PASS BE | `GET /stories/feed` → 200 `stories` |
| **UX-BDAY** | birthdays GET; dismiss; toggle | PASS BE | `GET /api/birthdays?days=7` → 200 `items` |
| **UX-PIN-FILE** | pin banner jump; file card download | PASS (static) | pin `data-pin-mid`; `a.hg-file-card` |
| **BE-AI** | styles presets; rewrite empty 400; RouterAI path | PASS | unit presets=9; rewrite empty 400; styles 200 |
| **UX-AIUI** | sheet tabs+icons; copy; expand; refresh; New Style | PASS (static) | `openNewStyleSheet`; no `prompt()` for style |
| **BE-FOLDER** | folders list/assign | PASS BE | `GET /folders` 200 |

## BE probe log (clone)

```
/api/chat-groups/stories/feed 200 stories
/api/birthdays?days=7 200 items
/api/chat-groups/ai/styles 200 presets,custom
/api/chat-groups/folders 200 folders,active_folder_id
rewrite empty 400
PASS huginn_ai_editor_unit presets=9
```

## Human-gate

Оба SUMMARY (visual + feature) готовы к вашему ревью.  
**Деплой не выполнять** без явной команды.
