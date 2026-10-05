# Doc Hub work-ready gate

**Date:** 2026-10-05  
**Shell:** 20.28.83 (deployed)

## Visual
- Independent `tests/reports/doc-hub-visual/VERIFIED.md`:  
  **VERIFIED 10/10 — CRM лучше render по каждому экрану матрицы** (6/6 YES)
- Drawer sum-hero live amounts; registry quarters + mixed statuses; wizard sum-strip

## Quarters
- API: `quarter` + `year` on `invoice_date`; default sort `invoice_date DESC`
- UI: chips 1–4 кв + year; section banners; sticky live quarter bar on scroll
- Hash query preserves `quarter`/`year`/`scope`

## Data (prod after apply)
- Rows: **1512** (soft-deleted near-dup renames)
- Exact/near dups: **0**
- `supplier_id`: **0 missing**
- DaData normalize: created **423** suppliers, linked **1514** updates, unmatched report **49** (mostly UI/test/odd spellings)
- Needs-manual Excel 37 remains excluded from “clean work” until Excel fixed (27 negative / 10 holes)

## Twin
- 1642/1642 with `supplier_id`; audit `tests/reports/doc-hub-excel/registry-audit.md`

## Ready to hand to people
Yes — with incomplete flags still high (purpose/owner/work gaps). Critical cells (number/date/CP/amount/supplier) are filled; use facets «Неполные» for the remaining backlog.
