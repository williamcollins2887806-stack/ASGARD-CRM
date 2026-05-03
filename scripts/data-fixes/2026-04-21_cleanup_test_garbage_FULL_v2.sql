BEGIN;

-- Whitelist guard
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM tenders WHERE id IN (18,19,21,22,23)) < 5 THEN
    RAISE EXCEPTION 'Whitelist tenders < 5, ABORT';
  END IF;
  IF (SELECT COUNT(*) FROM works WHERE id IN (10,11)) < 2 THEN
    RAISE EXCEPTION 'Whitelist works < 2, ABORT';
  END IF;
  IF (SELECT COUNT(*) FROM employees) < 500 THEN
    RAISE EXCEPTION 'employees < 500, something wrong, ABORT';
  END IF;
  RAISE NOTICE 'Pre-check OK: tenders whitelist=5, works whitelist=2, employees total ok';
END $$;

DO $$
DECLARE
  t_before INT := (SELECT COUNT(*) FROM tenders);
  w_before INT := (SELECT COUNT(*) FROM works);
  tkp_before INT := (SELECT COUNT(*) FROM tkp);
  audit_before INT := (SELECT COUNT(*) FROM audit_log);
BEGIN
  RAISE NOTICE 'BEFORE: tenders=%, works=%, tkp=%, audit_log=%', t_before, w_before, tkp_before, audit_before;
END $$;

DELETE FROM audit_log WHERE entity_type = 'tender' AND entity_id NOT IN (18,19,21,22,23);
DELETE FROM tkp WHERE tender_id IS NOT NULL AND tender_id NOT IN (18,19,21,22,23);
DELETE FROM tenders WHERE tender_title IS NULL OR tender_title = '';
DELETE FROM works WHERE id NOT IN (10,11);

DO $$ BEGIN
  IF (SELECT COUNT(*) FROM tenders) < 5 THEN RAISE EXCEPTION 'tenders < 5 after cleanup, ROLLBACK'; END IF;
  IF (SELECT COUNT(*) FROM works) < 2 THEN RAISE EXCEPTION 'works < 2 after cleanup, ROLLBACK'; END IF;
  IF (SELECT COUNT(*) FROM employees) < 500 THEN RAISE EXCEPTION 'employees touched, ROLLBACK'; END IF;
  IF (SELECT COUNT(*) FROM notifications) < 1200 THEN RAISE EXCEPTION 'notifications touched, ROLLBACK'; END IF;
  IF (SELECT COUNT(*) FROM customers) < 280 THEN RAISE EXCEPTION 'customers touched, ROLLBACK'; END IF;
  RAISE NOTICE 'Post-check OK';
END $$;

DO $$
DECLARE
  t_after INT := (SELECT COUNT(*) FROM tenders);
  w_after INT := (SELECT COUNT(*) FROM works);
  tkp_after INT := (SELECT COUNT(*) FROM tkp);
  audit_after INT := (SELECT COUNT(*) FROM audit_log);
BEGIN
  RAISE NOTICE 'AFTER: tenders=%, works=%, tkp=%, audit_log=%', t_after, w_after, tkp_after, audit_after;
END $$;

COMMIT;

SELECT 'tenders' AS tbl, COUNT(*) AS rows FROM tenders
UNION ALL SELECT 'works', COUNT(*) FROM works
UNION ALL SELECT 'tkp', COUNT(*) FROM tkp
UNION ALL SELECT 'audit_log', COUNT(*) FROM audit_log
UNION ALL SELECT 'employees', COUNT(*) FROM employees
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'customers', COUNT(*) FROM customers;
