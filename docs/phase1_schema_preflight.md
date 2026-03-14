# Phase 1 Schema Preflight

Date: 2026-03-13
Scope: documentation only, based on the live repository and live PostgreSQL schema on `/var/www/asgard-crm`

## 1. Current schema description

The current approval model is distributed across business tables. There is no centralized approval engine in the live schema.

Verified approval-bearing tables:

- `pre_tender_requests`: `status`, `decision_by`, `decision_at`, `decision_comment`, `reject_reason`, `approval_requested_by`, `approval_requested_at`, `approval_comment`, `assigned_to`, `created_tender_id`, `response_email_id`, `manual_documents`, `has_documents`.
- `training_applications`: `status`, `approved_by_head`, `approved_by_head_at`, `approved_by_dir`, `approved_by_dir_at`, `paid_by_buh`, `paid_by_buh_at`, `completed_by_hr`, `completed_by_hr_at`, `rejected_by`, `rejected_at`, `reject_reason`.
- `cash_requests`: `status`, `director_id`, `director_comment`, `issued_by`, `issued_at`, `received_at`, `closed_at`, `receipt_deadline`, `overdue_notified`.
- `tmc_requests`: `status`, `approved_by`, `approved_at`, `author_id`, plus order/delivery close statuses in route logic.
- `bonus_requests`: `status`, `approved_by`, `approved_at`, `processed_by`, `processed_at`, `decided_by_user_id`, `decided_at`, `director_comment`, `bonuses`, `bonuses_json`.
- `correspondence`: outgoing identifiers are stored in `number`; generation is not table-owned and is delegated to `correspondence_outgoing_seq` in backend code.

Verified attachment-bearing tables and fields:

- `documents`: generic file metadata for tender/work documents; linked by `tender_id`, `work_id`, `uploaded_by`; stores `filename`, `original_name`, `mime_type`, `size`, `download_url`, `file_url`.
- `email_attachments`: mailbox attachment metadata; linked by `email_id`; stores `filename`, `original_filename`, `file_path`, `mime_type`, `size`, `content_id`, `is_inline`, `thumbnail_path`, AI fields.
- `chat_attachments`: linked by `message_id`; live schema stores `filename`, `original_name`, `mime_type`, `size_bytes`, `uploaded_at`.
- `cash_expenses`: receipt linkage is inline on the row via `receipt_file`, `receipt_original_name`.
- `pre_tender_requests`: manual documents are not normalized into a table; they are stored as JSONB in `manual_documents` with disk paths under `uploads/pre_tenders/<id>/...`.

## 2. Involved tables and relationships

Primary relationships confirmed from live schema:

- `training_applications.user_id`, `approved_by_head`, `approved_by_dir`, `paid_by_buh`, `completed_by_hr`, `rejected_by` -> `users.id`.
- `cash_requests.user_id`, `director_id`, `issued_by` -> `users.id`; `cash_requests.work_id` -> `works.id`.
- `cash_expenses.request_id` -> `cash_requests.id` with `ON DELETE CASCADE`.
- `cash_returns.request_id` -> `cash_requests.id` with `ON DELETE CASCADE`; `confirmed_by` -> `users.id`.
- `tmc_requests.author_id`, `approved_by` -> `users.id`; `tmc_requests.tender_id` -> `tenders.id`.
- `bonus_requests.processed_by` -> `users.id`; no normalized child table exists for per-employee bonus lines because they are packed in JSONB.
- `pre_tender_requests.email_id` -> `emails.id` with `ON DELETE SET NULL`; `assigned_to`, `decision_by` -> `users.id`; `created_tender_id` -> `tenders.id`.
- `documents.tender_id` -> `tenders.id`; `documents.work_id` -> `works.id`; `documents.uploaded_by` -> `users.id`.
- `email_attachments.email_id` -> `emails.id` with `ON DELETE CASCADE`.
- `chat_attachments.message_id` -> `chat_messages.id` with `ON DELETE CASCADE`.
- `correspondence.email_id` -> `emails.id` with `ON DELETE SET NULL`; `correspondence.linked_inbox_application_id` -> `inbox_applications.id`; `correspondence.tender_id` -> `tenders.id`; `correspondence.work_id` -> `works.id`; `correspondence.created_by` -> `users.id`.

## 3. Explicit verification of known structural risks

1. Approval state distributed across entity tables instead of centralized approval engine: confirmed.
   Evidence: approval/status fields live in `pre_tender_requests`, `training_applications`, `cash_requests`, `tmc_requests`, `bonus_requests`; frontend `public/assets/js/approvals.js` and `public/assets/js/bonus_approval.js` still orchestrate some flows through generic `AsgardDB` writes.

2. Correspondence numbering relies on sequence `correspondence_outgoing_seq`: confirmed.
   Evidence: `src/routes/mailbox.js` and `src/routes/inbox_applications_ai.js` both call `SELECT nextval('correspondence_outgoing_seq')`; live sequence exists in PostgreSQL.

3. File access has dual paths: confirmed.
   Evidence: protected backend routes exist in `src/routes/files.js`, `src/routes/mailbox.js`, `src/routes/my-mail.js`, `src/routes/cash.js`; nginx also exposes `/var/www/asgard-crm/uploads/` directly under `/uploads/`.

4. Attachment flows are fragmented across modules: confirmed.
   Evidence: `documents`, `email_attachments`, `chat_attachments`, `cash_expenses.receipt_file`, `pre_tender_requests.manual_documents` all use different linkage and storage rules.

5. Attachment UI inconsistencies exist: confirmed.
   Evidence: `public/assets/js/approvals.js` renders direct links from `download_url || file_url`; `public/assets/js/mailbox.js` renders authenticated mailbox attachment pills; no unified attachment widget or approval-scoped file list exists for bonus or training flows.

6. Possible schema/runtime mismatch in `training_applications`: not confirmed in the live schema inspected on 2026-03-13.
   Evidence: live table columns match the route fields in `src/routes/training_applications.js`; user visibility checks also match the live `users.is_active` column.

7. Potential chat attachment schema mismatch: confirmed.
   Evidence: live `chat_attachments` table has `filename`, `original_name`, `size_bytes`, `uploaded_at`; `src/routes/chat_groups.js` route `POST /:id/upload` still inserts `file_name`, `file_path`, `file_size`, `created_at`, which do not exist in the live table.

## 4. Correspondence numbering and workflow state findings

- `correspondence.number` already has a partial unique index in the live schema, so numbering collisions should fail at insert time.
- The preview endpoint in `src/routes/mailbox.js` does not reserve a number. It reads `last_value` and `is_called`, so preview can become stale immediately under concurrency.
- No monthly reset logic was confirmed.
- No backend consumption of an admin-defined start value was confirmed.

## 5. Attachment flow map

- Generic tender/work documents:
  `/api/files/upload` -> disk `UPLOAD_DIR` (`./uploads`) -> row in `documents` -> protected download `/api/files/download/:filename`.
  Parallel exposure risk: nginx `/uploads/` alias points to the same disk tree.

- Shared mailbox attachments:
  IMAP/mail send ingestion -> row in `email_attachments` with `file_path` -> protected download `/api/mailbox/attachments/:id/download`.

- Personal mailbox attachments:
  same `email_attachments` table -> protected download `/api/my-mail/attachments/:id/download` with stricter account ownership join and path traversal guard.

- Chat attachments:
  `POST /api/chat-groups/:id/upload-file` -> disk `uploads/chat/<generated>` -> row in `chat_attachments` -> returned URL `/uploads/chat/<generated>`.
  Separate legacy route `POST /api/chat-groups/:id/upload` attempts metadata-only insert into mismatched columns.

- Cash receipts:
  `POST /api/cash/:id/expense` -> disk `UPLOAD_DIR/<receipt_...>` -> row in `cash_expenses` with `receipt_file` -> protected fetch `GET /api/cash/:id/receipt/:filename`.
  Parallel exposure risk: same underlying upload root is web-served by nginx.

- Pre-tender manual documents:
  `POST /api/pre-tenders/:id/upload-docs` -> disk `uploads/pre_tenders/<id>/<filename>` -> JSONB append into `pre_tender_requests.manual_documents`.
  No normalized attachment table or unified authorization layer exists.

- Training applications:
  no dedicated attachment table or upload route was confirmed.

- Bonus approvals:
  no dedicated attachment table or upload route was confirmed; the flow is status-and-JSON driven.

- TMC requests:
  no dedicated attachment table or upload route was confirmed in the inspected live route.

## 6. Migration risks

- Highest data-model risk: introducing centralized approval tables without a canonical mapping from the existing status/actor fields will create dual truth between legacy entity tables and new approval cases.
- Highest numbering risk: changing numbering semantics while `mailbox.js` and `inbox_applications_ai.js` still consume one global sequence will create preview drift or duplicate migration paths.
- Highest attachment risk: moving to protected file objects while nginx still serves `/uploads/` can leave some modules bypassing the new authorization path.
- Highest chat risk: the live `/api/chat-groups/:id/upload` path is already schema-drifted; any migration that assumes chat attachment integrity is complete will backfill bad or missing records.
- Highest bonus risk: `bonus_requests` contains status plus JSON payloads but no normalized action history, making precise backfill into case/step/action tables ambiguous.

## 7. Corruption scenarios

- Dual-write corruption: a new approval case is advanced, but the legacy entity row keeps an older `status`, `approved_by`, or `processed_by` field.
- Partial backfill corruption: one logical request creates an approval case without all historic actors/comments because legacy fields are sparse and inconsistent across modules.
- Attachment orphaning: a new file object is created for `documents` or `email_attachments`, but JSON-only pre-tender docs or cash receipt rows are not linked, producing silent file loss in approval views.
- Unauthorized exposure: a file is considered protected in the new model but remains reachable through nginx `/uploads/...`.
- Numbering split-brain: old routes keep consuming `correspondence_outgoing_seq` while a new per-period counter starts allocating independently.
- Chat backfill failure: schema-drifted chat attachment rows cannot be mapped consistently because one route records disk URLs and another expects relational metadata.

## 8. Rollback strategy for Phase 1 schema work

- Keep all legacy tables authoritative until backend approval orchestration is fully cut over.
- Make schema additions additive only in the first pass: create new tables and indexes without dropping or renaming legacy columns.
- Do not backfill destructive updates into legacy rows during Phase 1.
- Any future migration pack must record a checkpoint before DDL and include explicit reverse-order drops for new tables only.
- If a backfill is attempted later, write to mapping tables or append-only history first; do not overwrite legacy `status` fields in the same release.

## 9. Preflight conclusion

Phase 1 schema execution is not yet safe for direct implementation on production without a dry-run and an explicit legacy-to-new mapping matrix per module. The main blockers are distributed approval truth, fragmented attachments, and the confirmed chat attachment schema drift.
