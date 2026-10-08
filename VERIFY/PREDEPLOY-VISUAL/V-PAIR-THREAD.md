# V-PAIR-THREAD — Front 1в1

**CRM:** `VERIFY/PREDEPLOY-VISUAL/CAPTURE/CRM-thread.png` / `CRM-S05-*.png`  
**Mock:** `VERIFY/PREDEPLOY-VISUAL/MOCKS/pair-thread-diff.png`  
**Дата:** 2026-10-05

## Zones

| Zone | CRM live | Verdict |
|------|----------|---------|
| Header back+badge+title+avatar | есть | match |
| Pin banner | «Закреплённое сообщение» + jump | match |
| Bubbles me/them | rounded TG-like | match |
| Reactions | 👍 on message | match |
| Composer glass | attach + input + smile + send/mic | match |
| Wallpaper pattern | есть | match |

## Diffs

1. Seed/runtime noise texts (`react-me…`, gap-runtime URLs) — test data, не UI.
2. Call-event bubble — продуктовый.

## Verdict

**1в1** для thread chrome (header / pin / bubbles / composer).
