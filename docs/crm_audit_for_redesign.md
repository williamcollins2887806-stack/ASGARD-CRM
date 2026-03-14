# 1. Executive summary

- Coverage labels used in this file:
  `confirmed from live production code`, `confirmed only from local snapshots`, `inferred but not proven`, `coverage incomplete / needs verification`.
- `confirmed from live production code`
  Current CRM is a Node.js + Fastify backend with PostgreSQL, static browser SPA frontend, generic `/api/data/*` CRUD layer, separate module routes, local filesystem uploads, nginx in front, and a mixed mobile layer (`main app mobile branches` + `mobile_v2`).
- `confirmed from live production code`
  The highest-risk redesign subsystems are:
  permissions/access control, approval workflows, files/attachments access, shared vs personal mail, chat attachment/auth model, mixed mobile architecture, and outgoing correspondence numbering.
- `confirmed from live production code`
  A major structural trait is that some business flows are backend-centered (`pre_tenders`, `training_applications`, `cash`, `permit_applications`, `tmc_requests`), while other approval-related UX uses the generic `AsgardDB`/`/api/data/*` layer from the frontend (`approvals.js`, `bonus_approval.js`).
- `coverage incomplete / needs verification`
  Actual live DB contents of `modules`, `role_presets`, `user_permissions`, and actual active users by role were not inspected; the redesign conclusions below rely on code-level truth, not live data distribution.

# 2. Stack and project map

- `confirmed from live production code`
  Backend entrypoint: `/var/www/asgard-crm/src/index.js`.
- `confirmed from live production code`
  Runtime wiring: systemd runs Node from `/var/www/asgard-crm`; nginx serves `/public`, proxies app traffic to `127.0.0.1:3000`, and aliases `/uploads/`.
- `confirmed from live production code`
  Backend: Fastify, JWT, multipart, static, rate-limit, PostgreSQL `pg`, IMAP/SMTP/mail parsing, PDF/Excel, web-push, WebAuthn.
- `confirmed from live production code`
  Frontend: static hash-routed SPA from `/public/assets/js`, no visible build step in live root.
- `confirmed from live production code`
  Data/storage layers now:
  module-specific route files in `/src/routes/*`, generic data API in `/src/routes/data.js`, local filesystem uploads under `./uploads`, PostgreSQL schema from `/migrations`.
- `confirmed from live production code`
  Mobile layers now:
  main SPA with mobile-specific branches plus separate `/public/assets/js/mobile_v2/*`.

# 3. Roles and permissions matrix

- `confirmed from live production code`
  Role field is `users.role`.
- `confirmed from live production code`
  Roles referenced in live code: `ADMIN`, `DIRECTOR_GEN`, `DIRECTOR_COMM`, `DIRECTOR_DEV`, `DIRECTOR`, `DIR`, `FIN_DIR`, `PM`, `HEAD_PM`, `TO`, `HEAD_TO`, `HR`, `HR_MANAGER`, `BUH`, `ACCOUNTANT`, `WAREHOUSE`, `CHIEF_ENGINEER`, `OFFICE_MANAGER`, `PROC`, `MANAGER`.
- `inferred but not proven`
  Code references do not prove that all those roles are populated by active users in production.
- `confirmed from live production code`
  Backend permission models currently coexist:
  role lists via `requireRoles`, module permissions via `requirePermission`, and generic table-level role matrix in `/src/routes/data.js`.
- `confirmed from live production code`
  Server-side role inheritance exists only in `requireRoles`/`requirePermission` logic:
  `HEAD_TO -> TO`, `HEAD_PM -> PM`, `HR_MANAGER -> HR`, `CHIEF_ENGINEER -> WAREHOUSE`, `ADMIN` bypass.
- `confirmed from live production code`
  Generic Data API role matrix in `/src/routes/data.js` grants broad table access by role, including direct CRUD access to tables such as `bonus_requests`, `qa_messages`, `documents`, `cash_*`, `permit_*`, `emails`, `email_attachments`, `correspondence`.
- `confirmed from live production code`
  Frontend gates are role-based in `/public/assets/js/app.js` and `/public/assets/js/router.js`.
- `confirmed from live production code`
  Backend module permissions are partly table-based (`/api/data/*`) and partly route/module-based (`cash`, `cash_admin`, `permits`, `chat_groups`, `tasks`, `todo`, etc.).

Actual role/access matrix by area:

- `confirmed from live production code`
  Shared mailbox:
  frontend route allows `ADMIN`, `DIRECTOR_GEN`, `DIRECTOR_COMM`, `DIRECTOR_DEV`, `HEAD_TO`;
  backend mailbox route allows those plus `HEAD_PM`, `PM`, `TO`.
- `confirmed from live production code`
  Messenger:
  frontend route is open to `ALL_ROLES`;
  backend chat routes mostly require `chat_groups` permission or membership.
- `confirmed from live production code`
  Cash admin:
  frontend route is role-gated to `ADMIN`, `BUH`, directors;
  backend route uses `cash_admin` permission.
- `confirmed from live production code`
  Approvals:
  frontend `/approvals` is gated to `ADMIN`, `HEAD_PM`, directors;
  no dedicated backend `/approvals` module was confirmed.
- `confirmed from live production code`
  Bonus approval:
  frontend `/bonus-approval` is gated to `ADMIN`, `PM`, `HEAD_PM`, directors;
  backend dedicated route was not confirmed.

Confirmed mismatches:

- `confirmed from live production code`
  Frontend `/mailbox` and backend mailbox access rules differ.
- `confirmed from live production code`
  Frontend `/messenger` uses broad route access, backend uses `chat_groups` permissions and membership checks.
- `confirmed from live production code`
  Frontend `/cash-admin` is role-list based, backend is module-permission based.
- `confirmed from live production code`
  Permissions persistence is structurally inconsistent because schema/runtime use `module_key`, but `V002__runtime_fixes.sql` still uses `module`.

Unclear areas:

- `coverage incomplete / needs verification`
  Actual live `role_presets` rows and `user_permissions` overrides.
- `coverage incomplete / needs verification`
  Whether `DIR`, `FIN_DIR`, `DIRECTOR_FIN`, `DIRECTOR_COM` are legacy, active, or typos relative to `DIRECTOR_GEN` / `DIRECTOR_COMM`.

# 4. Current approval workflows

Main confirmed workflow variants:

- `confirmed from live production code`
  `pre_tenders`:
  `new|in_review|need_docs` editable; non-director accept/assign escalates to `pending_approval`; directors move to `accepted`; reject moves to `rejected`; approval rejection returns `pending_approval -> in_review`.
- `confirmed from live production code`
  `pre_tenders` is the most backend-complete approval flow: roles, notifications, email side effects, tender creation, audit inserts, and correspondence linkage all exist in server routes.
- `confirmed from live production code`
  `training_applications`:
  `draft -> pending_approval -> approved -> budget_approved -> paid -> completed`, with stage-specific reject rights.
- `confirmed from live production code`
  `cash_requests`:
  `requested -> approved|rejected|question`;
  `question -> requested` via applicant reply;
  `approved|money_issued -> received`;
  `received -> reporting`;
  `reporting|received -> closed`;
  expenses and returns are attached during `received/reporting`.
- `confirmed from live production code`
  `tmc_requests`:
  `draft -> submitted -> approved|rejected -> ordered -> delivered -> closed`.
- `confirmed from live production code`
  `pass_requests`:
  statuses `draft`, `submitted`, `approved`, `rejected`, `issued`, `expired`.
- `confirmed from live production code`
  `permit_applications`:
  base transitions `draft -> cancelled`, `sent -> in_progress|cancelled`, `in_progress -> completed|cancelled`;
  extra live endpoints also set `docs_requested`, `accepted`, `rejected`, urgent acceptance.
- `confirmed from live production code`
  `approvals.js` frontend is not a thin client for one backend approval engine; it reads/writes `estimates`, `qa_messages`, `documents`, `notifications`, `audit_log` through `AsgardDB`/`/api/data/*`.
- `confirmed from live production code`
  `bonus_approval.js` frontend uses `bonus_requests`, `notifications`, `work_expenses`, `employees`, `employee_assignments` through `AsgardDB`/`/api/data/*`.

Workflow reconstruction implications:

- `confirmed from live production code`
  There is no single canonical approval engine.
- `confirmed from live production code`
  Approval logic is split across dedicated backend modules, generic data API writes, and frontend-only orchestration.
- `coverage incomplete / needs verification`
  No full live-state map was extracted for every approval-adjacent table consuming `/api/data/*`; some flows may exist without dedicated route files.

# 5. Payment/accounting logic

What exists now:

- `confirmed from live production code`
  Explicit accounting step exists in `training_applications`: `budget_approved -> paid` by `BUH|ADMIN`.
- `confirmed from live production code`
  Explicit accounting/cash handling exists in `cash_requests`, `cash_expenses`, `cash_returns`, `cash_balance_log`.
- `confirmed from live production code`
  Invoices support payment rows through `invoice_payments`, recalculated `paid_amount`, and invoice status updates.
- `confirmed from live production code`
  Payroll-related tables and bonus requests exist in schema and data API, but bonus approval orchestration is frontend-driven.

What is missing or fragmented:

- `confirmed from live production code`
  No unified accounting step exists across all approval families.
- `confirmed from live production code`
  `tmc_requests` has approval progression but no confirmed explicit payment/accounting stage.
- `confirmed from live production code`
  `pass_requests` and `permit_applications` do not show accounting steps in inspected live code.
- `coverage incomplete / needs verification`
  Whether procurement payments are handled elsewhere through `invoices`, `payment_registry`, or manual office flows was not confirmed from inspected route code.

Where an accounting/payment step can realistically be inserted in the current structure:

- `confirmed from live production code`
  `training_applications` already has a dedicated бухгалтерский stage and data fields.
- `confirmed from live production code`
  `cash_requests` already has post-approval, issuance, expense, return, and close phases.
- `confirmed from live production code`
  `tmc_requests` is the most natural existing procurement approval chain to extend because it already has `submitted/approved/ordered/delivered/closed`.
- `confirmed from live production code`
  `invoices` already carries payment events, but it is a separate accounting track, not an approval-stage engine.

Risks of adding accounting into current workflow:

- `confirmed from live production code`
  Role model is not unified; backend modules, data API, and frontend route gates may all need alignment.
- `confirmed from live production code`
  Some flows are backend-owned, others are generic-data/frontend-owned, so accounting insertion point is not consistent across modules.
- `confirmed from live production code`
  Existing role-name inconsistencies (`DIRECTOR_FIN`, `DIRECTOR_COM`, `active` vs `is_active`) increase risk of partial notification or access breakage.

# 6. Files, attachments, preview, download

How it works now:

- `confirmed from live production code`
  Generic uploads go through `/api/files/upload`, are stored in `documents`, and saved to local disk under `UPLOAD_DIR`.
- `confirmed from live production code`
  Generic downloads use `/api/files/download/:filename` with auth.
- `confirmed from live production code`
  Shared mailbox attachments use `/api/mailbox/attachments/:id/download` with mailbox-role check.
- `confirmed from live production code`
  Personal mail attachments use `/api/my-mail/attachments/:id/download` with user-account ownership check and path traversal protection.
- `confirmed from live production code`
  Chat files are uploaded via `/api/chat-groups/:id/upload-file` into `/uploads/chat`, then referenced as `/uploads/chat/<name>`.
- `confirmed from live production code`
  Frontend preview/open patterns are mostly direct `target="_blank"` or `window.open`, not a unified preview service.

Where auth is bypassed or duplicated:

- `confirmed from live production code`
  `nginx` exposes `/uploads/` directly, duplicating file access paths outside Fastify auth.
- `confirmed from live production code`
  Chat upload-file returns direct `/uploads/chat/...` links under that public alias.
- `confirmed from live production code`
  Generic documents have backend auth, but the same upload root is also web-served by nginx.
- `confirmed from live production code`
  Mail attachments stay on backend download endpoints; generic documents and chat files do not share one uniform access model.

What must change before approval-chain participants can safely see/download/preview files:

- `confirmed from live production code`
  Access must stop depending on raw file URL reachability.
- `confirmed from live production code`
  Attachment access must be bound to workflow participants, not only uploader identity or guessed path.
- `confirmed from live production code`
  Preview/download should use one authoritative authorization path across documents, chat files, and mail attachments.
- `confirmed from live production code`
  Attachment metadata models are not aligned today: `documents`, `email_attachments`, and `chat_attachments` use different structures and access paths.

# 7. Chat module audit

Current architecture:

- `confirmed from live production code`
  Backend chat is a standalone subsystem with `chats`, `chat_group_members`, `chat_messages`, `chat_attachments`.
- `confirmed from live production code`
  It supports direct chats, group chats, membership roles, mute, archive, reactions, edit/delete, notifications.
- `confirmed from live production code`
  Frontend main UI is `/public/assets/js/chat_groups.js`; route aliases `/chat` and `/chat-groups` redirect to `/messenger`.
- `confirmed from live production code`
  Frontend chat uses polling-style reloads and mobile-specific layout branches.

Attachment handling:

- `confirmed from live production code`
  Chat attachments are not unified with `documents`.
- `confirmed from live production code`
  One route stores metadata-only attachment references; another writes actual files under `/uploads/chat`.
- `confirmed from live production code`
  Schema/runtime drift exists between `chat_attachments` table creation and one insert path.

Permission model:

- `confirmed from live production code`
  Listing/details/messages mostly require `chat_groups` permission plus membership.
- `confirmed from live production code`
  Direct chat creation and upload endpoints are less aligned, using auth + membership checks instead of the same module permission wrapper.
- `confirmed from live production code`
  Frontend route accessibility is broader than backend permission enforcement.

Whether temporary approval chat is structurally feasible:

- `confirmed from live production code`
  Structurally feasible at a basic level because the system already has group chats, member roles, notifications, file upload, and unread tracking.
- `confirmed from live production code`
  Not first-class today because approval entities are not structurally bound to chats; active route logic is chat-centric, not approval-entity-centric.
- `confirmed from live production code`
  Safe temporary approval chat is blocked by current attachment exposure model and by permission inconsistencies between routes and module access.

# 8. Mail module audit

Current architecture:

- `confirmed from live production code`
  Mail is split into shared mailbox (`mailbox.js`) and personal mailbox (`my-mail.js`).
- `confirmed from live production code`
  Shared mailbox supports listing, detail, flagging, sending, templates/rules/accounts, AI-related flows, outgoing correspondence auto-registration.
- `confirmed from live production code`
  Personal mailbox is account-scoped per user and has separate attachment-download restrictions.

Access model:

- `confirmed from live production code`
  Shared mailbox uses mailbox-role gating at route level.
- `confirmed from live production code`
  Personal mailbox uses ownership via `user_email_accounts` / email ownership joins.
- `confirmed from live production code`
  Frontend and backend shared-mail access rules are not identical.

Attachment handling:

- `confirmed from live production code`
  Mail attachments are stored in `email_attachments` and downloaded via backend endpoints, not through nginx alias.
- `confirmed from live production code`
  Personal mail frontend renders image previews directly from authenticated attachment-download URLs.

Risks for mobile redesign:

- `confirmed from live production code`
  Mail has dedicated mobile branches in both `mailbox.js` and `my_mail.js`.
- `confirmed from live production code`
  Main app also routes mail through mixed mobile logic and `mobile_v2` handoff lists.
- `confirmed from live production code`
  Redesign risk is high because mail UI behavior is split across shared mailbox, personal mailbox, desktop panels, mobile overlays, and route-level mobile dispatch.

# 9. Mobile-related architecture audit

Current mobile layers:

- `confirmed from live production code`
  Layer 1: main SPA responsive/mobile branches in `app.js` and module files.
- `confirmed from live production code`
  Layer 2: `mobile_v2` codebase under `/public/assets/js/mobile_v2`.
- `confirmed from live production code`
  Route dispatch in `app.js` conditionally hands a long route list into mobile_v2 while keeping separate legacy/mobile branches in many modules.

mobile_v2 vs mixed/legacy behavior:

- `confirmed from live production code`
  `mobile_v2` is not the only mobile system; it coexists with module-specific mobile overlays and width-based behaviors.
- `confirmed from live production code`
  `mobile_v2/system.js` hardcodes version metadata, while other modules still maintain their own mobile behavior.
- `confirmed from live production code`
  Numerous `.bak*` files in live public JS suggest active/live iteration and overlapping mobile code paths.

Critical areas for manual QA:

- `confirmed from live production code`
  chat navigation and unread badge behavior;
- `confirmed from live production code`
  shared mailbox detail panel and attachment download on mobile;
- `confirmed from live production code`
  personal mail detail/compose overlays and attachment previews;
- `confirmed from live production code`
  route handoff boundaries between main SPA mobile mode and `mobile_v2`;
- `confirmed from live production code`
  files opened via new tabs or direct URLs from mobile routes.

# 10. Outgoing numbering / ИСХ audit

Current implementation:

- `confirmed from live production code`
  Real outgoing number generation is backend-only and sequence-based: `nextval('correspondence_outgoing_seq')` in `mailbox.js` and `inbox_applications_ai.js`.
- `confirmed from live production code`
  Format is `АС-ИСХ-YYYY-NNNNNN`.
- `confirmed from live production code`
  Frontend only previews the next number via `/api/mailbox/next-outgoing-number`.
- `confirmed from live production code`
  Live frontend settings UI already contains `correspondence_start_number` and claims yearly reset in `/public/assets/js/settings.js`.
- `confirmed from live production code`
  No inspected live backend code uses that setting for actual number generation.

Confirmed concurrency and integrity risks:

- `confirmed from live production code`
  Preview endpoint does not reserve a number, so preview can become stale immediately.
- `confirmed from live production code`
  No monthly reset logic was confirmed.
- `confirmed from live production code`
  No backend path for admin-defined start number was confirmed.
- `confirmed from live production code`
  No unique constraint on `correspondence.number` was confirmed from inspected schema.

What is missing for safe monthly reset and admin-defined start number:

- `confirmed from live production code`
  No confirmed persisted counter policy beyond one global sequence.
- `confirmed from live production code`
  No confirmed backend consumption of settings for numbering policy.
- `confirmed from live production code`
  No confirmed boundary between preview logic and committed allocation logic.

# 11. Risks and change map

- `roles/access redesign`
  Affected files/modules: `/src/index.js`, `/src/routes/permissions.js`, `/src/routes/data.js`, `/src/routes/cash.js`, `/src/routes/mailbox.js`, `/src/routes/chat_groups.js`, `/public/assets/js/app.js`.
  Risk level: High.
  Dependent entities: `users`, `modules`, `role_presets`, `user_permissions`, route guards, data API tables.
  Possible side effects: hidden pages becoming accessible or inaccessible, backend/frontend drift, broken notifications, broken mobile navigation assumptions.

- `approval-chain redesign`
  Affected files/modules: `/src/routes/pre_tenders.js`, `/src/routes/training_applications.js`, `/src/routes/cash.js`, `/src/routes/tmc_requests.js`, `/src/routes/pass_requests.js`, `/src/routes/permit_applications.js`, `/public/assets/js/approvals.js`, `/public/assets/js/bonus_approval.js`, `/src/routes/data.js`.
  Risk level: High.
  Dependent entities: `pre_tender_requests`, `training_applications`, `cash_requests`, `tmc_requests`, `pass_requests`, `permit_applications`, `bonus_requests`, `qa_messages`, `notifications`, `audit_log`.
  Possible side effects: duplicated approval state, broken cross-module reporting, frontend writing states backend no longer expects.

- `accounting/payment step`
  Affected files/modules: `/src/routes/training_applications.js`, `/src/routes/cash.js`, `/src/routes/invoices.js`, `/src/routes/tmc_requests.js`, `/src/routes/payroll.js`.
  Risk level: High.
  Dependent entities: `training_applications`, `cash_*`, `invoice_payments`, `bonus_requests`, payroll tables.
  Possible side effects: inconsistent close/paid states, notification drift, accounting step present in one module but bypassed in others.

- `shared approval attachments`
  Affected files/modules: `/src/routes/files.js`, `/src/routes/chat_groups.js`, `/src/routes/mailbox.js`, `/src/routes/my-mail.js`, nginx uploads alias, frontend `tenders.js`, `approvals.js`, `pm_calcs.js`.
  Risk level: High.
  Dependent entities: `documents`, `email_attachments`, `chat_attachments`, approval participants, uploads filesystem.
  Possible side effects: file visibility leaks, broken links, inability of approvers to preview/download after model changes.

- `preview/download model`
  Affected files/modules: `/src/routes/files.js`, `/src/routes/mailbox.js`, `/src/routes/my-mail.js`, nginx config, frontend viewers/openers.
  Risk level: High.
  Dependent entities: `documents`, `email_attachments`, uploads paths, browser/mobile open behavior.
  Possible side effects: new auth checks breaking direct links, inconsistent preview capability between modules.

- `temporary approval chat`
  Affected files/modules: `/src/routes/chat_groups.js`, `/src/index.js`, `/public/assets/js/chat_groups.js`, approval modules that would need linkage.
  Risk level: Medium-High.
  Dependent entities: `chats`, `chat_group_members`, `chat_messages`, `chat_attachments`, approval entities, notifications.
  Possible side effects: orphan chats, attachment access leaks, role mismatch between chat membership and workflow membership.

- `mobile redesign of chat/mail`
  Affected files/modules: `/public/assets/js/app.js`, `/public/assets/js/chat_groups.js`, `/public/assets/js/mailbox.js`, `/public/assets/js/my_mail.js`, `/public/assets/js/mobile_v2/*`.
  Risk level: High.
  Dependent entities: route dispatch, mail attachments, chat unread state, mobile overlays.
  Possible side effects: route-loop issues, missing back navigation, inconsistent attachment open/download behavior, duplicate mobile code paths surviving redesign.

- `new ИСХ numbering`
  Affected files/modules: `/src/routes/mailbox.js`, `/src/routes/inbox_applications_ai.js`, `/public/assets/js/correspondence.js`, `/public/assets/js/settings.js`, `correspondence`, `correspondence_outgoing_seq`.
  Risk level: High.
  Dependent entities: outgoing correspondence, outbound emails, settings, admin expectations for yearly/monthly numbering.
  Possible side effects: preview mismatch, numbering gaps, reset collisions, disagreement between UI settings and backend behavior.

# 12. Unknowns and assumptions

- `coverage incomplete / needs verification`
  Actual live `modules`, `role_presets`, and `user_permissions` rows.
- `coverage incomplete / needs verification`
  Actual role population in production and whether legacy role names are still used.
- `coverage incomplete / needs verification`
  Whether any attachments are intentionally meant to stay public through nginx `/uploads/`.
- `coverage incomplete / needs verification`
  Whether `DIRECTOR_FIN`, `DIRECTOR_COM`, `DIR`, `FIN_DIR` are active roles, aliases, or dead code.
- `coverage incomplete / needs verification`
  Whether any backend process besides inspected routes also issues outgoing correspondence numbers.
- `coverage incomplete / needs verification`
  Full operational semantics of procurement/accounting across `tmc_requests`, `payment_registry`, and `invoices`.
- `coverage incomplete / needs verification`
  Whether `/approvals` is considered an official workflow source of truth or only a manager convenience UI.
- `confirmed only from local snapshots`
  No architectural conclusion in this report depends solely on local snapshots; none were used as primary evidence for final findings.

# 13. Questions for product owner

1. Which role names are canonical and still active in production?
2. Which access model is authoritative when frontend role gates and backend permissions disagree?
3. Is `/approvals` intended to be a true source-of-truth workflow or only an aggregated director dashboard?
4. Is `bonus_approval` intended to remain a separate flow or become part of a unified approval engine?
5. For `tmc_requests`, who exactly approves, orders, receives, and closes?
6. For `cash_requests`, who is the formal closer: director, BUH, or both?
7. Which approval chains require an explicit accounting/payment stage?
8. Are uploaded files supposed to be private to workflow participants, or can some remain directly reachable?
9. Which mobile experience is the target baseline: `mobile_v2`, current mixed app, or a new unified layer?
10. For outgoing correspondence numbering, what is the required reset policy and who can change the start number?
