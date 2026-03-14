# 1. Confirmed live runtime facts

- `confirmed from live production code`
  Runtime root: `/var/www/asgard-crm`.
- `confirmed from live production code`
  `systemd`: `/etc/systemd/system/asgard-crm.service` runs `User=ubuntu`, `WorkingDirectory=/var/www/asgard-crm`, `ExecStart=/usr/bin/node --dns-result-order=ipv4first src/index.js`, `Environment=NODE_ENV=production`.
- `confirmed from live production code`
  `nginx`: `/etc/nginx/sites-enabled/asgard-crm` serves `root /var/www/asgard-crm/public`, aliases uploads from `/var/www/asgard-crm/uploads/`, proxies app traffic to `http://127.0.0.1:3000`.
- `confirmed from live production code`
  `.env` at `/var/www/asgard-crm/.env` contains `PORT=3000`, `HOST=0.0.0.0`, `DB_HOST=localhost`, `DB_PORT=5432`, `DB_NAME=asgard_crm`, `DB_USER=asgard`, `UPLOAD_DIR=./uploads`.
- `confirmed from live production code`
  SSH verification succeeded with `root@92.242.61.184` using `C:\Users\Nikita-ASGARD\.ssh\asgard_crm_migrate`; remote returned `root / cv5977357.novalocal / /root`.

# 2. Stack and project map

- `confirmed from live production code`
  Backend stack: Node.js + Fastify. Evidence: `/var/www/asgard-crm/package.json`, `/var/www/asgard-crm/src/index.js`.
- `confirmed from live production code`
  Backend dependencies include `fastify`, `@fastify/jwt`, `@fastify/static`, `@fastify/multipart`, `pg`, `nodemailer`, `imapflow`, `mailparser`, `exceljs`, `pdfkit`, `web-push`, `@simplewebauthn/server`.
- `confirmed from live production code`
  Frontend stack: static SPA from `/var/www/asgard-crm/public` with plain browser JS under `/var/www/asgard-crm/public/assets/js`; hash router in `/var/www/asgard-crm/public/assets/js/router.js`; main app bootstrap in `/var/www/asgard-crm/public/assets/js/app.js`.
- `confirmed from live production code`
  No frontend framework build chain is visible in live app root; static assets are served directly by Fastify and nginx.
- `confirmed from live production code`
  Database: PostgreSQL via `/var/www/asgard-crm/src/services/db.js` and `pg`; schema migrations under `/var/www/asgard-crm/migrations`.
- `confirmed from live production code`
  Files/storage: local filesystem uploads under `./uploads` from `.env`; Fastify file APIs in `/var/www/asgard-crm/src/routes/files.js`; nginx also exposes `/var/www/asgard-crm/uploads/`.
- `confirmed from live production code`
  Realtime-related wiring exists via `/var/www/asgard-crm/src/routes/sse.js`, push subscriptions created in `/var/www/asgard-crm/src/index.js`, notification service in `/var/www/asgard-crm/src/services/NotificationService.js`, and chat unread/read timestamps in `chat_group_members`.
- `confirmed from live production code`
  Main backend entrypoint: `/var/www/asgard-crm/src/index.js`.
- `confirmed from live production code`
  Key backend directories: `/var/www/asgard-crm/src/routes`, `/var/www/asgard-crm/src/services`, `/var/www/asgard-crm/migrations`.
- `confirmed from live production code`
  Key frontend directories: `/var/www/asgard-crm/public/assets/js`, `/var/www/asgard-crm/public/assets/css`, `/var/www/asgard-crm/public/docs`.
- `confirmed from live production code`
  Route registration in `/var/www/asgard-crm/src/index.js` confirms active API modules: auth, users, pre-tenders, tenders, estimates, works, customers, expenses, incomes, calendar, staff, notifications, files, settings, reports, mimir, geo, email, acts, invoices, equipment, permissions, cash, tasks, permits, chat-groups, meetings, payroll, permit-applications, mailbox, my-mail, inbox-applications, integrations, sites, tkp, pass-requests, tmc-requests, sse, push, webauthn, training-applications, site-inspections, telephony.

# 3. Roles and permissions facts

- `confirmed from live production code`
  Base user role field is `users.role VARCHAR(50)` in `/var/www/asgard-crm/migrations/V001__initial_schema.sql`.
- `confirmed from live production code`
  Server-side hardcoded role inheritance in `/var/www/asgard-crm/src/index.js`:
  `HEAD_TO -> TO`, `HEAD_PM -> PM`, `HR_MANAGER -> HR`, `CHIEF_ENGINEER -> WAREHOUSE`, `ADMIN` bypass.
- `confirmed from live production code`
  Permission tables defined in `/var/www/asgard-crm/migrations/V001__initial_schema.sql`:
  `modules`, `user_permissions(user_id, module_key, can_read, can_write, can_delete, granted_by)`, `role_presets(role, module_key, can_read, can_write, can_delete)`, `user_menu_settings`.
- `confirmed from live production code`
  Permissions API in `/var/www/asgard-crm/src/routes/permissions.js` exposes `/modules`, `/presets`, `/user/:userId`, `/my`, `/apply-preset`, `/menu`.
- `confirmed from live production code`
  Auth/login payload also loads permissions from `user_permissions` or falls back to `role_presets` in `/var/www/asgard-crm/src/routes/webauthn.js`.
- `confirmed from live production code`
  Roles explicitly referenced in active live code include: `ADMIN`, `DIRECTOR_GEN`, `DIRECTOR_COMM`, `DIRECTOR_DEV`, `DIRECTOR`, `DIR`, `FIN_DIR`, `PM`, `HEAD_PM`, `TO`, `HEAD_TO`, `HR`, `HR_MANAGER`, `BUH`, `ACCOUNTANT`, `WAREHOUSE`, `CHIEF_ENGINEER`, `OFFICE_MANAGER`, `PROC`, `MANAGER`. Sources: `/var/www/asgard-crm/src/index.js`, `/var/www/asgard-crm/src/routes/*.js`, `/var/www/asgard-crm/src/services/mimir-data.js`, `/var/www/asgard-crm/src/services/voice-agent.js`, `/var/www/asgard-crm/public/assets/js/app.js`.
- `inferred but not proven`
  Not all listed roles are guaranteed to exist as active user rows in live DB; code only proves they are referenced.
- `confirmed from live production code`
  Frontend route gating is role-based in `/var/www/asgard-crm/public/assets/js/router.js` and `/var/www/asgard-crm/public/assets/js/app.js`.
- `confirmed from live production code`
  Frontend examples:
  `/approvals` allows `ADMIN`, `HEAD_PM`, directors; `/bonus-approval` allows `ADMIN`, `PM`, `HEAD_PM`, directors; `/cash-admin` allows `ADMIN`, `BUH`, directors; `/correspondence` allows `ADMIN`, `OFFICE_MANAGER`, `DIRECTOR_COMM`, `DIRECTOR_GEN`, `DIRECTOR_DEV`; `/mailbox` allows `ADMIN`, `DIRECTOR_GEN`, `DIRECTOR_COMM`, `DIRECTOR_DEV`, `HEAD_TO`; `/training` allows `ALL_ROLES`; `/messenger` allows `ALL_ROLES`. Source: `/var/www/asgard-crm/public/assets/js/app.js`.
- `confirmed from live production code`
  Backend modules gated by `requirePermission` include at least `cash`, `cash_admin`, `permits`, `permits_admin`, `tasks`, `tasks_admin`, `todo`, `chat_groups`, `works`. Source: `/var/www/asgard-crm/src/routes/cash.js`, `/var/www/asgard-crm/src/routes/permits.js`, `/var/www/asgard-crm/src/routes/tasks.js`, `/var/www/asgard-crm/src/routes/chat_groups.js`, `/var/www/asgard-crm/src/routes/site_inspections.js`.
- `confirmed from live production code`
  Backend modules gated by `requireRoles` include at least pre-tenders, tenders, estimates, works, sites, staff, training admin action, pass-requests, tmc-requests. Source: corresponding route files.
- `confirmed from live production code`
  Confirmed frontend vs backend mismatches:
  frontend `/mailbox` is limited to `ADMIN`, directors, `HEAD_TO` in `/public/assets/js/app.js`, but backend mailbox access also allows `HEAD_PM`, `PM`, `TO` in `/src/routes/mailbox.js`.
- `confirmed from live production code`
  Confirmed frontend vs backend mismatches:
  frontend `/cash-admin` uses role list `ADMIN`, `BUH`, directors in `/public/assets/js/app.js`, while backend uses modular permission `cash_admin` in `/src/routes/cash.js`.
- `confirmed from live production code`
  Confirmed frontend vs backend mismatches:
  frontend `/messenger` is open to `ALL_ROLES` in `/public/assets/js/app.js`, while backend chat endpoints require `chat_groups` module permissions for most read/write operations in `/src/routes/chat_groups.js`.
- `confirmed from live production code`
  Confirmed migration/schema mismatch:
  `/var/www/asgard-crm/migrations/V002__runtime_fixes.sql` still uses column name `module`, while live schema and runtime code use `module_key`.

# 4. Approval workflow facts

- `confirmed from live production code`
  Approval-like entities/files found:
  `/src/routes/pre_tenders.js`, `/src/routes/training_applications.js`, `/src/routes/cash.js`, `/src/routes/tmc_requests.js`, `/src/routes/pass_requests.js`, `/src/routes/permit_applications.js`, `/public/assets/js/approvals.js`, `/public/assets/js/bonus_approval.js`.
- `confirmed from live production code`
  `pre_tender_requests` flow in `/src/routes/pre_tenders.js` uses statuses `new`, `in_review`, `need_docs`, `pending_approval`, `accepted`, `rejected`, `expired`.
- `confirmed from live production code`
  `pre_tenders` transitions:
  update allowed only in `new|in_review|need_docs`; `/need-docs` sets `need_docs`; accept/assign-PM can move non-director action into `pending_approval`; directors can move to `accepted`; `/reject` moves to `rejected`; `/reject-approval` moves `pending_approval -> in_review`.
- `confirmed from live production code`
  `pre_tenders` initiators/approvers:
  TO/HEAD_TO/PM can request director approval; final approval for `pending_approval` is restricted to `ADMIN`, `DIRECTOR_GEN`, `DIRECTOR_COMM`, `DIRECTOR_DEV`.
- `confirmed from live production code`
  `pre_tenders` approval-like side effects:
  on acceptance it creates tender/work-linked records and can create outbound email + correspondence; on reject it can send rejection email. Source: `/src/routes/pre_tenders.js`.
- `confirmed from live production code`
  `training_applications` workflow in `/src/routes/training_applications.js`:
  `draft -> pending_approval -> approved -> budget_approved -> paid -> completed`, plus `rejected`.
- `confirmed from live production code`
  `training_applications` actors:
  author submits; `HEAD_PM|HEAD_TO|ADMIN|DIRECTOR_*` approve head stage; `DIRECTOR_GEN|ADMIN` approve budget; `BUH|ADMIN` confirm payment; `HR|HR_MANAGER|ADMIN` complete; rejection rights depend on current stage.
- `confirmed from live production code`
  `cash_requests` workflow in `/src/routes/cash.js`:
  table default `requested`; confirmed route transitions include `requested -> approved`, `requested|approved -> rejected`, `approved -> money_issued`, plus separate reporting/closing branches later in file.
- `confirmed from live production code`
  `cash_requests` actors:
  applicant creates request; `cash_admin write` approver approves/rejects/questions; BUH/director issues money; PM submits advance report via `/api/cash/:id/submit-report`.
- `confirmed from live production code`
  `tmc_requests` workflow in `/src/routes/tmc_requests.js`:
  statuses `draft`, `submitted`, `approved`, `rejected`, `ordered`, `delivered`, `closed`.
- `confirmed from live production code`
  `tmc_requests` actors:
  creator submits; on `submitted` notifications go to `ADMIN`, `DIRECTOR_GEN`, `DIRECTOR_COMM`, `BUH`; `approved/rejected` store `approved_by`, `approved_at`.
- `confirmed from live production code`
  `pass_requests` workflow in `/src/routes/pass_requests.js`:
  statuses `draft`, `submitted`, `approved`, `rejected`, `issued`, `expired`.
- `confirmed from live production code`
  `permit_applications` workflow in `/src/routes/permit_applications.js`:
  `STATUS_TRANSITIONS` defines `draft -> cancelled`, `sent -> in_progress|cancelled`, `in_progress -> completed|cancelled`; additional live endpoints also set `docs_requested`, `accepted`, `rejected`, urgent acceptance.
- `confirmed from live production code`
  `permit_applications` actors:
  access roles are `ADMIN`, directors, `HR`, `TO`, `HEAD_TO`, `HR_MANAGER`; type management is narrower; `/send` moves `draft -> sent`; history is written into `permit_application_history`.
- `confirmed from live production code`
  Separate premium approval UI exists on frontend in `/public/assets/js/bonus_approval.js`; separate generic approval screen exists in `/public/assets/js/approvals.js`.
- `inferred but not proven`
  No backend route named `approvals` was found; frontend `/approvals` appears to aggregate or display approval-related items from other modules rather than map to one backend workflow.

# 5. Payment/accounting facts

- `confirmed from live production code`
  Separate бухгалтерский шаг exists in `training_applications`: `budget_approved -> paid` by `BUH|ADMIN`, fields `paid_by_buh`, `paid_by_buh_at`. Source: `/src/routes/training_applications.js`.
- `confirmed from live production code`
  Separate бухгалтерский step exists in `cash`: approved request notifies `BUH`, then `BUH` or other `cash_admin write` actor issues money. Source: `/src/routes/cash.js`.
- `confirmed from live production code`
  Cash/accounting tables confirmed from live code:
  `cash_requests`, `cash_expenses`, `cash_returns`, `cash_balance_log`. Sources: `/src/index.js`, `/migrations/V033__cash_buh_enhancements.sql`, `/migrations/V035__cash_buh_enhancements.sql`.
- `confirmed from live production code`
  `cash_requests` includes accounting-related fields `director_comment`, `issued_by`, `issued_at`, `receipt_deadline`, `overdue_notified`, `received_at`, `closed_at`. Sources: `/src/index.js`, `V033`, `V035`.
- `confirmed from live production code`
  Invoice/payment module exists in `/src/routes/invoices.js`; payment records are stored in `invoice_payments`, and invoice status/paid amount are recalculated after adding payment.
- `confirmed from live production code`
  Procurement flow tied to payment is visible in `tmc_requests` only at notification/approval level; explicit payment step for TMC requests was not confirmed in active live route code inspected.
- `confirmed from live production code`
  Accountant feedback/comments confirmed:
  `cash_requests.director_comment` in cash workflow; `invoice_payments.comment` in invoices; `training_applications.reject_reason`; `permit_applications` history comment and `rejection_reason`.

# 6. Files/attachments facts

- `confirmed from live production code`
  Generic file upload/download API is `/api/files` in `/src/routes/files.js`.
- `confirmed from live production code`
  Generic uploads are stored on local disk under `UPLOAD_DIR` with generated UUID filenames; metadata is inserted into `documents`.
- `confirmed from live production code`
  Generic download API `/api/files/download/:filename` requires auth and resolves original name/mime type from `documents`.
- `confirmed from live production code`
  Generic file access restrictions in backend:
  list requires auth; delete is allowed only for uploader or `ADMIN`; download requires auth. Source: `/src/routes/files.js`.
- `confirmed from live production code`
  Generic attachments are linked to `tender_id` and `work_id` in `documents`. Cascading list mode can pull tender docs for work and work docs for tender.
- `confirmed from live production code`
  Entities confirmed using attachments/files:
  tenders/works via `documents`; emails via `email_attachments`; chats via `chat_attachments`; pre-tenders via email attachments plus manual docs; permit applications export/send as Excel attachment; invoices generate PDF.
- `confirmed from live production code`
  Mail attachments are stored in `email_attachments(filename, original_filename, mime_type, size, file_path, content_id, is_inline)` in `/migrations/V001__initial_schema.sql`.
- `confirmed from live production code`
  Chat attachments are stored in `chat_attachments` created in `/src/index.js`; chat upload endpoints are `/api/chat-groups/:id/upload` and `/api/chat-groups/:id/upload-file` in `/src/routes/chat_groups.js`.
- `confirmed from live production code`
  `upload-file` chat endpoint writes files to `/var/www/asgard-crm/uploads/chat` and returns URL `/uploads/chat/<name>`.
- `confirmed from live production code`
  Frontend download/open behavior is mostly `target="_blank"` or `window.open(...)` against `download_url`, `file_url`, or `/api/files/download/<filename>`. Sources: `/public/assets/js/tenders.js`, `/public/assets/js/pm_calcs.js`, `/public/assets/js/approvals.js`.
- `confirmed from live production code`
  Explicit preview support was confirmed for some UI modules and email compose previews, but a dedicated generic file-preview backend route was not found.

# 7. Chat facts

- `confirmed from live production code`
  Chat-related backend files: `/src/routes/chat_groups.js`, `/src/index.js` `ensureTables()`, `/src/services/NotificationService.js`.
- `confirmed from live production code`
  Chat tables created in live runtime code:
  `chats`, `chat_group_members`, `chat_messages`, `chat_attachments`.
- `confirmed from live production code`
  Chat types confirmed:
  `direct` and `group` in `chats.type`; `is_group` boolean; legacy `chat_type` also exists in `chat_messages`.
- `confirmed from live production code`
  Chat permissions:
  list/detail/messages mostly require `chat_groups` module permissions; direct-chat creation and file upload endpoints use only auth + membership checks.
- `confirmed from live production code`
  Member roles inside chats:
  `owner`, `admin`, `member` in `chat_group_members.role`.
- `confirmed from live production code`
  Chat operations confirmed:
  create direct chat, create group chat, update chat metadata, add/remove members, change member role, mute, archive, list messages, send/edit/delete message, reaction toggle, upload attachments, delete chat.
- `confirmed from live production code`
  Read tracking:
  `chat_group_members.last_read_at` is updated when loading messages.
- `confirmed from live production code`
  Notifications from chat go through DB notifications, web-push, and Telegram fallback. Source: `/src/routes/chat_groups.js`.
- `confirmed from live production code`
  Frontend routes:
  `/messenger` is the main chat route; `/chat-groups` and `/chat` redirect to `/messenger`. Source: `/public/assets/js/app.js`.
- `confirmed from live production code`
  No explicit code-level binding between chat groups and approval entities was confirmed; chat records do have generic `entity_id`/`entity_title` columns in `chat_messages`, but inspected active route logic uses `chat_id`-centric messaging.

# 8. Mail facts

- `confirmed from live production code`
  Mail-related backend files: `/src/routes/mailbox.js`, `/src/routes/my-mail.js`, `/src/routes/email.js`, `/src/services/imap.js`, `/src/services/email-classifier.js`, `/src/services/email-letterhead.js`, `/src/services/crm-mailer.js`.
- `confirmed from live production code`
  Mail storage tables in live schema:
  `email_accounts`, `emails`, `email_attachments`, `email_sync_log`, `email_templates_v2`, `email_classification_rules`, `user_email_accounts`, `correspondence`, `inbox_applications`.
- `confirmed from live production code`
  Shared mailbox access in `/src/routes/mailbox.js` allows `ADMIN`, directors, `HEAD_TO`, `HEAD_PM`, `PM`, `TO`.
- `confirmed from live production code`
  Personal mailbox access in `/src/routes/my-mail.js` is user-scoped and uses `user_email_accounts`.
- `confirmed from live production code`
  Mailbox routes confirmed:
  `/emails`, `/emails/:id`, flag updates, send flows, next outgoing number preview, AI reset, templates/rules/account management in mailbox; personal send/drafts/account flows in `my-mail`.
- `confirmed from live production code`
  Outbound shared mailbox send auto-registers outgoing correspondence and generates `АС-ИСХ-YYYY-NNNNNN` using `correspondence_outgoing_seq`. Source: `/src/routes/mailbox.js`.
- `confirmed from live production code`
  `correspondence` table is linked to `email_id`, `tender_id`, `work_id`, `linked_inbox_application_id`. Source: `/migrations/V001__initial_schema.sql`.
- `confirmed from live production code`
  `inbox_applications_ai` uses `correspondence_outgoing_seq` too when converting/acting on email-driven applications. Source: `/src/routes/inbox_applications_ai.js`.
- `confirmed from live production code`
  Frontend mail routes confirmed:
  `/mailbox`, `/my-mail`, `/mail-settings`, `/inbox-applications`, `/correspondence`.

# 9. Mobile-related facts

- `confirmed from live production code`
  Separate mobile codebase exists under `/var/www/asgard-crm/public/assets/js/mobile_v2`.
- `confirmed from live production code`
  Main app has two mobile behaviors in `/public/assets/js/app.js`:
  mobile layout inside main SPA for authenticated users, and `mobile_v2` handoff for a large set of routes through `mobileV2Routes`.
- `confirmed from live production code`
  `mobile_v2` files include `core.js`, `auth.js`, `dashboard.js`, `finance.js`, `sales.js`, `tasks.js`, `works.js`, `mimir.js`, `system.js`, `people.js`, `resources.js`, `analytics.js`.
- `confirmed from live production code`
  Explicit mobile-specific code also exists in non-`mobile_v2` modules: `chat_groups.js`, `mailbox.js`, `my_mail.js`, `tenders.js`, `pm_works.js`, `all_works.js`, `object_map.js`.
- `confirmed from live production code`
  `mobile_v2/system.js` contains hardcoded mobile version string `8.9.0 / mobile_v2 3.3.2`.
- `confirmed from live production code`
  Legacy-like indicators visible in live code:
  many `.bak*` JS files are present in `public/assets/js`; main app still contains broad mobile fallback logic plus separate `mobile_v2`; several modules keep width-based mobile branches instead of a single mobile entrypoint.

# 10. Outgoing numbering / ИСХ facts

- `confirmed from live production code`
  Outgoing number source is backend, not frontend reserve logic.
- `confirmed from live production code`
  `correspondence_outgoing_seq` is created in `/var/www/asgard-crm/migrations/V001__initial_schema.sql`.
- `confirmed from live production code`
  Real number generation occurs in `/src/routes/mailbox.js` and `/src/routes/inbox_applications_ai.js` using `SELECT nextval('correspondence_outgoing_seq')`.
- `confirmed from live production code`
  Number format is `АС-ИСХ-${year}-${String(seq).padStart(6, '0')}`.
- `confirmed from live production code`
  Frontend correspondence page only previews next number by calling `/api/mailbox/next-outgoing-number`; fallback preview is `АС-ИСХ-YYYY-??????`. Source: `/public/assets/js/correspondence.js`.
- `confirmed from live production code`
  `settings` table is not used in confirmed live numbering logic for outgoing correspondence generation.
- `confirmed from live production code`
  Monthly reset was not found in confirmed live numbering code; sequence is global, and year is only interpolated into formatted string.
- `confirmed from live production code`
  Duplicate protection for outgoing numbers was not found at code level: confirmed logic relies on sequence uniqueness and inserts into `correspondence`, but no unique constraint on `correspondence.number` was confirmed from inspected files.

# 11. Confirmed risks from current implementation

- `confirmed from live production code`
  Sensitive secrets are stored in plaintext in live `.env`, including JWT secret, DB password, VAPID keys, DaData tokens, Telegram bot token, telephony keys.
- `confirmed from live production code`
  Live `.env` uses weak-looking DB password value `123456789`.
- `confirmed from live production code`
  `nginx` directly exposes `/var/www/asgard-crm/uploads/` via alias while backend file API enforces auth; this creates two different access paths to uploaded files.
- `confirmed from live production code`
  Chat file uploads are written under `/uploads/chat` and returned as direct `/uploads/chat/<name>` URLs; this path sits under nginx uploads alias.
- `confirmed from live production code`
  Outgoing-number preview endpoint peeks sequence state without reserving number; preview can diverge from actual committed number under concurrent sends.
- `confirmed from live production code`
  Outgoing numbering has no confirmed monthly reset logic.
- `confirmed from live production code`
  No confirmed unique constraint on `correspondence.number`; sequence lowers duplicate risk but schema-level uniqueness was not confirmed.
- `confirmed from live production code`
  Migration/runtime inconsistency exists: `V002__runtime_fixes.sql` uses `module` while schema/runtime use `module_key`.
- `confirmed from live production code`
  Chat attachment schema drift exists: runtime create path uses columns `file_name/file_path/file_size/mime_type`, but `upload-file` path inserts `filename/original_name/size_bytes`.
- `confirmed from live production code`
  Frontend and backend access rules are not fully aligned for `mailbox`, `cash-admin`, and `messenger`, so UI visibility and backend authorization are not driven by one single source of truth.

# 12. Unknowns and gaps

- `confirmed from live production code`
  Actual live DB row contents for `modules`, `role_presets`, `user_permissions` were not inspected in this pass.
- `confirmed from live production code`
  Actual active user roster by role was not inspected; code references do not prove user existence.
- `confirmed from live production code`
  Full cash closing/report branch after `money_issued` was only partially inspected; presence of report endpoints is confirmed, but entire terminal-state map was not fully extracted in this pass.
- `confirmed from live production code`
  Generic file-preview support was not fully confirmed; download/open behavior is clear, but a universal preview backend route was not found.
- `confirmed from live production code`
  No factual claim in this report depends on local snapshot files; backup `.bak*` files were visible on the live host but not used as primary evidence unless explicitly stated.

# 13. Questions that require product-owner input

1. What are the authoritative business meanings of every user role referenced in code: `DIR`, `FIN_DIR`, `DIRECTOR`, `DIRECTOR_GEN`, `DIRECTOR_COMM`, `DIRECTOR_DEV`, `PROC`, `MANAGER`, `ACCOUNTANT`, `BUH`, `OFFICE_MANAGER`, `CHIEF_ENGINEER`, `WAREHOUSE`?
2. Which of those roles are реально действующие в production, and which are legacy or planned-only?
3. For `/mailbox`, should PM/TO/HEAD_PM have access as backend allows, or should frontend restriction remain narrower?
4. For `/messenger`, should access be universal for all authenticated users, or permission-module based only?
5. Is `approvals` meant to be a standalone business module or only an aggregate UI over other workflows?
6. What is the intended final state model for `cash_requests` after `money_issued`: receipt confirmed, report accepted, closed, overdue, partial return?
7. In `tmc_requests`, who is the formal approver for `approved/rejected/ordered/delivered/closed`, and does BUH approve or only observe?
8. In `pass_requests`, who may move status to `issued` and `expired`, and what event defines expiration operationally?
9. In `permit_applications`, which statuses are official business statuses: only `draft/sent/in_progress/completed/cancelled`, or also `docs_requested/accepted/rejected`?
10. For training applications, is `approved` the head-approval state and `budget_approved` the director state by design, or should naming reflect actor more explicitly?
11. For outgoing correspondence numbering, is reset expected yearly only, monthly, or never?
12. For outgoing correspondence numbering, is uniqueness required only de facto, or must it be enforced as a formal registry rule?
13. Which entities are allowed to expose attachments externally without auth, if any?
14. Is direct nginx access to `/uploads/` intentional for business users, or should files be treated as protected resources only?
15. Which mobile experience is the intended canonical one now: main SPA mobile layout, `mobile_v2`, or mixed mode by route?
