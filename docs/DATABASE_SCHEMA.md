# ASGARD CRM — Database Schema
Updated: 2026-03-18

Таблиц: **25** | Индексов: **150**

## Таблицы

### active_calls

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('active_calls_id_seq'::regclass) |
| mango_call_id | character varying | NO |  |
| mango_entry_id | character varying | YES |  |
| direction | character varying | NO |  |
| from_number | character varying | YES |  |
| to_number | character varying | YES |  |
| caller_name | character varying | YES |  |
| caller_company | character varying | YES |  |
| client_inn | character varying | YES |  |
| assigned_user_id | integer | YES |  |
| call_state | character varying | YES | 'ringing'::character varying |
| started_at | timestamp with time zone | YES | now() |
| connected_at | timestamp with time zone | YES |  |
| metadata | jsonb | YES | '{}'::jsonb |

### acts

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('acts_id_seq'::regclass) |
| act_number | character varying | YES |  |
| act_date | date | YES |  |
| status | character varying | YES | 'draft'::character varying |
| work_id | integer | YES |  |
| customer_name | character varying | YES |  |
| customer_inn | character varying | YES |  |
| amount | numeric | YES |  |
| vat_pct | integer | YES | 20 |
| total_amount | numeric | YES |  |
| signed_date | date | YES |  |
| paid_date | date | YES |  |
| notes | text | YES |  |
| created_at | timestamp without time zone | YES | now() |
| updated_at | timestamp without time zone | YES | now() |
| created_by | integer | YES |  |
| act_type | character varying | YES |  |
| vat_amount | numeric | YES |  |
| file_path | text | YES |  |
| contract_id | integer | YES |  |
| description | text | YES |  |
| customer_id | integer | YES |  |

### ai_analysis_log

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('ai_analysis_log_id_seq'::regclass) |
| entity_type | character varying | NO |  |
| entity_id | integer | NO |  |
| analysis_type | character varying | YES | 'email_classification'::character varying |
| prompt_tokens | integer | YES |  |
| completion_tokens | integer | YES |  |
| total_tokens | integer | YES |  |
| model | character varying | YES |  |
| provider | character varying | YES |  |
| duration_ms | integer | YES |  |
| input_preview | text | YES |  |
| output_json | jsonb | YES |  |
| error | text | YES |  |
| created_by | integer | YES |  |
| created_at | timestamp without time zone | YES | now() |

### approval_payment_slips

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('approval_payment_slips_id_seq'::regclass) |
| request_id | integer | NO |  |
| source_type | character varying | NO |  |
| source_id | integer | NO |  |
| document_id | integer | NO |  |
| comment | text | NO |  |
| uploaded_by | integer | YES |  |
| created_at | timestamp without time zone | NO | now() |

### audit_log

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('audit_log_id_seq'::regclass) |
| actor_user_id | integer | YES |  |
| entity_type | character varying | YES |  |
| entity_id | integer | YES |  |
| action | character varying | YES |  |
| details | jsonb | YES |  |
| created_at | timestamp without time zone | YES | now() |
| payload_json | jsonb | YES |  |
| updated_at | timestamp without time zone | YES | now() |

### bank_classification_rules

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('bank_classification_rules_id_seq'::regclass) |
| pattern | character varying | NO |  |
| match_field | character varying | YES | 'all'::character varying |
| direction | character varying | YES |  |
| article | character varying | NO |  |
| category_1c | character varying | YES |  |
| work_id | integer | YES |  |
| priority | integer | YES | 0 |
| usage_count | integer | YES | 0 |
| is_system | boolean | YES | false |
| is_active | boolean | YES | true |
| created_by | integer | YES |  |
| created_at | timestamp without time zone | YES | now() |

### bank_import_batches

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('bank_import_batches_id_seq'::regclass) |
| filename | character varying | YES |  |
| source_format | character varying | YES |  |
| total_rows | integer | YES | 0 |
| new_rows | integer | YES | 0 |
| duplicate_rows | integer | YES | 0 |
| auto_classified | integer | YES | 0 |
| manual_needed | integer | YES | 0 |
| status | character varying | YES | 'pending'::character varying |
| imported_by | integer | YES |  |
| error_message | text | YES |  |
| created_at | timestamp without time zone | YES | now() |

### bank_rules

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('bank_rules_id_seq'::regclass) |
| pattern | character varying | YES |  |
| type | character varying | YES |  |
| article | character varying | YES |  |
| counterparty | character varying | YES |  |
| created_at | timestamp without time zone | YES | now() |
| updated_at | timestamp without time zone | YES | now() |

### bank_transactions

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('bank_transactions_id_seq'::regclass) |
| import_hash | character varying | YES |  |
| external_id | character varying | YES |  |
| batch_id | integer | YES |  |
| transaction_date | date | NO |  |
| amount | numeric | NO |  |
| direction | character varying | NO |  |
| currency | character varying | YES | 'RUB'::character varying |
| counterparty_name | character varying | YES |  |
| counterparty_inn | character varying | YES |  |
| counterparty_kpp | character varying | YES |  |
| counterparty_account | character varying | YES |  |
| counterparty_bank_bik | character varying | YES |  |
| our_account | character varying | YES |  |
| our_bank_bik | character varying | YES |  |
| payment_purpose | text | YES |  |
| description | text | YES |  |
| document_number | character varying | YES |  |
| document_date | date | YES |  |
| article | character varying | YES |  |
| article_confidence | character varying | YES | 'none'::character varying |
| category_1c | character varying | YES |  |
| work_id | integer | YES |  |
| tender_id | integer | YES |  |
| linked_income_id | integer | YES |  |
| linked_expense_id | integer | YES |  |
| status | character varying | YES | 'new'::character varying |
| source_format | character varying | YES |  |
| source_filename | character varying | YES |  |
| imported_by | integer | YES |  |
| confirmed_by | integer | YES |  |
| confirmed_at | timestamp without time zone | YES |  |
| created_at | timestamp without time zone | YES | now() |
| updated_at | timestamp without time zone | YES | now() |

### bonus_requests

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('bonus_requests_id_seq'::regclass) |
| work_id | integer | YES |  |
| pm_id | integer | YES |  |
| employee_id | integer | YES |  |
| amount | numeric | YES |  |
| reason | text | YES |  |
| status | character varying | YES | 'pending'::character varying |
| approved_by | integer | YES |  |
| approved_at | timestamp without time zone | YES |  |
| created_at | timestamp without time zone | YES | now() |
| updated_at | timestamp without time zone | YES | now() |
| comment | text | YES |  |
| pm_name | character varying | YES |  |
| work_title | character varying | YES |  |
| total_amount | numeric | YES |  |
| currency | character varying | YES | 'RUB'::character varying |
| director_comment | text | YES |  |
| processed_by | integer | YES |  |
| processed_at | timestamp without time zone | YES |  |
| bonuses | jsonb | YES | '[]'::jsonb |
| bonuses_json | jsonb | YES |  |
| decided_at | timestamp without time zone | YES |  |
| decided_by_user_id | integer | YES |  |
| requires_payment | boolean | YES | true |
| payment_method | character varying | YES |  |
| payment_status | character varying | YES |  |
| payment_comment | text | YES |  |
| payment_doc_id | integer | YES |  |
| buh_id | integer | YES |  |
| buh_acted_at | timestamp without time zone | YES |  |

### business_trips

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('business_trips_id_seq'::regclass) |
| inspection_id | integer | YES |  |
| work_id | integer | YES |  |
| status | character varying | NO | 'draft'::character varying |
| date_from | date | YES |  |
| date_to | date | YES |  |
| employees_json | jsonb | YES | '[]'::jsonb |
| transport_type | character varying | YES |  |
| need_fuel_card | boolean | YES | false |
| need_air_ticket | boolean | YES | false |
| need_advance | boolean | YES | false |
| advance_amount | numeric | YES |  |
| ticket_details | text | YES |  |
| cash_request_id | integer | YES |  |
| expense_ids | jsonb | YES | '[]'::jsonb |
| author_id | integer | YES |  |
| sent_to_office_manager | boolean | YES | false |
| office_manager_notified_at | timestamp without time zone | YES |  |
| approved_by | integer | YES |  |
| approved_at | timestamp without time zone | YES |  |
| notes | text | YES |  |
| created_at | timestamp without time zone | YES | now() |
| updated_at | timestamp without time zone | YES | now() |
| requires_payment | boolean | YES | false |
| payment_method | character varying | YES |  |
| payment_status | character varying | YES |  |
| payment_comment | text | YES |  |
| buh_id | integer | YES |  |

### calendar_events

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('calendar_events_id_seq'::regclass) |
| date | date | NO |  |
| time | character varying | YES |  |
| type | character varying | YES | 'meeting'::character varying |
| title | character varying | NO |  |
| description | text | YES |  |
| participants | text | YES |  |
| reminder_minutes | integer | YES | 30 |
| reminder_sent | boolean | YES | false |
| tender_id | integer | YES |  |
| work_id | integer | YES |  |
| created_by | integer | YES |  |
| created_at | timestamp without time zone | YES | now() |
| updated_at | timestamp without time zone | YES |  |
| all_day | boolean | YES | false |
| location | character varying | YES |  |
| color | character varying | YES |  |
| status | character varying | YES | 'scheduled'::character varying |
| notes | text | YES |  |
| dates_json | jsonb | YES |  |
| confirmed_at | timestamp without time zone | YES |  |
| end_date | date | YES |  |
| end_time | time without time zone | YES |  |
| is_all_day | boolean | YES | false |
| recurrence | text | YES |  |

### call_history

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| call_id | character varying | NO |  |
| caller_number | character varying | YES |  |
| called_number | character varying | YES |  |
| direction | character varying | YES |  |
| status | character varying | YES |  |
| duration | integer | YES |  |
| recording_url | text | YES |  |
| timestamp | timestamp without time zone | YES |  |
| user_id | integer | YES |  |
| customer_id | character varying | YES |  |
| created_at | timestamp without time zone | YES | now() |
| id | integer | NO | nextval('call_history_id_seq'::regclass) |
| mango_entry_id | character varying | YES |  |
| mango_call_id | character varying | YES |  |
| from_number | character varying | YES |  |
| to_number | character varying | YES |  |
| started_at | timestamp with time zone | YES |  |
| ended_at | timestamp with time zone | YES |  |
| duration_seconds | integer | YES |  |
| call_type | character varying | YES | 'inbound'::character varying |
| record_path | text | YES |  |
| recording_id | character varying | YES |  |
| transcript | text | YES |  |
| transcript_status | character varying | YES | 'none'::character varying |
| transcript_segments | jsonb | YES |  |
| ai_summary | text | YES |  |
| ai_is_target | boolean | YES |  |
| ai_lead_data | jsonb | YES |  |
| ai_sentiment | character varying | YES |  |
| lead_id | integer | YES |  |
| client_inn | character varying | YES |  |
| dadata_region | character varying | YES |  |
| dadata_operator | character varying | YES |  |
| dadata_city | character varying | YES |  |
| missed_task_id | integer | YES |  |
| missed_acknowledged | boolean | YES | false |
| missed_callback_at | timestamp with time zone | YES |  |
| webhook_payload | jsonb | YES |  |
| line_number | character varying | YES |  |
| disconnect_reason | character varying | YES |  |
| updated_at | timestamp with time zone | YES | now() |

### call_routing_rules

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('call_routing_rules_id_seq'::regclass) |
| name | character varying | NO |  |
| description | text | YES |  |
| priority | integer | YES | 0 |
| condition_type | character varying | NO |  |
| condition_value | jsonb | NO | '{}'::jsonb |
| action_type | character varying | NO |  |
| action_value | jsonb | NO | '{}'::jsonb |
| is_active | boolean | YES | true |
| created_by | integer | YES |  |
| created_at | timestamp with time zone | YES | now() |
| updated_at | timestamp with time zone | YES | now() |

### cash_balance_log

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('cash_balance_log_id_seq'::regclass) |
| amount | numeric | NO |  |
| change_amount | numeric | YES |  |
| change_type | character varying | YES |  |
| description | text | YES |  |
| related_request_id | integer | YES |  |
| user_id | integer | YES |  |
| created_at | timestamp without time zone | YES | now() |

### cash_expenses

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('cash_expenses_id_seq'::regclass) |
| request_id | integer | NO |  |
| amount | numeric | NO |  |
| description | text | NO |  |
| receipt_file | character varying | YES |  |
| receipt_original_name | character varying | YES |  |
| expense_date | date | YES | CURRENT_DATE |
| created_at | timestamp without time zone | YES | now() |
| category | character varying | YES | 'other'::character varying |

### cash_messages

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('cash_messages_id_seq'::regclass) |
| request_id | integer | NO |  |
| user_id | integer | NO |  |
| message | text | NO |  |
| created_at | timestamp without time zone | YES | now() |

### cash_requests

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('cash_requests_id_seq'::regclass) |
| user_id | integer | NO |  |
| work_id | integer | YES |  |
| type | character varying | NO | 'advance'::character varying |
| amount | numeric | NO |  |
| purpose | text | NO |  |
| cover_letter | text | YES |  |
| status | character varying | NO | 'requested'::character varying |
| director_id | integer | YES |  |
| director_comment | text | YES |  |
| received_at | timestamp without time zone | YES |  |
| closed_at | timestamp without time zone | YES |  |
| created_at | timestamp without time zone | YES | now() |
| updated_at | timestamp without time zone | YES | now() |
| issued_by | integer | YES |  |
| issued_at | timestamp without time zone | YES |  |
| receipt_deadline | timestamp without time zone | YES |  |
| overdue_notified | boolean | YES | false |
| requires_payment | boolean | YES | true |

### cash_returns

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('cash_returns_id_seq'::regclass) |
| request_id | integer | NO |  |
| amount | numeric | NO |  |
| note | text | YES |  |
| confirmed_by | integer | YES |  |
| confirmed_at | timestamp without time zone | YES |  |
| created_at | timestamp without time zone | YES | now() |

### chat_attachments

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('chat_attachments_id_seq'::regclass) |
| message_id | integer | NO |  |
| file_name | character varying | NO |  |
| original_name | character varying | NO |  |
| mime_type | character varying | YES |  |
| file_size | integer | YES |  |
| created_at | timestamp without time zone | YES | now() |
| file_path | character varying | YES |  |

### chat_group_members

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('chat_group_members_id_seq'::regclass) |
| chat_id | integer | NO |  |
| user_id | integer | NO |  |
| role | character varying | YES | 'member'::character varying |
| muted_until | timestamp without time zone | YES |  |
| last_read_at | timestamp without time zone | YES |  |
| joined_at | timestamp without time zone | YES | now() |

### chat_messages

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('chat_messages_id_seq'::regclass) |
| chat_id | integer | YES |  |
| user_id | integer | YES |  |
| message | text | YES |  |
| attachments_json | text | YES |  |
| is_read | boolean | YES | false |
| created_at | timestamp without time zone | YES | now() |
| chat_type | character varying | YES | 'general'::character varying |
| sender_id | integer | YES |  |
| sender_name | character varying | YES |  |
| text | text | YES |  |
| timestamp | timestamp without time zone | YES | now() |
| read_by | jsonb | YES | '[]'::jsonb |
| entity_id | integer | YES |  |
| entity_title | text | YES |  |
| to_user_id | integer | YES |  |
| user_name | character varying | YES |  |
| user_role | character varying | YES |  |
| attachments | jsonb | YES | '[]'::jsonb |
| mentions | jsonb | YES | '[]'::jsonb |
| is_system | boolean | YES | false |
| updated_at | timestamp without time zone | YES | now() |
| read_at | timestamp without time zone | YES |  |
| entity_type | text | YES |  |
| created_by | integer | YES |  |
| reply_to_id | integer | YES |  |
| edited_at | timestamp without time zone | YES |  |
| deleted_at | timestamp without time zone | YES |  |
| reactions | jsonb | YES | '{}'::jsonb |
| reply_to | integer | YES |  |
| attachment_path | text | YES |  |
| attachment_name | text | YES |  |
| message_type | text | YES | 'text'::text |
| file_url | text | YES |  |
| file_duration | integer | YES |  |

### chats

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('chats_id_seq'::regclass) |
| type | character varying | YES |  |
| name | character varying | YES |  |
| entity_type | character varying | YES |  |
| entity_id | integer | YES |  |
| participants_json | text | YES |  |
| updated_at | timestamp without time zone | YES | now() |
| created_at | timestamp without time zone | YES | now() |
| is_group | boolean | YES | false |
| avatar | character varying | YES |  |
| description | text | YES |  |
| is_readonly | boolean | YES | false |
| archived_at | timestamp without time zone | YES |  |
| last_message_at | timestamp without time zone | YES |  |
| message_count | integer | YES | 0 |
| avatar_path | text | YES |  |

### contracts

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('contracts_id_seq'::regclass) |
| number | character varying | YES |  |
| type | character varying | YES |  |
| counterparty_id | character varying | YES |  |
| counterparty_name | character varying | YES |  |
| subject | text | YES |  |
| amount | numeric | YES |  |
| start_date | date | YES |  |
| end_date | date | YES |  |
| status | character varying | YES | 'active'::character varying |
| file_path | text | YES |  |
| created_by | integer | YES |  |
| created_at | timestamp without time zone | YES | now() |
| updated_at | timestamp without time zone | YES | now() |
| tender_id | integer | YES |  |
| work_id | integer | YES |  |
| is_perpetual | boolean | YES | false |
| is_indefinite | boolean | YES | false |
| vat_pct | integer | YES | 20 |
| signed_date | date | YES |  |
| customer_inn | character varying | YES |  |
| customer_name | character varying | YES |  |
| comment | text | YES |  |
| currency | character varying | YES | 'RUB'::character varying |
| file_url | text | YES |  |
| responsible | character varying | YES |  |

### correspondence

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | integer | NO | nextval('correspondence_id_seq'::regclass) |
| direction | character varying | NO |  |
| date | date | YES |  |

## Индексы

| Table | Index | Definition |
|-------|-------|------------|
| active_calls | active_calls_pkey | CREATE UNIQUE INDEX active_calls_pkey ON public.active_calls USING btree (id) |
| active_calls | idx_active_calls_user | CREATE INDEX idx_active_calls_user ON public.active_calls USING btree (assigned_user_id) |
| active_calls | active_calls_mango_call_id_key | CREATE UNIQUE INDEX active_calls_mango_call_id_key ON public.active_calls USING btree (mango_call_id) |
| active_calls | idx_active_calls_state | CREATE INDEX idx_active_calls_state ON public.active_calls USING btree (call_state) |
| acts | acts_pkey | CREATE UNIQUE INDEX acts_pkey ON public.acts USING btree (id) |
| ai_analysis_log | idx_ai_log_entity | CREATE INDEX idx_ai_log_entity ON public.ai_analysis_log USING btree (entity_type, entity_id) |
| ai_analysis_log | ai_analysis_log_pkey | CREATE UNIQUE INDEX ai_analysis_log_pkey ON public.ai_analysis_log USING btree (id) |
| ai_analysis_log | idx_ai_log_created | CREATE INDEX idx_ai_log_created ON public.ai_analysis_log USING btree (created_at DESC) |
| approval_payment_slips | uq_approval_payment_slips_document_id | CREATE UNIQUE INDEX uq_approval_payment_slips_document_id ON public.approval_payment_slips USING btree (document_id) |
| approval_payment_slips | idx_approval_payment_slips_request_id | CREATE INDEX idx_approval_payment_slips_request_id ON public.approval_payment_slips USING btree (request_id, id) |
| approval_payment_slips | approval_payment_slips_pkey | CREATE UNIQUE INDEX approval_payment_slips_pkey ON public.approval_payment_slips USING btree (id) |
| approval_payment_slips | idx_approval_payment_slips_source | CREATE INDEX idx_approval_payment_slips_source ON public.approval_payment_slips USING btree (source_type, source_id, id) |
| audit_log | idx_audit_created | CREATE INDEX idx_audit_created ON public.audit_log USING btree (created_at) |
| audit_log | idx_audit_log_entity | CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id) |
| audit_log | idx_audit_log_actor | CREATE INDEX idx_audit_log_actor ON public.audit_log USING btree (actor_user_id) |
| audit_log | idx_audit_entity | CREATE INDEX idx_audit_entity ON public.audit_log USING btree (entity_type, entity_id) |
| audit_log | audit_log_pkey | CREATE UNIQUE INDEX audit_log_pkey ON public.audit_log USING btree (id) |
| audit_log | idx_audit_actor | CREATE INDEX idx_audit_actor ON public.audit_log USING btree (actor_user_id) |
| bank_classification_rules | idx_bank_rules_pattern | CREATE INDEX idx_bank_rules_pattern ON public.bank_classification_rules USING btree (pattern) |
| bank_classification_rules | bank_classification_rules_pkey | CREATE UNIQUE INDEX bank_classification_rules_pkey ON public.bank_classification_rules USING btree (id) |
| bank_import_batches | bank_import_batches_pkey | CREATE UNIQUE INDEX bank_import_batches_pkey ON public.bank_import_batches USING btree (id) |
| bank_rules | bank_rules_pkey | CREATE UNIQUE INDEX bank_rules_pkey ON public.bank_rules USING btree (id) |
| bank_transactions | idx_bank_tx_article | CREATE INDEX idx_bank_tx_article ON public.bank_transactions USING btree (article) |
| bank_transactions | idx_bank_tx_date | CREATE INDEX idx_bank_tx_date ON public.bank_transactions USING btree (transaction_date DESC) |
| bank_transactions | idx_bank_tx_hash | CREATE INDEX idx_bank_tx_hash ON public.bank_transactions USING btree (import_hash) |
| bank_transactions | idx_bank_tx_batch | CREATE INDEX idx_bank_tx_batch ON public.bank_transactions USING btree (batch_id) |
| bank_transactions | bank_transactions_pkey | CREATE UNIQUE INDEX bank_transactions_pkey ON public.bank_transactions USING btree (id) |
| bank_transactions | idx_bank_tx_counterparty | CREATE INDEX idx_bank_tx_counterparty ON public.bank_transactions USING btree (counterparty_inn) |
| bank_transactions | bank_transactions_import_hash_key | CREATE UNIQUE INDEX bank_transactions_import_hash_key ON public.bank_transactions USING btree (import_hash) |
| bank_transactions | idx_bank_tx_status | CREATE INDEX idx_bank_tx_status ON public.bank_transactions USING btree (status) |
| bonus_requests | bonus_requests_pkey | CREATE UNIQUE INDEX bonus_requests_pkey ON public.bonus_requests USING btree (id) |
| bonus_requests | idx_bonus_requests_payment | CREATE INDEX idx_bonus_requests_payment ON public.bonus_requests USING btree (payment_status) WHERE (requires_payment = true) |
| business_trips | idx_business_trips_work | CREATE INDEX idx_business_trips_work ON public.business_trips USING btree (work_id) |
| business_trips | idx_business_trips_inspection | CREATE INDEX idx_business_trips_inspection ON public.business_trips USING btree (inspection_id) |
| business_trips | idx_business_trips_payment | CREATE INDEX idx_business_trips_payment ON public.business_trips USING btree (payment_status) WHERE (requires_payment = true) |
| business_trips | business_trips_pkey | CREATE UNIQUE INDEX business_trips_pkey ON public.business_trips USING btree (id) |
| business_trips | idx_business_trips_status | CREATE INDEX idx_business_trips_status ON public.business_trips USING btree (status) |
| calendar_events | calendar_events_pkey | CREATE UNIQUE INDEX calendar_events_pkey ON public.calendar_events USING btree (id) |
| calendar_events | idx_calendar_type | CREATE INDEX idx_calendar_type ON public.calendar_events USING btree (type) |
| calendar_events | idx_calendar_date | CREATE INDEX idx_calendar_date ON public.calendar_events USING btree (date) |
| call_history | idx_call_history_mango_entry | CREATE INDEX idx_call_history_mango_entry ON public.call_history USING btree (mango_entry_id) |
| call_history | idx_call_history_to_number | CREATE INDEX idx_call_history_to_number ON public.call_history USING btree (to_number) |
| call_history | idx_call_history_from_number | CREATE INDEX idx_call_history_from_number ON public.call_history USING btree (from_number) |
| call_history | idx_call_history_transcript_status | CREATE INDEX idx_call_history_transcript_status ON public.call_history USING btree (transcript_status) WHERE ((transcript_status)::text <> 'none'::text) |
| call_history | idx_call_history_call_type | CREATE INDEX idx_call_history_call_type ON public.call_history USING btree (call_type) |
| call_history | idx_call_history_created_at | CREATE INDEX idx_call_history_created_at ON public.call_history USING btree (created_at DESC) |
| call_history | idx_call_history_user_id | CREATE INDEX idx_call_history_user_id ON public.call_history USING btree (user_id) |
| call_history | idx_call_history_client_inn | CREATE INDEX idx_call_history_client_inn ON public.call_history USING btree (client_inn) |
| call_history | idx_call_history_mango_call | CREATE INDEX idx_call_history_mango_call ON public.call_history USING btree (mango_call_id) |
| call_history | call_history_pkey | CREATE UNIQUE INDEX call_history_pkey ON public.call_history USING btree (call_id) |
| call_history | idx_call_history_id | CREATE UNIQUE INDEX idx_call_history_id ON public.call_history USING btree (id) |
| call_history | idx_call_history_missed | CREATE INDEX idx_call_history_missed ON public.call_history USING btree (call_type, missed_acknowledged) WHERE ((call_type)::text = 'missed'::text) |
| call_routing_rules | call_routing_rules_pkey | CREATE UNIQUE INDEX call_routing_rules_pkey ON public.call_routing_rules USING btree (id) |
| call_routing_rules | idx_routing_rules_active | CREATE INDEX idx_routing_rules_active ON public.call_routing_rules USING btree (is_active, priority DESC) |
| cash_balance_log | cash_balance_log_pkey | CREATE UNIQUE INDEX cash_balance_log_pkey ON public.cash_balance_log USING btree (id) |
| cash_balance_log | idx_cash_balance_log_created | CREATE INDEX idx_cash_balance_log_created ON public.cash_balance_log USING btree (created_at DESC) |
| cash_expenses | idx_cash_expenses_request | CREATE INDEX idx_cash_expenses_request ON public.cash_expenses USING btree (request_id) |
| cash_expenses | cash_expenses_pkey | CREATE UNIQUE INDEX cash_expenses_pkey ON public.cash_expenses USING btree (id) |
| cash_messages | cash_messages_pkey | CREATE UNIQUE INDEX cash_messages_pkey ON public.cash_messages USING btree (id) |
| cash_messages | idx_cash_messages_request | CREATE INDEX idx_cash_messages_request ON public.cash_messages USING btree (request_id) |
| cash_requests | idx_cash_requests_user | CREATE INDEX idx_cash_requests_user ON public.cash_requests USING btree (user_id) |
| cash_requests | idx_cash_requests_status | CREATE INDEX idx_cash_requests_status ON public.cash_requests USING btree (status) |
| cash_requests | idx_cash_requests_work | CREATE INDEX idx_cash_requests_work ON public.cash_requests USING btree (work_id) |
| cash_requests | cash_requests_pkey | CREATE UNIQUE INDEX cash_requests_pkey ON public.cash_requests USING btree (id) |
| cash_returns | cash_returns_pkey | CREATE UNIQUE INDEX cash_returns_pkey ON public.cash_returns USING btree (id) |
| cash_returns | idx_cash_returns_request | CREATE INDEX idx_cash_returns_request ON public.cash_returns USING btree (request_id) |
| chat_attachments | idx_chat_attachments_message | CREATE INDEX idx_chat_attachments_message ON public.chat_attachments USING btree (message_id) |
| chat_attachments | chat_attachments_pkey | CREATE UNIQUE INDEX chat_attachments_pkey ON public.chat_attachments USING btree (id) |
| chat_group_members | idx_chat_group_members_user | CREATE INDEX idx_chat_group_members_user ON public.chat_group_members USING btree (user_id) |
| chat_group_members | chat_group_members_chat_id_user_id_key | CREATE UNIQUE INDEX chat_group_members_chat_id_user_id_key ON public.chat_group_members USING btree (chat_id, user_id) |
| chat_group_members | chat_group_members_pkey | CREATE UNIQUE INDEX chat_group_members_pkey ON public.chat_group_members USING btree (id) |
| chat_group_members | idx_chat_group_members_chat | CREATE INDEX idx_chat_group_members_chat ON public.chat_group_members USING btree (chat_id) |
| chat_messages | idx_chat_messages_created | CREATE INDEX idx_chat_messages_created ON public.chat_messages USING btree (created_at) |
| chat_messages | idx_chat_messages_chat_id | CREATE INDEX idx_chat_messages_chat_id ON public.chat_messages USING btree (chat_id) |
| chat_messages | idx_chat_messages_created_at | CREATE INDEX idx_chat_messages_created_at ON public.chat_messages USING btree (created_at) |
| chat_messages | idx_chat_messages_entity_id | CREATE INDEX idx_chat_messages_entity_id ON public.chat_messages USING btree (entity_id) |
| chat_messages | idx_chat_messages_reply | CREATE INDEX idx_chat_messages_reply ON public.chat_messages USING btree (reply_to_id) |
| chat_messages | idx_chat_messages_to_user_id | CREATE INDEX idx_chat_messages_to_user_id ON public.chat_messages USING btree (to_user_id) |
| chat_messages | idx_chat_messages_type | CREATE INDEX idx_chat_messages_type ON public.chat_messages USING btree (chat_type) |
| chat_messages | idx_chat_messages_updated | CREATE INDEX idx_chat_messages_updated ON public.chat_messages USING btree (updated_at) |
| chat_messages | idx_chat_messages_user_id | CREATE INDEX idx_chat_messages_user_id ON public.chat_messages USING btree (user_id) |
| chat_messages | chat_messages_pkey | CREATE UNIQUE INDEX chat_messages_pkey ON public.chat_messages USING btree (id) |
| chat_messages | idx_chat_messages_chat_type | CREATE INDEX idx_chat_messages_chat_type ON public.chat_messages USING btree (chat_type) |
| chats | idx_chats_archived | CREATE INDEX idx_chats_archived ON public.chats USING btree (archived_at) |
| chats | idx_chats_is_group | CREATE INDEX idx_chats_is_group ON public.chats USING btree (is_group) |
| chats | idx_chats_last_message | CREATE INDEX idx_chats_last_message ON public.chats USING btree (last_message_at DESC) |
| chats | chats_pkey | CREATE UNIQUE INDEX chats_pkey ON public.chats USING btree (id) |
| contracts | contracts_pkey | CREATE UNIQUE INDEX contracts_pkey ON public.contracts USING btree (id) |
| correspondence | idx_correspondence_direction | CREATE INDEX idx_correspondence_direction ON public.correspondence USING btree (direction) |
| correspondence | idx_correspondence_email_id | CREATE INDEX idx_correspondence_email_id ON public.correspondence USING btree (email_id) |
| correspondence | idx_correspondence_inbox_app | CREATE INDEX idx_correspondence_inbox_app ON public.correspondence USING btree (linked_inbox_application_id) WHERE (linked_inbox_application_id IS NOT NULL) |
| correspondence | idx_correspondence_date | CREATE INDEX idx_correspondence_date ON public.correspondence USING btree (date) |
| correspondence | idx_correspondence_number | CREATE UNIQUE INDEX idx_correspondence_number ON public.correspondence USING btree (number) WHERE ((number IS NOT NULL) AND ((number)::text <> ''::text)) |
| correspondence | correspondence_pkey | CREATE UNIQUE INDEX correspondence_pkey ON public.correspondence USING btree (id) |
| correspondence_outgoing_counters | correspondence_outgoing_counters_pkey | CREATE UNIQUE INDEX correspondence_outgoing_counters_pkey ON public.correspondence_outgoing_counters USING btree (period_key) |
| customer_reviews | customer_reviews_pkey | CREATE UNIQUE INDEX customer_reviews_pkey ON public.customer_reviews USING btree (id) |
| customers | customers_name_unique | CREATE UNIQUE INDEX customers_name_unique ON public.customers USING btree (name) |
| customers | idx_customers_name | CREATE INDEX idx_customers_name ON public.customers USING btree (name) |
| customers | idx_customers_id | CREATE UNIQUE INDEX idx_customers_id ON public.customers USING btree (id) |
| customers | customers_inn_unique | CREATE UNIQUE INDEX customers_inn_unique ON public.customers USING btree (inn) WHERE ((inn IS NOT NULL) AND ((inn)::text <> ''::text)) |
| customers | customers_pkey | CREATE UNIQUE INDEX customers_pkey ON public.customers USING btree (id) |
| doc_sets | doc_sets_pkey | CREATE UNIQUE INDEX doc_sets_pkey ON public.doc_sets USING btree (id) |
| documents | documents_pkey | CREATE UNIQUE INDEX documents_pkey ON public.documents USING btree (id) |
| documents | idx_documents_tender | CREATE INDEX idx_documents_tender ON public.documents USING btree (tender_id) |
| documents | idx_documents_work | CREATE INDEX idx_documents_work ON public.documents USING btree (work_id) |
| email_accounts | email_accounts_pkey | CREATE UNIQUE INDEX email_accounts_pkey ON public.email_accounts USING btree (id) |
| email_accounts | email_accounts_email_address_key | CREATE UNIQUE INDEX email_accounts_email_address_key ON public.email_accounts USING btree (email_address) |
| email_attachments | idx_email_attachments_email | CREATE INDEX idx_email_attachments_email ON public.email_attachments USING btree (email_id) |
| email_attachments | email_attachments_pkey | CREATE UNIQUE INDEX email_attachments_pkey ON public.email_attachments USING btree (id) |
| email_classification_rules | email_classification_rules_pkey | CREATE UNIQUE INDEX email_classification_rules_pkey ON public.email_classification_rules USING btree (id) |
| email_folders | idx_email_folders_user | CREATE INDEX idx_email_folders_user ON public.email_folders USING btree (user_account_id, sort_order) |
| email_folders | idx_email_folders_account | CREATE INDEX idx_email_folders_account ON public.email_folders USING btree (account_id) |
| email_folders | idx_email_folders_user_account | CREATE INDEX idx_email_folders_user_account ON public.email_folders USING btree (user_account_id) |
| email_folders | email_folders_pkey | CREATE UNIQUE INDEX email_folders_pkey ON public.email_folders USING btree (id) |
| email_history | email_history_pkey | CREATE UNIQUE INDEX email_history_pkey ON public.email_history USING btree (id) |
| email_log | email_log_pkey | CREATE UNIQUE INDEX email_log_pkey ON public.email_log USING btree (id) |
| email_queue | email_queue_pkey | CREATE UNIQUE INDEX email_queue_pkey ON public.email_queue USING btree (id) |
| email_sync_log | email_sync_log_pkey | CREATE UNIQUE INDEX email_sync_log_pkey ON public.email_sync_log USING btree (id) |
| email_sync_log | idx_email_sync_log_account | CREATE INDEX idx_email_sync_log_account ON public.email_sync_log USING btree (account_id, started_at DESC) |
| email_templates_v2 | email_templates_v2_pkey | CREATE UNIQUE INDEX email_templates_v2_pkey ON public.email_templates_v2 USING btree (id) |
| email_templates_v2 | email_templates_v2_code_key | CREATE UNIQUE INDEX email_templates_v2_code_key ON public.email_templates_v2 USING btree (code) |
| emails | idx_emails_starred | CREATE INDEX idx_emails_starred ON public.emails USING btree (is_starred) WHERE (is_starred = true) |
| emails | emails_pkey | CREATE UNIQUE INDEX emails_pkey ON public.emails USING btree (id) |
| emails | idx_emails_user_account_date | CREATE INDEX idx_emails_user_account_date ON public.emails USING btree (user_account_id, email_date DESC) |
| emails | idx_emails_user_account_folder | CREATE INDEX idx_emails_user_account_folder ON public.emails USING btree (user_account_id, folder_id, is_deleted, is_draft) |
| emails | idx_emails_folder | CREATE INDEX idx_emails_folder ON public.emails USING btree (folder_id) |
| emails | idx_emails_user_account | CREATE INDEX idx_emails_user_account ON public.emails USING btree (user_account_id) |
| emails | idx_emails_owner | CREATE INDEX idx_emails_owner ON public.emails USING btree (owner_user_id) |
| emails | idx_emails_account | CREATE INDEX idx_emails_account ON public.emails USING btree (account_id) |
| emails | idx_emails_date | CREATE INDEX idx_emails_date ON public.emails USING btree (email_date DESC) |
| emails | idx_emails_direction | CREATE INDEX idx_emails_direction ON public.emails USING btree (direction) |
| emails | idx_emails_from | CREATE INDEX idx_emails_from ON public.emails USING btree (from_email) |
| emails | idx_emails_imap_uid | CREATE INDEX idx_emails_imap_uid ON public.emails USING btree (account_id, imap_uid) |
| emails | idx_emails_list | CREATE INDEX idx_emails_list ON public.emails USING btree (direction, is_deleted, is_archived, email_date DESC) |
| emails | idx_emails_message_id_unique | CREATE UNIQUE INDEX idx_emails_message_id_unique ON public.emails USING btree (message_id) WHERE (message_id IS NOT NULL) |
| emails | idx_emails_thread | CREATE INDEX idx_emails_thread ON public.emails USING btree (thread_id) WHERE (thread_id IS NOT NULL) |
| emails | idx_emails_type | CREATE INDEX idx_emails_type ON public.emails USING btree (email_type) |
| emails | idx_emails_unread | CREATE INDEX idx_emails_unread ON public.emails USING btree (is_read) WHERE ((is_read = false) AND (is_deleted = false)) |
| employee_assignments | employee_assignments_pkey | CREATE UNIQUE INDEX employee_assignments_pkey ON public.employee_assignments USING btree (id) |
| employee_collection_items | employee_collection_items_collection_id_employee_id_key | CREATE UNIQUE INDEX employee_collection_items_collection_id_employee_id_key ON public.employee_collection_items USING btree (collection_id, employee_id) |
| employee_collection_items | idx_ecol_items_coll | CREATE INDEX idx_ecol_items_coll ON public.employee_collection_items USING btree (collection_id) |
| employee_collection_items | idx_ecol_items_emp | CREATE INDEX idx_ecol_items_emp ON public.employee_collection_items USING btree (employee_id) |
| employee_collection_items | employee_collection_items_pkey | CREATE UNIQUE INDEX employee_collection_items_pkey ON public.employee_collection_items USING btree (id) |
| employee_collections | employee_collections_pkey | CREATE UNIQUE INDEX employee_collections_pkey ON public.employee_collections USING btree (id) |
| employee_collections | idx_ecol_active | CREATE INDEX idx_ecol_active ON public.employee_collections USING btree (is_active) WHERE (is_active = true) |
| employee_permits | idx_permits_expiry | CREATE INDEX idx_permits_expiry ON public.employee_permits USING btree (expiry_date) |
| employee_permits | idx_permits_active | CREATE INDEX idx_permits_active ON public.employee_permits USING btree (is_active) |
| employee_permits | idx_permits_type | CREATE INDEX idx_permits_type ON public.employee_permits USING btree (type_id) |
| employee_permits | employee_permits_pkey | CREATE UNIQUE INDEX employee_permits_pkey ON public.employee_permits USING btree (id) |
| employee_permits | idx_permits_employee | CREATE INDEX idx_permits_employee ON public.employee_permits USING btree (employee_id) |
