# Phase 1 Migration Plan

Date: 2026-03-13
Scope: planning only; no schema changes executed

## 1. Current schema baseline

Current production behavior is anchored in legacy business tables, not in a shared approval engine.

Relevant live tables:

- Approval-bearing: `pre_tender_requests`, `training_applications`, `cash_requests`, `tmc_requests`, `bonus_requests`, `correspondence`.
- Attachment-bearing: `documents`, `email_attachments`, `chat_attachments`, `cash_expenses`, `pre_tender_requests`.
- Relationship context: `emails`, `inbox_applications`, `chat_messages`, `chats`, `works`, `tenders`, `users`.

## 2. New tables proposed

Based on `docs/crm_target_architecture_v2.md`, the Phase 1 schema should add the following tables only:

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

No legacy table should be dropped, renamed, or made non-functional during this phase.

## 3. Planned relationships

- `approval_steps.approval_case_id` -> `approval_cases.id`.
- `approval_actions.approval_case_id` -> `approval_cases.id`; `approval_actions.approval_step_id` -> `approval_steps.id`.
- `approval_events.approval_case_id` -> `approval_cases.id`.
- `approval_participants.approval_case_id` -> `approval_cases.id`.
- `file_links.file_object_id` -> `file_objects.id`.
- `approval_attachment_links.approval_case_id` -> `approval_cases.id`; `approval_attachment_links.file_link_id` -> `file_links.id`.
- `outgoing_number_settings.period_yy_mm` and `outgoing_number_counters.period_yy_mm` should each be unique per period.

## 4. Stepwise migration plan

1. Create additive tables and indexes only.
   Do not touch existing approval columns or legacy attachment fields.

2. Create uniqueness and lookup indexes for the new schema.
   Minimum examples: `approval_cases(entity_type, entity_id, workflow_key)`, `approval_steps(approval_case_id, step_order)`, `approval_participants(approval_case_id, user_id, is_active)`, `file_links(entity_type, entity_id)`, `outgoing_number_counters(period_yy_mm)`.

3. Add a legacy mapping matrix before any data movement.
   Required mapping rows: one row per legacy module describing current entity id, source status field, actor fields, and attachment source.

4. Dry-run backfill outside production first.
   Backfill must be rehearsal-only until every module has a deterministic mapping.

5. Backfill append-only structures before any runtime cutover.
   First create `approval_cases`, `approval_steps`, `approval_actions`, and `approval_participants` from historical rows. Do not update the legacy row during this pass.

6. Backfill file metadata separately from approval cases.
   Normalize `documents`, `email_attachments`, `cash_expenses.receipt_file`, and pre-tender JSON docs into `file_objects` and `file_links`. Exclude chat files from approval attachment auto-linking.

7. Introduce outgoing numbering tables without changing live allocation.
   Populate `outgoing_number_settings` and `outgoing_number_counters` in parallel, but keep `correspondence_outgoing_seq` authoritative until backend cutover is implemented and tested.

8. Block runtime cutover until all named risks are closed.
   The schema phase ends when additive tables exist, mappings are proven, and rollback scripts are ready. It does not include switching live routes.

## 5. Legacy-to-target mapping notes

- `training_applications` maps cleanly to a multi-step case, but its legacy fields are scalar and lose some action history.
- `cash_requests` maps to a case plus expense/return sub-records; receipts belong in file normalization, not in approval step tables.
- `tmc_requests` maps to a procurement case, but the live route does not yet expose a separate accounting step.
- `bonus_requests` is the least normalized approval source because line items and parts of the approval context are packed into JSONB.
- `pre_tender_requests` is approval-like, but it also creates downstream tender/correspondence side effects; it should not be backfilled blindly into the same workflow key as finance modules.
- `correspondence` is not itself the approval engine; only approval-owned outgoing files/numbers should later link in.

## 6. Migration risks

- Centralized backfill may misrepresent legacy action order because many modules only store current actor columns, not immutable histories.
- `bonus_requests` and `pre_tender_requests.manual_documents` are structurally weak inputs for deterministic migration.
- Chat attachment data cannot be trusted until the schema/runtime mismatch is fixed or explicitly quarantined.
- File normalization may misclassify mailbox attachments, cash receipts, and JSON-only pre-tender docs if a single heuristic is used.
- Outgoing numbering cannot be cut over safely while legacy routes still call `correspondence_outgoing_seq`.

## 7. Corruption scenarios

- One business entity receives two approval cases because uniqueness rules were not enforced before backfill retry.
- A backfill writes a terminal status into `approval_cases` but leaves active participants/steps marked current.
- A file object points to a disk path that still remains publicly reachable through nginx, creating false confidence in protection.
- A cash receipt or pre-tender document is normalized without a stable entity link, producing orphan `file_links`.
- A new counter table allocates a number that disagrees with `correspondence.number`, breaking historical continuity.

## 8. Rollback strategy

- Rollback for the schema phase must be table-addition only: drop newly created tables in dependency order if and only if no runtime cutover used them.
- Preserve all legacy tables, indexes, sequences, and routes untouched during Phase 1.
- If rehearsal backfill tables contain data, archive them first to a dated dump before dropping them.
- If any new indexes on legacy tables are added later, rollback must drop only those indexes and must not modify legacy business data.
- Do not attempt to rewind `correspondence_outgoing_seq` as part of Phase 1 rollback because schema planning does not consume sequence values.

## 9. Attachment flow map for migration

Source to target mapping intended for later execution:

- `documents` -> `file_objects` + `file_links(entity_type='tender'|'work')`
- `email_attachments` -> `file_objects` + `file_links(entity_type='email')`
- `cash_expenses.receipt_file` -> `file_objects` + `file_links(entity_type='cash_expense')`
- `pre_tender_requests.manual_documents` -> `file_objects` + `file_links(entity_type='pre_tender_request')`
- `chat_attachments` -> `file_objects` + `file_links(entity_type='chat_message')`, but never auto-promote to `approval_attachment_links`
- approval-visible subset only -> `approval_attachment_links`

## 10. Go/no-go

Do not execute the migration plan on production until a staging dry-run proves:

- one deterministic mapping per legacy approval module
- a quarantine decision for bad chat attachment rows
- a file path inventory for every attachment source
- a numbering cutover strategy that keeps `correspondence.number` unique and historically consistent
