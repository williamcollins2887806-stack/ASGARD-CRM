# ASGARD CRM — Полная схема БД
# Автогенерация: 18.03.2026
# 142 таблицы, PostgreSQL

## active_calls
- id integer NOT NULL DEFAULT nextval('active_calls_id_seq'::regclass)
- mango_call_id character varying(200) NOT NULL
- mango_entry_id character varying(200)
- direction character varying(20) NOT NULL
- from_number character varying(50)
- to_number character varying(50)
- caller_name character varying(200)
- caller_company character varying(300)
- client_inn character varying(50)
- assigned_user_id integer
- call_state character varying(30) DEFAULT 'ringing'::character varying
- started_at timestamp with time zone DEFAULT now()
- connected_at timestamp with time zone
- metadata jsonb DEFAULT '{}'::jsonb

## acts
- id integer NOT NULL DEFAULT nextval('acts_id_seq'::regclass)
- act_number character varying(50)
- act_date date
- status character varying(20) DEFAULT 'draft'::character varying
- work_id integer
- customer_name character varying(255)
- customer_inn character varying(20)
- amount numeric
- vat_pct integer DEFAULT 20
- total_amount numeric
- signed_date date
- paid_date date
- notes text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- created_by integer
- act_type character varying(50)
- vat_amount numeric
- file_path text
- contract_id integer
- description text
- customer_id integer

## ai_analysis_log
- id integer NOT NULL DEFAULT nextval('ai_analysis_log_id_seq'::regcla
- entity_type character varying(50) NOT NULL
- entity_id integer NOT NULL
- analysis_type character varying(50) DEFAULT 'email_classification'::character varyin
- prompt_tokens integer
- completion_tokens integer
- total_tokens integer
- model character varying(100)
- provider character varying(30)
- duration_ms integer
- input_preview text
- output_json jsonb
- error text
- created_by integer
- created_at timestamp without time zone DEFAULT now()

## approval_payment_slips
- id integer NOT NULL DEFAULT nextval('approval_payment_slips_id_seq':
- request_id integer NOT NULL
- source_type character varying(50) NOT NULL
- source_id integer NOT NULL
- document_id integer NOT NULL
- comment text NOT NULL
- uploaded_by integer
- created_at timestamp without time zone NOT NULL DEFAULT now()

## audit_log
- id integer NOT NULL DEFAULT nextval('audit_log_id_seq'::regclass)
- actor_user_id integer
- entity_type character varying(50)
- entity_id integer
- action character varying(50)
- details jsonb
- created_at timestamp without time zone DEFAULT now()
- payload_json jsonb
- updated_at timestamp without time zone DEFAULT now()

## bank_classification_rules
- id integer NOT NULL DEFAULT nextval('bank_classification_rules_id_se
- pattern character varying(255) NOT NULL
- match_field character varying(30) DEFAULT 'all'::character varying
- direction character varying(10)
- article character varying(100) NOT NULL
- category_1c character varying(100)
- work_id integer
- priority integer DEFAULT 0
- usage_count integer DEFAULT 0
- is_system boolean DEFAULT false
- is_active boolean DEFAULT true
- created_by integer
- created_at timestamp without time zone DEFAULT now()

## bank_import_batches
- id integer NOT NULL DEFAULT nextval('bank_import_batches_id_seq'::re
- filename character varying(255)
- source_format character varying(30)
- total_rows integer DEFAULT 0
- new_rows integer DEFAULT 0
- duplicate_rows integer DEFAULT 0
- auto_classified integer DEFAULT 0
- manual_needed integer DEFAULT 0
- status character varying(30) DEFAULT 'pending'::character varying
- imported_by integer
- error_message text
- created_at timestamp without time zone DEFAULT now()

## bank_rules
- id integer NOT NULL DEFAULT nextval('bank_rules_id_seq'::regclass)
- pattern character varying(500)
- type character varying(50)
- article character varying(100)
- counterparty character varying(500)
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## bank_transactions
- id integer NOT NULL DEFAULT nextval('bank_transactions_id_seq'::regc
- import_hash character varying(100)
- external_id character varying(255)
- batch_id integer
- transaction_date date NOT NULL
- amount numeric NOT NULL
- direction character varying(10) NOT NULL
- currency character varying(3) DEFAULT 'RUB'::character varying
- counterparty_name character varying(500)
- counterparty_inn character varying(20)
- counterparty_kpp character varying(20)
- counterparty_account character varying(30)
- counterparty_bank_bik character varying(20)
- our_account character varying(30)
- our_bank_bik character varying(20)
- payment_purpose text
- description text
- document_number character varying(50)
- document_date date
- article character varying(100)
- article_confidence character varying(20) DEFAULT 'none'::character varying
- category_1c character varying(100)
- work_id integer
- tender_id integer
- linked_income_id integer
- linked_expense_id integer
- status character varying(30) DEFAULT 'new'::character varying
- source_format character varying(30)
- source_filename character varying(255)
- imported_by integer
- confirmed_by integer
- confirmed_at timestamp without time zone
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## bonus_requests
- id integer NOT NULL DEFAULT nextval('bonus_requests_id_seq'::regclas
- work_id integer
- pm_id integer
- employee_id integer
- amount numeric
- reason text
- status character varying(50) DEFAULT 'pending'::character varying
- approved_by integer
- approved_at timestamp without time zone
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- comment text
- pm_name character varying(255)
- work_title character varying(500)
- total_amount numeric
- currency character varying(10) DEFAULT 'RUB'::character varying
- director_comment text
- processed_by integer
- processed_at timestamp without time zone
- bonuses jsonb DEFAULT '[]'::jsonb
- bonuses_json jsonb
- decided_at timestamp without time zone
- decided_by_user_id integer
- requires_payment boolean DEFAULT true
- payment_method character varying(20)
- payment_status character varying(30)
- payment_comment text
- payment_doc_id integer
- buh_id integer
- buh_acted_at timestamp without time zone

## business_trips
- id integer NOT NULL DEFAULT nextval('business_trips_id_seq'::regclas
- inspection_id integer
- work_id integer
- status character varying(50) NOT NULL DEFAULT 'draft'::character varying
- date_from date
- date_to date
- employees_json jsonb DEFAULT '[]'::jsonb
- transport_type character varying(50)
- need_fuel_card boolean DEFAULT false
- need_air_ticket boolean DEFAULT false
- need_advance boolean DEFAULT false
- advance_amount numeric
- ticket_details text
- cash_request_id integer
- expense_ids jsonb DEFAULT '[]'::jsonb
- author_id integer
- sent_to_office_manager boolean DEFAULT false
- office_manager_notified_at timestamp without time zone
- approved_by integer
- approved_at timestamp without time zone
- notes text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- requires_payment boolean DEFAULT false
- payment_method character varying(20)
- payment_status character varying(30)
- payment_comment text
- buh_id integer

## calendar_events
- id integer NOT NULL DEFAULT nextval('calendar_events_id_seq'::regcla
- date date NOT NULL
- time character varying(10)
- type character varying(50) DEFAULT 'meeting'::character varying
- title character varying(500) NOT NULL
- description text
- participants text
- reminder_minutes integer DEFAULT 30
- reminder_sent boolean DEFAULT false
- tender_id integer
- work_id integer
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone
- all_day boolean DEFAULT false
- location character varying(255)
- color character varying(20)
- status character varying(50) DEFAULT 'scheduled'::character varying
- notes text
- dates_json jsonb
- confirmed_at timestamp without time zone
- end_date date
- end_time time without time zone
- is_all_day boolean DEFAULT false
- recurrence text

## call_history
- call_id character varying(100) NOT NULL
- caller_number character varying(50)
- called_number character varying(50)
- direction character varying(20)
- status character varying(50)
- duration integer
- recording_url text
- timestamp timestamp without time zone
- user_id integer
- customer_id character varying(50)
- created_at timestamp without time zone DEFAULT now()
- id integer NOT NULL DEFAULT nextval('call_history_id_seq'::regclass)
- mango_entry_id character varying(200)
- mango_call_id character varying(200)
- from_number character varying(50)
- to_number character varying(50)
- started_at timestamp with time zone
- ended_at timestamp with time zone
- duration_seconds integer
- call_type character varying(20) DEFAULT 'inbound'::character varying
- record_path text
- recording_id character varying(200)
- transcript text
- transcript_status character varying(20) DEFAULT 'none'::character varying
- transcript_segments jsonb
- ai_summary text
- ai_is_target boolean
- ai_lead_data jsonb
- ai_sentiment character varying(20)
- lead_id integer
- client_inn character varying(50)
- dadata_region character varying(150)
- dadata_operator character varying(150)
- dadata_city character varying(150)
- missed_task_id integer
- missed_acknowledged boolean DEFAULT false
- missed_callback_at timestamp with time zone
- webhook_payload jsonb
- line_number character varying(50)
- disconnect_reason character varying(100)
- updated_at timestamp with time zone DEFAULT now()

## call_routing_rules
- id integer NOT NULL DEFAULT nextval('call_routing_rules_id_seq'::reg
- name character varying(200) NOT NULL
- description text
- priority integer DEFAULT 0
- condition_type character varying(50) NOT NULL
- condition_value jsonb NOT NULL DEFAULT '{}'::jsonb
- action_type character varying(50) NOT NULL
- action_value jsonb NOT NULL DEFAULT '{}'::jsonb
- is_active boolean DEFAULT true
- created_by integer
- created_at timestamp with time zone DEFAULT now()
- updated_at timestamp with time zone DEFAULT now()

## cash_balance_log
- id integer NOT NULL DEFAULT nextval('cash_balance_log_id_seq'::regcl
- amount numeric NOT NULL
- change_amount numeric
- change_type character varying(50)
- description text
- related_request_id integer
- user_id integer
- created_at timestamp without time zone DEFAULT now()

## cash_expenses
- id integer NOT NULL DEFAULT nextval('cash_expenses_id_seq'::regclass
- request_id integer NOT NULL
- amount numeric NOT NULL
- description text NOT NULL
- receipt_file character varying(255)
- receipt_original_name character varying(255)
- expense_date date DEFAULT CURRENT_DATE
- created_at timestamp without time zone DEFAULT now()
- category character varying(50) DEFAULT 'other'::character varying

## cash_messages
- id integer NOT NULL DEFAULT nextval('cash_messages_id_seq'::regclass
- request_id integer NOT NULL
- user_id integer NOT NULL
- message text NOT NULL
- created_at timestamp without time zone DEFAULT now()

## cash_requests
- id integer NOT NULL DEFAULT nextval('cash_requests_id_seq'::regclass
- user_id integer NOT NULL
- work_id integer
- type character varying(20) NOT NULL DEFAULT 'advance'::character varying
- amount numeric NOT NULL
- purpose text NOT NULL
- cover_letter text
- status character varying(20) NOT NULL DEFAULT 'requested'::character varying
- director_id integer
- director_comment text
- received_at timestamp without time zone
- closed_at timestamp without time zone
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- issued_by integer
- issued_at timestamp without time zone
- receipt_deadline timestamp without time zone
- overdue_notified boolean DEFAULT false
- requires_payment boolean DEFAULT true

## cash_returns
- id integer NOT NULL DEFAULT nextval('cash_returns_id_seq'::regclass)
- request_id integer NOT NULL
- amount numeric NOT NULL
- note text
- confirmed_by integer
- confirmed_at timestamp without time zone
- created_at timestamp without time zone DEFAULT now()

## chat_attachments
- id integer NOT NULL DEFAULT nextval('chat_attachments_id_seq'::regcl
- message_id integer NOT NULL
- file_name character varying(255) NOT NULL
- original_name character varying(255) NOT NULL
- mime_type character varying(100)
- file_size integer
- created_at timestamp without time zone DEFAULT now()
- file_path character varying(500)

## chat_group_members
- id integer NOT NULL DEFAULT nextval('chat_group_members_id_seq'::reg
- chat_id integer NOT NULL
- user_id integer NOT NULL
- role character varying(20) DEFAULT 'member'::character varying
- muted_until timestamp without time zone
- last_read_at timestamp without time zone
- joined_at timestamp without time zone DEFAULT now()

## chat_messages
- id integer NOT NULL DEFAULT nextval('chat_messages_id_seq'::regclass
- chat_id integer
- user_id integer
- message text
- attachments_json text
- is_read boolean DEFAULT false
- created_at timestamp without time zone DEFAULT now()
- chat_type character varying(50) DEFAULT 'general'::character varying
- sender_id integer
- sender_name character varying(255)
- text text
- timestamp timestamp without time zone DEFAULT now()
- read_by jsonb DEFAULT '[]'::jsonb
- entity_id integer
- entity_title text
- to_user_id integer
- user_name character varying(255)
- user_role character varying(50)
- attachments jsonb DEFAULT '[]'::jsonb
- mentions jsonb DEFAULT '[]'::jsonb
- is_system boolean DEFAULT false
- updated_at timestamp without time zone DEFAULT now()
- read_at timestamp without time zone
- entity_type text
- created_by integer
- reply_to_id integer
- edited_at timestamp without time zone
- deleted_at timestamp without time zone
- reactions jsonb DEFAULT '{}'::jsonb
- reply_to integer
- attachment_path text
- attachment_name text
- message_type text DEFAULT 'text'::text
- file_url text
- file_duration integer
- waveform jsonb

## chats
- id integer NOT NULL DEFAULT nextval('chats_id_seq'::regclass)
- type character varying(50)
- name character varying(200)
- entity_type character varying(50)
- entity_id integer
- participants_json text
- updated_at timestamp without time zone DEFAULT now()
- created_at timestamp without time zone DEFAULT now()
- is_group boolean DEFAULT false
- avatar character varying(255)
- description text
- is_readonly boolean DEFAULT false
- archived_at timestamp without time zone
- last_message_at timestamp without time zone
- message_count integer DEFAULT 0
- avatar_path text
- is_mimir boolean DEFAULT false

## contracts
- id integer NOT NULL DEFAULT nextval('contracts_id_seq'::regclass)
- number character varying(100)
- type character varying(50)
- counterparty_id character varying(50)
- counterparty_name character varying(500)
- subject text
- amount numeric
- start_date date
- end_date date
- status character varying(50) DEFAULT 'active'::character varying
- file_path text
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- tender_id integer
- work_id integer
- is_perpetual boolean DEFAULT false
- is_indefinite boolean DEFAULT false
- vat_pct integer DEFAULT 20
- signed_date date
- customer_inn character varying(20)
- customer_name character varying(500)
- comment text
- currency character varying(10) DEFAULT 'RUB'::character varying
- file_url text
- responsible character varying(255)

## correspondence
- id integer NOT NULL DEFAULT nextval('correspondence_id_seq'::regclas
- direction character varying(20) NOT NULL
- date date
- number character varying(100)
- counterparty character varying(500)
- subject text
- content text
- tender_id integer
- work_id integer
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone
- doc_type character varying(50)
- file_path text
- status character varying(50)
- contact_person character varying(255)
- note text
- email_id integer
- customer_id integer
- body text
- linked_inbox_application_id integer

## correspondence_outgoing_counters
- period_key character varying(7) NOT NULL
- last_number integer NOT NULL
- created_at timestamp without time zone NOT NULL DEFAULT now()
- updated_at timestamp without time zone NOT NULL DEFAULT now()

## customer_reviews
- id integer NOT NULL DEFAULT nextval('customer_reviews_id_seq'::regcl
- work_id integer
- pm_id integer
- customer_id character varying(50)
- rating integer
- comment text
- created_at timestamp without time zone DEFAULT now()

## customers
- inn character varying(30)
- name character varying(500) NOT NULL
- full_name character varying(1000)
- address character varying(1000)
- phone character varying(100)
- email character varying(255)
- contact_person character varying(255)
- category character varying(100)
- comment text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone
- id integer NOT NULL DEFAULT nextval('customers_id_seq'::regclass)
- kpp character varying(20)
- city character varying(255)
- note text
- ogrn character varying(20)
- contacts_json text
- last_review_at timestamp without time zone
- legal_address character varying(1000)

## doc_sets
- id integer NOT NULL DEFAULT nextval('doc_sets_id_seq'::regclass)
- tender_id integer
- work_id integer
- name character varying(200)
- status character varying(50)
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## documents
- id integer NOT NULL DEFAULT nextval('documents_id_seq'::regclass)
- filename character varying(255) NOT NULL
- original_name character varying(500)
- mime_type character varying(100)
- size integer
- type character varying(100)
- tender_id integer
- work_id integer
- uploaded_by integer
- created_at timestamp without time zone DEFAULT now()
- category character varying(100)
- description text
- employee_id integer
- updated_at timestamp without time zone DEFAULT now()
- file_url text
- download_url text
- uploaded_by_user_id integer

## email_accounts
- id integer NOT NULL DEFAULT nextval('email_accounts_id_seq'::regclas
- name character varying(255) NOT NULL
- email_address character varying(255) NOT NULL
- account_type character varying(50) DEFAULT 'primary'::character varying
- imap_host character varying(255)
- imap_port integer DEFAULT 993
- imap_user character varying(255)
- imap_pass_encrypted text
- imap_tls boolean DEFAULT true
- imap_folder character varying(255) DEFAULT 'INBOX'::character varying
- smtp_host character varying(255)
- smtp_port integer DEFAULT 587
- smtp_user character varying(255)
- smtp_pass_encrypted text
- smtp_tls boolean DEFAULT true
- smtp_from_name character varying(255) DEFAULT 'ООО «Асгард Сервис»'::character varying
- sync_enabled boolean DEFAULT true
- sync_interval_sec integer DEFAULT 120
- sync_max_emails integer DEFAULT 200
- last_sync_at timestamp without time zone
- last_sync_uid integer DEFAULT 0
- last_sync_error text
- is_active boolean DEFAULT true
- is_copy_target boolean DEFAULT false
- exclude_from_inbox boolean DEFAULT false
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## email_attachments
- id integer NOT NULL DEFAULT nextval('email_attachments_id_seq'::regc
- email_id integer NOT NULL
- filename character varying(500) NOT NULL
- original_filename character varying(500)
- mime_type character varying(255) DEFAULT 'application/octet-stream'::character va
- size bigint DEFAULT 0
- file_path text NOT NULL
- content_id character varying(500)
- content_disposition character varying(50)
- is_inline boolean DEFAULT false
- checksum_sha256 character varying(64)
- thumbnail_path text
- ai_content_type character varying(100)
- ai_extracted_text text
- created_at timestamp without time zone DEFAULT now()

## email_classification_rules
- id integer NOT NULL DEFAULT nextval('email_classification_rules_id_s
- rule_type character varying(50) NOT NULL
- pattern character varying(500) NOT NULL
- match_mode character varying(20) DEFAULT 'contains'::character varying
- classification character varying(50) NOT NULL
- confidence integer DEFAULT 80
- priority integer DEFAULT 0
- is_active boolean DEFAULT true
- description character varying(500)
- times_matched integer DEFAULT 0
- last_matched_at timestamp without time zone
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## email_folders
- id integer NOT NULL DEFAULT nextval('email_folders_id_seq'::regclass
- user_account_id integer
- account_id integer
- name character varying(255) NOT NULL
- imap_path character varying(255)
- folder_type character varying(50) DEFAULT 'custom'::character varying
- unread_count integer DEFAULT 0
- total_count integer DEFAULT 0
- color character varying(20)
- sort_order integer DEFAULT 0
- created_at timestamp without time zone DEFAULT now()

## email_history
- id integer NOT NULL DEFAULT nextval('email_history_id_seq'::regclass
- recipient character varying(255)
- subject character varying(255)
- body text
- status character varying(20) DEFAULT 'sent'::character varying
- sent_at timestamp without time zone DEFAULT now()
- error_message text

## email_log
- id integer NOT NULL DEFAULT nextval('email_log_id_seq'::regclass)
- user_id integer
- to_email character varying(255)
- subject character varying(500)
- status character varying(50)
- message_id character varying(255)
- error text
- created_at timestamp without time zone DEFAULT now()

## email_queue
- id integer NOT NULL DEFAULT nextval('email_queue_id_seq'::regclass)
- recipient character varying(255)
- subject character varying(255)
- body text
- scheduled_for timestamp without time zone
- attempts integer DEFAULT 0
- status character varying(20) DEFAULT 'pending'::character varying
- created_at timestamp without time zone DEFAULT now()

## email_sync_log
- id integer NOT NULL DEFAULT nextval('email_sync_log_id_seq'::regclas
- account_id integer
- sync_type character varying(50) NOT NULL
- status character varying(50) NOT NULL DEFAULT 'running'::character varying
- emails_fetched integer DEFAULT 0
- emails_new integer DEFAULT 0
- emails_updated integer DEFAULT 0
- attachments_saved integer DEFAULT 0
- errors_count integer DEFAULT 0
- error_details jsonb DEFAULT '[]'::jsonb
- duration_ms integer
- started_at timestamp without time zone DEFAULT now()
- completed_at timestamp without time zone

## email_templates_v2
- id integer NOT NULL DEFAULT nextval('email_templates_v2_id_seq'::reg
- code character varying(100) NOT NULL
- name character varying(255) NOT NULL
- category character varying(100) DEFAULT 'custom'::character varying
- subject_template text NOT NULL
- body_template text NOT NULL
- variables_schema jsonb DEFAULT '[]'::jsonb
- use_letterhead boolean DEFAULT false
- default_cc text
- auto_attach_files jsonb DEFAULT '[]'::jsonb
- is_system boolean DEFAULT false
- is_active boolean DEFAULT true
- sort_order integer DEFAULT 0
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## emails
- id integer NOT NULL DEFAULT nextval('emails_id_seq'::regclass)
- account_id integer
- direction character varying(10) NOT NULL DEFAULT 'inbound'::character varying
- message_id character varying(998)
- in_reply_to character varying(998)
- references_header text
- thread_id character varying(255)
- from_email character varying(255)
- from_name character varying(255)
- to_emails jsonb DEFAULT '[]'::jsonb
- cc_emails jsonb DEFAULT '[]'::jsonb
- bcc_emails jsonb DEFAULT '[]'::jsonb
- reply_to_email character varying(255)
- subject text
- body_text text
- body_html text
- body_html_raw text
- snippet character varying(300)
- email_type character varying(50) DEFAULT 'unknown'::character varying
- classification_confidence integer DEFAULT 0
- classification_rule_id integer
- is_read boolean DEFAULT false
- is_starred boolean DEFAULT false
- is_archived boolean DEFAULT false
- is_deleted boolean DEFAULT false
- is_spam boolean DEFAULT false
- is_draft boolean DEFAULT false
- linked_tender_id integer
- linked_work_id integer
- linked_customer_inn character varying(20)
- linked_entities jsonb DEFAULT '{}'::jsonb
- has_attachments boolean DEFAULT false
- attachment_count integer DEFAULT 0
- total_attachments_size bigint DEFAULT 0
- imap_uid integer
- imap_folder character varying(255) DEFAULT 'INBOX'::character varying
- imap_flags text
- raw_headers text
- sent_by_user_id integer
- template_id integer
- reply_to_email_id integer
- forward_of_email_id integer
- ai_summary text
- ai_classification text
- ai_color character varying(20)
- ai_recommendation text
- ai_processed_at timestamp without time zone
- email_date timestamp without time zone NOT NULL DEFAULT now()
- synced_at timestamp without time zone DEFAULT now()
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- pre_tender_id integer
- user_account_id integer
- owner_user_id integer
- folder_id integer
- is_crm_copy boolean DEFAULT false

## employee_assignments
- id integer NOT NULL DEFAULT nextval('employee_assignments_id_seq'::r
- employee_id integer
- work_id integer
- date_from date
- date_to date
- role character varying(100)
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## employee_collection_items
- id integer NOT NULL DEFAULT nextval('employee_collection_items_id_se
- collection_id integer NOT NULL
- employee_id integer NOT NULL
- added_by integer
- added_at timestamp without time zone DEFAULT now()

## employee_collections
- id integer NOT NULL DEFAULT nextval('employee_collections_id_seq'::r
- name character varying(255) NOT NULL
- description text
- created_by integer
- is_active boolean DEFAULT true
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## employee_permits
- id integer NOT NULL DEFAULT nextval('employee_permits_id_seq'::regcl
- employee_id integer
- type_id integer
- permit_type character varying(100)
- permit_number character varying(100)
- issue_date date
- expiry_date date
- file_path text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- category character varying(100)
- doc_number character varying(100)
- file_url text
- issuer character varying(255)
- status character varying(50) DEFAULT 'active'::character varying
- scan_file character varying(255)
- scan_original_name character varying(255)
- notify_30_sent boolean DEFAULT false
- notify_14_sent boolean DEFAULT false
- notify_expired_sent boolean DEFAULT false
- is_active boolean DEFAULT true
- created_by integer
- renewal_of integer
- notes text

## employee_plan
- id integer NOT NULL DEFAULT nextval('employee_plan_id_seq'::regclass
- employee_id integer
- date date NOT NULL
- status character varying(50)
- work_id integer
- comment text
- created_at timestamp without time zone DEFAULT now()
- kind character varying(50)
- note text
- updated_at timestamp without time zone DEFAULT now()
- staff_id integer
- user_id integer
- status_code character varying(10)
- object_name character varying(500)
- shift_type character varying(50)
- hours numeric
- notes text
- source character varying(50)
- staff_request_id integer
- locked boolean DEFAULT false

## employee_rates
- id integer NOT NULL DEFAULT nextval('employee_rates_id_seq'::regclas
- employee_id integer
- role_tag character varying(100)
- day_rate numeric NOT NULL
- shift_rate numeric
- overtime_rate numeric
- effective_from date DEFAULT CURRENT_DATE
- effective_to date
- comment text
- created_by integer
- created_at timestamp without time zone DEFAULT now()

## employee_reviews
- id integer NOT NULL DEFAULT nextval('employee_reviews_id_seq'::regcl
- employee_id integer
- work_id integer
- pm_id integer
- rating integer
- comment text
- created_at timestamp without time zone DEFAULT now()

## employees
- id integer NOT NULL DEFAULT nextval('employees_id_seq'::regclass)
- fio character varying(255) NOT NULL
- phone character varying(100)
- email character varying(255)
- role_tag character varying(100)
- skills ARRAY
- rating_avg numeric DEFAULT 0
- is_active boolean DEFAULT true
- user_id integer
- comment text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone
- city character varying(255)
- position character varying(255)
- full_name character varying(255)
- passport_data text
- inn character varying(20)
- snils character varying(20)
- birth_date date
- address text
- employment_date date
- dismissal_date date
- salary numeric
- rate numeric
- gender character varying(10)
- grade character varying(50)
- hire_date date
- pass_series character varying(10)
- pass_number character varying(20)
- imt_number character varying(50)
- imt_expires date
- permits jsonb
- rating_count integer DEFAULT 0
- docs_url text
- is_self_employed boolean DEFAULT false
- bank_name text
- bik character varying(20)
- account_number character varying(30)
- card_number character varying(20)
- passport_series character varying(10)
- passport_number character varying(10)
- day_rate numeric
- contract_type character varying(30) DEFAULT 'labor'::character varying
- department character varying(100)
- registration_address text
- birth_place text
- passport_date text
- passport_issued text
- passport_code text
- naks text
- naks_number character varying(100)
- naks_stamp character varying(20)
- naks_date date
- naks_expiry date
- fsb_pass text
- score_index character varying(50)
- qualification_name text
- qualification_grade character varying(50)
- brigade character varying(100)
- notes text

## equipment
- id integer NOT NULL DEFAULT nextval('equipment_id_seq'::regclass)
- inventory_number character varying(50) NOT NULL
- name character varying(255) NOT NULL
- category_id integer
- serial_number character varying(100)
- barcode character varying(100)
- qr_code text
- qr_uuid character varying(36)
- purchase_price numeric
- purchase_date date
- invoice_id integer
- balance_date date
- balance_status character varying(20) DEFAULT 'pending'::character varying
- useful_life_months integer DEFAULT 60
- salvage_value numeric DEFAULT 0
- depreciation_method character varying(20) DEFAULT 'linear'::character varying
- accumulated_depreciation numeric DEFAULT 0
- book_value numeric
- last_depreciation_date date
- auto_write_off boolean DEFAULT true
- status character varying(30) DEFAULT 'on_warehouse'::character varying
- condition character varying(20) DEFAULT 'good'::character varying
- quantity numeric DEFAULT 1
- unit character varying(20) DEFAULT 'шт'::character varying
- warranty_end date
- next_maintenance date
- next_calibration date
- maintenance_interval_days integer
- warehouse_id integer
- current_holder_id integer
- current_object_id integer
- brand character varying(100)
- model character varying(100)
- specifications jsonb
- notes text
- photos ARRAY
- written_off_date date
- written_off_reason text
- written_off_by integer
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- description text
- location character varying(255)
- is_active boolean DEFAULT true
- comment text
- holder_id integer
- object_id integer
- work_id integer
- photo_url text
- kit_id integer
- min_stock_level integer DEFAULT 0
- reorder_point integer DEFAULT 0
- custom_icon text

## equipment_categories
- id integer NOT NULL DEFAULT nextval('equipment_categories_id_seq'::r
- name character varying(100) NOT NULL
- code character varying(20)
- parent_id integer
- icon character varying(10)
- requires_calibration boolean DEFAULT false
- is_consumable boolean DEFAULT false
- description text
- sort_order integer DEFAULT 0
- created_at timestamp without time zone DEFAULT now()

## equipment_kit_items
- id integer NOT NULL DEFAULT nextval('equipment_kit_items_id_seq'::re
- kit_id integer NOT NULL
- equipment_id integer
- category_id integer
- item_name character varying(200)
- quantity integer DEFAULT 1
- is_required boolean DEFAULT true
- sort_order integer DEFAULT 0
- notes text
- created_at timestamp without time zone DEFAULT now()

## equipment_kits
- id integer NOT NULL DEFAULT nextval('equipment_kits_id_seq'::regclas
- name character varying(200) NOT NULL
- code character varying(50)
- description text
- work_type character varying(100)
- icon character varying(10) DEFAULT '🧰'::character varying
- photo_url text
- is_template boolean DEFAULT false
- is_active boolean DEFAULT true
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## equipment_maintenance
- id integer NOT NULL DEFAULT nextval('equipment_maintenance_id_seq'::
- equipment_id integer
- maintenance_type character varying(30) NOT NULL
- description text
- cost numeric
- spare_parts jsonb
- performed_by character varying(255)
- contractor character varying(255)
- started_at date
- completed_at date
- next_date date
- invoice_id integer
- notes text
- photos ARRAY
- created_by integer
- created_at timestamp without time zone DEFAULT now()

## equipment_movements
- id integer NOT NULL DEFAULT nextval('equipment_movements_id_seq'::re
- equipment_id integer
- movement_type character varying(30) NOT NULL
- from_warehouse_id integer
- from_holder_id integer
- from_object_id integer
- to_warehouse_id integer
- to_holder_id integer
- to_object_id integer
- work_id integer
- quantity numeric DEFAULT 1
- condition_before character varying(20)
- condition_after character varying(20)
- document_number character varying(50)
- photos_before ARRAY
- photos_after ARRAY
- notes text
- confirmed boolean DEFAULT false
- confirmed_by integer
- confirmed_at timestamp without time zone
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- verification_photos ARRAY
- checklist jsonb

## equipment_requests
- id integer NOT NULL DEFAULT nextval('equipment_requests_id_seq'::reg
- request_type character varying(20) NOT NULL
- status character varying(20) DEFAULT 'pending'::character varying
- requester_id integer
- equipment_id integer
- quantity numeric DEFAULT 1
- work_id integer
- object_id integer
- target_holder_id integer
- needed_from date
- needed_to date
- notes text
- processed_by integer
- processed_at timestamp without time zone
- rejection_reason text
- created_at timestamp without time zone DEFAULT now()
- reason text
- updated_at timestamp without time zone DEFAULT now()
- urgency character varying(20)

## equipment_reservations
- id integer NOT NULL DEFAULT nextval('equipment_reservations_id_seq':
- equipment_id integer
- work_id integer
- reserved_by integer
- reserved_from date NOT NULL
- reserved_to date NOT NULL
- status character varying(20) DEFAULT 'active'::character varying
- notes text
- created_at timestamp without time zone DEFAULT now()

## equipment_work_assignments
- id integer NOT NULL DEFAULT nextval('equipment_work_assignments_id_s
- equipment_id integer NOT NULL
- work_id integer NOT NULL
- assigned_by integer
- assigned_at timestamp without time zone DEFAULT now()
- returned_at timestamp without time zone
- condition_on_assign character varying(50)
- condition_on_return character varying(50)
- photo_assign ARRAY
- photo_return ARRAY
- notes text
- status character varying(30) DEFAULT 'active'::character varying

## erp_connections
- id integer NOT NULL DEFAULT nextval('erp_connections_id_seq'::regcla
- name character varying(255) NOT NULL
- erp_type character varying(50) NOT NULL
- connection_url text
- auth_type character varying(30) DEFAULT 'basic'::character varying
- auth_credentials_encrypted text
- is_active boolean DEFAULT true
- sync_direction character varying(20) DEFAULT 'both'::character varying
- last_sync_at timestamp without time zone
- last_sync_status character varying(30)
- last_sync_error text
- sync_interval_minutes integer DEFAULT 60
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- webhook_secret character varying(128)

## erp_field_mappings
- id integer NOT NULL DEFAULT nextval('erp_field_mappings_id_seq'::reg
- connection_id integer
- entity_type character varying(50) NOT NULL
- crm_field character varying(100) NOT NULL
- erp_field character varying(100) NOT NULL
- transform_rule character varying(255)
- is_required boolean DEFAULT false
- is_active boolean DEFAULT true
- created_at timestamp without time zone DEFAULT now()

## erp_sync_log
- id integer NOT NULL DEFAULT nextval('erp_sync_log_id_seq'::regclass)
- connection_id integer
- direction character varying(10) NOT NULL
- entity_type character varying(50) NOT NULL
- records_total integer DEFAULT 0
- records_success integer DEFAULT 0
- records_failed integer DEFAULT 0
- error_details jsonb DEFAULT '[]'::jsonb
- started_at timestamp without time zone DEFAULT now()
- completed_at timestamp without time zone
- status character varying(30) DEFAULT 'running'::character varying
- initiated_by integer

## estimate_approval_events
- id integer NOT NULL DEFAULT nextval('estimate_approval_events_id_seq
- request_id integer NOT NULL
- estimate_id integer NOT NULL
- action character varying(50) NOT NULL
- from_stage character varying(50)
- to_stage character varying(50) NOT NULL
- actor_id integer
- actor_role character varying(50)
- comment text
- payload_json jsonb
- created_at timestamp without time zone NOT NULL DEFAULT now()

## estimate_approval_requests
- id integer NOT NULL DEFAULT nextval('estimate_approval_requests_id_s
- estimate_id integer NOT NULL
- tender_id integer
- requested_by integer NOT NULL
- pm_id integer
- estimate_version_no integer
- current_stage character varying(50) NOT NULL
- last_rework_kind character varying(20)
- submitted_snapshot_json jsonb NOT NULL
- submitted_at timestamp without time zone NOT NULL DEFAULT now()
- last_action_at timestamp without time zone NOT NULL DEFAULT now()
- last_actor_id integer
- last_comment text
- finalized_at timestamp without time zone
- cancelled_at timestamp without time zone
- created_at timestamp without time zone NOT NULL DEFAULT now()
- updated_at timestamp without time zone NOT NULL DEFAULT now()
- requires_payment boolean NOT NULL DEFAULT false
- source_type character varying(50)
- source_id integer

## estimates
- id integer NOT NULL DEFAULT nextval('estimates_id_seq'::regclass)
- tender_id integer
- pm_id integer
- approval_status character varying(100) DEFAULT 'draft'::character varying
- total_sum numeric
- cost_sum numeric
- margin_percent numeric
- deadline date
- work_days integer
- comment text
- calc_data jsonb
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone
- version integer DEFAULT 1
- is_approved boolean DEFAULT false
- approved_by integer
- approved_at timestamp without time zone
- status character varying(50)
- city character varying(255)
- distance_km integer
- people_count integer
- work_type character varying(100)
- vat_pct integer DEFAULT 20
- price_tkp numeric
- cost_plan numeric
- work_start_plan date
- work_end_plan date
- version_no integer DEFAULT 1
- calc_summary_json jsonb
- quick_calc_json jsonb
- payload_json jsonb
- sent_for_approval_at timestamp without time zone
- approval_comment text
- reject_reason text
- user_id integer
- probability_pct integer DEFAULT 50
- payment_terms text
- calc_v2_json jsonb
- profit_per_day numeric
- price_with_vat numeric
- decided_at timestamp without time zone
- cover_letter text
- assumptions text
- margin_pct numeric
- overhead_pct numeric
- fot_tax_pct numeric
- profit_tax_pct numeric
- consumables_pct numeric
- decided_by_user_id integer
- items_json jsonb
- staff_ids_json jsonb
- proposed_staff_ids_json jsonb
- approved_staff_ids_json jsonb
- proposed_staff_ids_a_json jsonb
- proposed_staff_ids_b_json jsonb
- approved_staff_ids_a_json jsonb
- approved_staff_ids_b_json jsonb
- work_id integer
- estimate_data_json jsonb
- title character varying(500)
- description text
- amount numeric
- cost numeric
- margin numeric
- notes text
- customer character varying(500)
- object_name character varying(500)
- priority character varying(30)

## expenses
- id integer NOT NULL DEFAULT nextval('expenses_id_seq'::regclass)
- user_id integer
- work_id integer
- category text
- amount numeric
- description text
- status text DEFAULT 'pending'::text
- approved_at timestamp without time zone
- rejected_at timestamp without time zone
- processed_at timestamp without time zone
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- requires_payment boolean DEFAULT false
- payment_method character varying(20)
- payment_status character varying(30)
- payment_comment text
- payment_doc_id integer
- buh_id integer
- buh_acted_at timestamp without time zone

## hr_requests
- id integer NOT NULL DEFAULT nextval('hr_requests_id_seq'::regclass)
- user_id integer
- type text
- status text DEFAULT 'pending'::text
- request_json jsonb
- comment text
- decided_at timestamp without time zone
- decided_by_user_id integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## inbox_applications
- id integer NOT NULL DEFAULT nextval('inbox_applications_id_seq'::reg
- email_id integer
- source character varying(50) DEFAULT 'email'::character varying
- source_email character varying(255)
- source_name character varying(255)
- subject text
- body_preview text
- ai_classification character varying(50)
- ai_color character varying(10)
- ai_summary text
- ai_recommendation text
- ai_work_type character varying(100)
- ai_estimated_budget numeric
- ai_estimated_days integer
- ai_keywords ARRAY
- ai_confidence numeric
- ai_raw_json jsonb
- ai_analyzed_at timestamp without time zone
- ai_model character varying(100)
- workload_snapshot jsonb
- status character varying(30) DEFAULT 'new'::character varying
- decision_by integer
- decision_at timestamp without time zone
- decision_notes text
- rejection_reason text
- linked_tender_id integer
- linked_work_id integer
- attachment_count integer DEFAULT 0
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- ai_report text
- ai_cost_estimate numeric
- ai_cost_report text

## incomes
- id integer NOT NULL DEFAULT nextval('incomes_id_seq'::regclass)
- work_id integer
- type character varying(100)
- amount numeric NOT NULL
- date date
- counterparty character varying(255)
- description text
- document_number character varying(100)
- source character varying(50)
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone
- invoice_id integer
- comment text
- confirmed boolean DEFAULT true
- import_hash text

## inventory_checks
- id integer NOT NULL DEFAULT nextval('inventory_checks_id_seq'::regcl
- warehouse_id integer
- check_date date NOT NULL
- status character varying(20) DEFAULT 'in_progress'::character varying
- total_items integer DEFAULT 0
- found_items integer DEFAULT 0
- missing_items integer DEFAULT 0
- surplus_items integer DEFAULT 0
- notes text
- conducted_by integer
- completed_at timestamp without time zone
- created_at timestamp without time zone DEFAULT now()

## invoice_payments
- id integer NOT NULL DEFAULT nextval('invoice_payments_id_seq'::regcl
- invoice_id integer
- amount numeric
- payment_date date
- payment_method character varying(50)
- comment text
- created_at timestamp without time zone DEFAULT now()
- created_by integer

## invoices
- id integer NOT NULL DEFAULT nextval('invoices_id_seq'::regclass)
- invoice_number character varying(50)
- invoice_date date
- invoice_type character varying(20) DEFAULT 'incoming'::character varying
- status character varying(20) DEFAULT 'pending'::character varying
- work_id integer
- act_id integer
- customer_name character varying(255)
- customer_inn character varying(20)
- amount numeric
- vat_pct integer DEFAULT 20
- total_amount numeric
- due_date date
- paid_amount numeric DEFAULT 0
- notes text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- created_by integer
- paid_date date
- vat_amount numeric
- file_path text
- contract_id integer
- comment text
- description text
- customer_id integer
- items_json jsonb
- exported_at timestamp without time zone
- source character varying(50)
- tender_id integer
- estimate_id integer
- tkp_id integer

## ivr_audio_cache
- id integer NOT NULL DEFAULT nextval('ivr_audio_cache_id_seq'::regcla
- text_hash character varying(64) NOT NULL
- text text NOT NULL
- file_path text NOT NULL
- voice character varying(50) DEFAULT 'alena'::character varying
- format character varying(20) DEFAULT 'oggopus'::character varying
- file_size integer
- created_at timestamp with time zone DEFAULT now()
- last_used_at timestamp with time zone DEFAULT now()

## meeting_minutes
- id integer NOT NULL DEFAULT nextval('meeting_minutes_id_seq'::regcla
- meeting_id integer NOT NULL
- item_order integer DEFAULT 0
- item_type character varying(20) DEFAULT 'note'::character varying
- content text NOT NULL
- responsible_user_id integer
- deadline timestamp without time zone
- task_id integer
- created_by integer NOT NULL
- created_at timestamp without time zone DEFAULT now()

## meeting_participants
- id integer NOT NULL DEFAULT nextval('meeting_participants_id_seq'::r
- meeting_id integer NOT NULL
- user_id integer NOT NULL
- rsvp_status character varying(20) DEFAULT 'pending'::character varying
- rsvp_comment text
- attended boolean
- notified_at timestamp without time zone
- reminder_sent_at timestamp without time zone
- created_at timestamp without time zone DEFAULT now()

## meetings
- id integer NOT NULL DEFAULT nextval('meetings_id_seq'::regclass)
- organizer_id integer NOT NULL
- title character varying(255) NOT NULL
- description text
- location character varying(255)
- start_time timestamp without time zone NOT NULL
- end_time timestamp without time zone
- is_recurring boolean DEFAULT false
- recurrence_rule text
- status character varying(20) DEFAULT 'scheduled'::character varying
- agenda text
- minutes text
- minutes_author_id integer
- minutes_approved_at timestamp without time zone
- work_id integer
- tender_id integer
- notify_before_minutes integer DEFAULT 15
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## migrations
- id integer NOT NULL DEFAULT nextval('migrations_id_seq'::regclass)
- name character varying(255) NOT NULL
- executed_at timestamp without time zone DEFAULT now()

## mimir_conversations
- id integer NOT NULL DEFAULT nextval('mimir_conversations_id_seq'::re
- user_id integer NOT NULL
- title character varying(500) DEFAULT 'Новый диалог'::character varying
- is_archived boolean DEFAULT false
- is_pinned boolean DEFAULT false
- message_count integer DEFAULT 0
- total_tokens integer DEFAULT 0
- last_message_at timestamp without time zone
- last_message_preview text
- metadata jsonb DEFAULT '{}'::jsonb
- created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
- updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP

## mimir_messages
- id integer NOT NULL DEFAULT nextval('mimir_messages_id_seq'::regclas
- conversation_id integer NOT NULL
- role character varying(20) NOT NULL
- content text NOT NULL
- content_type character varying(20) DEFAULT 'text'::character varying
- tokens_input integer DEFAULT 0
- tokens_output integer DEFAULT 0
- model_used character varying(100)
- has_files boolean DEFAULT false
- file_names ARRAY
- search_results jsonb
- duration_ms integer
- metadata jsonb DEFAULT '{}'::jsonb
- created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP

## mimir_usage_log
- id integer NOT NULL DEFAULT nextval('mimir_usage_log_id_seq'::regcla
- user_id integer
- conversation_id integer
- provider character varying(20) DEFAULT 'unknown'::character varying
- model character varying(100) DEFAULT 'unknown'::character varying
- tokens_input integer DEFAULT 0
- tokens_output integer DEFAULT 0
- duration_ms integer DEFAULT 0
- success boolean DEFAULT true
- error_message text
- created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP

## modules
- id integer NOT NULL DEFAULT nextval('modules_id_seq'::regclass)
- key character varying(50) NOT NULL
- label character varying(100) NOT NULL
- description text
- category character varying(50) DEFAULT 'general'::character varying
- icon character varying(50)
- sort_order integer DEFAULT 100
- is_active boolean DEFAULT true
- created_at timestamp without time zone DEFAULT now()

## notifications
- id integer NOT NULL DEFAULT nextval('notifications_id_seq'::regclass
- user_id integer
- type character varying(100)
- title character varying(500)
- message text
- is_read boolean DEFAULT false
- created_at timestamp without time zone DEFAULT now()
- entity_id integer
- entity_type character varying(50)
- link text
- updated_at timestamp without time zone DEFAULT now()
- read_at timestamp without time zone
- link_hash text
- kind text
- day_key text
- dedup_key text
- dismissed_at timestamp without time zone
- created_by integer
- url character varying(500)
- body text

## objects
- id integer NOT NULL DEFAULT nextval('objects_id_seq'::regclass)
- name character varying(200) NOT NULL
- code character varying(20)
- address text
- city character varying(100)
- is_active boolean DEFAULT true
- created_at timestamp without time zone DEFAULT now()
- customer_inn character varying(20)
- work_id integer
- updated_at timestamp without time zone DEFAULT now()

## office_expenses
- id integer NOT NULL DEFAULT nextval('office_expenses_id_seq'::regcla
- category character varying(100)
- amount numeric NOT NULL
- date date
- description text
- document_number character varying(100)
- counterparty character varying(255)
- status character varying(50) DEFAULT 'pending'::character varying
- approved_by integer
- approved_at timestamp without time zone
- source character varying(50)
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone
- supplier character varying(255)
- doc_number character varying(100)
- comment text
- vat_pct integer DEFAULT 20
- vat_amount numeric
- total_amount numeric
- payment_date date
- invoice_needed boolean DEFAULT false
- invoice_received boolean DEFAULT false
- number character varying(100)
- payment_method character varying(50)
- contract_id integer
- submitted_at timestamp without time zone
- work_id integer
- import_hash text
- notes text
- receipt_url text
- requires_payment boolean DEFAULT true
- payment_status character varying(30)
- payment_comment text
- payment_doc_id integer
- buh_id integer
- buh_acted_at timestamp without time zone

## one_time_payments
- id integer NOT NULL DEFAULT nextval('one_time_payments_id_seq'::regc
- employee_id integer
- employee_name text
- work_id integer
- amount numeric NOT NULL
- reason text NOT NULL
- payment_method character varying(30) DEFAULT 'card'::character varying
- payment_type character varying(30) DEFAULT 'one_time'::character varying
- status character varying(30) DEFAULT 'pending'::character varying
- requested_by integer
- approved_by integer
- approved_at timestamp without time zone
- paid_at timestamp without time zone
- comment text
- director_comment text
- receipt_url text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- requires_payment boolean DEFAULT true
- payment_status character varying(30)
- payment_comment text
- payment_doc_id integer
- buh_id integer
- buh_acted_at timestamp without time zone

## pass_requests
- id integer NOT NULL DEFAULT nextval('pass_requests_id_seq'::regclass
- tender_id integer
- work_id integer
- object_name text
- object_address text
- request_type text DEFAULT 'Пропуск'::text
- workers jsonb DEFAULT '[]'::jsonb
- vehicles jsonb DEFAULT '[]'::jsonb
- date_from date
- date_to date
- status text DEFAULT 'draft'::text
- pdf_path text
- notes text
- author_id integer
- approved_by integer
- created_at timestamp with time zone DEFAULT now()
- updated_at timestamp with time zone DEFAULT now()
- request_date date DEFAULT CURRENT_DATE
- equipment_json jsonb DEFAULT '[]'::jsonb
- contact_person text
- contact_phone text
- approved_at timestamp with time zone

## payment_registry
- id integer NOT NULL DEFAULT nextval('payment_registry_id_seq'::regcl
- sheet_id integer
- employee_id integer
- employee_name text
- amount numeric NOT NULL
- payment_type character varying(30) DEFAULT 'salary'::character varying
- payment_method character varying(30) DEFAULT 'card'::character varying
- inn character varying(20)
- bank_name text
- bik character varying(20)
- account_number character varying(30)
- status character varying(30) DEFAULT 'pending'::character varying
- paid_at timestamp without time zone
- bank_ref text
- payment_order_number text
- comment text
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## payroll_items
- id integer NOT NULL DEFAULT nextval('payroll_items_id_seq'::regclass
- sheet_id integer
- employee_id integer
- employee_name text
- work_id integer
- role_on_work character varying(100)
- days_worked integer DEFAULT 0
- day_rate numeric DEFAULT 0
- base_amount numeric DEFAULT 0
- bonus numeric DEFAULT 0
- overtime_hours numeric DEFAULT 0
- overtime_amount numeric DEFAULT 0
- penalty numeric DEFAULT 0
- penalty_reason text
- advance_paid numeric DEFAULT 0
- deductions numeric DEFAULT 0
- deductions_reason text
- accrued numeric DEFAULT 0
- payout numeric DEFAULT 0
- payment_method character varying(30) DEFAULT 'card'::character varying
- is_self_employed boolean DEFAULT false
- comment text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## payroll_sheets
- id integer NOT NULL DEFAULT nextval('payroll_sheets_id_seq'::regclas
- work_id integer
- title text NOT NULL
- period_from date NOT NULL
- period_to date NOT NULL
- status character varying(30) DEFAULT 'draft'::character varying
- total_accrued numeric DEFAULT 0
- total_bonus numeric DEFAULT 0
- total_penalty numeric DEFAULT 0
- total_advance_paid numeric DEFAULT 0
- total_payout numeric DEFAULT 0
- workers_count integer DEFAULT 0
- created_by integer
- approved_by integer
- approved_at timestamp without time zone
- paid_by integer
- paid_at timestamp without time zone
- comment text
- director_comment text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- requires_payment boolean DEFAULT true
- payment_method character varying(20)
- payment_status character varying(30)
- payment_comment text
- payment_doc_id integer
- buh_id integer
- buh_acted_at timestamp without time zone

## permit_application_history
- id integer NOT NULL DEFAULT nextval('permit_application_history_id_s
- application_id integer NOT NULL
- old_status character varying(30)
- new_status character varying(30) NOT NULL
- changed_by integer
- comment text
- created_at timestamp without time zone DEFAULT now()

## permit_application_items
- id integer NOT NULL DEFAULT nextval('permit_application_items_id_seq
- application_id integer NOT NULL
- employee_id integer NOT NULL
- permit_type_ids ARRAY NOT NULL DEFAULT '{}'::integer[]
- notes text DEFAULT ''::text
- created_at timestamp without time zone DEFAULT now()

## permit_applications
- id integer NOT NULL DEFAULT nextval('permit_applications_id_seq'::re
- number character varying(50)
- title character varying(500)
- contractor_email character varying(255)
- contractor_name character varying(255)
- cover_letter text
- status character varying(30) DEFAULT 'draft'::character varying
- sent_at timestamp without time zone
- sent_by integer
- email_message_id character varying(255)
- excel_file_path text
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- rejection_reason text
- approved_by integer
- is_urgent boolean DEFAULT false

## permit_types
- id integer NOT NULL DEFAULT nextval('permit_types_id_seq'::regclass)
- name character varying(255) NOT NULL
- category character varying(30) NOT NULL
- validity_months integer
- sort_order integer DEFAULT 0
- is_active boolean DEFAULT true
- code character varying(50)
- description text
- is_system boolean DEFAULT false
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## platform_parse_results
- id integer NOT NULL DEFAULT nextval('platform_parse_results_id_seq':
- email_id integer
- pre_tender_id integer
- platform_name character varying(100)
- platform_code character varying(50)
- purchase_number character varying(100)
- purchase_url text
- lot_number character varying(20)
- purchase_method character varying(100)
- customer_name character varying(500)
- customer_inn character varying(20)
- object_description text
- nmck numeric
- currency character varying(3) DEFAULT 'RUB'::character varying
- application_deadline timestamp without time zone
- auction_date timestamp without time zone
- work_start_date date
- work_end_date date
- docs_downloaded boolean DEFAULT false
- docs_download_error text
- docs_paths jsonb DEFAULT '[]'::jsonb
- ai_relevance_score integer
- ai_analysis text
- ai_keywords jsonb DEFAULT '[]'::jsonb
- parse_status character varying(30) DEFAULT 'pending'::character varying
- parse_error text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## pm_consents
- id integer NOT NULL DEFAULT nextval('pm_consents_id_seq'::regclass)
- pm_id integer
- type character varying(50)
- status character varying(50) DEFAULT 'pending'::character varying
- entity_type character varying(50)
- entity_id integer
- comments text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## pre_tender_requests
- id integer NOT NULL DEFAULT nextval('pre_tender_requests_id_seq'::re
- email_id integer
- source_type character varying(30) NOT NULL DEFAULT 'email'::character varying
- customer_name character varying(500)
- customer_inn character varying(20)
- customer_email character varying(255)
- contact_person character varying(255)
- contact_phone character varying(100)
- work_description text
- work_location character varying(500)
- work_deadline date
- estimated_sum numeric
- ai_summary text
- ai_color character varying(20) DEFAULT 'yellow'::character varying
- ai_recommendation text
- ai_work_match_score integer DEFAULT 50
- ai_workload_warning text
- ai_processed_at timestamp without time zone
- has_documents boolean DEFAULT false
- documents_summary text
- manual_documents jsonb DEFAULT '[]'::jsonb
- status character varying(30) NOT NULL DEFAULT 'new'::character varying
- decision_by integer
- decision_at timestamp without time zone
- decision_comment text
- reject_reason text
- created_tender_id integer
- response_email_id integer
- assigned_to integer
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- approval_requested_by integer
- approval_requested_at timestamp without time zone
- approval_comment text
- requires_payment boolean DEFAULT false
- payment_method character varying(20)
- payment_status character varying(30)
- payment_comment text
- payment_doc_id integer
- buh_id integer
- buh_acted_at timestamp without time zone

## proxies
- id integer NOT NULL DEFAULT nextval('proxies_id_seq'::regclass)
- type character varying(100)
- number character varying(100)
- issue_date date
- valid_until date
- employee_id integer
- employee_name character varying(255)
- fio character varying(255)
- passport text
- powers_general text
- description text
- address text
- supplier character varying(255)
- goods_list text
- vehicle_brand character varying(100)
- vehicle_number character varying(50)
- vin character varying(50)
- bank_name character varying(255)
- account_number character varying(50)
- tax_office character varying(255)
- court_name character varying(255)
- case_number character varying(100)
- license character varying(100)
- status character varying(50) DEFAULT 'active'::character varying
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## purchase_requests
- id integer NOT NULL DEFAULT nextval('purchase_requests_id_seq'::regc
- work_id integer
- pm_id integer
- status character varying(50) DEFAULT 'new'::character varying
- items_json text
- total_amount numeric
- urgency character varying(20)
- comments text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- decided_at timestamp without time zone
- decided_by_user_id integer

## push_subscriptions
- id integer NOT NULL DEFAULT nextval('push_subscriptions_id_seq'::reg
- user_id integer NOT NULL
- endpoint text NOT NULL
- p256dh text NOT NULL
- auth text NOT NULL
- device_info character varying(255)
- created_at timestamp without time zone DEFAULT now()

## qa_messages
- id integer NOT NULL DEFAULT nextval('qa_messages_id_seq'::regclass)
- tender_id integer
- estimate_id integer
- pm_id integer
- question text
- answer text
- is_open boolean DEFAULT true
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## reminders
- id integer NOT NULL DEFAULT nextval('reminders_id_seq'::regclass)
- user_id integer
- title character varying(255)
- description text
- due_date timestamp without time zone
- status character varying(20) DEFAULT 'active'::character varying
- priority character varying(20) DEFAULT 'normal'::character varying
- created_at timestamp without time zone DEFAULT now()
- entity_id integer
- entity_type character varying(50)
- completed_at timestamp without time zone
- updated_at timestamp without time zone DEFAULT now()
- due_time time without time zone
- message text
- auto_key character varying(100)
- next_at timestamp without time zone
- sent_at timestamp without time zone
- completed boolean DEFAULT false
- dismissed boolean DEFAULT false
- dismissed_at timestamp without time zone
- type character varying(50) DEFAULT 'custom'::character varying
- reminder_date timestamp with time zone

## role_analytics_cache
- id integer NOT NULL DEFAULT nextval('role_analytics_cache_id_seq'::r
- role character varying(50) NOT NULL
- user_id integer
- metric_key character varying(100) NOT NULL
- metric_value numeric DEFAULT 0
- period character varying(20)
- calculated_at timestamp without time zone DEFAULT now()

## role_presets
- id integer NOT NULL DEFAULT nextval('role_presets_id_seq'::regclass)
- role character varying(50) NOT NULL
- module_key character varying(50) NOT NULL
- can_read boolean DEFAULT false
- can_write boolean DEFAULT false
- can_delete boolean DEFAULT false

## saved_reports
- id integer NOT NULL DEFAULT nextval('saved_reports_id_seq'::regclass
- type character varying(100)
- period character varying(50)
- period_code character varying(50)
- data jsonb
- user_id integer
- created_at timestamp without time zone DEFAULT now()

## seal_transfers
- id integer NOT NULL DEFAULT nextval('seal_transfers_id_seq'::regclas
- seal_id integer
- from_id integer
- to_id integer
- status character varying(50) DEFAULT 'pending'::character varying
- transfer_date timestamp without time zone
- return_date timestamp without time zone
- comments text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- from_holder_id integer
- to_holder_id integer
- from_holder_name character varying(255)
- to_holder_name character varying(255)
- reason text
- created_by integer
- is_indefinite boolean DEFAULT false
- purpose text
- confirmed_at timestamp without time zone
- approved_by integer
- approved_at timestamp without time zone
- comment text

## seals
- id integer NOT NULL DEFAULT nextval('seals_id_seq'::regclass)
- type character varying(50)
- name character varying(200)
- description text
- status character varying(50) DEFAULT 'available'::character varying
- holder_id integer
- location character varying(200)
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- inv_number character varying(100)
- purchase_date date
- serial_number character varying(100)
- issue_date date
- expiry_date date
- notes text
- comment text
- return_date date
- transfer_date date
- holder_name character varying(255)
- prev_holder_id integer
- prev_holder_name character varying(255)
- transfer_reason text
- responsible_id integer
- organization character varying(255)
- registration_number character varying(100)
- is_indefinite boolean DEFAULT false
- purpose text
- pending_transfer_id integer

## self_employed
- id integer NOT NULL DEFAULT nextval('self_employed_id_seq'::regclass
- employee_id integer
- full_name text NOT NULL
- inn character varying(12) NOT NULL
- phone character varying(50)
- email character varying(255)
- bank_name text
- bik character varying(20)
- corr_account character varying(30)
- account_number character varying(30)
- card_number character varying(20)
- npd_status character varying(30) DEFAULT 'active'::character varying
- npd_registered_at date
- contract_number text
- contract_date date
- contract_end_date date
- comment text
- is_active boolean DEFAULT true
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## settings
- key character varying(100) NOT NULL
- value_json text
- updated_at timestamp without time zone DEFAULT now()
- id integer NOT NULL DEFAULT nextval('settings_id_seq'::regclass)
- created_at timestamp without time zone DEFAULT now()

## site_inspections
- id integer NOT NULL DEFAULT nextval('site_inspections_id_seq'::regcl
- work_id integer
- estimate_id integer
- tender_id integer
- status character varying(50) NOT NULL DEFAULT 'draft'::character varying
- object_name character varying(500)
- object_address text
- customer_name character varying(500)
- customer_contact_person character varying(255)
- customer_contact_email character varying(255)
- customer_contact_phone character varying(100)
- inspection_dates jsonb DEFAULT '[]'::jsonb
- employees_json jsonb DEFAULT '[]'::jsonb
- vehicles_json jsonb DEFAULT '[]'::jsonb
- notes text
- author_id integer
- approved_by integer
- approved_at timestamp without time zone
- rejected_at timestamp without time zone
- rejected_reason text
- sent_at timestamp without time zone
- email_sent_to character varying(255)
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## sites
- id integer NOT NULL DEFAULT nextval('sites_id_seq'::regclass)
- name character varying(500) NOT NULL
- short_name character varying(200)
- lat double precision
- lng double precision
- region character varying(200)
- site_type character varying(50) DEFAULT 'object'::character varying
- customer_id integer
- customer_name character varying(500)
- address text
- description text
- geocode_status character varying(20) DEFAULT 'pending'::character varying
- geocode_source character varying(200)
- photo_url character varying(500)
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- status character varying(30) DEFAULT 'active'::character varying

## staff
- id integer NOT NULL DEFAULT nextval('staff_id_seq'::regclass)
- name character varying(200)
- role_tag character varying(50)
- user_id integer
- phone character varying(50)
- email character varying(200)
- is_active boolean DEFAULT true
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- position character varying(255)
- department character varying(100)
- city character varying(255)
- comment text

## staff_plan
- id integer NOT NULL DEFAULT nextval('staff_plan_id_seq'::regclass)
- staff_id integer
- date date
- work_id integer
- status character varying(50)
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- status_code character varying(50)
- note text
- comment text
- kind character varying(50)
- employee_id integer
- staff_request_id integer
- fio character varying(255)

## staff_replacements
- id integer NOT NULL DEFAULT nextval('staff_replacements_id_seq'::reg
- staff_request_id integer
- work_id integer
- old_employee_id integer
- new_employee_id integer
- status character varying(50) DEFAULT 'pending'::character varying
- reason text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## staff_request_messages
- id integer NOT NULL DEFAULT nextval('staff_request_messages_id_seq':
- staff_request_id integer
- author_user_id integer
- message text
- created_at timestamp without time zone DEFAULT now()

## staff_requests
- id integer NOT NULL DEFAULT nextval('staff_requests_id_seq'::regclas
- work_id integer
- pm_id integer
- status character varying(50) DEFAULT 'new'::character varying
- required_count integer
- specialization text
- date_from date
- date_to date
- comments text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- proposed_staff_ids_json jsonb
- approved_staff_ids_json jsonb
- is_vachta boolean DEFAULT false
- rotation_days integer
- request_json jsonb
- pm_comment text
- hr_comment text
- crew character varying(1)

## sync_meta
- table_name character varying(100) NOT NULL
- last_sync timestamp without time zone
- status character varying(50)
- error_message text

## task_comments
- id integer NOT NULL DEFAULT nextval('task_comments_id_seq'::regclass
- task_id integer NOT NULL
- user_id integer NOT NULL
- text text NOT NULL
- attachments jsonb DEFAULT '[]'::jsonb
- is_system boolean DEFAULT false
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## task_watchers
- id integer NOT NULL DEFAULT nextval('task_watchers_id_seq'::regclass
- task_id integer NOT NULL
- user_id integer NOT NULL
- created_at timestamp without time zone DEFAULT now()

## tasks
- id integer NOT NULL DEFAULT nextval('tasks_id_seq'::regclass)
- creator_id integer NOT NULL
- assignee_id integer NOT NULL
- title character varying(255) NOT NULL
- description text
- deadline timestamp without time zone
- priority character varying(20) DEFAULT 'normal'::character varying
- status character varying(20) NOT NULL DEFAULT 'new'::character varying
- accepted_at timestamp without time zone
- completed_at timestamp without time zone
- files jsonb DEFAULT '[]'::jsonb
- creator_comment text
- assignee_comment text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()
- kanban_column character varying(20) DEFAULT 'new'::character varying
- kanban_position integer DEFAULT 0
- acknowledged_at timestamp without time zone
- acknowledged_by integer
- work_id integer
- tender_id integer
- parent_task_id integer
- estimated_hours numeric
- actual_hours numeric
- tags jsonb DEFAULT '[]'::jsonb
- archived_at timestamp without time zone
- archived_by integer

## telephony_escalations
- id integer NOT NULL DEFAULT nextval('telephony_escalations_id_seq'::
- call_id integer
- user_id integer
- deadline_at timestamp with time zone NOT NULL
- escalated boolean DEFAULT false
- escalated_at timestamp with time zone
- acknowledged boolean DEFAULT false
- created_at timestamp with time zone DEFAULT now()

## telephony_events_log
- id integer NOT NULL DEFAULT nextval('telephony_events_log_id_seq'::r
- event_type character varying(50) NOT NULL
- mango_call_id character varying(200)
- mango_entry_id character varying(200)
- payload jsonb NOT NULL
- processed boolean DEFAULT false
- processing_result jsonb
- error text
- created_at timestamp with time zone DEFAULT now()

## telephony_jobs
- id integer NOT NULL DEFAULT nextval('telephony_jobs_id_seq'::regclas
- job_type character varying(50) NOT NULL
- call_id integer
- payload jsonb DEFAULT '{}'::jsonb
- status character varying(20) DEFAULT 'pending'::character varying
- attempts integer DEFAULT 0
- max_attempts integer DEFAULT 3
- error text
- scheduled_at timestamp with time zone DEFAULT now()
- started_at timestamp with time zone
- completed_at timestamp with time zone
- created_at timestamp with time zone DEFAULT now()

## tenders
- id integer NOT NULL DEFAULT nextval('tenders_id_seq'::regclass)
- customer character varying(500)
- customer_inn character varying(20)
- tender_number character varying(255)
- tender_type character varying(100)
- tender_status character varying(100) DEFAULT 'Новый'::character varying
- period character varying(20)
- year integer
- deadline date
- estimated_sum numeric
- responsible_pm_id integer
- tag character varying(255)
- docs_link text
- comment_to text
- comment_dir text
- reject_reason text
- dedup_key text
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone
- tender_title text
- customer_name character varying(500)
- tender_price numeric
- docs_deadline date
- pm_id integer
- source character varying(100)
- platform character varying(255)
- link text
- status character varying(50)
- assigned_at timestamp without time zone
- assigned_by_user_id integer
- created_by_user_id integer
- cost_plan numeric
- work_start_plan date
- work_end_plan date
- inn character varying(20)
- purchase_url text
- group_tag text
- tender_comment_to text
- tender_description text
- tender_region text
- tender_contact text
- tender_phone text
- tender_email text
- handoff_at timestamp without time zone
- handoff_by_user_id integer
- distribution_requested_at timestamp without time zone
- distribution_requested_by_user_id integer
- require_docs_on_handoff boolean DEFAULT false
- distribution_assigned_at timestamp without time zone
- distribution_assigned_by_user_id integer
- tkp_sent_at timestamp without time zone
- tkp_followup_next_at timestamp without time zone
- tkp_followup_closed_at timestamp without time zone
- pm_login character varying(100)
- saved_at timestamp without time zone
- site_id integer
- ai_report text
- ai_cost_estimate numeric
- ai_cost_report text

## tkp
- id integer NOT NULL DEFAULT nextval('tkp_id_seq'::regclass)
- tender_id integer
- number text
- customer_name text
- customer_inn text
- contact_person text
- contact_email text
- contact_phone text
- subject text
- items jsonb DEFAULT '[]'::jsonb
- total_sum numeric DEFAULT 0
- discount_percent numeric DEFAULT 0
- final_sum numeric DEFAULT 0
- valid_until date
- status text DEFAULT 'draft'::text
- sent_at timestamp with time zone
- sent_via text
- pdf_path text
- notes text
- author_id integer
- created_at timestamp with time zone DEFAULT now()
- updated_at timestamp with time zone DEFAULT now()
- work_id integer
- services text
- deadline text
- validity_days integer DEFAULT 30
- sent_by integer
- tkp_number character varying(50)
- source character varying(50) DEFAULT 'registry'::character varying
- approved_by integer
- approved_at timestamp without time zone
- customer_address text
- work_description text
- estimate_id integer

## tmc_requests
- id integer NOT NULL DEFAULT nextval('tmc_requests_id_seq'::regclass)
- work_id integer
- tender_id integer
- request_type text DEFAULT 'import'::text
- items jsonb DEFAULT '[]'::jsonb
- total_sum numeric DEFAULT 0
- status text DEFAULT 'draft'::text
- supplier text
- delivery_date date
- notes text
- author_id integer
- approved_by integer
- created_at timestamp with time zone DEFAULT now()
- updated_at timestamp with time zone DEFAULT now()
- title text
- priority text DEFAULT 'normal'::text
- needed_by date
- delivery_address text
- approved_at timestamp with time zone
- requires_payment boolean DEFAULT false
- payment_method character varying(20)
- payment_status character varying(30)
- payment_comment text
- payment_doc_id integer
- buh_id integer
- buh_acted_at timestamp without time zone

## todo_items
- id integer NOT NULL DEFAULT nextval('todo_items_id_seq'::regclass)
- user_id integer NOT NULL
- text character varying(500) NOT NULL
- done boolean DEFAULT false
- done_at timestamp without time zone
- auto_delete_hours integer DEFAULT 48
- sort_order integer DEFAULT 0
- created_at timestamp without time zone DEFAULT now()

## training_applications
- id integer NOT NULL DEFAULT nextval('training_applications_id_seq'::
- user_id integer NOT NULL
- course_name character varying(500) NOT NULL
- provider character varying(300)
- training_type character varying(100) DEFAULT 'external'::character varying
- date_start date
- date_end date
- cost numeric DEFAULT 0
- justification text
- status character varying(30) NOT NULL DEFAULT 'draft'::character varying
- comment text
- approved_by_head integer
- approved_by_head_at timestamp with time zone
- approved_by_dir integer
- approved_by_dir_at timestamp with time zone
- paid_by_buh integer
- paid_by_buh_at timestamp with time zone
- completed_by_hr integer
- completed_by_hr_at timestamp with time zone
- rejected_by integer
- rejected_at timestamp with time zone
- reject_reason text
- created_at timestamp with time zone NOT NULL DEFAULT now()
- updated_at timestamp with time zone NOT NULL DEFAULT now()
- requires_payment boolean DEFAULT false
- payment_method character varying(20)
- payment_status character varying(30)
- payment_comment text
- payment_doc_id integer
- buh_id integer
- buh_acted_at timestamp without time zone

## travel_expenses
- id integer NOT NULL DEFAULT nextval('travel_expenses_id_seq'::regcla
- expense_type character varying(50)
- work_id integer
- employee_id integer
- date date
- amount numeric
- description text
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone
- supplier character varying(255)
- counterparty character varying(255)
- document_number character varying(100)
- status character varying(50)
- approved_by integer
- approved_at timestamp without time zone
- comment text
- date_from date
- date_to date
- doc_number character varying(100)
- currency character varying(10) DEFAULT 'RUB'::character varying
- requires_payment boolean DEFAULT false
- payment_method character varying(20)
- payment_status character varying(30)
- payment_comment text
- payment_doc_id integer
- buh_id integer
- buh_acted_at timestamp without time zone

## user_call_status
- user_id integer NOT NULL
- accepting boolean DEFAULT true
- status character varying(50)
- updated_at timestamp without time zone DEFAULT now()
- id integer NOT NULL DEFAULT nextval('user_call_status_id_seq'::regcl
- busy boolean DEFAULT false
- created_at timestamp without time zone DEFAULT now()
- mango_extension character varying(20)
- fallback_user_id integer
- fallback_mobile character varying(50)
- work_schedule jsonb DEFAULT '{"fri": {"end": "18:00"
- "start": "09:0
- is_duty boolean DEFAULT false
- display_name character varying(200)
- sip_login character varying(100)
- last_call_at timestamp with time zone
- receive_call_push boolean DEFAULT false
- is_call_dispatcher boolean DEFAULT false

## user_dashboard
- user_id integer NOT NULL
- widgets_json text
- layout_json text
- updated_at timestamp without time zone DEFAULT now()

## user_email_accounts
- id integer NOT NULL DEFAULT nextval('user_email_accounts_id_seq'::re
- user_id integer NOT NULL
- email_address character varying(255) NOT NULL
- imap_host character varying(255) DEFAULT 'imap.yandex.ru'::character varying
- imap_port integer DEFAULT 993
- imap_user character varying(255)
- imap_pass_encrypted text
- imap_tls boolean DEFAULT true
- smtp_host character varying(255) DEFAULT 'smtp.yandex.ru'::character varying
- smtp_port integer DEFAULT 465
- smtp_user character varying(255)
- smtp_pass_encrypted text
- smtp_tls boolean DEFAULT true
- display_name character varying(255)
- signature_html text
- is_active boolean DEFAULT true
- last_sync_at timestamp without time zone
- last_sync_uid integer DEFAULT 0
- last_sync_error text
- sync_interval_sec integer DEFAULT 120
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## user_menu_settings
- user_id integer NOT NULL
- hidden_routes jsonb DEFAULT '[]'::jsonb
- route_order jsonb DEFAULT '[]'::jsonb
- updated_at timestamp without time zone DEFAULT now()

## user_permissions
- id integer NOT NULL DEFAULT nextval('user_permissions_id_seq'::regcl
- user_id integer NOT NULL
- module_key character varying(50) NOT NULL
- can_read boolean DEFAULT false
- can_write boolean DEFAULT false
- can_delete boolean DEFAULT false
- granted_by integer
- granted_at timestamp without time zone DEFAULT now()

## user_requests
- id integer NOT NULL DEFAULT nextval('user_requests_id_seq'::regclass
- user_id integer
- status character varying(50) DEFAULT 'pending'::character varying
- approved_by integer
- approved_at timestamp without time zone
- comment text
- created_at timestamp without time zone DEFAULT now()

## user_stories
- id integer NOT NULL DEFAULT nextval('user_stories_id_seq'::regclass)
- user_id integer
- content text
- image_url text
- created_at timestamp with time zone DEFAULT now()
- expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval)

## users
- id integer NOT NULL DEFAULT nextval('users_id_seq'::regclass)
- login character varying(100) NOT NULL
- password_hash character varying(255) NOT NULL
- name character varying(255) NOT NULL
- email character varying(255)
- role character varying(50) NOT NULL DEFAULT 'PENDING'::character varying
- roles ARRAY
- is_active boolean DEFAULT false
- telegram_chat_id character varying(50)
- temp_password_hash character varying(255)
- temp_password_expires timestamp without time zone
- last_login_at timestamp without time zone
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone
- must_change_password boolean DEFAULT false
- pin_hash character varying(255)
- phone character varying(50)
- birth_date date
- employment_date date
- is_blocked boolean DEFAULT false
- blocked_at timestamp without time zone
- blocked_by integer
- block_reason text
- password_changed_at timestamp without time zone
- created_by integer
- show_in_schedule boolean DEFAULT true
- military_id text
- ready boolean DEFAULT true
- is_approved boolean DEFAULT true
- patronymic character varying(255)
- avatar_url text

## warehouses
- id integer NOT NULL DEFAULT nextval('warehouses_id_seq'::regclass)
- name character varying(100) NOT NULL
- code character varying(20)
- address text
- responsible_id integer
- is_main boolean DEFAULT false
- is_active boolean DEFAULT true
- created_at timestamp without time zone DEFAULT now()
- phone character varying(50)
- updated_at timestamp without time zone DEFAULT now()

## webauthn_challenges
- id integer NOT NULL DEFAULT nextval('webauthn_challenges_id_seq'::re
- user_id integer NOT NULL
- challenge text NOT NULL
- type character varying(20) NOT NULL
- created_at timestamp without time zone DEFAULT now()

## webauthn_credentials
- id uuid NOT NULL DEFAULT gen_random_uuid()
- user_id integer NOT NULL
- credential_id text NOT NULL
- public_key bytea NOT NULL
- counter bigint NOT NULL DEFAULT 0
- device_name character varying(255) DEFAULT 'Устройство'::character varying
- transports ARRAY
- created_at timestamp without time zone DEFAULT now()
- last_used_at timestamp without time zone

## work_assign_requests
- id integer NOT NULL DEFAULT nextval('work_assign_requests_id_seq'::r
- tender_id integer
- assigned_pm_id integer
- status character varying(50) DEFAULT 'pending'::character varying
- requested_at timestamp without time zone DEFAULT now()
- processed_at timestamp without time zone
- comments text
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone DEFAULT now()

## work_expenses
- id integer NOT NULL DEFAULT nextval('work_expenses_id_seq'::regclass
- work_id integer
- category character varying(100)
- amount numeric NOT NULL
- date date
- description text
- document_number character varying(255)
- counterparty character varying(500)
- source character varying(50)
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone
- supplier character varying(255)
- status character varying(255)
- approved_by integer
- comment text
- employee_id integer
- bonus_request_id integer
- fot_employee_id integer
- fot_employee_name character varying(255)
- requires_approval boolean DEFAULT false
- approval_status character varying(50)
- import_hash text
- notes text
- receipt_url text
- requires_payment boolean DEFAULT false
- payment_method character varying(20)
- payment_status character varying(30)
- payment_comment text
- payment_doc_id integer
- buh_id integer
- buh_acted_at timestamp without time zone

## work_permit_requirements
- id integer NOT NULL DEFAULT nextval('work_permit_requirements_id_seq
- work_id integer NOT NULL
- permit_type_id integer NOT NULL
- is_mandatory boolean DEFAULT true
- notes text
- created_at timestamp without time zone DEFAULT now()

## worker_profiles
- id integer NOT NULL DEFAULT nextval('worker_profiles_id_seq'::regcla
- user_id integer NOT NULL
- data jsonb NOT NULL DEFAULT '{}'::jsonb
- filled_count integer DEFAULT 0
- total_count integer DEFAULT 20
- overall_score integer
- photo_url text
- created_by integer
- updated_by integer
- created_at timestamp with time zone DEFAULT now()
- updated_at timestamp with time zone DEFAULT now()
- employee_id integer

## works
- id integer NOT NULL DEFAULT nextval('works_id_seq'::regclass)
- tender_id integer
- estimate_id integer
- pm_id integer
- work_number character varying(100)
- work_status character varying(100) DEFAULT 'Новая'::character varying
- contract_sum numeric
- cost_plan numeric
- cost_fact numeric
- advance_percent numeric
- advance_sum numeric
- advance_received numeric
- advance_date_plan date
- advance_date_fact date
- balance_sum numeric
- balance_received numeric
- payment_date_plan date
- payment_date_fact date
- start_date_plan date
- start_in_work_date date
- end_date_plan date
- end_date_fact date
- city character varying(255)
- address text
- comment text
- created_by integer
- created_at timestamp without time zone DEFAULT now()
- updated_at timestamp without time zone
- work_start_plan date
- work_end_plan date
- work_title text
- customer_name character varying(500)
- customer_inn character varying(20)
- object_name character varying(500)
- responsible_pm_id integer
- contact_person character varying(255)
- contact_phone character varying(50)
- status character varying(50)
- vat_pct integer DEFAULT 20
- end_fact date
- contract_value numeric
- staff_ids_json jsonb
- rotation_days integer
- is_vachta boolean DEFAULT false
- hr_comment text
- customer_score integer
- payload_json jsonb
- staff_request_id integer
- started_at timestamp without time zone
- completed_at timestamp without time zone
- closed_at timestamp without time zone
- closeout_submitted_at timestamp without time zone
- proposed_staff_ids_a_json jsonb
- proposed_staff_ids_b_json jsonb
- approved_staff_ids_a_json jsonb
- approved_staff_ids_b_json jsonb
- rework_requested_at timestamp without time zone
- advance_pct numeric
- w_adv_pct numeric
- work_name text
- start_plan date
- act_signed_date_fact date
- closeout_submitted_by integer
- site_id integer
- start_fact date
- object_address text
- description text
- notes text
- priority character varying(30)
- end_plan date

