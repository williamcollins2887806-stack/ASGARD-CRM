# Codex Task Pack - Phase 0

Phase 0 scope only:
- UTF-8 / mojibake restoration
- ISO date leak cleanup foundation and sequence
- service-worker / first-load stabilization

No approval engine rewrite in this task pack.
No schema changes in this task pack.
No backend business workflow changes in this task pack.

## 1. Goals

Execution Codex must:
- restore corrupted Russian UI strings in active live frontend files
- eliminate confirmed raw ISO date leaks from active UI surfaces in scope
- introduce one shared UI date-formatting path for user-visible dates
- stabilize shell first-load behavior by fixing the service-worker / cache lifecycle path
- stop after Phase 0

## 2. Mandatory backup/checkpoint before edits

Execution Codex must do this first.

### 2.1 Git checkpoint

If `/var/www/asgard-crm` is a git repo:
- run `git status`
- run `git diff --stat`
- create a checkpoint branch, checkpoint commit, or patch bundle before edits

### 2.2 File backups

Create timestamped backups for every target file even if git exists.

Minimum required backup targets:
- `/var/www/asgard-crm/public/assets/js/push-notifications.js`
- `/var/www/asgard-crm/public/assets/js/webauthn.js`
- `/var/www/asgard-crm/public/assets/js/ui.js`
- `/var/www/asgard-crm/public/assets/js/funnel.js`
- `/var/www/asgard-crm/public/assets/js/diag.js`
- `/var/www/asgard-crm/public/assets/js/sla.js`
- `/var/www/asgard-crm/public/index.html`
- `/var/www/asgard-crm/public/sw.js`

Store backups under:
- `/var/www/asgard-crm/backups/<timestamp>/...`

## 3. Exact files to inspect

Required inspection set:
- `public/assets/js/push-notifications.js`
- `public/assets/js/webauthn.js`
- `public/assets/js/webauthn.js.bak.20260310_085404`
- `public/assets/js/ui.js`
- `public/assets/js/funnel.js`
- `public/assets/js/diag.js`
- `public/assets/js/sla.js`
- `public/index.html`
- `public/sw.js`
- git history for `public/assets/js/push-notifications.js` if needed for string restoration

Optional in-scope supporting inspection only if needed:
- other frontend files found by grep to still leak raw ISO dates after fixing the confirmed set

## 4. Exact files allowed to modify

Allowed modification set for Phase 0:
- `public/assets/js/push-notifications.js`
- `public/assets/js/webauthn.js`
- `public/assets/js/ui.js`
- `public/assets/js/funnel.js`
- `public/assets/js/diag.js`
- `public/assets/js/sla.js`
- `public/index.html`
- `public/sw.js`

Allowed expansion rule:
- if a shared helper requires one additional directly-related frontend file, stop and report before editing it unless it is clearly a no-risk helper dependency

## 5. Files forbidden to modify in Phase 0

Do not modify:
- any `src/routes/*` backend business modules
- any migrations
- any permission routes or role logic
- approval-engine code
- mail backend logic
- chat backend logic
- mobile redesign files
- unrelated desktop feature modules

## 6. Implementation sequence

### Step 1 - Restore mojibake

- scan active frontend for literal `????`
- restore `webauthn.js` strings from `webauthn.js.bak.20260310_085404`
- restore `push-notifications.js` strings from last known good git content and live context
- do not change feature behavior while restoring strings
- produce an inventory of restored strings

### Step 2 - Date formatting foundation

- inspect existing shared helper in `public/assets/js/ui.js`
- normalize it so all user-visible dates can go through one helper path
- preferred API direction:
  - `formatDate(value, mode)`
  - `formatDateTime(value)`
- supported display modes must include:
  - `dd.mm.yyyy`
  - `yyyy.mm.dd`

### Step 3 - Fix confirmed ISO leaks

At minimum fix confirmed leaks in:
- `public/assets/js/funnel.js`
- `public/assets/js/diag.js`
- `public/assets/js/sla.js`

Goal:
- no raw ISO strings shown to users on these pages/messages

### Step 4 - Stabilize first-load shell behavior

Required direction:
- remove destructive runtime purge logic from active first-render path in `index.html`
- align service-worker cache versioning with deploy version
- keep shell asset loading atomic enough to avoid first-render partial state
- preserve safe SW registration/update behavior without reload loops

Important:
- do not redesign the PWA
- only stabilize shell integrity and cache/update behavior

## 7. Syntax and verification commands

Execution Codex must run at minimum:
- `node --check /var/www/asgard-crm/public/assets/js/push-notifications.js`
- `node --check /var/www/asgard-crm/public/assets/js/webauthn.js`
- `node --check /var/www/asgard-crm/public/assets/js/ui.js`
- `node --check /var/www/asgard-crm/public/assets/js/funnel.js`
- `node --check /var/www/asgard-crm/public/assets/js/diag.js`
- `node --check /var/www/asgard-crm/public/assets/js/sla.js`
- if `sw.js` changes, run a JS syntax check on `public/sw.js` via Node-compatible parse path if possible

Required grep/verifications after edit:
- scan active frontend for remaining literal `????`
- grep for raw UI interpolation patterns still leaking `created_at`, `deadline`, `updated_at` directly in the changed files

Manual verification checklist:
- open clean browser session with cleared service worker/cache
- verify first load does not flash broken shell then self-correct only after refresh
- verify no mojibake in WebAuthn or Push UI
- verify funnel card deadline renders formatted date, not raw ISO
- verify diagnostic audit view does not show raw ISO timestamps directly
- verify SLA user-facing date message is formatted

## 8. Acceptance criteria

Phase 0 is accepted only if all are true:
- active mojibake strings in `push-notifications.js` and `webauthn.js` are restored
- no confirmed raw ISO leak remains in `funnel.js`, `diag.js`, `sla.js`
- changed date rendering goes through shared helper path
- first-load shell path no longer depends on destructive runtime purge during active render
- changed JS files pass syntax checks
- changed files are reported exactly
- backups/checkpoint are reported exactly

## 9. Rollback instructions

If any Phase 0 verification fails:
- restore the exact file backups for touched files from `/var/www/asgard-crm/backups/<timestamp>/...`
- or revert using the pre-task checkpoint commit/patch created before edits
- after rollback, report:
  - rollback method used
  - exact files restored
  - reason for rollback

## 10. Mandatory stop conditions

Execution Codex must stop and report instead of continuing if:
- original strings cannot be reconstructed from trusted source
- service-worker stabilization requires broader shell refactor than Phase 0 allows
- fixing date leaks safely requires a wider multi-module sweep beyond the allowed file set
- any change risks altering approval, mail, chat, or backend business logic
