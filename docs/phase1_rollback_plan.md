# Phase 1 Rollback Plan

Date: 2026-03-13
Scope: rollback planning for the future schema-only phase

## 1. Current schema and rollback context

Current production truth remains in legacy tables:

- Workflow state: `pre_tender_requests`, `training_applications`, `cash_requests`, `tmc_requests`, `bonus_requests`.
- Numbering: `correspondence.number` plus backend allocation through `correspondence_outgoing_seq`.
- Attachments: `documents`, `email_attachments`, `chat_attachments`, `cash_expenses`, `pre_tender_requests.manual_documents`.

Because the current system is already fragmented, rollback must preserve the legacy model as the authoritative fallback at all times.

## 2. Involved tables

Legacy tables to protect:

- `pre_tender_requests`
- `training_applications`
- `cash_requests`
- `cash_expenses`
- `cash_returns`
- `tmc_requests`
- `bonus_requests`
- `documents`
- `email_attachments`
- `chat_attachments`
- `correspondence`
- sequence `correspondence_outgoing_seq`

Future additive tables that must be individually reversible:

- `approval_cases`
- `approval_steps`
- `approval_actions`
- `approval_events`
- `approval_participants`
- `file_objects`
- `file_links`
- `approval_attachment_links`
- `outgoing_number_settings`
- `outgoing_number_counters`

## 3. Rollback triggers

Rollback must be executed if any of the following happen during future Phase 1 execution:

- new tables are created with wrong constraints or indexes
- backfill creates duplicate or missing approval cases
- file normalization produces missing or mismatched disk paths
- numbering preview or allocation becomes inconsistent with current `correspondence` behavior
- any live route starts reading the new tables before parity is proven

## 4. Rollback strategy

1. Use the pre-migration checkpoint created immediately before DDL.
   Required artifacts: git status snapshot, repo HEAD, migration SQL bundle, database schema dump, and if backfill is attempted, table-level row counts before execution.

2. Roll back in dependency order.
   Drop or disable runtime use of `approval_attachment_links` first, then `file_links`, then `approval_participants`, `approval_actions`, `approval_events`, `approval_steps`, `approval_cases`, `file_objects`, and only then the numbering helper tables if they were introduced.

3. Preserve all legacy tables and sequence state.
   `pre_tender_requests`, `training_applications`, `cash_requests`, `tmc_requests`, `bonus_requests`, `documents`, `email_attachments`, `chat_attachments`, `cash_expenses`, and `correspondence_outgoing_seq` must remain intact and queryable.

4. Do not rollback by inference.
   If any new table was partially used by runtime code, rollback must restore the exact checkpointed migration set, not a hand-written approximation.

5. Keep rollback append-safe.
   If backfill inserted rows into new tables, archive them before drop so the failure can be analyzed later.

## 5. Corruption scenarios and containment

- Duplicate case creation:
  Containment: disable writes to new approval tables, compare legacy entity ids against `approval_cases(entity_type, entity_id, workflow_key)`, then restore from checkpoint.

- Partial attachment normalization:
  Containment: stop file-object backfill, preserve legacy attachment reads, dump mismatched rows, and do not remove any old file path references.

- Numbering divergence:
  Containment: keep `correspondence_outgoing_seq` authoritative and drop only the new counter tables; never rewrite historical `correspondence.number` values.

- Chat attachment mismatch surfacing during backfill:
  Containment: exclude `chat_attachments` from migration scope and roll back only the attempted chat-related file-link rows.

- Legacy/new split-brain:
  Containment: revert any feature flag or runtime read path to legacy tables only, then inspect new tables offline.

## 6. Migration risks relevant to rollback

- The biggest rollback risk is not DDL itself; it is partial data movement from heterogeneous legacy models into a unified schema.
- JSON-based payloads in `bonus_requests.bonuses` and `pre_tender_requests.manual_documents` are especially vulnerable to lossy interpretation.
- Chat files are high risk because live route code already disagrees with the live table shape.
- Attachments under `./uploads` remain reachable both through backend routes and nginx aliasing, so rollback must account for authorization behavior as well as data rows.

## 7. Attachment flow map for rollback

Rollback must leave these legacy flows functional:

- `documents` -> `/api/files/download/:filename`
- `email_attachments` -> `/api/mailbox/attachments/:id/download`
- `email_attachments` -> `/api/my-mail/attachments/:id/download`
- `cash_expenses.receipt_file` -> `/api/cash/:id/receipt/:filename`
- `pre_tender_requests.manual_documents[*].path` -> current pre-tender UI link behavior
- `chat_attachments` and `/uploads/chat/...` -> current chat UI behavior, even if inconsistent

If any new file-object layer is added later, rollback must restore the above routes before dropping the new tables.

## 8. Practical rollback order

- Disable runtime reads from new approval/file/numbering tables.
- Stop any backfill or synchronization job.
- Export diagnostic dumps of the new tables.
- Drop new child tables first.
- Drop new parent tables next.
- Re-run smoke checks on legacy routes only.
- Confirm `correspondence` creation, mailbox attachment download, cash receipt download, and legacy approval screens still work.

## 9. Safe rollback judgment

Rollback is only safe if Phase 1 remains additive. If Phase 1 ever overwrites legacy statuses, rewrites attachment paths, or replaces `correspondence_outgoing_seq` before cutover verification, rollback safety drops sharply.
