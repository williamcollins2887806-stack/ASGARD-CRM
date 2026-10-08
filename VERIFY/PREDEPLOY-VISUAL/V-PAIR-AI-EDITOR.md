# V-PAIR-AI-EDITOR — Front 1в1

**CRM:** `VERIFY/PREDEPLOY-VISUAL/CAPTURE/CRM-A02-ai-style-generate.png` / `CRM-composer-ai.png`  
**Mock:** `VERIFY/PREDEPLOY-VISUAL/MOCKS/pair-ai-diff.png`  
**Дата:** 2026-10-05

## Zones

| Zone | CRM live | Verdict |
|------|----------|---------|
| Ai над attach | CRM-A07 | match |
| Idle no-Ai tip/gate | CRM-A06 (пусто → нет sheet) | match |
| Sheet head + tabs translate/style/grammar | icons + labels | match |
| Generate / refresh / send actions | есть | match |
| New Style path | CRM-A01 | match |

## Diffs

1. Sheet opens only after ≥4 lines — продуктовый gate (не баг).
2. Result empty until Generate — ожидаемо без RouterAI call в capture.

## Verdict

**1в1** для AI sheet chrome (A02/A06/A07). Apply-результат (A03–A05) — отдельно после runtime rewrite на клоне с ключом.
