# Tender Registry — Analytics & KPI Audit Checklist

Updated: 2026-07-05. Tracks breakage after `registry_status`, TenderGuru, and registry sub-tabs.

Legend: **P0** critical · **P1** data drift · **P2** cosmetic/analytics · **FIXED** / **OPEN**

| ID | Surface | API / source | Expected | Issue | Pri | Status |
|----|---------|--------------|----------|-------|-----|--------|
| P0-1 | Tenders hub KPI «В работе ТО» | `index.jsx` client KPI | = sub-tab «В работе ТО» (`registry_status=подались`) | Was counting all ACTIVE_STATUSES | P0 | FIXED |
| P0-2 | `/personal-kanban` RBAC | `App.jsx` Protected roles | TO/HEAD_TO can open kanban | Route blocked TO | P0 | FIXED |
| P0-3 | Registry default view | `GET /registry` | Current month tenders | No period filter | P0 | FIXED |
| P0-4 | AlertBar jumpToBurn | `index.jsx` → RegistryTab | Show burn filter (≤3 days) | Opened registry without filter | P0 | FIXED |
| P1-1 | Kanban drag → registry | `personal-kanban.js` transition | Sync `registry_status` | Only `tender_status` updated | P1 | FIXED |
| P1-2 | Funnel / PUT status | `tenders.js` PUT `/:id/status` | Sync `registry_status` | Missing inverse map | P1 | FIXED |
| P1-3 | Registry → kanban cards | `tenders-registry.js` status patch | Card for готовим/подались | No card creation | P1 | FIXED |
| P1-4 | TO kanban scope | `personal-kanban.js` to_personal | Match `created_by` | Only `created_by_user_id` | P1 | FIXED |
| P1-5 | Hub «С площадок» filter | `index.jsx` visible | platform, email_invite, to_manual, tenderguru | Missing tenderguru/to_manual | P1 | FIXED |
| P1-6 | Hub period filter | `api.js` filterByPeriod | YYYY-MM, year:YYYY on `period` | Rolling 30d on created_at only | P1 | FIXED |
| P1-7 | Source filter UI | `api.js` SOURCE_OPTIONS | Include tenderguru | Missing option | P1 | FIXED |
| P2-1 | Home Funnel widget | `widgets/Funnel.jsx` | Registry-aware counts | Uses tender_status only | P2 | OPEN |
| P2-2 | TenderDynamics widget | `BusinessWidgets.jsx` | period field after import | May miss rows without period | P2 | OPEN |
| P2-3 | ToAnalytics | `/api/tenders/analytics/team` | registry buckets | tender_status buckets | P2 | OPEN |
| P2-4 | Mobile funnel widget | `TendersFunnelWidget.jsx` | Cyrillic statuses | Hardcoded EN stages | P2 | OPEN |
| P2-5 | Reports cron | `reports.js` | Cyrillic statuses | Legacy strings | P2 | OPEN |
| P2-6 | PlatformAlerts widget | `BusinessWidgets.jsx` | TenderGuru queue | Legacy integrations API | P2 | OPEN |
| P2-7 | KPI snapshot cron | `kpi-snapshot-cron.js` | registry_status | tender_status only | P2 | OPEN |

## Import pipeline

| Step | Command | Status |
|------|---------|--------|
| Assign period from Excel sheets | `npm run prepare:tender-import -- --out report.json` | READY |
| Dry-run vs CRM | `POST /api/tenders/registry/import` `{ dry_run: true }` | READY |
| Real import (after operator OK) | `{ dry_run: false, file_path: "..." }` | PENDING |

Matching rules: purchase_url → INN+title → name+title. Actions: new, duplicate_skip, duplicate_merge, conflict.

## Smoke after deploy

1. Open **Тендеры → Реестр** — default current month, period selector works (month/year/all).
2. KPI «В работе ТО» = badge on sub-tab «В работе ТО».
3. TO user opens **#/personal-kanban** — no AccessDenied.
4. AlertBar «Показать» — registry with burn filter only.
5. `npm run prepare:tender-import` — row count ~1100, audit summary printed.
6. Dry-run import on prod — review conflicts before `dry_run:false`.

## Notes

- Do **not** use `POST /registry/cleanup` for import prep — it soft-deletes all tenders without works.
- Registry KPI uses `registry_status`; legacy widgets still use `tender_status` (P2 backlog).
