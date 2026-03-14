# Phase 1 Attachment Flow Audit

Date: 2026-03-13
Scope: live repository and live PostgreSQL schema only

## 1. Current attachment schema description

There is no unified attachment subsystem. Current storage and linkage patterns are split across multiple tables and even JSON fields.

Current attachment-bearing structures:

- `documents`: generic tender/work files.
- `email_attachments`: shared and personal mailbox files.
- `chat_attachments`: chat message files.
- `cash_expenses.receipt_file`: cash receipt files.
- `pre_tender_requests.manual_documents`: JSONB list of uploaded docs with embedded relative paths.

No dedicated attachment tables were confirmed for:

- `training_applications`
- `bonus_requests`
- `tmc_requests`

## 2. Involved tables and relationships

- `documents` -> `tenders`, `works`, `users`.
- `email_attachments` -> `emails`.
- `chat_attachments` -> `chat_messages`.
- `cash_expenses` -> `cash_requests`.
- `pre_tender_requests` may point to `emails` and `tenders`, but its manual documents are not normalized.
- `correspondence` links to `emails`, `works`, `tenders`, and `inbox_applications`, but it is not a generic attachment table.

## 3. Flow map by module

### 3.1 Generic documents

- Upload endpoint: `POST /api/files/upload`.
- Storage path: `UPLOAD_DIR` / `./uploads` with generated UUID filename.
- Metadata row: `documents`.
- Download mechanism: `GET /api/files/download/:filename`.
- Preview mechanism: no dedicated generic preview endpoint was confirmed.
- Linkage pattern: `tender_id`, `work_id`, `uploaded_by`; frontend often opens `download_url` or `file_url` directly.

### 3.2 Shared mailbox attachments

- Attachment source: IMAP ingestion and outbound mail flows.
- Metadata row: `email_attachments`.
- Storage path: relative `file_path` on disk.
- Download mechanism: `GET /api/mailbox/attachments/:id/download`.
- Preview mechanism: frontend opens the authenticated download URL in a new tab.
- Linkage pattern: `email_id`; optional inline metadata via `content_id` and `is_inline`.

### 3.3 Personal mailbox attachments

- Same physical table: `email_attachments`.
- Download mechanism: `GET /api/my-mail/attachments/:id/download`.
- Authorization model: joins through the user-owned mail account and checks path traversal.
- Linkage pattern: `email_id` + personal account ownership.

### 3.4 Chat attachments

- Route A: `POST /api/chat-groups/:id/upload-file`.
  Stores the file under `uploads/chat/<generated>` and inserts a row into `chat_attachments(filename, original_name, mime_type, size_bytes)`.

- Route B: `POST /api/chat-groups/:id/upload`.
  Tries to insert `file_name`, `file_path`, `file_size`, `created_at` into `chat_attachments`.

- File access mechanism: returned URL `/uploads/chat/<generated>`.
- Preview/download mechanism: direct public URL under nginx alias, not a protected backend file endpoint.
- Linkage pattern: `chat_attachments.message_id` -> `chat_messages.id`.

### 3.5 Cash receipts

- Upload endpoint: `POST /api/cash/:id/expense`.
- Storage path: `UPLOAD_DIR` / `./uploads` with generated `receipt_<uuid>` filename.
- Metadata row: `cash_expenses.receipt_file`, `cash_expenses.receipt_original_name`.
- Download mechanism: `GET /api/cash/:id/receipt/:filename`.
- Preview mechanism: route returns the raw file with inferred MIME type; no unified file object exists.
- Linkage pattern: file path embedded directly on `cash_expenses`.

### 3.6 Pre-tender manual documents

- Upload endpoint: `POST /api/pre-tenders/:id/upload-docs`.
- Storage path: `uploads/pre_tenders/<id>/<filename>`.
- Metadata storage: appended JSON objects in `pre_tender_requests.manual_documents` and `has_documents=true`.
- Download/preview mechanism: no normalized protected file route confirmed in the inspected code; frontend reads the JSON metadata.
- Linkage pattern: embedded JSON on the business row.

### 3.7 Training applications

- No upload endpoint confirmed.
- No attachment table confirmed.
- No preview/download mechanism confirmed.

### 3.8 Bonus approvals

- No upload endpoint confirmed.
- No attachment table confirmed.
- No preview/download mechanism confirmed.

### 3.9 TMC requests

- No dedicated attachment endpoint confirmed in the inspected route.
- No module-specific attachment table confirmed.

## 4. Verified structural risks

- Dual file access path: confirmed.
  Generic uploads and chat files reside under disk paths reachable through nginx `/uploads/`, while some modules also expose protected backend routes.

- Fragmented attachment flows: confirmed.
  The system mixes relational attachment tables, inline path fields, and JSONB arrays.

- Attachment UI inconsistency: confirmed.
  `approvals.js` uses direct links from document metadata, `mailbox.js` renders attachment pills from authenticated URLs, and several approval modules have no attachment UX at all.

- Chat attachment schema mismatch: confirmed.
  One upload route matches the live table, another writes non-existent columns.

## 5. Migration risks

- Files in the same physical upload root have different authorization rules depending on module.
- Some attachment metadata is normalized (`email_attachments`), some semi-normalized (`documents`), some embedded (`manual_documents`, `receipt_file`).
- Direct `/uploads/chat/...` links bypass any future approval participant authorization unless nginx exposure is changed.
- Pre-tender documents are especially risky because their metadata lives in JSONB rather than a table with foreign keys.
- Cash receipts are risky because they are not represented in a generic attachment table and share the same upload root as web-served files.

## 6. Corruption scenarios

- A normalized backfill misses JSON-only pre-tender docs, causing silent attachment loss.
- A future protected file layer is introduced, but legacy frontend still opens stale `file_url` or `/uploads/...` links.
- Chat files are duplicated or lost because two routes record different metadata shapes.
- Cash receipt rows survive, but the physical file path changes without synchronized row updates.
- Approval participants gain access through a new file service, while the same file remains publicly reachable through nginx aliasing.

## 7. Rollback strategies

- Keep every legacy attachment route operational until the new file-object layer is fully proven.
- Do not rewrite or delete legacy path fields during the first migration pass.
- Exclude chat attachments from automatic normalization until the schema/runtime mismatch is resolved or explicitly mapped.
- Normalize pre-tender JSON attachments only after path inventory and integrity checks per row.
- Preserve `documents`, `email_attachments`, `cash_expenses`, and `pre_tender_requests.manual_documents` as fallback read sources during rollout.

## 8. Recommended containment before implementation

- Quarantine the broken `POST /api/chat-groups/:id/upload` path in implementation planning.
- Treat nginx `/uploads` exposure as a blocker for approval-grade file protection.
- Add a per-source attachment inventory step before any file-object backfill.
- Keep training, bonus, and TMC attachment modeling explicit in the redesign because no current attachment contract exists for them.
