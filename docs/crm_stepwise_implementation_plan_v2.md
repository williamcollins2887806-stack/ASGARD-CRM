# CRM Stepwise Implementation Plan v2

Date: 2026-03-12
Scope: execution planning only

## Phase 0 - Integrity + stabilization

Goal:
- restore frontend text integrity
- eliminate raw ISO date leakage in UI
- stabilize first-load shell behavior and service-worker lifecycle

Likely modules/files touched:
- `public/assets/js/push-notifications.js`
- `public/assets/js/webauthn.js`
- `public/assets/js/ui.js`
- date-leaking modules such as `public/assets/js/funnel.js`, `public/assets/js/diag.js`, `public/assets/js/sla.js`
- `public/index.html`
- `public/sw.js`

DB risk:
- none expected

Rollback risk:
- medium for shell files because bad cache/SW edits can break first-load experience

Verification required:
- syntax checks for changed JS files
- manual fresh-load test with cleared SW/cache
- manual update-path test with an already-cached browser session
- UI spot check for mojibake and raw ISO dates

Stop conditions:
- if exact original Russian strings cannot be recovered from trusted backup/git/context
- if service-worker changes cannot be validated without rollout control
- if shell changes risk trapping users in a reload loop

## Phase 1 - Schema

Goal:
- create approval core schema, protected file schema, and outgoing numbering support schema

Likely modules/files touched:
- `migrations/*`
- schema/bootstrap logic in `src/index.js` only if required by current runtime conventions

DB risk:
- high

Rollback risk:
- high if migrations are not reversible or if live code assumes old schema only

Verification required:
- migration dry run on staging clone if available
- schema diff review
- rollback script or down-plan

Stop conditions:
- ambiguous mapping from existing live entity data to new approval structures
- missing uniqueness or indexing strategy

## Phase 2 - Backend approval engine

Goal:
- implement backend-owned approval orchestration with entity adapters

Likely modules/files touched:
- new approval service/module under `src/services` and/or `src/routes`
- adapters around `src/routes/cash.js`, `src/routes/tmc_requests.js`, `src/routes/training_applications.js`
- generic data/API touchpoints if current frontend-driven flows must be cut off

DB risk:
- medium to high

Rollback risk:
- high because partial dual-write behavior can corrupt workflow truth

Verification required:
- route-level tests or deterministic API verification scripts
- state-transition validation for procurement, cash, bonus, training
- action authorization checks

Stop conditions:
- if any flow still depends on frontend-only orchestration to remain functional
- if live action rights cannot be reproduced safely on backend

## Phase 3 - Protected file service

Goal:
- replace approval-visible raw-path access with backend-authorized preview/download

Likely modules/files touched:
- `src/routes/files.js`
- new file service modules
- `src/routes/chat_groups.js`
- `src/routes/mailbox.js`
- `src/routes/my-mail.js`
- possibly nginx follow-up plan, but not during unsafe mixed mode

DB risk:
- medium

Rollback risk:
- high if existing file links become unreadable

Verification required:
- preview/download checks for generic docs, mail attachments, chat files
- participant-based access checks
- explicit denial tests for unauthorized users

Stop conditions:
- if file-object mapping for legacy attachments is incomplete
- if nginx raw `/uploads` remains the only path for active business-critical files

## Phase 4 - Accounting step

Goal:
- add BUH stage behavior into the new approval engine

Likely modules/files touched:
- approval workflow service
- entity adapters for procurement, cash, bonus
- existing cash/payment touchpoints

DB risk:
- medium

Rollback risk:
- high if payment state can be double-recorded or skipped

Verification required:
- procurement always routes through BUH
- cash/bonus route through BUH only when `payment_required=true`
- return from BUH restarts through director again

Stop conditions:
- if current live payment records cannot be linked safely to approval states

## Phase 5 - Approval chat

Goal:
- bind approval cases to temporary participant-scoped chats

Likely modules/files touched:
- `src/routes/chat_groups.js`
- approval-chat link logic
- notification service
- frontend entry points later, but backend first

DB risk:
- medium

Rollback risk:
- medium

Verification required:
- chat created for active approval case
- participant sync works on step transitions
- archive state works on terminal case state
- chat files do not auto-become approval attachments

Stop conditions:
- if participant sync cannot be made deterministic
- if chat attachment auth still depends on raw `/uploads/chat/...`

## Phase 6 - ??? backend rewrite

Goal:
- replace current outgoing numbering sequence logic with monthly admin-configured backend allocation

Likely modules/files touched:
- `src/routes/mailbox.js`
- correspondence-related DB migrations
- possible helper/service for number allocation

DB risk:
- high

Rollback risk:
- high because numbering collisions are unacceptable

Verification required:
- uniqueness check under concurrent allocation
- monthly reset behavior
- admin start-value behavior
- preview remains non-reserving

Stop conditions:
- if uniqueness cannot be guaranteed transactionally
- if old numbering must be preserved with incompatible assumptions

## Phase 7 - Frontend approval UI

Goal:
- move approval UI from frontend-driven orchestration to backend-driven case views/actions

Likely modules/files touched:
- `public/assets/js/approvals.js`
- `public/assets/js/bonus_approval.js`
- related pages for procurement/cash/training approval visibility
- shared UI helpers

DB risk:
- none directly

Rollback risk:
- medium to high if frontend switches before backend parity exists

Verification required:
- UI only reflects backend case state
- no frontend state mutation remains as source of truth
- action buttons match backend-provided allowed actions

Stop conditions:
- if frontend still needs generic `/api/data/*` writes to keep approvals functional

## Phase 8 - Mail/chat/mobile integration

Goal:
- integrate stabilized approval, chat, file, and mailbox APIs into later mobile and surrounding UX layers

Likely modules/files touched:
- `public/assets/js/mailbox.js`
- `public/assets/js/my_mail.js`
- `public/assets/js/chat_groups.js`
- future canonical mobile client only after backend contracts are stable

DB risk:
- low to medium

Rollback risk:
- medium

Verification required:
- mail/chat consumers use protected attachment flows
- mobile consumes the same APIs as desktop
- no mobile-only workflow logic exists

Stop conditions:
- if backend API contracts are still unstable

## Phase 9 - Migration and rollout

Goal:
- migrate active data safely and cut over incrementally

Likely modules/files touched:
- migration scripts
- rollout feature flags
- compatibility adapters

DB risk:
- high

Rollback risk:
- high

Verification required:
- active case parity checks
- old-to-new link completeness checks
- controlled rollout checklist
- rollback plan tested before broad enablement

Stop conditions:
- mismatch between migrated live cases and legacy module truth
- unresolved access-control regressions
- unresolved file-visibility regressions
