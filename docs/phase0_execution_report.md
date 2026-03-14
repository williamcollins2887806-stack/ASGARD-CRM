# Phase 0 Execution Report

## 1. Root cause summary

- `public/assets/js/webauthn.js` and `public/assets/js/push-notifications.js` contained UTF-8 text that had already degraded into mojibake placeholders, so live mobile prompts and errors were unreadable.
- User-visible dates were rendered through ad hoc direct values (`deadline`, `created_at`, ISO strings, `toLocaleDateString`) instead of one shared UI formatter, which leaked raw ISO-like values into funnel, diagnostics, SLA messages, and WebAuthn device lists.
- `public/index.html` contained a destructive first-render service-worker purge path (`getRegistrations` + `unregister` + cache delete + forced reload), while `public/sw.js` also activated immediately with `skipWaiting`, which could produce a partial shell on first open and only appear fixed after refresh.

## 2. Files changed

- `public/assets/js/push-notifications.js`
- `public/assets/js/webauthn.js`
- `public/assets/js/ui.js`
- `public/assets/js/funnel.js`
- `public/assets/js/diag.js`
- `public/assets/js/sla.js`
- `public/index.html`
- `public/sw.js`
- `docs/codex_state.md`
- `docs/phase0_execution_report.md`

## 3. Mojibake fixes

- Restored Russian strings for WebAuthn support errors, biometric enrollment/login prompts, device management labels, delete confirmation text, and load-error messages.
- Restored Russian strings for Push notification enrollment bottom-sheet copy, status toasts, and fallback prompt text.
- Confirmed `????` no longer appears in the changed WebAuthn and Push frontend files.

## 4. Date formatting fixes

- Replaced the old `AsgardUI.formatDate` / `formatDateTime` implementation with a shared parser/formatter path that supports `DD.MM.YYYY`, `YYYY-MM-DD`, and `YYYY.MM.DD` output modes.
- Routed funnel deadline display through `AsgardUI.formatDate`.
- Routed diagnostic build time, last backup time, and audit timestamps through `AsgardUI.formatDateTime`.
- Replaced SLA user-facing deadline and reminder messages to use the shared formatter instead of raw ISO strings or direct `toLocaleDateString` calls.
- Routed WebAuthn device `created_at` and `last_used_at` display through the shared formatter.

## 5. Service worker / caching fixes

- Removed the destructive runtime purge/unregister/reload script from `public/index.html`.
- Added a shell version marker in `public/index.html` and updated versioned script URLs for the Phase 0 changed assets.
- Changed service-worker registration to `./sw.js?v=<shell-version>` and kept update handling behind the existing update banner instead of immediate forced takeover.
- Rewrote `public/sw.js` to use a versioned shell cache, aligned precached asset URLs with `index.html`, and removed immediate activation during install.
- Kept controlled activation through the existing `skipWaiting` message path so updates can still be applied intentionally without reload loops.

## 6. Verification steps

Commands run:
- `node --check /var/www/asgard-crm/public/assets/js/push-notifications.js`
- `node --check /var/www/asgard-crm/public/assets/js/webauthn.js`
- `node --check /var/www/asgard-crm/public/assets/js/ui.js`
- `node --check /var/www/asgard-crm/public/assets/js/funnel.js`
- `node --check /var/www/asgard-crm/public/assets/js/diag.js`
- `node --check /var/www/asgard-crm/public/assets/js/sla.js`
- `node --check /var/www/asgard-crm/public/sw.js`
- Inline `<script>` blocks extracted from `public/index.html` were parsed successfully with `node --check`.
- A repository scan for literal `????` found no remaining matches in the changed scoped files.

Manual verification still required:
- Open the CRM in a clean browser profile with service worker/cache cleared and verify the first load does not render a broken shell.
- Confirm that a normal cached session receives the update banner and updates cleanly after clicking `Обновить`.
- Confirm WebAuthn prompts, errors, and device list labels display normal Russian text.
- Confirm Push enrollment UI displays normal Russian text.
- Confirm funnel deadlines, diagnostics timestamps, SLA reminder text, and WebAuthn device dates render as `DD.MM.YYYY` or formatted date-time.

## 7. Remaining risks

- `public/assets/js/correspondence.js` still contains `АС-ИСХ-${year}-??????`; this was detected during the final scan but lies outside the exact Phase 0 file set from the task pack, so it was reported instead of changed automatically.
- No live browser session was available from the terminal, so service-worker first-load behavior and update-banner UX remain manually unverified.
- The emergency snapshot commit included pre-existing unrelated live-server changes, so rollback should use the Phase 0 backup tag/branch carefully and only for touched files if partial restore is needed.
