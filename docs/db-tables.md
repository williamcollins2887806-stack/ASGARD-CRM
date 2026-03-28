# ASGARD CRM — Database Schema
_Updated: 2026-03-28_

## `active_calls`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `mango_call_id` | `character varying` | NO |
| `mango_entry_id` | `character varying` | YES |
| `direction` | `character varying` | NO |
| `from_number` | `character varying` | YES |
| `to_number` | `character varying` | YES |
| `caller_name` | `character varying` | YES |
| `caller_company` | `character varying` | YES |
| `client_inn` | `character varying` | YES |
| `assigned_user_id` | `integer` | YES |
| `call_state` | `character varying` | YES |
| `started_at` | `timestamp with time zone` | YES |
| `connected_at` | `timestamp with time zone` | YES |
| `metadata` | `jsonb` | YES |

## `acts`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `act_number` | `character varying` | YES |
| `act_date` | `date` | YES |
| `status` | `character varying` | YES |
| `work_id` | `integer` | YES |
| `customer_name` | `character varying` | YES |
| `customer_inn` | `character varying` | YES |
| `amount` | `numeric` | YES |
| `vat_pct` | `integer` | YES |
| `total_amount` | `numeric` | YES |
| `signed_date` | `date` | YES |
| `paid_date` | `date` | YES |
| `notes` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `created_by` | `integer` | YES |
| `act_type` | `character varying` | YES |
| `vat_amount` | `numeric` | YES |
| `file_path` | `text` | YES |
| `contract_id` | `integer` | YES |
| `description` | `text` | YES |
| `customer_id` | `integer` | YES |

## `ai_analysis_log`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `entity_type` | `character varying` | NO |
| `entity_id` | `integer` | NO |
| `analysis_type` | `character varying` | YES |
| `prompt_tokens` | `integer` | YES |
| `completion_tokens` | `integer` | YES |
| `total_tokens` | `integer` | YES |
| `model` | `character varying` | YES |
| `provider` | `character varying` | YES |
| `duration_ms` | `integer` | YES |
| `input_preview` | `text` | YES |
| `output_json` | `jsonb` | YES |
| `error` | `text` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `approval_payment_slips`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `request_id` | `integer` | NO |
| `source_type` | `character varying` | NO |
| `source_id` | `integer` | NO |
| `document_id` | `integer` | NO |
| `comment` | `text` | NO |
| `uploaded_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | NO |

## `assembly_items`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `assembly_id` | `integer` | NO |
| `equipment_id` | `integer` | YES |
| `procurement_item_id` | `integer` | YES |
| `pallet_id` | `integer` | YES |
| `name` | `character varying` | NO |
| `article` | `character varying` | YES |
| `unit` | `character varying` | YES |
| `quantity` | `numeric` | NO |
| `source` | `character varying` | NO |
| `packed` | `boolean` | YES |
| `packed_at` | `timestamp without time zone` | YES |
| `packed_by` | `integer` | YES |
| `return_status` | `character varying` | YES |
| `return_reason` | `text` | YES |
| `received` | `boolean` | YES |
| `received_at` | `timestamp without time zone` | YES |
| `received_by` | `integer` | YES |
| `sort_order` | `integer` | YES |
| `notes` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `assembly_orders`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `work_id` | `integer` | NO |
| `type` | `character varying` | NO |
| `status` | `character varying` | NO |
| `title` | `character varying` | YES |
| `object_name` | `character varying` | YES |
| `destination` | `character varying` | YES |
| `planned_date` | `date` | YES |
| `actual_sent_at` | `timestamp without time zone` | YES |
| `actual_received_at` | `timestamp without time zone` | YES |
| `source_assembly_id` | `integer` | YES |
| `notes` | `text` | YES |
| `created_by` | `integer` | NO |
| `confirmed_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `assembly_pallets`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `assembly_id` | `integer` | NO |
| `pallet_number` | `integer` | NO |
| `qr_uuid` | `uuid` | NO |
| `label` | `character varying` | YES |
| `status` | `character varying` | YES |
| `capacity_items` | `integer` | YES |
| `capacity_kg` | `numeric` | YES |
| `packed_at` | `timestamp without time zone` | YES |
| `shipped_at` | `timestamp without time zone` | YES |
| `received_at` | `timestamp without time zone` | YES |
| `received_by` | `integer` | YES |
| `scanned_lat` | `numeric` | YES |
| `scanned_lon` | `numeric` | YES |
| `notes` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `audit_log`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `actor_user_id` | `integer` | YES |
| `entity_type` | `character varying` | YES |
| `entity_id` | `integer` | YES |
| `action` | `character varying` | YES |
| `details` | `jsonb` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `payload_json` | `jsonb` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `bank_classification_rules`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `pattern` | `character varying` | NO |
| `match_field` | `character varying` | YES |
| `direction` | `character varying` | YES |
| `article` | `character varying` | NO |
| `category_1c` | `character varying` | YES |
| `work_id` | `integer` | YES |
| `priority` | `integer` | YES |
| `usage_count` | `integer` | YES |
| `is_system` | `boolean` | YES |
| `is_active` | `boolean` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `bank_import_batches`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `filename` | `character varying` | YES |
| `source_format` | `character varying` | YES |
| `total_rows` | `integer` | YES |
| `new_rows` | `integer` | YES |
| `duplicate_rows` | `integer` | YES |
| `auto_classified` | `integer` | YES |
| `manual_needed` | `integer` | YES |
| `status` | `character varying` | YES |
| `imported_by` | `integer` | YES |
| `error_message` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `bank_rules`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `pattern` | `character varying` | YES |
| `type` | `character varying` | YES |
| `article` | `character varying` | YES |
| `counterparty` | `character varying` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `bank_transactions`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `import_hash` | `character varying` | YES |
| `external_id` | `character varying` | YES |
| `batch_id` | `integer` | YES |
| `transaction_date` | `date` | NO |
| `amount` | `numeric` | NO |
| `direction` | `character varying` | NO |
| `currency` | `character varying` | YES |
| `counterparty_name` | `character varying` | YES |
| `counterparty_inn` | `character varying` | YES |
| `counterparty_kpp` | `character varying` | YES |
| `counterparty_account` | `character varying` | YES |
| `counterparty_bank_bik` | `character varying` | YES |
| `our_account` | `character varying` | YES |
| `our_bank_bik` | `character varying` | YES |
| `payment_purpose` | `text` | YES |
| `description` | `text` | YES |
| `document_number` | `character varying` | YES |
| `document_date` | `date` | YES |
| `article` | `character varying` | YES |
| `article_confidence` | `character varying` | YES |
| `category_1c` | `character varying` | YES |
| `work_id` | `integer` | YES |
| `tender_id` | `integer` | YES |
| `linked_income_id` | `integer` | YES |
| `linked_expense_id` | `integer` | YES |
| `status` | `character varying` | YES |
| `source_format` | `character varying` | YES |
| `source_filename` | `character varying` | YES |
| `imported_by` | `integer` | YES |
| `confirmed_by` | `integer` | YES |
| `confirmed_at` | `timestamp without time zone` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `bonus_requests`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `work_id` | `integer` | YES |
| `pm_id` | `integer` | YES |
| `employee_id` | `integer` | YES |
| `amount` | `numeric` | YES |
| `reason` | `text` | YES |
| `status` | `character varying` | YES |
| `approved_by` | `integer` | YES |
| `approved_at` | `timestamp without time zone` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `comment` | `text` | YES |
| `pm_name` | `character varying` | YES |
| `work_title` | `character varying` | YES |
| `total_amount` | `numeric` | YES |
| `currency` | `character varying` | YES |
| `director_comment` | `text` | YES |
| `processed_by` | `integer` | YES |
| `processed_at` | `timestamp without time zone` | YES |
| `bonuses` | `jsonb` | YES |
| `bonuses_json` | `jsonb` | YES |
| `decided_at` | `timestamp without time zone` | YES |
| `decided_by_user_id` | `integer` | YES |
| `requires_payment` | `boolean` | YES |
| `payment_method` | `character varying` | YES |
| `payment_status` | `character varying` | YES |
| `payment_comment` | `text` | YES |
| `payment_doc_id` | `integer` | YES |
| `buh_id` | `integer` | YES |
| `buh_acted_at` | `timestamp without time zone` | YES |

## `business_trips`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `inspection_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `status` | `character varying` | NO |
| `date_from` | `date` | YES |
| `date_to` | `date` | YES |
| `employees_json` | `jsonb` | YES |
| `transport_type` | `character varying` | YES |
| `need_fuel_card` | `boolean` | YES |
| `need_air_ticket` | `boolean` | YES |
| `need_advance` | `boolean` | YES |
| `advance_amount` | `numeric` | YES |
| `ticket_details` | `text` | YES |
| `cash_request_id` | `integer` | YES |
| `expense_ids` | `jsonb` | YES |
| `author_id` | `integer` | YES |
| `sent_to_office_manager` | `boolean` | YES |
| `office_manager_notified_at` | `timestamp without time zone` | YES |
| `approved_by` | `integer` | YES |
| `approved_at` | `timestamp without time zone` | YES |
| `notes` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `requires_payment` | `boolean` | YES |
| `payment_method` | `character varying` | YES |
| `payment_status` | `character varying` | YES |
| `payment_comment` | `text` | YES |
| `buh_id` | `integer` | YES |

## `calendar_events`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `date` | `date` | NO |
| `time` | `character varying` | YES |
| `type` | `character varying` | YES |
| `title` | `character varying` | NO |
| `description` | `text` | YES |
| `participants` | `text` | YES |
| `reminder_minutes` | `integer` | YES |
| `reminder_sent` | `boolean` | YES |
| `tender_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `all_day` | `boolean` | YES |
| `location` | `character varying` | YES |
| `color` | `character varying` | YES |
| `status` | `character varying` | YES |
| `notes` | `text` | YES |
| `dates_json` | `jsonb` | YES |
| `confirmed_at` | `timestamp without time zone` | YES |
| `end_date` | `date` | YES |
| `end_time` | `time without time zone` | YES |
| `is_all_day` | `boolean` | YES |
| `recurrence` | `text` | YES |

## `call_history`

| Column | Type | Nullable |
|--------|------|----------|
| `call_id` | `character varying` | NO |
| `caller_number` | `character varying` | YES |
| `called_number` | `character varying` | YES |
| `direction` | `character varying` | YES |
| `status` | `character varying` | YES |
| `duration` | `integer` | YES |
| `recording_url` | `text` | YES |
| `timestamp` | `timestamp without time zone` | YES |
| `user_id` | `integer` | YES |
| `customer_id` | `character varying` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `id` | `integer` | NO |
| `mango_entry_id` | `character varying` | YES |
| `mango_call_id` | `character varying` | YES |
| `from_number` | `character varying` | YES |
| `to_number` | `character varying` | YES |
| `started_at` | `timestamp with time zone` | YES |
| `ended_at` | `timestamp with time zone` | YES |
| `duration_seconds` | `integer` | YES |
| `call_type` | `character varying` | YES |
| `record_path` | `text` | YES |
| `recording_id` | `character varying` | YES |
| `transcript` | `text` | YES |
| `transcript_status` | `character varying` | YES |
| `transcript_segments` | `jsonb` | YES |
| `ai_summary` | `text` | YES |
| `ai_is_target` | `boolean` | YES |
| `ai_lead_data` | `jsonb` | YES |
| `ai_sentiment` | `character varying` | YES |
| `lead_id` | `integer` | YES |
| `client_inn` | `character varying` | YES |
| `dadata_region` | `character varying` | YES |
| `dadata_operator` | `character varying` | YES |
| `dadata_city` | `character varying` | YES |
| `missed_task_id` | `integer` | YES |
| `missed_acknowledged` | `boolean` | YES |
| `missed_callback_at` | `timestamp with time zone` | YES |
| `webhook_payload` | `jsonb` | YES |
| `line_number` | `character varying` | YES |
| `disconnect_reason` | `character varying` | YES |
| `updated_at` | `timestamp with time zone` | YES |

## `call_routing_rules`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `name` | `character varying` | NO |
| `description` | `text` | YES |
| `priority` | `integer` | YES |
| `condition_type` | `character varying` | NO |
| `condition_value` | `jsonb` | NO |
| `action_type` | `character varying` | NO |
| `action_value` | `jsonb` | NO |
| `is_active` | `boolean` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp with time zone` | YES |
| `updated_at` | `timestamp with time zone` | YES |

## `cash_balance_log`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `amount` | `numeric` | NO |
| `change_amount` | `numeric` | YES |
| `change_type` | `character varying` | YES |
| `description` | `text` | YES |
| `related_request_id` | `integer` | YES |
| `user_id` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `cash_expenses`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `request_id` | `integer` | NO |
| `amount` | `numeric` | NO |
| `description` | `text` | NO |
| `receipt_file` | `character varying` | YES |
| `receipt_original_name` | `character varying` | YES |
| `expense_date` | `date` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `category` | `character varying` | YES |

## `cash_messages`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `request_id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `message` | `text` | NO |
| `created_at` | `timestamp without time zone` | YES |

## `cash_requests`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `work_id` | `integer` | YES |
| `type` | `character varying` | NO |
| `amount` | `numeric` | NO |
| `purpose` | `text` | NO |
| `cover_letter` | `text` | YES |
| `status` | `character varying` | NO |
| `director_id` | `integer` | YES |
| `director_comment` | `text` | YES |
| `received_at` | `timestamp without time zone` | YES |
| `closed_at` | `timestamp without time zone` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `issued_by` | `integer` | YES |
| `issued_at` | `timestamp without time zone` | YES |
| `receipt_deadline` | `timestamp without time zone` | YES |
| `overdue_notified` | `boolean` | YES |
| `requires_payment` | `boolean` | YES |
| `payment_status` | `character varying` | YES |
| `sent_for_approval_at` | `timestamp with time zone` | YES |

## `cash_returns`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `request_id` | `integer` | NO |
| `amount` | `numeric` | NO |
| `note` | `text` | YES |
| `confirmed_by` | `integer` | YES |
| `confirmed_at` | `timestamp without time zone` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `chat_attachments`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `message_id` | `integer` | NO |
| `file_name` | `character varying` | NO |
| `original_name` | `character varying` | NO |
| `mime_type` | `character varying` | YES |
| `file_size` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `file_path` | `character varying` | YES |

## `chat_group_members`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `chat_id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `role` | `character varying` | YES |
| `muted_until` | `timestamp without time zone` | YES |
| `last_read_at` | `timestamp without time zone` | YES |
| `joined_at` | `timestamp without time zone` | YES |

## `chat_messages`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `chat_id` | `integer` | YES |
| `user_id` | `integer` | YES |
| `message` | `text` | YES |
| `attachments_json` | `text` | YES |
| `is_read` | `boolean` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `chat_type` | `character varying` | YES |
| `sender_id` | `integer` | YES |
| `sender_name` | `character varying` | YES |
| `text` | `text` | YES |
| `timestamp` | `timestamp without time zone` | YES |
| `read_by` | `jsonb` | YES |
| `entity_id` | `integer` | YES |
| `entity_title` | `text` | YES |
| `to_user_id` | `integer` | YES |
| `user_name` | `character varying` | YES |
| `user_role` | `character varying` | YES |
| `attachments` | `jsonb` | YES |
| `mentions` | `jsonb` | YES |
| `is_system` | `boolean` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `read_at` | `timestamp without time zone` | YES |
| `entity_type` | `text` | YES |
| `created_by` | `integer` | YES |
| `reply_to_id` | `integer` | YES |
| `edited_at` | `timestamp without time zone` | YES |
| `deleted_at` | `timestamp without time zone` | YES |
| `reactions` | `jsonb` | YES |
| `reply_to` | `integer` | YES |
| `attachment_path` | `text` | YES |
| `attachment_name` | `text` | YES |
| `message_type` | `text` | YES |
| `file_url` | `text` | YES |
| `file_duration` | `integer` | YES |
| `waveform` | `jsonb` | YES |

## `chats`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `type` | `character varying` | YES |
| `name` | `character varying` | YES |
| `entity_type` | `character varying` | YES |
| `entity_id` | `integer` | YES |
| `participants_json` | `text` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `is_group` | `boolean` | YES |
| `avatar` | `character varying` | YES |
| `description` | `text` | YES |
| `is_readonly` | `boolean` | YES |
| `archived_at` | `timestamp without time zone` | YES |
| `last_message_at` | `timestamp without time zone` | YES |
| `message_count` | `integer` | YES |
| `avatar_path` | `text` | YES |
| `is_mimir` | `boolean` | YES |

## `contracts`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `number` | `character varying` | YES |
| `type` | `character varying` | YES |
| `counterparty_id` | `character varying` | YES |
| `counterparty_name` | `character varying` | YES |
| `subject` | `text` | YES |
| `amount` | `numeric` | YES |
| `start_date` | `date` | YES |
| `end_date` | `date` | YES |
| `status` | `character varying` | YES |
| `file_path` | `text` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `tender_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `is_perpetual` | `boolean` | YES |
| `is_indefinite` | `boolean` | YES |
| `vat_pct` | `integer` | YES |
| `signed_date` | `date` | YES |
| `customer_inn` | `character varying` | YES |
| `customer_name` | `character varying` | YES |
| `comment` | `text` | YES |
| `currency` | `character varying` | YES |
| `file_url` | `text` | YES |
| `responsible` | `character varying` | YES |

## `correspondence`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `direction` | `character varying` | NO |
| `date` | `date` | YES |
| `number` | `character varying` | YES |
| `counterparty` | `character varying` | YES |
| `subject` | `text` | YES |
| `content` | `text` | YES |
| `tender_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `doc_type` | `character varying` | YES |
| `file_path` | `text` | YES |
| `status` | `character varying` | YES |
| `contact_person` | `character varying` | YES |
| `note` | `text` | YES |
| `email_id` | `integer` | YES |
| `customer_id` | `integer` | YES |
| `body` | `text` | YES |
| `linked_inbox_application_id` | `integer` | YES |

## `correspondence_outgoing_counters`

| Column | Type | Nullable |
|--------|------|----------|
| `period_key` | `character varying` | NO |
| `last_number` | `integer` | NO |
| `created_at` | `timestamp without time zone` | NO |
| `updated_at` | `timestamp without time zone` | NO |

## `customer_reviews`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `work_id` | `integer` | YES |
| `pm_id` | `integer` | YES |
| `customer_id` | `character varying` | YES |
| `rating` | `integer` | YES |
| `comment` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `score` | `integer` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `customers`

| Column | Type | Nullable |
|--------|------|----------|
| `inn` | `character varying` | YES |
| `name` | `character varying` | NO |
| `full_name` | `character varying` | YES |
| `address` | `character varying` | YES |
| `phone` | `character varying` | YES |
| `email` | `character varying` | YES |
| `contact_person` | `character varying` | YES |
| `category` | `character varying` | YES |
| `comment` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `id` | `integer` | NO |
| `kpp` | `character varying` | YES |
| `city` | `character varying` | YES |
| `note` | `text` | YES |
| `ogrn` | `character varying` | YES |
| `contacts_json` | `text` | YES |
| `last_review_at` | `timestamp without time zone` | YES |
| `legal_address` | `character varying` | YES |

## `doc_sets`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `tender_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `name` | `character varying` | YES |
| `status` | `character varying` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `documents`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `filename` | `character varying` | NO |
| `original_name` | `character varying` | YES |
| `mime_type` | `character varying` | YES |
| `size` | `integer` | YES |
| `type` | `character varying` | YES |
| `tender_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `uploaded_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `category` | `character varying` | YES |
| `description` | `text` | YES |
| `employee_id` | `integer` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `file_url` | `text` | YES |
| `download_url` | `text` | YES |
| `uploaded_by_user_id` | `integer` | YES |

## `email_accounts`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `name` | `character varying` | NO |
| `email_address` | `character varying` | NO |
| `account_type` | `character varying` | YES |
| `imap_host` | `character varying` | YES |
| `imap_port` | `integer` | YES |
| `imap_user` | `character varying` | YES |
| `imap_pass_encrypted` | `text` | YES |
| `imap_tls` | `boolean` | YES |
| `imap_folder` | `character varying` | YES |
| `smtp_host` | `character varying` | YES |
| `smtp_port` | `integer` | YES |
| `smtp_user` | `character varying` | YES |
| `smtp_pass_encrypted` | `text` | YES |
| `smtp_tls` | `boolean` | YES |
| `smtp_from_name` | `character varying` | YES |
| `sync_enabled` | `boolean` | YES |
| `sync_interval_sec` | `integer` | YES |
| `sync_max_emails` | `integer` | YES |
| `last_sync_at` | `timestamp without time zone` | YES |
| `last_sync_uid` | `integer` | YES |
| `last_sync_error` | `text` | YES |
| `is_active` | `boolean` | YES |
| `is_copy_target` | `boolean` | YES |
| `exclude_from_inbox` | `boolean` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `email_attachments`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `email_id` | `integer` | NO |
| `filename` | `character varying` | NO |
| `original_filename` | `character varying` | YES |
| `mime_type` | `character varying` | YES |
| `size` | `bigint` | YES |
| `file_path` | `text` | NO |
| `content_id` | `character varying` | YES |
| `content_disposition` | `character varying` | YES |
| `is_inline` | `boolean` | YES |
| `checksum_sha256` | `character varying` | YES |
| `thumbnail_path` | `text` | YES |
| `ai_content_type` | `character varying` | YES |
| `ai_extracted_text` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `email_classification_rules`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `rule_type` | `character varying` | NO |
| `pattern` | `character varying` | NO |
| `match_mode` | `character varying` | YES |
| `classification` | `character varying` | NO |
| `confidence` | `integer` | YES |
| `priority` | `integer` | YES |
| `is_active` | `boolean` | YES |
| `description` | `character varying` | YES |
| `times_matched` | `integer` | YES |
| `last_matched_at` | `timestamp without time zone` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `email_folders`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_account_id` | `integer` | YES |
| `account_id` | `integer` | YES |
| `name` | `character varying` | NO |
| `imap_path` | `character varying` | YES |
| `folder_type` | `character varying` | YES |
| `unread_count` | `integer` | YES |
| `total_count` | `integer` | YES |
| `color` | `character varying` | YES |
| `sort_order` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `email_history`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `recipient` | `character varying` | YES |
| `subject` | `character varying` | YES |
| `body` | `text` | YES |
| `status` | `character varying` | YES |
| `sent_at` | `timestamp without time zone` | YES |
| `error_message` | `text` | YES |

## `email_log`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | YES |
| `to_email` | `character varying` | YES |
| `subject` | `character varying` | YES |
| `status` | `character varying` | YES |
| `message_id` | `character varying` | YES |
| `error` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `email_queue`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `recipient` | `character varying` | YES |
| `subject` | `character varying` | YES |
| `body` | `text` | YES |
| `scheduled_for` | `timestamp without time zone` | YES |
| `attempts` | `integer` | YES |
| `status` | `character varying` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `email_sync_log`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `account_id` | `integer` | YES |
| `sync_type` | `character varying` | NO |
| `status` | `character varying` | NO |
| `emails_fetched` | `integer` | YES |
| `emails_new` | `integer` | YES |
| `emails_updated` | `integer` | YES |
| `attachments_saved` | `integer` | YES |
| `errors_count` | `integer` | YES |
| `error_details` | `jsonb` | YES |
| `duration_ms` | `integer` | YES |
| `started_at` | `timestamp without time zone` | YES |
| `completed_at` | `timestamp without time zone` | YES |

## `email_templates_v2`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `code` | `character varying` | NO |
| `name` | `character varying` | NO |
| `category` | `character varying` | YES |
| `subject_template` | `text` | NO |
| `body_template` | `text` | NO |
| `variables_schema` | `jsonb` | YES |
| `use_letterhead` | `boolean` | YES |
| `default_cc` | `text` | YES |
| `auto_attach_files` | `jsonb` | YES |
| `is_system` | `boolean` | YES |
| `is_active` | `boolean` | YES |
| `sort_order` | `integer` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `emails`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `account_id` | `integer` | YES |
| `direction` | `character varying` | NO |
| `message_id` | `character varying` | YES |
| `in_reply_to` | `character varying` | YES |
| `references_header` | `text` | YES |
| `thread_id` | `character varying` | YES |
| `from_email` | `character varying` | YES |
| `from_name` | `character varying` | YES |
| `to_emails` | `jsonb` | YES |
| `cc_emails` | `jsonb` | YES |
| `bcc_emails` | `jsonb` | YES |
| `reply_to_email` | `character varying` | YES |
| `subject` | `text` | YES |
| `body_text` | `text` | YES |
| `body_html` | `text` | YES |
| `body_html_raw` | `text` | YES |
| `snippet` | `character varying` | YES |
| `email_type` | `character varying` | YES |
| `classification_confidence` | `integer` | YES |
| `classification_rule_id` | `integer` | YES |
| `is_read` | `boolean` | YES |
| `is_starred` | `boolean` | YES |
| `is_archived` | `boolean` | YES |
| `is_deleted` | `boolean` | YES |
| `is_spam` | `boolean` | YES |
| `is_draft` | `boolean` | YES |
| `linked_tender_id` | `integer` | YES |
| `linked_work_id` | `integer` | YES |
| `linked_customer_inn` | `character varying` | YES |
| `linked_entities` | `jsonb` | YES |
| `has_attachments` | `boolean` | YES |
| `attachment_count` | `integer` | YES |
| `total_attachments_size` | `bigint` | YES |
| `imap_uid` | `integer` | YES |
| `imap_folder` | `character varying` | YES |
| `imap_flags` | `text` | YES |
| `raw_headers` | `text` | YES |
| `sent_by_user_id` | `integer` | YES |
| `template_id` | `integer` | YES |
| `reply_to_email_id` | `integer` | YES |
| `forward_of_email_id` | `integer` | YES |
| `ai_summary` | `text` | YES |
| `ai_classification` | `text` | YES |
| `ai_color` | `character varying` | YES |
| `ai_recommendation` | `text` | YES |
| `ai_processed_at` | `timestamp without time zone` | YES |
| `email_date` | `timestamp without time zone` | NO |
| `synced_at` | `timestamp without time zone` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `pre_tender_id` | `integer` | YES |
| `user_account_id` | `integer` | YES |
| `owner_user_id` | `integer` | YES |
| `folder_id` | `integer` | YES |
| `is_crm_copy` | `boolean` | YES |

## `employee_assignments`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `employee_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `date_from` | `date` | YES |
| `date_to` | `date` | YES |
| `role` | `character varying` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `employee_collection_items`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `collection_id` | `integer` | NO |
| `employee_id` | `integer` | NO |
| `added_by` | `integer` | YES |
| `added_at` | `timestamp without time zone` | YES |

## `employee_collections`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `name` | `character varying` | NO |
| `description` | `text` | YES |
| `created_by` | `integer` | YES |
| `is_active` | `boolean` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `employee_permits`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `employee_id` | `integer` | YES |
| `type_id` | `integer` | YES |
| `permit_type` | `character varying` | YES |
| `permit_number` | `character varying` | YES |
| `issue_date` | `date` | YES |
| `expiry_date` | `date` | YES |
| `file_path` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `category` | `character varying` | YES |
| `doc_number` | `character varying` | YES |
| `file_url` | `text` | YES |
| `issuer` | `character varying` | YES |
| `status` | `character varying` | YES |
| `scan_file` | `character varying` | YES |
| `scan_original_name` | `character varying` | YES |
| `notify_30_sent` | `boolean` | YES |
| `notify_14_sent` | `boolean` | YES |
| `notify_expired_sent` | `boolean` | YES |
| `is_active` | `boolean` | YES |
| `created_by` | `integer` | YES |
| `renewal_of` | `integer` | YES |
| `notes` | `text` | YES |

## `employee_plan`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `employee_id` | `integer` | YES |
| `date` | `date` | NO |
| `status` | `character varying` | YES |
| `work_id` | `integer` | YES |
| `comment` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `kind` | `character varying` | YES |
| `note` | `text` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `staff_id` | `integer` | YES |
| `user_id` | `integer` | YES |
| `status_code` | `character varying` | YES |
| `object_name` | `character varying` | YES |
| `shift_type` | `character varying` | YES |
| `hours` | `numeric` | YES |
| `notes` | `text` | YES |
| `source` | `character varying` | YES |
| `staff_request_id` | `integer` | YES |
| `locked` | `boolean` | YES |

## `employee_rates`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `employee_id` | `integer` | YES |
| `role_tag` | `character varying` | YES |
| `day_rate` | `numeric` | NO |
| `shift_rate` | `numeric` | YES |
| `overtime_rate` | `numeric` | YES |
| `effective_from` | `date` | YES |
| `effective_to` | `date` | YES |
| `comment` | `text` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `employee_reviews`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `employee_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `pm_id` | `integer` | YES |
| `rating` | `integer` | YES |
| `comment` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `score` | `integer` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `employees`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `fio` | `character varying` | NO |
| `phone` | `character varying` | YES |
| `email` | `character varying` | YES |
| `role_tag` | `character varying` | YES |
| `skills` | `ARRAY` | YES |
| `rating_avg` | `numeric` | YES |
| `is_active` | `boolean` | YES |
| `user_id` | `integer` | YES |
| `comment` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `city` | `character varying` | YES |
| `position` | `character varying` | YES |
| `full_name` | `character varying` | YES |
| `passport_data` | `text` | YES |
| `inn` | `character varying` | YES |
| `snils` | `character varying` | YES |
| `birth_date` | `date` | YES |
| `address` | `text` | YES |
| `employment_date` | `date` | YES |
| `dismissal_date` | `date` | YES |
| `salary` | `numeric` | YES |
| `rate` | `numeric` | YES |
| `gender` | `character varying` | YES |
| `grade` | `character varying` | YES |
| `hire_date` | `date` | YES |
| `pass_series` | `character varying` | YES |
| `pass_number` | `character varying` | YES |
| `imt_number` | `character varying` | YES |
| `imt_expires` | `date` | YES |
| `permits` | `jsonb` | YES |
| `rating_count` | `integer` | YES |
| `docs_url` | `text` | YES |
| `is_self_employed` | `boolean` | YES |
| `bank_name` | `text` | YES |
| `bik` | `character varying` | YES |
| `account_number` | `character varying` | YES |
| `card_number` | `character varying` | YES |
| `passport_series` | `character varying` | YES |
| `passport_number` | `character varying` | YES |
| `day_rate` | `numeric` | YES |
| `contract_type` | `character varying` | YES |
| `department` | `character varying` | YES |
| `registration_address` | `text` | YES |
| `birth_place` | `text` | YES |
| `passport_date` | `text` | YES |
| `passport_issued` | `text` | YES |
| `passport_code` | `text` | YES |
| `naks` | `text` | YES |
| `naks_number` | `character varying` | YES |
| `naks_stamp` | `character varying` | YES |
| `naks_date` | `date` | YES |
| `naks_expiry` | `date` | YES |
| `fsb_pass` | `text` | YES |
| `score_index` | `character varying` | YES |
| `qualification_name` | `text` | YES |
| `qualification_grade` | `character varying` | YES |
| `brigade` | `character varying` | YES |
| `notes` | `text` | YES |

## `equipment`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `inventory_number` | `character varying` | NO |
| `name` | `character varying` | NO |
| `category_id` | `integer` | YES |
| `serial_number` | `character varying` | YES |
| `barcode` | `character varying` | YES |
| `qr_code` | `text` | YES |
| `qr_uuid` | `character varying` | YES |
| `purchase_price` | `numeric` | YES |
| `purchase_date` | `date` | YES |
| `invoice_id` | `integer` | YES |
| `balance_date` | `date` | YES |
| `balance_status` | `character varying` | YES |
| `useful_life_months` | `integer` | YES |
| `salvage_value` | `numeric` | YES |
| `depreciation_method` | `character varying` | YES |
| `accumulated_depreciation` | `numeric` | YES |
| `book_value` | `numeric` | YES |
| `last_depreciation_date` | `date` | YES |
| `auto_write_off` | `boolean` | YES |
| `status` | `character varying` | YES |
| `condition` | `character varying` | YES |
| `quantity` | `numeric` | YES |
| `unit` | `character varying` | YES |
| `warranty_end` | `date` | YES |
| `next_maintenance` | `date` | YES |
| `next_calibration` | `date` | YES |
| `maintenance_interval_days` | `integer` | YES |
| `warehouse_id` | `integer` | YES |
| `current_holder_id` | `integer` | YES |
| `current_object_id` | `integer` | YES |
| `brand` | `character varying` | YES |
| `model` | `character varying` | YES |
| `specifications` | `jsonb` | YES |
| `notes` | `text` | YES |
| `photos` | `ARRAY` | YES |
| `written_off_date` | `date` | YES |
| `written_off_reason` | `text` | YES |
| `written_off_by` | `integer` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `description` | `text` | YES |
| `location` | `character varying` | YES |
| `is_active` | `boolean` | YES |
| `comment` | `text` | YES |
| `holder_id` | `integer` | YES |
| `object_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `photo_url` | `text` | YES |
| `kit_id` | `integer` | YES |
| `min_stock_level` | `integer` | YES |
| `reorder_point` | `integer` | YES |
| `custom_icon` | `text` | YES |

## `equipment_categories`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `name` | `character varying` | NO |
| `code` | `character varying` | YES |
| `parent_id` | `integer` | YES |
| `icon` | `character varying` | YES |
| `requires_calibration` | `boolean` | YES |
| `is_consumable` | `boolean` | YES |
| `description` | `text` | YES |
| `sort_order` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `equipment_kit_items`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `kit_id` | `integer` | NO |
| `equipment_id` | `integer` | YES |
| `category_id` | `integer` | YES |
| `item_name` | `character varying` | YES |
| `quantity` | `integer` | YES |
| `is_required` | `boolean` | YES |
| `sort_order` | `integer` | YES |
| `notes` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `equipment_kits`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `name` | `character varying` | NO |
| `code` | `character varying` | YES |
| `description` | `text` | YES |
| `work_type` | `character varying` | YES |
| `icon` | `character varying` | YES |
| `photo_url` | `text` | YES |
| `is_template` | `boolean` | YES |
| `is_active` | `boolean` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `equipment_maintenance`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `equipment_id` | `integer` | YES |
| `maintenance_type` | `character varying` | NO |
| `description` | `text` | YES |
| `cost` | `numeric` | YES |
| `spare_parts` | `jsonb` | YES |
| `performed_by` | `character varying` | YES |
| `contractor` | `character varying` | YES |
| `started_at` | `date` | YES |
| `completed_at` | `date` | YES |
| `next_date` | `date` | YES |
| `invoice_id` | `integer` | YES |
| `notes` | `text` | YES |
| `photos` | `ARRAY` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `equipment_movements`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `equipment_id` | `integer` | YES |
| `movement_type` | `character varying` | NO |
| `from_warehouse_id` | `integer` | YES |
| `from_holder_id` | `integer` | YES |
| `from_object_id` | `integer` | YES |
| `to_warehouse_id` | `integer` | YES |
| `to_holder_id` | `integer` | YES |
| `to_object_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `quantity` | `numeric` | YES |
| `condition_before` | `character varying` | YES |
| `condition_after` | `character varying` | YES |
| `document_number` | `character varying` | YES |
| `photos_before` | `ARRAY` | YES |
| `photos_after` | `ARRAY` | YES |
| `notes` | `text` | YES |
| `confirmed` | `boolean` | YES |
| `confirmed_by` | `integer` | YES |
| `confirmed_at` | `timestamp without time zone` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `verification_photos` | `ARRAY` | YES |
| `checklist` | `jsonb` | YES |

## `equipment_requests`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `request_type` | `character varying` | NO |
| `status` | `character varying` | YES |
| `requester_id` | `integer` | YES |
| `equipment_id` | `integer` | YES |
| `quantity` | `numeric` | YES |
| `work_id` | `integer` | YES |
| `object_id` | `integer` | YES |
| `target_holder_id` | `integer` | YES |
| `needed_from` | `date` | YES |
| `needed_to` | `date` | YES |
| `notes` | `text` | YES |
| `processed_by` | `integer` | YES |
| `processed_at` | `timestamp without time zone` | YES |
| `rejection_reason` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `reason` | `text` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `urgency` | `character varying` | YES |

## `equipment_reservations`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `equipment_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `reserved_by` | `integer` | YES |
| `reserved_from` | `date` | NO |
| `reserved_to` | `date` | NO |
| `status` | `character varying` | YES |
| `notes` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `equipment_work_assignments`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `equipment_id` | `integer` | NO |
| `work_id` | `integer` | NO |
| `assigned_by` | `integer` | YES |
| `assigned_at` | `timestamp without time zone` | YES |
| `returned_at` | `timestamp without time zone` | YES |
| `condition_on_assign` | `character varying` | YES |
| `condition_on_return` | `character varying` | YES |
| `photo_assign` | `ARRAY` | YES |
| `photo_return` | `ARRAY` | YES |
| `notes` | `text` | YES |
| `status` | `character varying` | YES |

## `erp_connections`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `name` | `character varying` | NO |
| `erp_type` | `character varying` | NO |
| `connection_url` | `text` | YES |
| `auth_type` | `character varying` | YES |
| `auth_credentials_encrypted` | `text` | YES |
| `is_active` | `boolean` | YES |
| `sync_direction` | `character varying` | YES |
| `last_sync_at` | `timestamp without time zone` | YES |
| `last_sync_status` | `character varying` | YES |
| `last_sync_error` | `text` | YES |
| `sync_interval_minutes` | `integer` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `webhook_secret` | `character varying` | YES |

## `erp_field_mappings`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `connection_id` | `integer` | YES |
| `entity_type` | `character varying` | NO |
| `crm_field` | `character varying` | NO |
| `erp_field` | `character varying` | NO |
| `transform_rule` | `character varying` | YES |
| `is_required` | `boolean` | YES |
| `is_active` | `boolean` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `erp_sync_log`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `connection_id` | `integer` | YES |
| `direction` | `character varying` | NO |
| `entity_type` | `character varying` | NO |
| `records_total` | `integer` | YES |
| `records_success` | `integer` | YES |
| `records_failed` | `integer` | YES |
| `error_details` | `jsonb` | YES |
| `started_at` | `timestamp without time zone` | YES |
| `completed_at` | `timestamp without time zone` | YES |
| `status` | `character varying` | YES |
| `initiated_by` | `integer` | YES |

## `estimate_approval_events`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `request_id` | `integer` | NO |
| `estimate_id` | `integer` | NO |
| `action` | `character varying` | NO |
| `from_stage` | `character varying` | YES |
| `to_stage` | `character varying` | NO |
| `actor_id` | `integer` | YES |
| `actor_role` | `character varying` | YES |
| `comment` | `text` | YES |
| `payload_json` | `jsonb` | YES |
| `created_at` | `timestamp without time zone` | NO |

## `estimate_approval_requests`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `estimate_id` | `integer` | NO |
| `tender_id` | `integer` | YES |
| `requested_by` | `integer` | NO |
| `pm_id` | `integer` | YES |
| `estimate_version_no` | `integer` | YES |
| `current_stage` | `character varying` | NO |
| `last_rework_kind` | `character varying` | YES |
| `submitted_snapshot_json` | `jsonb` | NO |
| `submitted_at` | `timestamp without time zone` | NO |
| `last_action_at` | `timestamp without time zone` | NO |
| `last_actor_id` | `integer` | YES |
| `last_comment` | `text` | YES |
| `finalized_at` | `timestamp without time zone` | YES |
| `cancelled_at` | `timestamp without time zone` | YES |
| `created_at` | `timestamp without time zone` | NO |
| `updated_at` | `timestamp without time zone` | NO |
| `requires_payment` | `boolean` | NO |
| `source_type` | `character varying` | YES |
| `source_id` | `integer` | YES |

## `estimates`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `tender_id` | `integer` | YES |
| `pm_id` | `integer` | YES |
| `approval_status` | `character varying` | YES |
| `total_sum` | `numeric` | YES |
| `cost_sum` | `numeric` | YES |
| `margin_percent` | `numeric` | YES |
| `deadline` | `date` | YES |
| `work_days` | `integer` | YES |
| `comment` | `text` | YES |
| `calc_data` | `jsonb` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `version` | `integer` | YES |
| `is_approved` | `boolean` | YES |
| `approved_by` | `integer` | YES |
| `approved_at` | `timestamp without time zone` | YES |
| `status` | `character varying` | YES |
| `city` | `character varying` | YES |
| `distance_km` | `integer` | YES |
| `people_count` | `integer` | YES |
| `work_type` | `character varying` | YES |
| `vat_pct` | `integer` | YES |
| `price_tkp` | `numeric` | YES |
| `cost_plan` | `numeric` | YES |
| `work_start_plan` | `date` | YES |
| `work_end_plan` | `date` | YES |
| `version_no` | `integer` | YES |
| `calc_summary_json` | `jsonb` | YES |
| `quick_calc_json` | `jsonb` | YES |
| `payload_json` | `jsonb` | YES |
| `sent_for_approval_at` | `timestamp without time zone` | YES |
| `approval_comment` | `text` | YES |
| `reject_reason` | `text` | YES |
| `user_id` | `integer` | YES |
| `probability_pct` | `integer` | YES |
| `payment_terms` | `text` | YES |
| `calc_v2_json` | `jsonb` | YES |
| `profit_per_day` | `numeric` | YES |
| `price_with_vat` | `numeric` | YES |
| `decided_at` | `timestamp without time zone` | YES |
| `cover_letter` | `text` | YES |
| `assumptions` | `text` | YES |
| `margin_pct` | `numeric` | YES |
| `overhead_pct` | `numeric` | YES |
| `fot_tax_pct` | `numeric` | YES |
| `profit_tax_pct` | `numeric` | YES |
| `consumables_pct` | `numeric` | YES |
| `decided_by_user_id` | `integer` | YES |
| `items_json` | `jsonb` | YES |
| `staff_ids_json` | `jsonb` | YES |
| `proposed_staff_ids_json` | `jsonb` | YES |
| `approved_staff_ids_json` | `jsonb` | YES |
| `proposed_staff_ids_a_json` | `jsonb` | YES |
| `proposed_staff_ids_b_json` | `jsonb` | YES |
| `approved_staff_ids_a_json` | `jsonb` | YES |
| `approved_staff_ids_b_json` | `jsonb` | YES |
| `work_id` | `integer` | YES |
| `estimate_data_json` | `jsonb` | YES |
| `title` | `character varying` | YES |
| `description` | `text` | YES |
| `amount` | `numeric` | YES |
| `cost` | `numeric` | YES |
| `margin` | `numeric` | YES |
| `notes` | `text` | YES |
| `customer` | `character varying` | YES |
| `object_name` | `character varying` | YES |
| `priority` | `character varying` | YES |

## `expenses`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `category` | `text` | YES |
| `amount` | `numeric` | YES |
| `description` | `text` | YES |
| `status` | `text` | YES |
| `approved_at` | `timestamp without time zone` | YES |
| `rejected_at` | `timestamp without time zone` | YES |
| `processed_at` | `timestamp without time zone` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `requires_payment` | `boolean` | YES |
| `payment_method` | `character varying` | YES |
| `payment_status` | `character varying` | YES |
| `payment_comment` | `text` | YES |
| `payment_doc_id` | `integer` | YES |
| `buh_id` | `integer` | YES |
| `buh_acted_at` | `timestamp without time zone` | YES |

## `hr_requests`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | YES |
| `type` | `text` | YES |
| `status` | `text` | YES |
| `request_json` | `jsonb` | YES |
| `comment` | `text` | YES |
| `decided_at` | `timestamp without time zone` | YES |
| `decided_by_user_id` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `inbox_applications`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `email_id` | `integer` | YES |
| `source` | `character varying` | YES |
| `source_email` | `character varying` | YES |
| `source_name` | `character varying` | YES |
| `subject` | `text` | YES |
| `body_preview` | `text` | YES |
| `ai_classification` | `character varying` | YES |
| `ai_color` | `character varying` | YES |
| `ai_summary` | `text` | YES |
| `ai_recommendation` | `text` | YES |
| `ai_work_type` | `character varying` | YES |
| `ai_estimated_budget` | `numeric` | YES |
| `ai_estimated_days` | `integer` | YES |
| `ai_keywords` | `ARRAY` | YES |
| `ai_confidence` | `numeric` | YES |
| `ai_raw_json` | `jsonb` | YES |
| `ai_analyzed_at` | `timestamp without time zone` | YES |
| `ai_model` | `character varying` | YES |
| `workload_snapshot` | `jsonb` | YES |
| `status` | `character varying` | YES |
| `decision_by` | `integer` | YES |
| `decision_at` | `timestamp without time zone` | YES |
| `decision_notes` | `text` | YES |
| `rejection_reason` | `text` | YES |
| `linked_tender_id` | `integer` | YES |
| `linked_work_id` | `integer` | YES |
| `attachment_count` | `integer` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `ai_report` | `text` | YES |
| `ai_cost_estimate` | `numeric` | YES |
| `ai_cost_report` | `text` | YES |

## `incomes`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `work_id` | `integer` | YES |
| `type` | `character varying` | YES |
| `amount` | `numeric` | NO |
| `date` | `date` | YES |
| `counterparty` | `character varying` | YES |
| `description` | `text` | YES |
| `document_number` | `character varying` | YES |
| `source` | `character varying` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `invoice_id` | `integer` | YES |
| `comment` | `text` | YES |
| `confirmed` | `boolean` | YES |
| `import_hash` | `text` | YES |

## `inventory_checks`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `warehouse_id` | `integer` | YES |
| `check_date` | `date` | NO |
| `status` | `character varying` | YES |
| `total_items` | `integer` | YES |
| `found_items` | `integer` | YES |
| `missing_items` | `integer` | YES |
| `surplus_items` | `integer` | YES |
| `notes` | `text` | YES |
| `conducted_by` | `integer` | YES |
| `completed_at` | `timestamp without time zone` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `invoice_payments`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `invoice_id` | `integer` | YES |
| `amount` | `numeric` | YES |
| `payment_date` | `date` | YES |
| `payment_method` | `character varying` | YES |
| `comment` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `created_by` | `integer` | YES |

## `invoices`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `invoice_number` | `character varying` | YES |
| `invoice_date` | `date` | YES |
| `invoice_type` | `character varying` | YES |
| `status` | `character varying` | YES |
| `work_id` | `integer` | YES |
| `act_id` | `integer` | YES |
| `customer_name` | `character varying` | YES |
| `customer_inn` | `character varying` | YES |
| `amount` | `numeric` | YES |
| `vat_pct` | `integer` | YES |
| `total_amount` | `numeric` | YES |
| `due_date` | `date` | YES |
| `paid_amount` | `numeric` | YES |
| `notes` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `created_by` | `integer` | YES |
| `paid_date` | `date` | YES |
| `vat_amount` | `numeric` | YES |
| `file_path` | `text` | YES |
| `contract_id` | `integer` | YES |
| `comment` | `text` | YES |
| `description` | `text` | YES |
| `customer_id` | `integer` | YES |
| `items_json` | `jsonb` | YES |
| `exported_at` | `timestamp without time zone` | YES |
| `source` | `character varying` | YES |
| `tender_id` | `integer` | YES |
| `estimate_id` | `integer` | YES |
| `tkp_id` | `integer` | YES |

## `ivr_audio_cache`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `text_hash` | `character varying` | NO |
| `text` | `text` | NO |
| `file_path` | `text` | NO |
| `voice` | `character varying` | YES |
| `format` | `character varying` | YES |
| `file_size` | `integer` | YES |
| `created_at` | `timestamp with time zone` | YES |
| `last_used_at` | `timestamp with time zone` | YES |

## `meeting_minutes`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `meeting_id` | `integer` | NO |
| `item_order` | `integer` | YES |
| `item_type` | `character varying` | YES |
| `content` | `text` | NO |
| `responsible_user_id` | `integer` | YES |
| `deadline` | `timestamp without time zone` | YES |
| `task_id` | `integer` | YES |
| `created_by` | `integer` | NO |
| `created_at` | `timestamp without time zone` | YES |

## `meeting_participants`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `meeting_id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `rsvp_status` | `character varying` | YES |
| `rsvp_comment` | `text` | YES |
| `attended` | `boolean` | YES |
| `notified_at` | `timestamp without time zone` | YES |
| `reminder_sent_at` | `timestamp without time zone` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `meetings`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `organizer_id` | `integer` | NO |
| `title` | `character varying` | NO |
| `description` | `text` | YES |
| `location` | `character varying` | YES |
| `start_time` | `timestamp without time zone` | NO |
| `end_time` | `timestamp without time zone` | YES |
| `is_recurring` | `boolean` | YES |
| `recurrence_rule` | `text` | YES |
| `status` | `character varying` | YES |
| `agenda` | `text` | YES |
| `minutes` | `text` | YES |
| `minutes_author_id` | `integer` | YES |
| `minutes_approved_at` | `timestamp without time zone` | YES |
| `work_id` | `integer` | YES |
| `tender_id` | `integer` | YES |
| `notify_before_minutes` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `migrations`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `name` | `character varying` | NO |
| `executed_at` | `timestamp without time zone` | YES |

## `mimir_conversations`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `title` | `character varying` | YES |
| `is_archived` | `boolean` | YES |
| `is_pinned` | `boolean` | YES |
| `message_count` | `integer` | YES |
| `total_tokens` | `integer` | YES |
| `last_message_at` | `timestamp without time zone` | YES |
| `last_message_preview` | `text` | YES |
| `metadata` | `jsonb` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `mimir_hint_analysis_cache`

| Column | Type | Nullable |
|--------|------|----------|
| `cache_key` | `text` | NO |
| `role` | `text` | YES |
| `page` | `text` | YES |
| `user_id` | `integer` | YES |
| `hints_hash` | `text` | YES |
| `analysis_text` | `text` | YES |
| `hints_snapshot` | `jsonb` | YES |
| `tokens_input` | `integer` | YES |
| `tokens_output` | `integer` | YES |
| `model_used` | `text` | YES |
| `duration_ms` | `integer` | YES |
| `generated_at` | `timestamp with time zone` | YES |
| `expires_at` | `timestamp with time zone` | YES |

## `mimir_messages`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `conversation_id` | `integer` | NO |
| `role` | `character varying` | NO |
| `content` | `text` | NO |
| `content_type` | `character varying` | YES |
| `tokens_input` | `integer` | YES |
| `tokens_output` | `integer` | YES |
| `model_used` | `character varying` | YES |
| `has_files` | `boolean` | YES |
| `file_names` | `ARRAY` | YES |
| `search_results` | `jsonb` | YES |
| `duration_ms` | `integer` | YES |
| `metadata` | `jsonb` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `mimir_usage_log`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | YES |
| `conversation_id` | `integer` | YES |
| `provider` | `character varying` | YES |
| `model` | `character varying` | YES |
| `tokens_input` | `integer` | YES |
| `tokens_output` | `integer` | YES |
| `duration_ms` | `integer` | YES |
| `success` | `boolean` | YES |
| `error_message` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `modules`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `key` | `character varying` | NO |
| `label` | `character varying` | NO |
| `description` | `text` | YES |
| `category` | `character varying` | YES |
| `icon` | `character varying` | YES |
| `sort_order` | `integer` | YES |
| `is_active` | `boolean` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `notifications`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | YES |
| `type` | `character varying` | YES |
| `title` | `character varying` | YES |
| `message` | `text` | YES |
| `is_read` | `boolean` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `entity_id` | `integer` | YES |
| `entity_type` | `character varying` | YES |
| `link` | `text` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `read_at` | `timestamp without time zone` | YES |
| `link_hash` | `text` | YES |
| `kind` | `text` | YES |
| `day_key` | `text` | YES |
| `dedup_key` | `text` | YES |
| `dismissed_at` | `timestamp without time zone` | YES |
| `created_by` | `integer` | YES |
| `url` | `character varying` | YES |
| `body` | `text` | YES |

## `objects`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `name` | `character varying` | NO |
| `code` | `character varying` | YES |
| `address` | `text` | YES |
| `city` | `character varying` | YES |
| `is_active` | `boolean` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `customer_inn` | `character varying` | YES |
| `work_id` | `integer` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `office_expenses`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `category` | `character varying` | YES |
| `amount` | `numeric` | NO |
| `date` | `date` | YES |
| `description` | `text` | YES |
| `document_number` | `character varying` | YES |
| `counterparty` | `character varying` | YES |
| `status` | `character varying` | YES |
| `approved_by` | `integer` | YES |
| `approved_at` | `timestamp without time zone` | YES |
| `source` | `character varying` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `supplier` | `character varying` | YES |
| `doc_number` | `character varying` | YES |
| `comment` | `text` | YES |
| `vat_pct` | `integer` | YES |
| `vat_amount` | `numeric` | YES |
| `total_amount` | `numeric` | YES |
| `payment_date` | `date` | YES |
| `invoice_needed` | `boolean` | YES |
| `invoice_received` | `boolean` | YES |
| `number` | `character varying` | YES |
| `payment_method` | `character varying` | YES |
| `contract_id` | `integer` | YES |
| `submitted_at` | `timestamp without time zone` | YES |
| `work_id` | `integer` | YES |
| `import_hash` | `text` | YES |
| `notes` | `text` | YES |
| `receipt_url` | `text` | YES |
| `requires_payment` | `boolean` | YES |
| `payment_status` | `character varying` | YES |
| `payment_comment` | `text` | YES |
| `payment_doc_id` | `integer` | YES |
| `buh_id` | `integer` | YES |
| `buh_acted_at` | `timestamp without time zone` | YES |

## `one_time_payments`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `employee_id` | `integer` | YES |
| `employee_name` | `text` | YES |
| `work_id` | `integer` | YES |
| `amount` | `numeric` | NO |
| `reason` | `text` | NO |
| `payment_method` | `character varying` | YES |
| `payment_type` | `character varying` | YES |
| `status` | `character varying` | YES |
| `requested_by` | `integer` | YES |
| `approved_by` | `integer` | YES |
| `approved_at` | `timestamp without time zone` | YES |
| `paid_at` | `timestamp without time zone` | YES |
| `comment` | `text` | YES |
| `director_comment` | `text` | YES |
| `receipt_url` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `requires_payment` | `boolean` | YES |
| `payment_status` | `character varying` | YES |
| `payment_comment` | `text` | YES |
| `payment_doc_id` | `integer` | YES |
| `buh_id` | `integer` | YES |
| `buh_acted_at` | `timestamp without time zone` | YES |

## `pass_requests`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `tender_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `object_name` | `text` | YES |
| `object_address` | `text` | YES |
| `request_type` | `text` | YES |
| `workers` | `jsonb` | YES |
| `vehicles` | `jsonb` | YES |
| `date_from` | `date` | YES |
| `date_to` | `date` | YES |
| `status` | `text` | YES |
| `pdf_path` | `text` | YES |
| `notes` | `text` | YES |
| `author_id` | `integer` | YES |
| `approved_by` | `integer` | YES |
| `created_at` | `timestamp with time zone` | YES |
| `updated_at` | `timestamp with time zone` | YES |
| `request_date` | `date` | YES |
| `equipment_json` | `jsonb` | YES |
| `contact_person` | `text` | YES |
| `contact_phone` | `text` | YES |
| `approved_at` | `timestamp with time zone` | YES |

## `payment_registry`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `sheet_id` | `integer` | YES |
| `employee_id` | `integer` | YES |
| `employee_name` | `text` | YES |
| `amount` | `numeric` | NO |
| `payment_type` | `character varying` | YES |
| `payment_method` | `character varying` | YES |
| `inn` | `character varying` | YES |
| `bank_name` | `text` | YES |
| `bik` | `character varying` | YES |
| `account_number` | `character varying` | YES |
| `status` | `character varying` | YES |
| `paid_at` | `timestamp without time zone` | YES |
| `bank_ref` | `text` | YES |
| `payment_order_number` | `text` | YES |
| `comment` | `text` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `payroll_items`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `sheet_id` | `integer` | YES |
| `employee_id` | `integer` | YES |
| `employee_name` | `text` | YES |
| `work_id` | `integer` | YES |
| `role_on_work` | `character varying` | YES |
| `days_worked` | `integer` | YES |
| `day_rate` | `numeric` | YES |
| `base_amount` | `numeric` | YES |
| `bonus` | `numeric` | YES |
| `overtime_hours` | `numeric` | YES |
| `overtime_amount` | `numeric` | YES |
| `penalty` | `numeric` | YES |
| `penalty_reason` | `text` | YES |
| `advance_paid` | `numeric` | YES |
| `deductions` | `numeric` | YES |
| `deductions_reason` | `text` | YES |
| `accrued` | `numeric` | YES |
| `payout` | `numeric` | YES |
| `payment_method` | `character varying` | YES |
| `is_self_employed` | `boolean` | YES |
| `comment` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `payroll_sheets`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `work_id` | `integer` | YES |
| `title` | `text` | NO |
| `period_from` | `date` | NO |
| `period_to` | `date` | NO |
| `status` | `character varying` | YES |
| `total_accrued` | `numeric` | YES |
| `total_bonus` | `numeric` | YES |
| `total_penalty` | `numeric` | YES |
| `total_advance_paid` | `numeric` | YES |
| `total_payout` | `numeric` | YES |
| `workers_count` | `integer` | YES |
| `created_by` | `integer` | YES |
| `approved_by` | `integer` | YES |
| `approved_at` | `timestamp without time zone` | YES |
| `paid_by` | `integer` | YES |
| `paid_at` | `timestamp without time zone` | YES |
| `comment` | `text` | YES |
| `director_comment` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `requires_payment` | `boolean` | YES |
| `payment_method` | `character varying` | YES |
| `payment_status` | `character varying` | YES |
| `payment_comment` | `text` | YES |
| `payment_doc_id` | `integer` | YES |
| `buh_id` | `integer` | YES |
| `buh_acted_at` | `timestamp without time zone` | YES |

## `permit_application_history`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `application_id` | `integer` | NO |
| `old_status` | `character varying` | YES |
| `new_status` | `character varying` | NO |
| `changed_by` | `integer` | YES |
| `comment` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `permit_application_items`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `application_id` | `integer` | NO |
| `employee_id` | `integer` | NO |
| `permit_type_ids` | `ARRAY` | NO |
| `notes` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `permit_applications`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `number` | `character varying` | YES |
| `title` | `character varying` | YES |
| `contractor_email` | `character varying` | YES |
| `contractor_name` | `character varying` | YES |
| `cover_letter` | `text` | YES |
| `status` | `character varying` | YES |
| `sent_at` | `timestamp without time zone` | YES |
| `sent_by` | `integer` | YES |
| `email_message_id` | `character varying` | YES |
| `excel_file_path` | `text` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `rejection_reason` | `text` | YES |
| `approved_by` | `integer` | YES |
| `is_urgent` | `boolean` | YES |

## `permit_types`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `name` | `character varying` | NO |
| `category` | `character varying` | NO |
| `validity_months` | `integer` | YES |
| `sort_order` | `integer` | YES |
| `is_active` | `boolean` | YES |
| `code` | `character varying` | YES |
| `description` | `text` | YES |
| `is_system` | `boolean` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `pinned_messages`

| Column | Type | Nullable |
|--------|------|----------|
| `chat_id` | `integer` | NO |
| `message_id` | `integer` | NO |
| `pinned_by` | `integer` | YES |
| `pinned_at` | `timestamp with time zone` | YES |

## `platform_parse_results`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `email_id` | `integer` | YES |
| `pre_tender_id` | `integer` | YES |
| `platform_name` | `character varying` | YES |
| `platform_code` | `character varying` | YES |
| `purchase_number` | `character varying` | YES |
| `purchase_url` | `text` | YES |
| `lot_number` | `character varying` | YES |
| `purchase_method` | `character varying` | YES |
| `customer_name` | `character varying` | YES |
| `customer_inn` | `character varying` | YES |
| `object_description` | `text` | YES |
| `nmck` | `numeric` | YES |
| `currency` | `character varying` | YES |
| `application_deadline` | `timestamp without time zone` | YES |
| `auction_date` | `timestamp without time zone` | YES |
| `work_start_date` | `date` | YES |
| `work_end_date` | `date` | YES |
| `docs_downloaded` | `boolean` | YES |
| `docs_download_error` | `text` | YES |
| `docs_paths` | `jsonb` | YES |
| `ai_relevance_score` | `integer` | YES |
| `ai_analysis` | `text` | YES |
| `ai_keywords` | `jsonb` | YES |
| `parse_status` | `character varying` | YES |
| `parse_error` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `pm_consents`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `pm_id` | `integer` | YES |
| `type` | `character varying` | YES |
| `status` | `character varying` | YES |
| `entity_type` | `character varying` | YES |
| `entity_id` | `integer` | YES |
| `comments` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `pre_tender_requests`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `email_id` | `integer` | YES |
| `source_type` | `character varying` | NO |
| `customer_name` | `character varying` | YES |
| `customer_inn` | `character varying` | YES |
| `customer_email` | `character varying` | YES |
| `contact_person` | `character varying` | YES |
| `contact_phone` | `character varying` | YES |
| `work_description` | `text` | YES |
| `work_location` | `character varying` | YES |
| `work_deadline` | `date` | YES |
| `estimated_sum` | `numeric` | YES |
| `ai_summary` | `text` | YES |
| `ai_color` | `character varying` | YES |
| `ai_recommendation` | `text` | YES |
| `ai_work_match_score` | `integer` | YES |
| `ai_workload_warning` | `text` | YES |
| `ai_processed_at` | `timestamp without time zone` | YES |
| `has_documents` | `boolean` | YES |
| `documents_summary` | `text` | YES |
| `manual_documents` | `jsonb` | YES |
| `status` | `character varying` | NO |
| `decision_by` | `integer` | YES |
| `decision_at` | `timestamp without time zone` | YES |
| `decision_comment` | `text` | YES |
| `reject_reason` | `text` | YES |
| `created_tender_id` | `integer` | YES |
| `response_email_id` | `integer` | YES |
| `assigned_to` | `integer` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `approval_requested_by` | `integer` | YES |
| `approval_requested_at` | `timestamp without time zone` | YES |
| `approval_comment` | `text` | YES |
| `requires_payment` | `boolean` | YES |
| `payment_method` | `character varying` | YES |
| `payment_status` | `character varying` | YES |
| `payment_comment` | `text` | YES |
| `payment_doc_id` | `integer` | YES |
| `buh_id` | `integer` | YES |
| `buh_acted_at` | `timestamp without time zone` | YES |
| `ai_confidence` | `numeric` | YES |
| `ai_urgency` | `character varying` | YES |
| `ai_auto_suggestion` | `character varying` | YES |
| `ai_risk_factors` | `jsonb` | YES |
| `ai_required_specialists` | `jsonb` | YES |

## `procurement_history`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `procurement_id` | `integer` | NO |
| `actor_id` | `integer` | NO |
| `action` | `character varying` | NO |
| `old_status` | `character varying` | YES |
| `new_status` | `character varying` | YES |
| `comment` | `text` | YES |
| `changes_json` | `jsonb` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `procurement_items`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `procurement_id` | `integer` | NO |
| `sort_order` | `integer` | YES |
| `name` | `character varying` | NO |
| `article` | `character varying` | YES |
| `unit` | `character varying` | YES |
| `quantity` | `numeric` | NO |
| `supplier` | `character varying` | YES |
| `supplier_link` | `text` | YES |
| `unit_price` | `numeric` | YES |
| `total_price` | `numeric` | YES |
| `invoice_doc_id` | `integer` | YES |
| `delivery_target` | `character varying` | YES |
| `delivery_address` | `character varying` | YES |
| `warehouse_id` | `integer` | YES |
| `estimated_delivery` | `date` | YES |
| `actual_delivery` | `date` | YES |
| `item_status` | `character varying` | YES |
| `equipment_id` | `integer` | YES |
| `received_by` | `integer` | YES |
| `received_at` | `timestamp without time zone` | YES |
| `notes` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `procurement_payments`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `procurement_id` | `integer` | NO |
| `document_id` | `integer` | NO |
| `amount` | `numeric` | YES |
| `payment_date` | `date` | YES |
| `payment_number` | `character varying` | YES |
| `bank_name` | `character varying` | YES |
| `comment` | `text` | YES |
| `uploaded_by` | `integer` | NO |
| `created_at` | `timestamp without time zone` | YES |

## `procurement_requests`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `work_id` | `integer` | YES |
| `tender_id` | `integer` | YES |
| `request_type` | `text` | YES |
| `items` | `jsonb` | YES |
| `total_sum` | `numeric` | YES |
| `status` | `text` | YES |
| `supplier` | `text` | YES |
| `delivery_date` | `date` | YES |
| `notes` | `text` | YES |
| `author_id` | `integer` | YES |
| `approved_by` | `integer` | YES |
| `created_at` | `timestamp with time zone` | YES |
| `updated_at` | `timestamp with time zone` | YES |
| `title` | `text` | YES |
| `priority` | `text` | YES |
| `needed_by` | `date` | YES |
| `delivery_address` | `text` | YES |
| `approved_at` | `timestamp with time zone` | YES |
| `requires_payment` | `boolean` | YES |
| `payment_method` | `character varying` | YES |
| `payment_status` | `character varying` | YES |
| `payment_comment` | `text` | YES |
| `payment_doc_id` | `integer` | YES |
| `buh_id` | `integer` | YES |
| `buh_acted_at` | `timestamp without time zone` | YES |
| `pm_id` | `integer` | YES |
| `proc_id` | `integer` | YES |
| `delivery_deadline` | `date` | YES |
| `deadline_type` | `character varying` | YES |
| `deadline_days` | `integer` | YES |
| `paid_at` | `timestamp without time zone` | YES |
| `delivered_at` | `timestamp without time zone` | YES |
| `pm_approved_at` | `timestamp without time zone` | YES |
| `dir_approved_at` | `timestamp without time zone` | YES |
| `dir_approved_by` | `integer` | YES |
| `locked` | `boolean` | YES |
| `proc_comment` | `text` | YES |
| `pm_comment` | `text` | YES |

## `proxies`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `type` | `character varying` | YES |
| `number` | `character varying` | YES |
| `issue_date` | `date` | YES |
| `valid_until` | `date` | YES |
| `employee_id` | `integer` | YES |
| `employee_name` | `character varying` | YES |
| `fio` | `character varying` | YES |
| `passport` | `text` | YES |
| `powers_general` | `text` | YES |
| `description` | `text` | YES |
| `address` | `text` | YES |
| `supplier` | `character varying` | YES |
| `goods_list` | `text` | YES |
| `vehicle_brand` | `character varying` | YES |
| `vehicle_number` | `character varying` | YES |
| `vin` | `character varying` | YES |
| `bank_name` | `character varying` | YES |
| `account_number` | `character varying` | YES |
| `tax_office` | `character varying` | YES |
| `court_name` | `character varying` | YES |
| `case_number` | `character varying` | YES |
| `license` | `character varying` | YES |
| `status` | `character varying` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `push_subscriptions`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `endpoint` | `text` | NO |
| `p256dh` | `text` | NO |
| `auth` | `text` | NO |
| `device_info` | `character varying` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `qa_messages`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `tender_id` | `integer` | YES |
| `estimate_id` | `integer` | YES |
| `pm_id` | `integer` | YES |
| `question` | `text` | YES |
| `answer` | `text` | YES |
| `is_open` | `boolean` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `reminders`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | YES |
| `title` | `character varying` | YES |
| `description` | `text` | YES |
| `due_date` | `timestamp without time zone` | YES |
| `status` | `character varying` | YES |
| `priority` | `character varying` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `entity_id` | `integer` | YES |
| `entity_type` | `character varying` | YES |
| `completed_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `due_time` | `time without time zone` | YES |
| `message` | `text` | YES |
| `auto_key` | `character varying` | YES |
| `next_at` | `timestamp without time zone` | YES |
| `sent_at` | `timestamp without time zone` | YES |
| `completed` | `boolean` | YES |
| `dismissed` | `boolean` | YES |
| `dismissed_at` | `timestamp without time zone` | YES |
| `type` | `character varying` | YES |
| `reminder_date` | `timestamp with time zone` | YES |

## `role_analytics_cache`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `role` | `character varying` | NO |
| `user_id` | `integer` | YES |
| `metric_key` | `character varying` | NO |
| `metric_value` | `numeric` | YES |
| `period` | `character varying` | YES |
| `calculated_at` | `timestamp without time zone` | YES |

## `role_presets`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `role` | `character varying` | NO |
| `module_key` | `character varying` | NO |
| `can_read` | `boolean` | YES |
| `can_write` | `boolean` | YES |
| `can_delete` | `boolean` | YES |

## `saved_reports`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `type` | `character varying` | YES |
| `period` | `character varying` | YES |
| `period_code` | `character varying` | YES |
| `data` | `jsonb` | YES |
| `user_id` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `seal_transfers`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `seal_id` | `integer` | YES |
| `from_id` | `integer` | YES |
| `to_id` | `integer` | YES |
| `status` | `character varying` | YES |
| `transfer_date` | `timestamp without time zone` | YES |
| `return_date` | `timestamp without time zone` | YES |
| `comments` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `from_holder_id` | `integer` | YES |
| `to_holder_id` | `integer` | YES |
| `from_holder_name` | `character varying` | YES |
| `to_holder_name` | `character varying` | YES |
| `reason` | `text` | YES |
| `created_by` | `integer` | YES |
| `is_indefinite` | `boolean` | YES |
| `purpose` | `text` | YES |
| `confirmed_at` | `timestamp without time zone` | YES |
| `approved_by` | `integer` | YES |
| `approved_at` | `timestamp without time zone` | YES |
| `comment` | `text` | YES |

## `seals`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `type` | `character varying` | YES |
| `name` | `character varying` | YES |
| `description` | `text` | YES |
| `status` | `character varying` | YES |
| `holder_id` | `integer` | YES |
| `location` | `character varying` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `inv_number` | `character varying` | YES |
| `purchase_date` | `date` | YES |
| `serial_number` | `character varying` | YES |
| `issue_date` | `date` | YES |
| `expiry_date` | `date` | YES |
| `notes` | `text` | YES |
| `comment` | `text` | YES |
| `return_date` | `date` | YES |
| `transfer_date` | `date` | YES |
| `holder_name` | `character varying` | YES |
| `prev_holder_id` | `integer` | YES |
| `prev_holder_name` | `character varying` | YES |
| `transfer_reason` | `text` | YES |
| `responsible_id` | `integer` | YES |
| `organization` | `character varying` | YES |
| `registration_number` | `character varying` | YES |
| `is_indefinite` | `boolean` | YES |
| `purpose` | `text` | YES |
| `pending_transfer_id` | `integer` | YES |

## `self_employed`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `employee_id` | `integer` | YES |
| `full_name` | `text` | NO |
| `inn` | `character varying` | NO |
| `phone` | `character varying` | YES |
| `email` | `character varying` | YES |
| `bank_name` | `text` | YES |
| `bik` | `character varying` | YES |
| `corr_account` | `character varying` | YES |
| `account_number` | `character varying` | YES |
| `card_number` | `character varying` | YES |
| `npd_status` | `character varying` | YES |
| `npd_registered_at` | `date` | YES |
| `contract_number` | `text` | YES |
| `contract_date` | `date` | YES |
| `contract_end_date` | `date` | YES |
| `comment` | `text` | YES |
| `is_active` | `boolean` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `settings`

| Column | Type | Nullable |
|--------|------|----------|
| `key` | `character varying` | NO |
| `value_json` | `text` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `id` | `integer` | NO |
| `created_at` | `timestamp without time zone` | YES |

## `site_inspections`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `work_id` | `integer` | YES |
| `estimate_id` | `integer` | YES |
| `tender_id` | `integer` | YES |
| `status` | `character varying` | NO |
| `object_name` | `character varying` | YES |
| `object_address` | `text` | YES |
| `customer_name` | `character varying` | YES |
| `customer_contact_person` | `character varying` | YES |
| `customer_contact_email` | `character varying` | YES |
| `customer_contact_phone` | `character varying` | YES |
| `inspection_dates` | `jsonb` | YES |
| `employees_json` | `jsonb` | YES |
| `vehicles_json` | `jsonb` | YES |
| `notes` | `text` | YES |
| `author_id` | `integer` | YES |
| `approved_by` | `integer` | YES |
| `approved_at` | `timestamp without time zone` | YES |
| `rejected_at` | `timestamp without time zone` | YES |
| `rejected_reason` | `text` | YES |
| `sent_at` | `timestamp without time zone` | YES |
| `email_sent_to` | `character varying` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `sites`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `name` | `character varying` | NO |
| `short_name` | `character varying` | YES |
| `lat` | `double precision` | YES |
| `lng` | `double precision` | YES |
| `region` | `character varying` | YES |
| `site_type` | `character varying` | YES |
| `customer_id` | `integer` | YES |
| `customer_name` | `character varying` | YES |
| `address` | `text` | YES |
| `description` | `text` | YES |
| `geocode_status` | `character varying` | YES |
| `geocode_source` | `character varying` | YES |
| `photo_url` | `character varying` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `status` | `character varying` | YES |

## `staff`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `name` | `character varying` | YES |
| `role_tag` | `character varying` | YES |
| `user_id` | `integer` | YES |
| `phone` | `character varying` | YES |
| `email` | `character varying` | YES |
| `is_active` | `boolean` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `position` | `character varying` | YES |
| `department` | `character varying` | YES |
| `city` | `character varying` | YES |
| `comment` | `text` | YES |

## `staff_plan`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `staff_id` | `integer` | YES |
| `date` | `date` | YES |
| `work_id` | `integer` | YES |
| `status` | `character varying` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `status_code` | `character varying` | YES |
| `note` | `text` | YES |
| `comment` | `text` | YES |
| `kind` | `character varying` | YES |
| `employee_id` | `integer` | YES |
| `staff_request_id` | `integer` | YES |
| `fio` | `character varying` | YES |

## `staff_replacements`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `staff_request_id` | `integer` | YES |
| `work_id` | `integer` | YES |
| `old_employee_id` | `integer` | YES |
| `new_employee_id` | `integer` | YES |
| `status` | `character varying` | YES |
| `reason` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `dates_json` | `jsonb` | YES |
| `comment` | `text` | YES |
| `crew` | `character varying` | YES |
| `approved_by` | `integer` | YES |
| `approved_at` | `timestamp without time zone` | YES |

## `staff_request_messages`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `staff_request_id` | `integer` | YES |
| `author_user_id` | `integer` | YES |
| `message` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `text` | `text` | YES |

## `staff_requests`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `work_id` | `integer` | YES |
| `pm_id` | `integer` | YES |
| `status` | `character varying` | YES |
| `required_count` | `integer` | YES |
| `specialization` | `text` | YES |
| `date_from` | `date` | YES |
| `date_to` | `date` | YES |
| `comments` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `proposed_staff_ids_json` | `jsonb` | YES |
| `approved_staff_ids_json` | `jsonb` | YES |
| `is_vachta` | `boolean` | YES |
| `rotation_days` | `integer` | YES |
| `request_json` | `jsonb` | YES |
| `pm_comment` | `text` | YES |
| `hr_comment` | `text` | YES |
| `crew` | `character varying` | YES |
| `proposed_staff_ids_a_json` | `jsonb` | YES |
| `proposed_staff_ids_b_json` | `jsonb` | YES |
| `approved_staff_ids_a_json` | `jsonb` | YES |
| `approved_staff_ids_b_json` | `jsonb` | YES |

## `sync_meta`

| Column | Type | Nullable |
|--------|------|----------|
| `table_name` | `character varying` | NO |
| `last_sync` | `timestamp without time zone` | YES |
| `status` | `character varying` | YES |
| `error_message` | `text` | YES |

## `task_comments`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `task_id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `text` | `text` | NO |
| `attachments` | `jsonb` | YES |
| `is_system` | `boolean` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `task_watchers`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `task_id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `created_at` | `timestamp without time zone` | YES |

## `tasks`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `creator_id` | `integer` | NO |
| `assignee_id` | `integer` | NO |
| `title` | `character varying` | NO |
| `description` | `text` | YES |
| `deadline` | `timestamp without time zone` | YES |
| `priority` | `character varying` | YES |
| `status` | `character varying` | NO |
| `accepted_at` | `timestamp without time zone` | YES |
| `completed_at` | `timestamp without time zone` | YES |
| `files` | `jsonb` | YES |
| `creator_comment` | `text` | YES |
| `assignee_comment` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `kanban_column` | `character varying` | YES |
| `kanban_position` | `integer` | YES |
| `acknowledged_at` | `timestamp without time zone` | YES |
| `acknowledged_by` | `integer` | YES |
| `work_id` | `integer` | YES |
| `tender_id` | `integer` | YES |
| `parent_task_id` | `integer` | YES |
| `estimated_hours` | `numeric` | YES |
| `actual_hours` | `numeric` | YES |
| `tags` | `jsonb` | YES |
| `archived_at` | `timestamp without time zone` | YES |
| `archived_by` | `integer` | YES |

## `telephony_escalations`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `call_id` | `integer` | YES |
| `user_id` | `integer` | YES |
| `deadline_at` | `timestamp with time zone` | NO |
| `escalated` | `boolean` | YES |
| `escalated_at` | `timestamp with time zone` | YES |
| `acknowledged` | `boolean` | YES |
| `created_at` | `timestamp with time zone` | YES |

## `telephony_events_log`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `event_type` | `character varying` | NO |
| `mango_call_id` | `character varying` | YES |
| `mango_entry_id` | `character varying` | YES |
| `payload` | `jsonb` | NO |
| `processed` | `boolean` | YES |
| `processing_result` | `jsonb` | YES |
| `error` | `text` | YES |
| `created_at` | `timestamp with time zone` | YES |

## `telephony_jobs`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `job_type` | `character varying` | NO |
| `call_id` | `integer` | YES |
| `payload` | `jsonb` | YES |
| `status` | `character varying` | YES |
| `attempts` | `integer` | YES |
| `max_attempts` | `integer` | YES |
| `error` | `text` | YES |
| `scheduled_at` | `timestamp with time zone` | YES |
| `started_at` | `timestamp with time zone` | YES |
| `completed_at` | `timestamp with time zone` | YES |
| `created_at` | `timestamp with time zone` | YES |

## `tenders`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `customer` | `character varying` | YES |
| `customer_inn` | `character varying` | YES |
| `tender_number` | `character varying` | YES |
| `tender_type` | `character varying` | YES |
| `tender_status` | `character varying` | YES |
| `period` | `character varying` | YES |
| `year` | `integer` | YES |
| `deadline` | `date` | YES |
| `estimated_sum` | `numeric` | YES |
| `responsible_pm_id` | `integer` | YES |
| `tag` | `character varying` | YES |
| `docs_link` | `text` | YES |
| `comment_to` | `text` | YES |
| `comment_dir` | `text` | YES |
| `reject_reason` | `text` | YES |
| `dedup_key` | `text` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `tender_title` | `text` | YES |
| `customer_name` | `character varying` | YES |
| `tender_price` | `numeric` | YES |
| `docs_deadline` | `date` | YES |
| `pm_id` | `integer` | YES |
| `source` | `character varying` | YES |
| `platform` | `character varying` | YES |
| `link` | `text` | YES |
| `status` | `character varying` | YES |
| `assigned_at` | `timestamp without time zone` | YES |
| `assigned_by_user_id` | `integer` | YES |
| `created_by_user_id` | `integer` | YES |
| `cost_plan` | `numeric` | YES |
| `work_start_plan` | `date` | YES |
| `work_end_plan` | `date` | YES |
| `inn` | `character varying` | YES |
| `purchase_url` | `text` | YES |
| `group_tag` | `text` | YES |
| `tender_comment_to` | `text` | YES |
| `tender_description` | `text` | YES |
| `tender_region` | `text` | YES |
| `tender_contact` | `text` | YES |
| `tender_phone` | `text` | YES |
| `tender_email` | `text` | YES |
| `handoff_at` | `timestamp without time zone` | YES |
| `handoff_by_user_id` | `integer` | YES |
| `distribution_requested_at` | `timestamp without time zone` | YES |
| `distribution_requested_by_user_id` | `integer` | YES |
| `require_docs_on_handoff` | `boolean` | YES |
| `distribution_assigned_at` | `timestamp without time zone` | YES |
| `distribution_assigned_by_user_id` | `integer` | YES |
| `tkp_sent_at` | `timestamp without time zone` | YES |
| `tkp_followup_next_at` | `timestamp without time zone` | YES |
| `tkp_followup_closed_at` | `timestamp without time zone` | YES |
| `pm_login` | `character varying` | YES |
| `saved_at` | `timestamp without time zone` | YES |
| `site_id` | `integer` | YES |
| `ai_report` | `text` | YES |
| `ai_cost_estimate` | `numeric` | YES |
| `ai_cost_report` | `text` | YES |

## `tkp`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `tender_id` | `integer` | YES |
| `number` | `text` | YES |
| `customer_name` | `text` | YES |
| `customer_inn` | `text` | YES |
| `contact_person` | `text` | YES |
| `contact_email` | `text` | YES |
| `contact_phone` | `text` | YES |
| `subject` | `text` | YES |
| `items` | `jsonb` | YES |
| `total_sum` | `numeric` | YES |
| `discount_percent` | `numeric` | YES |
| `final_sum` | `numeric` | YES |
| `valid_until` | `date` | YES |
| `status` | `text` | YES |
| `sent_at` | `timestamp with time zone` | YES |
| `sent_via` | `text` | YES |
| `pdf_path` | `text` | YES |
| `notes` | `text` | YES |
| `author_id` | `integer` | YES |
| `created_at` | `timestamp with time zone` | YES |
| `updated_at` | `timestamp with time zone` | YES |
| `work_id` | `integer` | YES |
| `services` | `text` | YES |
| `deadline` | `text` | YES |
| `validity_days` | `integer` | YES |
| `sent_by` | `integer` | YES |
| `tkp_number` | `character varying` | YES |
| `source` | `character varying` | YES |
| `approved_by` | `integer` | YES |
| `approved_at` | `timestamp without time zone` | YES |
| `customer_address` | `text` | YES |
| `work_description` | `text` | YES |
| `estimate_id` | `integer` | YES |

## `todo_items`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `text` | `character varying` | NO |
| `done` | `boolean` | YES |
| `done_at` | `timestamp without time zone` | YES |
| `auto_delete_hours` | `integer` | YES |
| `sort_order` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `training_applications`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `course_name` | `character varying` | NO |
| `provider` | `character varying` | YES |
| `training_type` | `character varying` | YES |
| `date_start` | `date` | YES |
| `date_end` | `date` | YES |
| `cost` | `numeric` | YES |
| `justification` | `text` | YES |
| `status` | `character varying` | NO |
| `comment` | `text` | YES |
| `approved_by_head` | `integer` | YES |
| `approved_by_head_at` | `timestamp with time zone` | YES |
| `approved_by_dir` | `integer` | YES |
| `approved_by_dir_at` | `timestamp with time zone` | YES |
| `paid_by_buh` | `integer` | YES |
| `paid_by_buh_at` | `timestamp with time zone` | YES |
| `completed_by_hr` | `integer` | YES |
| `completed_by_hr_at` | `timestamp with time zone` | YES |
| `rejected_by` | `integer` | YES |
| `rejected_at` | `timestamp with time zone` | YES |
| `reject_reason` | `text` | YES |
| `created_at` | `timestamp with time zone` | NO |
| `updated_at` | `timestamp with time zone` | NO |
| `requires_payment` | `boolean` | YES |
| `payment_method` | `character varying` | YES |
| `payment_status` | `character varying` | YES |
| `payment_comment` | `text` | YES |
| `payment_doc_id` | `integer` | YES |
| `buh_id` | `integer` | YES |
| `buh_acted_at` | `timestamp without time zone` | YES |

## `travel_expenses`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `expense_type` | `character varying` | YES |
| `work_id` | `integer` | YES |
| `employee_id` | `integer` | YES |
| `date` | `date` | YES |
| `amount` | `numeric` | YES |
| `description` | `text` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `supplier` | `character varying` | YES |
| `counterparty` | `character varying` | YES |
| `document_number` | `character varying` | YES |
| `status` | `character varying` | YES |
| `approved_by` | `integer` | YES |
| `approved_at` | `timestamp without time zone` | YES |
| `comment` | `text` | YES |
| `date_from` | `date` | YES |
| `date_to` | `date` | YES |
| `doc_number` | `character varying` | YES |
| `currency` | `character varying` | YES |
| `requires_payment` | `boolean` | YES |
| `payment_method` | `character varying` | YES |
| `payment_status` | `character varying` | YES |
| `payment_comment` | `text` | YES |
| `payment_doc_id` | `integer` | YES |
| `buh_id` | `integer` | YES |
| `buh_acted_at` | `timestamp without time zone` | YES |

## `user_call_status`

| Column | Type | Nullable |
|--------|------|----------|
| `user_id` | `integer` | NO |
| `accepting` | `boolean` | YES |
| `status` | `character varying` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `id` | `integer` | NO |
| `busy` | `boolean` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `mango_extension` | `character varying` | YES |
| `fallback_user_id` | `integer` | YES |
| `fallback_mobile` | `character varying` | YES |
| `work_schedule` | `jsonb` | YES |
| `is_duty` | `boolean` | YES |
| `display_name` | `character varying` | YES |
| `sip_login` | `character varying` | YES |
| `last_call_at` | `timestamp with time zone` | YES |
| `receive_call_push` | `boolean` | YES |
| `is_call_dispatcher` | `boolean` | YES |

## `user_dashboard`

| Column | Type | Nullable |
|--------|------|----------|
| `user_id` | `integer` | NO |
| `widgets_json` | `text` | YES |
| `layout_json` | `text` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `user_email_accounts`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `email_address` | `character varying` | NO |
| `imap_host` | `character varying` | YES |
| `imap_port` | `integer` | YES |
| `imap_user` | `character varying` | YES |
| `imap_pass_encrypted` | `text` | YES |
| `imap_tls` | `boolean` | YES |
| `smtp_host` | `character varying` | YES |
| `smtp_port` | `integer` | YES |
| `smtp_user` | `character varying` | YES |
| `smtp_pass_encrypted` | `text` | YES |
| `smtp_tls` | `boolean` | YES |
| `display_name` | `character varying` | YES |
| `signature_html` | `text` | YES |
| `is_active` | `boolean` | YES |
| `last_sync_at` | `timestamp without time zone` | YES |
| `last_sync_uid` | `integer` | YES |
| `last_sync_error` | `text` | YES |
| `sync_interval_sec` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `user_menu_settings`

| Column | Type | Nullable |
|--------|------|----------|
| `user_id` | `integer` | NO |
| `hidden_routes` | `jsonb` | YES |
| `route_order` | `jsonb` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `user_permissions`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `module_key` | `character varying` | NO |
| `can_read` | `boolean` | YES |
| `can_write` | `boolean` | YES |
| `can_delete` | `boolean` | YES |
| `granted_by` | `integer` | YES |
| `granted_at` | `timestamp without time zone` | YES |

## `user_requests`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | YES |
| `status` | `character varying` | YES |
| `approved_by` | `integer` | YES |
| `approved_at` | `timestamp without time zone` | YES |
| `comment` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `user_stories`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | YES |
| `content` | `text` | YES |
| `image_url` | `text` | YES |
| `created_at` | `timestamp with time zone` | YES |
| `expires_at` | `timestamp with time zone` | YES |

## `users`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `login` | `character varying` | NO |
| `password_hash` | `character varying` | NO |
| `name` | `character varying` | NO |
| `email` | `character varying` | YES |
| `role` | `character varying` | NO |
| `roles` | `ARRAY` | YES |
| `is_active` | `boolean` | YES |
| `telegram_chat_id` | `character varying` | YES |
| `temp_password_hash` | `character varying` | YES |
| `temp_password_expires` | `timestamp without time zone` | YES |
| `last_login_at` | `timestamp without time zone` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `must_change_password` | `boolean` | YES |
| `pin_hash` | `character varying` | YES |
| `phone` | `character varying` | YES |
| `birth_date` | `date` | YES |
| `employment_date` | `date` | YES |
| `is_blocked` | `boolean` | YES |
| `blocked_at` | `timestamp without time zone` | YES |
| `blocked_by` | `integer` | YES |
| `block_reason` | `text` | YES |
| `password_changed_at` | `timestamp without time zone` | YES |
| `created_by` | `integer` | YES |
| `show_in_schedule` | `boolean` | YES |
| `military_id` | `text` | YES |
| `ready` | `boolean` | YES |
| `is_approved` | `boolean` | YES |
| `patronymic` | `character varying` | YES |
| `avatar_url` | `text` | YES |

## `warehouses`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `name` | `character varying` | NO |
| `code` | `character varying` | YES |
| `address` | `text` | YES |
| `responsible_id` | `integer` | YES |
| `is_main` | `boolean` | YES |
| `is_active` | `boolean` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `phone` | `character varying` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `webauthn_challenges`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `challenge` | `text` | NO |
| `type` | `character varying` | NO |
| `created_at` | `timestamp without time zone` | YES |

## `webauthn_credentials`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `uuid` | NO |
| `user_id` | `integer` | NO |
| `credential_id` | `text` | NO |
| `public_key` | `bytea` | NO |
| `counter` | `bigint` | NO |
| `device_name` | `character varying` | YES |
| `transports` | `ARRAY` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `last_used_at` | `timestamp without time zone` | YES |

## `work_assign_requests`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `tender_id` | `integer` | YES |
| `assigned_pm_id` | `integer` | YES |
| `status` | `character varying` | YES |
| `requested_at` | `timestamp without time zone` | YES |
| `processed_at` | `timestamp without time zone` | YES |
| `comments` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |

## `work_expenses`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `work_id` | `integer` | YES |
| `category` | `character varying` | YES |
| `amount` | `numeric` | NO |
| `date` | `date` | YES |
| `description` | `text` | YES |
| `document_number` | `character varying` | YES |
| `counterparty` | `character varying` | YES |
| `source` | `character varying` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `supplier` | `character varying` | YES |
| `status` | `character varying` | YES |
| `approved_by` | `integer` | YES |
| `comment` | `text` | YES |
| `employee_id` | `integer` | YES |
| `bonus_request_id` | `integer` | YES |
| `fot_employee_id` | `integer` | YES |
| `fot_employee_name` | `character varying` | YES |
| `requires_approval` | `boolean` | YES |
| `approval_status` | `character varying` | YES |
| `import_hash` | `text` | YES |
| `notes` | `text` | YES |
| `receipt_url` | `text` | YES |
| `requires_payment` | `boolean` | YES |
| `payment_method` | `character varying` | YES |
| `payment_status` | `character varying` | YES |
| `payment_comment` | `text` | YES |
| `payment_doc_id` | `integer` | YES |
| `buh_id` | `integer` | YES |
| `buh_acted_at` | `timestamp without time zone` | YES |
| `invoice_needed` | `boolean` | YES |
| `invoice_received` | `boolean` | YES |
| `doc_number` | `character varying` | YES |
| `fot_base_pay` | `numeric` | YES |
| `fot_per_diem` | `numeric` | YES |
| `fot_bonus` | `numeric` | YES |
| `fot_date_from` | `date` | YES |
| `fot_date_to` | `date` | YES |

## `work_permit_requirements`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `work_id` | `integer` | NO |
| `permit_type_id` | `integer` | NO |
| `is_mandatory` | `boolean` | YES |
| `notes` | `text` | YES |
| `created_at` | `timestamp without time zone` | YES |

## `worker_profiles`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `user_id` | `integer` | NO |
| `data` | `jsonb` | NO |
| `filled_count` | `integer` | YES |
| `total_count` | `integer` | YES |
| `overall_score` | `integer` | YES |
| `photo_url` | `text` | YES |
| `created_by` | `integer` | YES |
| `updated_by` | `integer` | YES |
| `created_at` | `timestamp with time zone` | YES |
| `updated_at` | `timestamp with time zone` | YES |
| `employee_id` | `integer` | YES |

## `works`

| Column | Type | Nullable |
|--------|------|----------|
| `id` | `integer` | NO |
| `tender_id` | `integer` | YES |
| `estimate_id` | `integer` | YES |
| `pm_id` | `integer` | YES |
| `work_number` | `character varying` | YES |
| `work_status` | `character varying` | YES |
| `cost_plan` | `numeric` | YES |
| `cost_fact` | `numeric` | YES |
| `advance_received` | `numeric` | YES |
| `advance_date_fact` | `date` | YES |
| `balance_received` | `numeric` | YES |
| `payment_date_fact` | `date` | YES |
| `start_in_work_date` | `date` | YES |
| `city` | `character varying` | YES |
| `address` | `text` | YES |
| `comment` | `text` | YES |
| `created_by` | `integer` | YES |
| `created_at` | `timestamp without time zone` | YES |
| `updated_at` | `timestamp without time zone` | YES |
| `work_title` | `text` | YES |
| `customer_name` | `character varying` | YES |
| `customer_inn` | `character varying` | YES |
| `object_name` | `character varying` | YES |
| `contact_person` | `character varying` | YES |
| `contact_phone` | `character varying` | YES |
| `vat_pct` | `integer` | YES |
| `end_fact` | `date` | YES |
| `contract_value` | `numeric` | YES |
| `staff_ids_json` | `jsonb` | YES |
| `rotation_days` | `integer` | YES |
| `is_vachta` | `boolean` | YES |
| `hr_comment` | `text` | YES |
| `customer_score` | `integer` | YES |
| `payload_json` | `jsonb` | YES |
| `staff_request_id` | `integer` | YES |
| `started_at` | `timestamp without time zone` | YES |
| `completed_at` | `timestamp without time zone` | YES |
| `closed_at` | `timestamp without time zone` | YES |
| `closeout_submitted_at` | `timestamp without time zone` | YES |
| `proposed_staff_ids_a_json` | `jsonb` | YES |
| `proposed_staff_ids_b_json` | `jsonb` | YES |
| `approved_staff_ids_a_json` | `jsonb` | YES |
| `approved_staff_ids_b_json` | `jsonb` | YES |
| `rework_requested_at` | `timestamp without time zone` | YES |
| `advance_pct` | `numeric` | YES |
| `start_plan` | `date` | YES |
| `act_signed_date_fact` | `date` | YES |
| `closeout_submitted_by` | `integer` | YES |
| `site_id` | `integer` | YES |
| `start_fact` | `date` | YES |
| `object_address` | `text` | YES |
| `description` | `text` | YES |
| `notes` | `text` | YES |
| `priority` | `character varying` | YES |
| `end_plan` | `date` | YES |
| `delay_workdays` | `integer` | YES |
| `crew_size` | `integer` | YES |
| `deleted_at` | `timestamp without time zone` | YES |
| `deleted_by` | `integer` | YES |
