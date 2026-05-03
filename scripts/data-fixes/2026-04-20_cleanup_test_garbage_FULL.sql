-- ПОЛНАЯ очистка тестового мусора (prod cleanup 2026-04-20)
-- Backup: /var/backup/asgard_before_cleanup_2026-04-20_091607.sql (7.2 MB)
--
-- СТРАТЕГИЯ: ловим по created_at = '2026-04-20' + маркерам в тексте
-- Реальные работы/сотрудники/тендеры — все созданы ДО 20.04.2026, значит их не тронем.

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- СБОР ТЕСТОВЫХ ID (широкие фильтры, т.к. всё сегодняшнее = тест)
-- ══════════════════════════════════════════════════════════════

CREATE TEMP TABLE test_works AS
SELECT id FROM works
WHERE created_at::date = '2026-04-20'
  AND (
    work_title ILIKE '%test%' OR work_title ILIKE '%тест%'
    OR work_title LIKE 'WF-%' OR work_title LIKE 'E2E%'
    OR work_title LIKE 'MATRIX-%' OR work_title LIKE 'DEL-%'
    OR work_title LIKE 'BP-Test%' OR work_title LIKE 'FK-%'
    OR work_title LIKE 'HEAD_PM-%' OR work_title LIKE 'Value test%'
    OR work_title LIKE 'PM-Work-Test%' OR work_title LIKE 'Dir test%'
    OR work_title LIKE 'SEC-%' OR work_title LIKE 'SQL%' OR work_title LIKE 'XSS%'
    OR work_title LIKE 'Approval%' OR work_title LIKE 'Finance Test%'
    OR work_title LIKE 'HR Test%' OR work_title LIKE 'Delete-Work%'
    OR work_title LIKE 'Delete test%'
    OR customer_name ILIKE '%test%' OR customer_name LIKE 'MATRIX-%'
    OR customer_name LIKE 'E2E%' OR customer_name LIKE 'XSS%'
  );

CREATE TEMP TABLE test_employees AS
SELECT id FROM employees
WHERE created_at::date = '2026-04-20'
  AND id >= 10029;

CREATE TEMP TABLE test_tenders AS
SELECT id FROM tenders
WHERE tender_title ILIKE '%test%' OR tender_title LIKE 'BP-Test%'
   OR customer_name ILIKE '%test%' OR customer_name LIKE 'MATRIX-%'
   OR customer_name LIKE 'E2E%' OR customer_name LIKE 'XSS%';

CREATE TEMP TABLE test_customers AS
SELECT id FROM customers
WHERE name ILIKE '%test%' OR name LIKE 'MATRIX-%'
   OR name LIKE 'XSS%' OR name LIKE 'E2E%';

CREATE TEMP TABLE test_users AS
SELECT id FROM users
WHERE login ILIKE '%test%' OR login LIKE 'e2e_%'
   OR email ILIKE '%test%' OR email ILIKE '%example%';

-- ══════════════════════════════════════════════════════════════
-- ЗАЩИТА: ни одна реальная сущность не должна попасть
-- ══════════════════════════════════════════════════════════════

DO $$
DECLARE v_fatal int;
BEGIN
  SELECT COUNT(*) INTO v_fatal FROM test_works WHERE id IN (10, 11);
  IF v_fatal > 0 THEN
    RAISE EXCEPTION 'FATAL: реальная работа (10 или 11) в test_works! Отмена.';
  END IF;

  SELECT COUNT(*) INTO v_fatal FROM test_employees
  WHERE id IN (SELECT id FROM employees
               WHERE fio ILIKE '%Горшков%Иван%Александрович%'
                  OR fio ILIKE '%Магомедов%Руслан%Дибирович%'
                  OR fio ILIKE '%Пономарев%Александр%Евгеньевич%'
                  OR fio ILIKE '%Шмелев%Александр%'
                  OR fio ILIKE '%Катериненко%'
                  OR fio ILIKE '%Бауков%');
  IF v_fatal > 0 THEN
    RAISE EXCEPTION 'FATAL: реальный сотрудник в test_employees! Отмена.';
  END IF;

  RAISE NOTICE '--- TO DELETE ---';
  RAISE NOTICE 'works: %', (SELECT COUNT(*) FROM test_works);
  RAISE NOTICE 'employees: %', (SELECT COUNT(*) FROM test_employees);
  RAISE NOTICE 'tenders: %', (SELECT COUNT(*) FROM test_tenders);
  RAISE NOTICE 'customers: %', (SELECT COUNT(*) FROM test_customers);
  RAISE NOTICE 'users: %', (SELECT COUNT(*) FROM test_users);
END $$;

-- ══════════════════════════════════════════════════════════════
-- УРОВЕНЬ 5: Листья (notifications/messages/audit)
-- ══════════════════════════════════════════════════════════════

DELETE FROM notifications
WHERE user_id IN (SELECT id FROM test_users)
   OR (created_at::date = '2026-04-20' AND (message ILIKE '%test%' OR message LIKE 'MATRIX-%' OR message LIKE 'E2E%' OR message LIKE 'WF-%' OR message LIKE 'BP-Test%' OR message LIKE 'DEL-%'));

DELETE FROM chat_messages
WHERE user_id IN (SELECT id FROM test_users)
   OR (created_at::date = '2026-04-20' AND (message ILIKE '%test%' OR message LIKE 'MATRIX-%' OR message LIKE 'E2E%'));

DELETE FROM audit_log WHERE actor_user_id IN (SELECT id FROM test_users);

DELETE FROM approval_comments
WHERE user_id IN (SELECT id FROM test_users)
   OR (created_at::date = '2026-04-20' AND (comment ILIKE '%test%' OR comment LIKE 'MATRIX-%' OR comment LIKE 'E2E%'));

-- ══════════════════════════════════════════════════════════════
-- УРОВЕНЬ 4: tasks / email / correspondence / calendar
-- ══════════════════════════════════════════════════════════════

DELETE FROM meeting_minutes WHERE task_id IN (
  SELECT id FROM tasks
  WHERE (created_at::date = '2026-04-20' AND (title ILIKE '%test%' OR title LIKE 'MATRIX-%' OR title LIKE 'E2E%'))
     OR work_id IN (SELECT id FROM test_works)
     OR creator_id IN (SELECT id FROM test_users)
);
DELETE FROM task_comments WHERE task_id IN (
  SELECT id FROM tasks
  WHERE (created_at::date = '2026-04-20' AND (title ILIKE '%test%' OR title LIKE 'MATRIX-%' OR title LIKE 'E2E%'))
     OR work_id IN (SELECT id FROM test_works)
     OR creator_id IN (SELECT id FROM test_users)
);
DELETE FROM task_watchers WHERE task_id IN (
  SELECT id FROM tasks
  WHERE (created_at::date = '2026-04-20' AND (title ILIKE '%test%' OR title LIKE 'MATRIX-%' OR title LIKE 'E2E%'))
     OR work_id IN (SELECT id FROM test_works)
     OR creator_id IN (SELECT id FROM test_users)
);

DELETE FROM tasks
WHERE work_id IN (SELECT id FROM test_works)
   OR creator_id IN (SELECT id FROM test_users)
   OR (created_at::date = '2026-04-20' AND (title ILIKE '%test%' OR title LIKE 'MATRIX-%' OR title LIKE 'E2E%'));

DELETE FROM calendar_events
WHERE created_by IN (SELECT id FROM test_users)
   OR (created_at::date = '2026-04-20' AND (title ILIKE '%test%' OR title LIKE 'MATRIX-%' OR title LIKE 'E2E%'));

DELETE FROM email_log WHERE created_at::date = '2026-04-20' AND (subject ILIKE '%test%' OR subject LIKE 'MATRIX-%' OR subject LIKE 'E2E%');
DELETE FROM emails WHERE created_at::date = '2026-04-20' AND (subject ILIKE '%test%' OR subject LIKE 'MATRIX-%' OR subject LIKE 'E2E%');
DELETE FROM email_templates_v2 WHERE created_at::date = '2026-04-20' AND (name ILIKE '%test%' OR name LIKE 'MATRIX-%');

DELETE FROM correspondence
WHERE work_id IN (SELECT id FROM test_works)
   OR created_by IN (SELECT id FROM test_users)
   OR (created_at::date = '2026-04-20'
       AND (subject ILIKE '%test%' OR content ILIKE '%test%' OR body ILIKE '%test%'
            OR subject LIKE 'MATRIX-%' OR subject LIKE 'E2E%' OR subject LIKE 'BP-Test%'));

DELETE FROM reminders WHERE user_id IN (SELECT id FROM test_users)
   OR (created_at::date = '2026-04-20' AND (title ILIKE '%test%' OR title LIKE 'MATRIX-%' OR title LIKE 'E2E%'));

DELETE FROM todo_items WHERE user_id IN (SELECT id FROM test_users) OR text ILIKE '%test%';

DELETE FROM mimir_messages WHERE conversation_id IN (SELECT id FROM mimir_conversations WHERE user_id IN (SELECT id FROM test_users));
DELETE FROM mimir_conversations WHERE user_id IN (SELECT id FROM test_users) OR (created_at::date = '2026-04-20' AND title ILIKE '%test%');

DELETE FROM mimir_usage_log WHERE user_id IN (SELECT id FROM test_users);

-- ══════════════════════════════════════════════════════════════
-- УРОВЕНЬ 3: Финансы / сметы / заявки
-- ══════════════════════════════════════════════════════════════

-- estimates children first
DELETE FROM estimate_approval_events WHERE estimate_id IN (SELECT id FROM estimates WHERE work_id IN (SELECT id FROM test_works) OR tender_id IN (SELECT id FROM test_tenders));
DELETE FROM estimate_approval_requests WHERE estimate_id IN (SELECT id FROM estimates WHERE work_id IN (SELECT id FROM test_works) OR tender_id IN (SELECT id FROM test_tenders));
DELETE FROM estimate_calculation_data WHERE estimate_id IN (SELECT id FROM estimates WHERE work_id IN (SELECT id FROM test_works) OR tender_id IN (SELECT id FROM test_tenders));

DELETE FROM estimates
WHERE work_id IN (SELECT id FROM test_works)
   OR tender_id IN (SELECT id FROM test_tenders)
   OR created_by IN (SELECT id FROM test_users)
   OR (created_at::date = '2026-04-20' AND (title ILIKE '%test%' OR title LIKE 'MATRIX-%' OR title LIKE 'E2E%'));

DELETE FROM tkp
WHERE work_id IN (SELECT id FROM test_works)
   OR tender_id IN (SELECT id FROM test_tenders);

-- cash_requests children first
DELETE FROM cash_balance_log WHERE related_request_id IN (SELECT id FROM cash_requests WHERE work_id IN (SELECT id FROM test_works) OR user_id IN (SELECT id FROM test_users));
DELETE FROM cash_expenses WHERE request_id IN (SELECT id FROM cash_requests WHERE work_id IN (SELECT id FROM test_works) OR user_id IN (SELECT id FROM test_users));
DELETE FROM cash_messages WHERE request_id IN (SELECT id FROM cash_requests WHERE work_id IN (SELECT id FROM test_works) OR user_id IN (SELECT id FROM test_users));
DELETE FROM cash_returns WHERE request_id IN (SELECT id FROM cash_requests WHERE work_id IN (SELECT id FROM test_works) OR user_id IN (SELECT id FROM test_users));

DELETE FROM cash_requests
WHERE work_id IN (SELECT id FROM test_works)
   OR user_id IN (SELECT id FROM test_users)
   OR (created_at::date = '2026-04-20' AND (purpose ILIKE '%test%' OR purpose LIKE 'MATRIX-%'));

-- payroll children
DELETE FROM payment_registry WHERE sheet_id IN (SELECT id FROM payroll_sheets WHERE work_id IN (SELECT id FROM test_works) OR created_by IN (SELECT id FROM test_users));
DELETE FROM payroll_items WHERE sheet_id IN (SELECT id FROM payroll_sheets WHERE work_id IN (SELECT id FROM test_works) OR created_by IN (SELECT id FROM test_users));
DELETE FROM payroll_items WHERE work_id IN (SELECT id FROM test_works) OR employee_id IN (SELECT id FROM test_employees);

DELETE FROM payroll_sheets WHERE work_id IN (SELECT id FROM test_works)
   OR created_by IN (SELECT id FROM test_users)
   OR (created_at::date = '2026-04-20' AND title ILIKE '%test%');

DELETE FROM procurement_history WHERE actor_id IN (SELECT id FROM test_users);
DELETE FROM procurement_items WHERE procurement_id IN (SELECT id FROM procurement_requests WHERE author_id IN (SELECT id FROM test_users) OR tender_id IN (SELECT id FROM test_tenders));
DELETE FROM procurement_payments WHERE procurement_id IN (SELECT id FROM procurement_requests WHERE author_id IN (SELECT id FROM test_users) OR tender_id IN (SELECT id FROM test_tenders));
DELETE FROM procurement_requests
WHERE author_id IN (SELECT id FROM test_users)
   OR tender_id IN (SELECT id FROM test_tenders)
   OR (created_at::date = '2026-04-20' AND (title ILIKE '%test%' OR title LIKE 'MATRIX-%' OR title LIKE 'E2E%'));

DELETE FROM tmc_requests WHERE created_at::date = '2026-04-20' AND (title ILIKE '%test%' OR title LIKE 'MATRIX-%' OR title LIKE 'E2E%');

DELETE FROM invoices WHERE customer_name ILIKE '%test%' OR customer_name LIKE 'MATRIX-%' OR customer_name LIKE 'E2E%' OR tender_id IN (SELECT id FROM test_tenders) OR work_id IN (SELECT id FROM test_works);

DELETE FROM incomes WHERE work_id IN (SELECT id FROM test_works) OR created_by IN (SELECT id FROM test_users) OR (created_at::date = '2026-04-20' AND description ILIKE '%test%');

DELETE FROM work_expenses WHERE work_id IN (SELECT id FROM test_works) OR created_by IN (SELECT id FROM test_users) OR (created_at::date = '2026-04-20' AND description ILIKE '%test%');

DELETE FROM one_time_payments WHERE employee_id IN (SELECT id FROM test_employees) OR requested_by IN (SELECT id FROM test_users) OR (created_at::date = '2026-04-20' AND reason ILIKE '%test%');

DELETE FROM bank_transactions WHERE tender_id IN (SELECT id FROM test_tenders) OR work_id IN (SELECT id FROM test_works) OR (created_at::date = '2026-04-20' AND description ILIKE '%test%');

DELETE FROM pass_requests WHERE tender_id IN (SELECT id FROM test_tenders) OR author_id IN (SELECT id FROM test_users) OR (created_at::date = '2026-04-20' AND notes ILIKE '%test%');

DELETE FROM permit_applications WHERE created_at::date = '2026-04-20' AND (title ILIKE '%test%' OR title LIKE 'MATRIX-%');

DELETE FROM pre_tender_requests WHERE customer_name ILIKE '%test%' OR customer_name LIKE 'MATRIX-%' OR customer_name LIKE 'E2E%';

DELETE FROM site_inspections WHERE tender_id IN (SELECT id FROM test_tenders) OR work_id IN (SELECT id FROM test_works) OR (created_at::date = '2026-04-20' AND (notes ILIKE '%test%' OR customer_name ILIKE '%test%'));

DELETE FROM documents WHERE tender_id IN (SELECT id FROM test_tenders) OR work_id IN (SELECT id FROM test_works) OR uploaded_by IN (SELECT id FROM test_users);
DELETE FROM meetings WHERE tender_id IN (SELECT id FROM test_tenders) OR work_id IN (SELECT id FROM test_works) OR organizer_id IN (SELECT id FROM test_users);
DELETE FROM inbox_applications WHERE linked_tender_id IN (SELECT id FROM test_tenders) OR linked_work_id IN (SELECT id FROM test_works) OR created_by IN (SELECT id FROM test_users);
DELETE FROM estimate_approval_requests WHERE tender_id IN (SELECT id FROM test_tenders) OR requested_by IN (SELECT id FROM test_users);
DELETE FROM estimate_approval_events WHERE actor_id IN (SELECT id FROM test_users);
DELETE FROM tender_comments WHERE tender_id IN (SELECT id FROM test_tenders) OR user_id IN (SELECT id FROM test_users);
DELETE FROM tender_author_history WHERE tender_id IN (SELECT id FROM test_tenders) OR changed_by IN (SELECT id FROM test_users);

DELETE FROM contracts WHERE work_id IN (SELECT id FROM test_works);
DELETE FROM acts WHERE work_id IN (SELECT id FROM test_works);
DELETE FROM staff_requests WHERE work_id IN (SELECT id FROM test_works);
DELETE FROM customer_reviews WHERE work_id IN (SELECT id FROM test_works);
DELETE FROM travel_expenses WHERE work_id IN (SELECT id FROM test_works) OR employee_id IN (SELECT id FROM test_employees) OR created_by IN (SELECT id FROM test_users);
DELETE FROM business_trips WHERE work_id IN (SELECT id FROM test_works) OR author_id IN (SELECT id FROM test_users);
DELETE FROM work_permit_requirements WHERE work_id IN (SELECT id FROM test_works);

-- ══════════════════════════════════════════════════════════════
-- УРОВЕНЬ 2: Equipment / HR / misc
-- ══════════════════════════════════════════════════════════════

DELETE FROM equipment_movements WHERE created_by IN (SELECT id FROM test_users) OR (created_at::date = '2026-04-20' AND notes ILIKE '%test%');
DELETE FROM equipment_reservations WHERE reserved_by IN (SELECT id FROM test_users) OR (created_at::date = '2026-04-20' AND notes ILIKE '%test%');
DELETE FROM equipment_requests WHERE requester_id IN (SELECT id FROM test_users) OR (created_at::date = '2026-04-20' AND notes ILIKE '%test%');
DELETE FROM equipment_work_assignments WHERE work_id IN (SELECT id FROM test_works) OR assigned_by IN (SELECT id FROM test_users);
-- equipment BEFORE equipment_kits (FK: equipment.kit_id -> equipment_kits)
DELETE FROM equipment WHERE created_by IN (SELECT id FROM test_users) OR (created_at::date = '2026-04-20' AND (name ILIKE '%test%' OR name LIKE 'MATRIX-%'));
DELETE FROM equipment_kits WHERE created_by IN (SELECT id FROM test_users) OR (created_at::date = '2026-04-20' AND (name ILIKE '%test%' OR description ILIKE '%test%'));
DELETE FROM equipment_categories WHERE created_at::date = '2026-04-20' AND name ILIKE '%test%';

DELETE FROM employee_reviews WHERE employee_id IN (SELECT id FROM test_employees) OR pm_id IN (SELECT id FROM test_users);
DELETE FROM employee_rates WHERE employee_id IN (SELECT id FROM test_employees) OR created_by IN (SELECT id FROM test_users);
DELETE FROM employee_collection_items WHERE employee_id IN (SELECT id FROM test_employees) OR added_by IN (SELECT id FROM test_users);
DELETE FROM employee_collections WHERE created_by IN (SELECT id FROM test_users) OR (created_at::date = '2026-04-20' AND name ILIKE '%test%');
DELETE FROM employee_permits WHERE employee_id IN (SELECT id FROM test_employees);
DELETE FROM employee_plan WHERE employee_id IN (SELECT id FROM test_employees) OR work_id IN (SELECT id FROM test_works);

DELETE FROM permit_types WHERE created_at::date = '2026-04-20' AND name ILIKE '%test%';
DELETE FROM cash_returns WHERE confirmed_by IN (SELECT id FROM test_users) OR (created_at::date = '2026-04-20' AND note ILIKE '%test%');
DELETE FROM staff WHERE created_at::date = '2026-04-20' AND name ILIKE '%test%';
DELETE FROM erp_sync_log WHERE connection_id IN (SELECT id FROM erp_connections WHERE created_at::date = '2026-04-20' AND name ILIKE '%test%');
DELETE FROM erp_connections WHERE created_at::date = '2026-04-20' AND name ILIKE '%test%';

DELETE FROM self_employed WHERE employee_id IN (SELECT id FROM test_employees);
DELETE FROM payment_registry WHERE employee_id IN (SELECT id FROM test_employees) OR created_by IN (SELECT id FROM test_users);

-- ══════════════════════════════════════════════════════════════
-- УРОВЕНЬ 1: field-операции + user-owned leaf tables
-- ══════════════════════════════════════════════════════════════

DELETE FROM field_checkins WHERE work_id IN (SELECT id FROM test_works) OR employee_id IN (SELECT id FROM test_employees);
DELETE FROM field_daily_reports WHERE work_id IN (SELECT id FROM test_works) OR author_id IN (SELECT id FROM test_employees);
DELETE FROM field_photos WHERE work_id IN (SELECT id FROM test_works) OR employee_id IN (SELECT id FROM test_employees);
DELETE FROM field_incidents WHERE work_id IN (SELECT id FROM test_works) OR reported_by IN (SELECT id FROM test_employees);
DELETE FROM field_sms_log WHERE work_id IN (SELECT id FROM test_works) OR employee_id IN (SELECT id FROM test_employees);
DELETE FROM field_logistics WHERE work_id IN (SELECT id FROM test_works) OR employee_id IN (SELECT id FROM test_employees);
DELETE FROM field_project_settings WHERE work_id IN (SELECT id FROM test_works);
DELETE FROM field_master_funds WHERE work_id IN (SELECT id FROM test_works) OR master_employee_id IN (SELECT id FROM test_employees);
DELETE FROM field_master_expenses WHERE work_id IN (SELECT id FROM test_works) OR master_employee_id IN (SELECT id FROM test_employees);
DELETE FROM field_packing_items WHERE photographed_by IN (SELECT id FROM test_employees);
DELETE FROM field_packing_lists WHERE work_id IN (SELECT id FROM test_works) OR assigned_to IN (SELECT id FROM test_employees);
DELETE FROM field_trip_stages WHERE work_id IN (SELECT id FROM test_works) OR employee_id IN (SELECT id FROM test_employees);
DELETE FROM field_auth_codes WHERE employee_id IN (SELECT id FROM test_employees);
DELETE FROM field_sessions WHERE employee_id IN (SELECT id FROM test_employees);
DELETE FROM worker_payments WHERE work_id IN (SELECT id FROM test_works) OR employee_id IN (SELECT id FROM test_employees) OR created_by IN (SELECT id FROM test_users);
DELETE FROM employee_assignments WHERE work_id IN (SELECT id FROM test_works) OR employee_id IN (SELECT id FROM test_employees);

-- assembly
DELETE FROM assembly_items WHERE assembly_id IN (SELECT id FROM assembly_orders WHERE work_id IN (SELECT id FROM test_works) OR created_by IN (SELECT id FROM test_users));
DELETE FROM assembly_pallets WHERE assembly_id IN (SELECT id FROM assembly_orders WHERE work_id IN (SELECT id FROM test_works) OR created_by IN (SELECT id FROM test_users));
DELETE FROM assembly_orders WHERE work_id IN (SELECT id FROM test_works) OR created_by IN (SELECT id FROM test_users);

-- user-owned leaf tables
DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM test_users);
DELETE FROM user_menu_settings WHERE user_id IN (SELECT id FROM test_users);
DELETE FROM user_email_accounts WHERE user_id IN (SELECT id FROM test_users);
DELETE FROM user_stories WHERE user_id IN (SELECT id FROM test_users);
DELETE FROM user_requests WHERE user_id IN (SELECT id FROM test_users);
DELETE FROM chat_group_members WHERE user_id IN (SELECT id FROM test_users);
DELETE FROM worker_profiles WHERE user_id IN (SELECT id FROM test_users);
DELETE FROM role_analytics_cache WHERE user_id IN (SELECT id FROM test_users);
DELETE FROM call_report_user_prefs WHERE user_id IN (SELECT id FROM test_users);

DELETE FROM sites WHERE customer_id IN (SELECT id FROM test_customers) OR (created_at::date = '2026-04-20' AND (name ILIKE '%test%' OR address ILIKE '%test%'));

-- Nullify non-owned FK refs on remaining records (where column is nullable)
UPDATE tenders SET responsible_pm_id = NULL WHERE responsible_pm_id IN (SELECT id FROM test_users);
UPDATE tenders SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE tenders SET archived_by = NULL WHERE archived_by IN (SELECT id FROM test_users);
UPDATE works SET pm_id = NULL WHERE pm_id IN (SELECT id FROM test_users);
UPDATE works SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE employees SET user_id = NULL WHERE user_id IN (SELECT id FROM test_users);
UPDATE expenses SET buh_id = NULL WHERE buh_id IN (SELECT id FROM test_users);
UPDATE tkp SET author_id = NULL WHERE author_id IN (SELECT id FROM test_users);
UPDATE tkp SET sent_by = NULL WHERE sent_by IN (SELECT id FROM test_users);
UPDATE tkp SET approved_by = NULL WHERE approved_by IN (SELECT id FROM test_users);
UPDATE invoices SET estimate_id = NULL WHERE estimate_id IN (SELECT id FROM estimates WHERE created_by IN (SELECT id FROM test_users));
-- chats don't have created_by; chat_group_members already DELETE'd above

-- Mass nullify ALL remaining nullable FK refs to test_users
-- (144 FK on users — cover everything)
UPDATE bank_transactions SET confirmed_by = NULL WHERE confirmed_by IN (SELECT id FROM test_users);
UPDATE bank_transactions SET imported_by = NULL WHERE imported_by IN (SELECT id FROM test_users);
UPDATE inbox_applications SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE inbox_applications SET decision_by = NULL WHERE decision_by IN (SELECT id FROM test_users);
UPDATE incomes SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE meetings SET organizer_id = NULL WHERE organizer_id IN (SELECT id FROM test_users);
UPDATE meetings SET minutes_author_id = NULL WHERE minutes_author_id IN (SELECT id FROM test_users);
UPDATE site_inspections SET author_id = NULL WHERE author_id IN (SELECT id FROM test_users);
UPDATE estimates SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE estimates SET pm_id = NULL WHERE pm_id IN (SELECT id FROM test_users);
UPDATE estimates SET director_id = NULL WHERE director_id IN (SELECT id FROM test_users);
UPDATE worker_payments SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE worker_payments SET paid_by = NULL WHERE paid_by IN (SELECT id FROM test_users);
UPDATE equipment SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE equipment SET written_off_by = NULL WHERE written_off_by IN (SELECT id FROM test_users);
UPDATE equipment SET current_holder_id = NULL WHERE current_holder_id IN (SELECT id FROM test_users);
UPDATE equipment_movements SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE equipment_movements SET confirmed_by = NULL WHERE confirmed_by IN (SELECT id FROM test_users);
UPDATE equipment_movements SET from_holder_id = NULL WHERE from_holder_id IN (SELECT id FROM test_users);
UPDATE equipment_movements SET to_holder_id = NULL WHERE to_holder_id IN (SELECT id FROM test_users);
UPDATE equipment_requests SET requester_id = NULL WHERE requester_id IN (SELECT id FROM test_users);
UPDATE equipment_requests SET processed_by = NULL WHERE processed_by IN (SELECT id FROM test_users);
UPDATE equipment_requests SET target_holder_id = NULL WHERE target_holder_id IN (SELECT id FROM test_users);
UPDATE equipment_reservations SET reserved_by = NULL WHERE reserved_by IN (SELECT id FROM test_users);
UPDATE procurement_requests SET author_id = NULL WHERE author_id IN (SELECT id FROM test_users);
UPDATE procurement_requests SET approved_by = NULL WHERE approved_by IN (SELECT id FROM test_users);
UPDATE procurement_requests SET pm_id = NULL WHERE pm_id IN (SELECT id FROM test_users);
UPDATE procurement_requests SET buh_id = NULL WHERE buh_id IN (SELECT id FROM test_users);
UPDATE procurement_requests SET proc_id = NULL WHERE proc_id IN (SELECT id FROM test_users);
UPDATE procurement_requests SET dir_approved_by = NULL WHERE dir_approved_by IN (SELECT id FROM test_users);
UPDATE procurement_items SET received_by = NULL WHERE received_by IN (SELECT id FROM test_users);
UPDATE procurement_payments SET uploaded_by = NULL WHERE uploaded_by IN (SELECT id FROM test_users);
UPDATE procurement_history SET actor_id = NULL WHERE actor_id IN (SELECT id FROM test_users);
UPDATE one_time_payments SET requested_by = NULL WHERE requested_by IN (SELECT id FROM test_users);
UPDATE one_time_payments SET approved_by = NULL WHERE approved_by IN (SELECT id FROM test_users);
UPDATE one_time_payments SET buh_id = NULL WHERE buh_id IN (SELECT id FROM test_users);
UPDATE payroll_sheets SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE payroll_sheets SET buh_id = NULL WHERE buh_id IN (SELECT id FROM test_users);
UPDATE payroll_sheets SET approved_by = NULL WHERE approved_by IN (SELECT id FROM test_users);
UPDATE payroll_sheets SET paid_by = NULL WHERE paid_by IN (SELECT id FROM test_users);
UPDATE payment_registry SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE pass_requests SET author_id = NULL WHERE author_id IN (SELECT id FROM test_users);
UPDATE pass_requests SET approved_by = NULL WHERE approved_by IN (SELECT id FROM test_users);
UPDATE employee_reviews SET pm_id = NULL WHERE pm_id IN (SELECT id FROM test_users);
UPDATE employee_rates SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE business_trips SET author_id = NULL WHERE author_id IN (SELECT id FROM test_users);
UPDATE travel_expenses SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE travel_expenses SET buh_id = NULL WHERE buh_id IN (SELECT id FROM test_users);
UPDATE work_expenses SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE work_expenses SET buh_id = NULL WHERE buh_id IN (SELECT id FROM test_users);
UPDATE documents SET uploaded_by = NULL WHERE uploaded_by IN (SELECT id FROM test_users);
UPDATE correspondence SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE cash_requests SET user_id = NULL WHERE user_id IN (SELECT id FROM test_users);
UPDATE cash_requests SET director_id = NULL WHERE director_id IN (SELECT id FROM test_users);
UPDATE cash_requests SET issued_by = NULL WHERE issued_by IN (SELECT id FROM test_users);
UPDATE cash_balance_log SET user_id = NULL WHERE user_id IN (SELECT id FROM test_users);
UPDATE cash_returns SET confirmed_by = NULL WHERE confirmed_by IN (SELECT id FROM test_users);
UPDATE cash_messages SET user_id = NULL WHERE user_id IN (SELECT id FROM test_users);
UPDATE estimate_approval_requests SET requested_by = NULL WHERE requested_by IN (SELECT id FROM test_users);
UPDATE estimate_approval_requests SET last_actor_id = NULL WHERE last_actor_id IN (SELECT id FROM test_users);
UPDATE estimate_approval_requests SET pm_id = NULL WHERE pm_id IN (SELECT id FROM test_users);
UPDATE estimate_approval_events SET actor_id = NULL WHERE actor_id IN (SELECT id FROM test_users);
UPDATE estimate_calculation_data SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE tender_comments SET user_id = NULL WHERE user_id IN (SELECT id FROM test_users);
UPDATE tender_author_history SET changed_by = NULL WHERE changed_by IN (SELECT id FROM test_users);
UPDATE tender_author_history SET old_author_id = NULL WHERE old_author_id IN (SELECT id FROM test_users);
UPDATE tender_author_history SET new_author_id = NULL WHERE new_author_id IN (SELECT id FROM test_users);
UPDATE assembly_orders SET created_by = NULL WHERE created_by IN (SELECT id FROM test_users);
UPDATE assembly_orders SET confirmed_by = NULL WHERE confirmed_by IN (SELECT id FROM test_users);
UPDATE assembly_items SET packed_by = NULL WHERE packed_by IN (SELECT id FROM test_users);
UPDATE assembly_items SET received_by = NULL WHERE received_by IN (SELECT id FROM test_users);
UPDATE assembly_pallets SET received_by = NULL WHERE received_by IN (SELECT id FROM test_users);
UPDATE pre_tender_requests SET assigned_to = NULL WHERE assigned_to IN (SELECT id FROM test_users);
UPDATE pre_tender_requests SET decision_by = NULL WHERE decision_by IN (SELECT id FROM test_users);
UPDATE pre_tender_requests SET buh_id = NULL WHERE buh_id IN (SELECT id FROM test_users);
-- customer_reviews doesn't have user_id
UPDATE audit_log SET actor_user_id = NULL WHERE actor_user_id IN (SELECT id FROM test_users);
UPDATE erp_sync_log SET initiated_by = NULL WHERE initiated_by IN (SELECT id FROM test_users);
DELETE FROM emails WHERE owner_user_id IN (SELECT id FROM test_users);
DELETE FROM office_expenses WHERE created_by IN (SELECT id FROM test_users) OR approved_by IN (SELECT id FROM test_users);
DELETE FROM bonus_requests WHERE processed_by IN (SELECT id FROM test_users) OR buh_id IN (SELECT id FROM test_users);
DELETE FROM training_applications WHERE user_id IN (SELECT id FROM test_users);
DELETE FROM inventory_checks WHERE conducted_by IN (SELECT id FROM test_users);
DELETE FROM seal_transfers WHERE created_at::date = '2026-04-20';
DELETE FROM meeting_participants WHERE user_id IN (SELECT id FROM test_users);
DELETE FROM meeting_minutes WHERE created_by IN (SELECT id FROM test_users);
DELETE FROM approval_payment_slips WHERE uploaded_by IN (SELECT id FROM test_users);
DELETE FROM ai_analysis_log WHERE created_by IN (SELECT id FROM test_users);
DELETE FROM bank_import_batches WHERE imported_by IN (SELECT id FROM test_users);
DELETE FROM call_reports WHERE requested_by IN (SELECT id FROM test_users);
DELETE FROM call_routing_rules WHERE created_by IN (SELECT id FROM test_users);
DELETE FROM active_calls WHERE assigned_user_id IN (SELECT id FROM test_users);
DELETE FROM telephony_escalations WHERE user_id IN (SELECT id FROM test_users);
DELETE FROM warehouses WHERE responsible_id IN (SELECT id FROM test_users);

-- ══════════════════════════════════════════════════════════════
-- УРОВЕНЬ 0: Корневые таблицы
-- ══════════════════════════════════════════════════════════════

-- Nullify tender_id on test_works so tenders can be deleted
UPDATE works SET tender_id = NULL WHERE tender_id IN (SELECT id FROM test_tenders);
-- works linked to test tenders (that aren't already in test_works)
DELETE FROM works WHERE id IN (SELECT id FROM test_works);
DELETE FROM tenders WHERE id IN (SELECT id FROM test_tenders);
DELETE FROM customers WHERE id IN (SELECT id FROM test_customers);
DELETE FROM employees WHERE id IN (SELECT id FROM test_employees);
DELETE FROM users WHERE id IN (SELECT id FROM test_users);

-- ══════════════════════════════════════════════════════════════
-- ФИНАЛЬНЫЙ CHECK: реальные данные целы?
-- ══════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_kao_checkins int; v_kao_fot numeric; v_kao_emp int;
  v_gorshkov_ok boolean; v_arhbum_ok boolean;
BEGIN
  SELECT COUNT(*) FILTER (WHERE status != 'cancelled'),
         COALESCE(SUM(amount_earned) FILTER (WHERE status != 'cancelled'), 0),
         COUNT(DISTINCT employee_id)
  INTO v_kao_checkins, v_kao_fot, v_kao_emp
  FROM field_checkins WHERE work_id = 11;

  SELECT EXISTS(SELECT 1 FROM employees WHERE fio ILIKE '%Горшков%Иван%') INTO v_gorshkov_ok;
  SELECT EXISTS(SELECT 1 FROM works WHERE id = 10) INTO v_arhbum_ok;

  RAISE NOTICE '--- AFTER CLEANUP ---';
  RAISE NOTICE 'КАО Азот: checkins=%, ФОТ=%₽, employees=%', v_kao_checkins, v_kao_fot, v_kao_emp;
  RAISE NOTICE 'Горшков в employees: %', v_gorshkov_ok;
  RAISE NOTICE 'ARHBUM (work_id=10) in works: %', v_arhbum_ok;

  IF v_kao_checkins < 290 OR v_kao_fot < 1600000 OR v_kao_emp < 20 THEN
    RAISE EXCEPTION 'FATAL: КАО Азот пострадала! checkins=%, fot=%, emp=%', v_kao_checkins, v_kao_fot, v_kao_emp;
  END IF;

  IF NOT v_gorshkov_ok THEN
    RAISE EXCEPTION 'FATAL: Горшков удалён!';
  END IF;

  IF NOT v_arhbum_ok THEN
    RAISE EXCEPTION 'FATAL: АРХБУМ удалён!';
  END IF;

  RAISE NOTICE 'OK: реальные данные целы. COMMIT безопасен.';
END $$;

COMMIT;
