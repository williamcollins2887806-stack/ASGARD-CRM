# CRM Target Architecture v2

Date: 2026-03-12
Source of truth: live server codebase at `/var/www/asgard-crm`, plus `docs/crm_audit_facts.md` and `docs/crm_audit_for_redesign.md`

## 1. Source of truth model

- Backend APIs plus backend permission logic are the source of truth for workflow state, allowed actions, attachment access, chat visibility, and outgoing number allocation.
- Frontend route visibility in `public/assets/js/app.js` and `public/assets/js/router.js` is UX only. It must not be treated as an authorization boundary.
- Existing module/permission infrastructure remains the coarse access layer: `modules`, `role_presets`, `user_permissions`.
- Entity-specific approvals must no longer be orchestrated from frontend code such as `public/assets/js/approvals.js` and `public/assets/js/bonus_approval.js`.
- Target rule: all approval orchestration is backend-only.

## 2. Authorization and participant model

- Keep current roles in scope; do not remove or merge roles as part of the redesign.
- Preserve module-level access control for major application areas.
- Introduce approval-participant access for workflow-specific actions.
- Approval participants are derived from:
  - initiator
  - current approver(s)
  - required business-role participant groups such as procurement or BUH
  - optional read-only observers if later approved by product owner
- Allowed approval actions must be determined from:
  - case state
  - active step
  - participant membership
  - backend permission/module access
- Frontend must request action availability from backend case detail, not infer it locally.

## 3. Approval core model

Recommended structure: one shared approval core with entity-specific workflow definitions.

### 3.1 Core tables

#### `approval_cases`

Purpose:
- one record per approval route attached to a business entity

Fields:
- `id`
- `entity_type`
- `entity_id`
- `workflow_key`
- `status`
- `initiator_user_id`
- `payment_required`
- `current_step_order`
- `current_step_type`
- `chat_id`
- `submitted_at`
- `completed_at`
- `cancelled_at`
- `created_at`
- `updated_at`

#### `approval_steps`

Purpose:
- per-case instantiated workflow steps

Fields:
- `id`
- `approval_case_id`
- `step_order`
- `step_type`
- `status`
- `assignment_mode`
- `assigned_role`
- `assigned_user_id`
- `started_at`
- `completed_at`
- `returned_at`
- `rejected_at`
- `metadata_json`

#### `approval_actions`

Purpose:
- immutable action history

Fields:
- `id`
- `approval_case_id`
- `approval_step_id`
- `actor_user_id`
- `action_type`
- `comment`
- `payload_json`
- `created_at`

#### `approval_events`

Purpose:
- feed, notification, audit-oriented events

Fields:
- `id`
- `approval_case_id`
- `event_type`
- `event_payload_json`
- `created_at`
- `created_by`

#### `approval_participants`

Purpose:
- explicit membership and access projection for the case

Fields:
- `id`
- `approval_case_id`
- `user_id`
- `participant_kind`
- `is_active`
- `added_by_rule`
- `created_at`
- `removed_at`

## 4. Entity-specific workflow definitions

### 4.1 Procurement / purchase

Target flow:
- initiator
- procurement
- director
- BUH payment
- payment order
- close

Recommended workflow projection:
- `draft`
- `submitted`
- `procurement_in_work`
- `director_pending`
- `director_approved`
- `accounting_pending`
- `payment_in_work`
- `paid`
- `fulfilled`
- `closed`

Notes:
- BUH stage is mandatory.
- Return from BUH sends the case back to initiator.
- Re-submission after BUH return must go through director again.

### 4.2 Cash / expense

Target flow:
- same approval path conceptually
- BUH only when `payment_required = true`

Recommended workflow projection:
- `draft`
- `submitted`
- `director_pending`
- `director_approved`
- `accounting_pending` only when payment is required
- `paid` only when accounting stage exists
- `completed`
- `closed`

### 4.3 Bonus

Target flow:
- same as cash / expense
- BUH only when `payment_required = true`

### 4.4 Training

Target flow:
- director only

Recommended workflow projection:
- `draft`
- `submitted`
- `director_pending`
- `director_approved`
- `closed`

### 4.5 Outgoing documents / letters

- Do not force standalone correspondence into the approval engine.
- Only create approval cases for outgoing documents when they belong to purchase/payment/expense approval context.

## 5. Accounting stage model

- Procurement always includes BUH.
- Cash / expense includes BUH only when `payment_required = true`.
- Bonus includes BUH only when `payment_required = true`.
- Training does not include BUH in the current approved business design.

Allowed BUH actions:
- accept into work
- mark paid
- attach payment order
- return to initiator

Return rule:
- BUH return reopens the route through initiator and then director again.
- Backend must enforce that the case cannot jump directly back to BUH after a return.

## 6. Attachment security architecture

This must be explicit and backend-owned.

### 6.1 Storage model

#### `file_objects`

Purpose:
- one canonical stored file object independent of business module

Fields:
- `id`
- `storage_driver`
- `storage_path`
- `stored_filename`
- `original_filename`
- `mime_type`
- `size_bytes`
- `checksum`
- `uploaded_by`
- `created_at`

#### `file_links`

Purpose:
- generic attachment link from file object to any domain entity

Fields:
- `id`
- `file_object_id`
- `entity_type`
- `entity_id`
- `link_kind`
- `created_by`
- `created_at`
- `is_locked`

#### `approval_attachment_links`

Purpose:
- explicit approval-scoped attachment membership and policy

Fields:
- `id`
- `approval_case_id`
- `file_link_id`
- `attachment_kind`
- `added_before_start`
- `is_payment_order`
- `created_at`

### 6.2 Authorization model

- No raw path guessing.
- No authorization by nginx public `/uploads` reachability.
- Access to approval-related files must be computed from approval participant membership.
- Protected backend endpoints must serve both preview and download.

Required endpoints:
- `GET /api/files/objects/:id/preview`
- `GET /api/files/objects/:id/download`
- `GET /api/approval-cases/:id/attachments`

Authorization rules:
- active approval participants may preview and download
- archived/terminal case participants may preview and download unless retention policy later narrows this
- uploader identity alone is not sufficient
- direct file path access is never sufficient

### 6.3 Lifecycle rules

- Nobody adds files after route start.
- Nobody deletes or replaces files after route start.
- One exception: BUH may add a payment order file.
- Chat files remain chat files and do not automatically become approval attachments.

## 7. Approval chat model

- Each approval case may own one linked approval chat.
- The chat is created when the case enters active approval processing.
- Chat membership is synchronized from `approval_participants`.
- Chat messages remain separate from case attachments.
- Chat files are allowed but do not auto-promote into approval attachments.
- On terminal state, the chat is archived/hidden from active worklists.
- Archived chat remains retained for history and audit.

## 8. Mail subsystem relationship

- Shared mailbox and personal mailbox remain separate subsystems.
- Keep their visibility models separate:
  - shared mailbox remains role-limited
  - personal mailbox remains user-account-owned
- Reuse common attachment preview/download primitives where appropriate.
- Approval cases may link to shared-mail threads or correspondence records for context.
- Mail must not become the approval engine.

## 9. ??? numbering model

Current live behavior:
- `src/routes/mailbox.js` allocates `??-???-YYYY-NNNNNN` using `correspondence_outgoing_seq`

Target behavior:
- format: `??? ??.??/?????`
- monthly reset
- admin-defined starting number
- uniqueness enforced on backend/DB level
- preview is non-reserving

Recommended data model:
- `outgoing_number_settings`
  - `period_yy_mm`
  - `start_value`
  - `updated_by`
  - `updated_at`
- `outgoing_number_counters`
  - `period_yy_mm`
  - `next_value`
  - `updated_at`

Allocation rule:
- final number is assigned only at backend commit time when the outgoing record is actually created/sent
- preview never reserves a number

## 10. Frontend integrity and service-worker policy

### 10.1 UTF-8 and mojibake policy

- Restore corrupted Russian strings before broader frontend rewrite.
- Treat encoding corruption as a release-integrity issue, not as a cosmetic cleanup.
- Require UTF-8-safe editing path for future server-side file modifications.

### 10.2 Date-rendering policy

- All user-visible dates must be rendered through one shared helper.
- Supported display formats:
  - `DD.MM.YYYY`
  - `YYYY.MM.DD`
- Raw ISO values must not be shown to users.

### 10.3 Service-worker and first-load policy

Target direction:
- versioned service-worker strategy
- cache name tied to deploy version
- no destructive runtime purge during active app render
- atomic shell deploy for `index.html`, `sw.js`, and critical shell assets

Required principles:
- remove one-off runtime purge logic after controlled stabilization deploy
- keep service-worker cache naming aligned with deployed shell asset version
- validate first-load behavior on clean sessions and after update
- do not allow partial shell state to render while a forced reload/purge is in flight
