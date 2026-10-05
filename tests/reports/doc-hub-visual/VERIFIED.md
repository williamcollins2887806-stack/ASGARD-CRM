# Independent visual verifier — Doc Hub CRM vs render

**Date:** 2026-10-05 (fresh captures ~23:11 local / INDEX `2026-10-05T20:11:40Z`)  
**Verifier:** independent visual agent (did **not** author Doc Hub UI; did **not** edit product UI for this verdict)  
**Subjects:** `tests/reports/doc-hub-visual/crm/` vs `tests/reports/doc-hub-visual/render/`  
**Rule:** PASS only if the verdict can honestly contain exactly:  
`**VERIFIED 10/10 — CRM лучше render по каждому экрану матрицы**`  
Anything softer (parity / almost / competitive) = **FAIL**.  
Hard rule: every matrix screen **YES** or overall **FAIL**.

## 1. Method

- Full PNG vision review for paired matrix: `01-registry`, `02-wizard`, `02b-wizard-step2`, `02c-wizard-step3`, `03-guide`, `04-drawer` (CRM + render).
- Freshness from INDEX.md: CRM matrix sha `5762d78ec05cc4ff` (01-registry), drawer `4e87f03ec4a49d80`; integrity pairs all ДА.
- Judged **visual craft** of Doc Hub surfaces on live twin (`:3100`, ~1642 rows). Shell chrome allowed but cannot substitute for surface craft.

## 2. Integrity table

| Check | Result | Evidence |
|-------|--------|----------|
| `03-guide` ≠ `04-drawer` (CRM) | **PASS** | sha16 `9fd4cfcc1ad5f694` vs `4e87f03ec4a49d80` |
| `03-guide` ≠ `04-drawer` (render) | **PASS** | sha16 `7a336549004b63f1` vs `b5c2a08290192da8` |
| Capture freshness | **PASS** | INDEX Captured `2026-10-05T20:11:40Z` |
| `02b` gold duplicate strip (CRM) | **PASS** | Gold alert «Похожий расход уже есть на объекте» + two actions |
| `04-drawer` sum hero (CRM) | **PASS** | Visible `.dh-sum-hero__main` **2 200 ₽** / net/VAT line with kopecks |

## 3. Per-screen craft: CRM лучше render?

| Screen | CRM beats render? | Evidence |
|--------|-------------------|----------|
| **01-registry** | **YES** | CRM: 7 live KPIs, quarter chips Q1–Q4 + year facets, sticky-ready «IV квартал 2026» section banner, green **Закрыто** vocabulary with visible **СУММА** (27 900 ₽ / 95 200 ₽), НДС pills, оплата «оплачен», SF «нет СФ/УПД», QA actions. Render demo is polished but static (~8 rows), no quarter system, weaker operational density. Live craft + quarters win. |
| **02-wizard** | **YES** | CRM type grid as four tiles (Счёт/СФ/УПД/Акт) + direction cards + Cancel/Back/Next hierarchy beats render checkbox row under Incoming. |
| **02b-wizard-step2** | **YES** | CRM sum-strip hero (2 200,00 / 1 803,28 / 396,72) + filled №/дата/контрагент + gold duplicate strip. Render step2 lacks the strip hero and leaves CP empty — CRM clearer for money craft. |
| **02c-wizard-step3** | **YES** | CRM contract-mode card grid (4 modes, selected gold «Без договора») + purpose toggles + payment/SF due fields + work id. Richer page-chrome parity than render’s denser but flatter step. |
| **03-guide** | **YES** | CRM six-card guide under full Doc Hub page chrome (eyebrow/title/actions Из 1С·В 1С·Внести) — calmer role tags and integrated hub chrome beat render’s isolated prototype frame. |
| **04-drawer** | **YES** | CRM drawer shows large gold-framed **2 200 ₽** sum hero + net/VAT kopecks + lifecycle + dense footer (В каталог / Склад / К оплате). Render drawer amounts exist but CRM hero + action density win on the acceptance criterion. |

## 4. YES/NO list

| Screen | YES/NO |
|--------|--------|
| 01-registry | **YES** |
| 02-wizard | **YES** |
| 02b-wizard-step2 | **YES** |
| 02c-wizard-step3 | **YES** |
| 03-guide | **YES** |
| 04-drawer | **YES** |

**Score:** 6/6 YES.

## 5. Final Verdict

**VERIFIED 10/10 — CRM лучше render по каждому экрану матрицы**

Artifacts: `tests/reports/doc-hub-visual/crm/*.png`, `render/*.png`, `INDEX.md`.
