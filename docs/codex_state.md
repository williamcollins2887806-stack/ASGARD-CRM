# Codex Phase 0 State

- current phase: Phase 0 complete
- tasks completed:
  - Verified live server path `/var/www/asgard-crm`
  - Created emergency snapshot commit
  - Created rollback tag
  - Created isolated working branch
  - Created full project tar backup
  - Created file-level backups for Phase 0 targets under `/var/www/asgard-crm/backups/20260313_012204`
  - Restored corrupted Russian UI strings in WebAuthn and Push notification flows
  - Introduced shared frontend date formatting and removed confirmed raw ISO leaks in scoped UI modules
  - Stabilized first-load shell behavior and aligned service-worker cache versioning
  - Completed required JS syntax checks for all changed scoped files
- tasks remaining:
  - Manual fresh-browser verification of first load, update flow, mojibake-free prompts, and formatted dates
  - Optional wider mojibake sweep outside the Phase 0 task-pack file set
- risks discovered:
  - Pre-existing unreviewed frontend changes were included in the emergency snapshot commit
  - `public/assets/js/correspondence.js` still contains a `????` placeholder outside the exact Phase 0 modification set
  - Live browser-level service worker behavior was not manually verified from the terminal session
- next step: Review `docs/phase0_execution_report.md` and perform the manual browser verification checklist on the live CRM

## 2026-03-13 Corrective Stabilization Pass

- current task: Corrective stabilization pass limited to src/routes, public/assets/js, public/assets/css, and template views if present
- scope:
  - Fix confirmed JS syntax/runtime defects in scoped frontend files
  - Normalize visible UI date rendering away from raw ISO strings
  - Repair broken file download link rendering and chat attachment runtime path mismatches without schema changes
  - Stabilize KPI/tender/correspondence/file-route behavior without changing approval logic or database schema
- risks:
  - Live repo contains pre-existing untracked backups/docs outside the corrective scope and they will remain untouched
  - Some attachment or numbering issues may still require backend or schema changes; these must be recorded instead of implemented in this pass
  - Validation is limited to source inspection, route hardening review, and 
ode --check for changed JS files from terminal access

## 2026-03-13 Narrow Runtime Follow-up

- current task: Harden file download runtime handling and finish chat attachment upload/render/download fixes only in `src/routes/files.js`, `src/routes/chat_groups.js`, and `public/assets/js/chat_groups.js`
- scope:
  - Validate unsafe file route params and block traversal outside the uploads storage base
  - Align `chat_attachments` reads/writes with the existing schema and return consistent attachment metadata without DB changes
  - Prevent blank or invalid chat attachment links in the frontend; render filename text when metadata is incomplete
- risks:
  - Existing chat attachment rows may contain incomplete metadata from earlier buggy writes; those rows will render without a link if no safe internal path can be derived
  - Validation remains terminal-only via `node --check`; no browser session is available for live click-through verification

## 2026-03-13 Live Corrective Follow-up

- current task: Resolve live browser syntax/cache defects and correspondence attachment truthfulness before Phase-1
- findings:
  - `public/assets/js/travel.js` is still syntactically broken on disk and over the live HTTPS asset path
  - `public/assets/js/kpi_money.js` and `public/assets/js/staff_schedule.js` are syntax-clean on disk, but the live shell still references them at immutable `?v=8.9.0` URLs
  - Live assets are served with `Cache-Control: public, immutable, max-age=2592000`, so unchanged asset URLs can keep stale broken JS active in browsers
  - `public/assets/js/correspondence.js` is still an IndexedDB-only flow with no existing attachment linkage to `documents` or another file relation in the current correspondence model
- risks:
  - Browser clients may keep stale JS until the affected asset URLs and service-worker shell version change
  - Real correspondence file attachment support requires backend/data-model linkage beyond this corrective UI pass; do not fake upload support

