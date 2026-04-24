import paramiko

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)

SQL = r"""
-- Cleanup E2E data (ignore missing tables)
DO $$ BEGIN
  -- Staff
  BEGIN DELETE FROM staff_request_items WHERE request_id IN (SELECT id FROM staff_requests WHERE work_id IN (SELECT id FROM works WHERE title ILIKE '%E2E%' OR title ILIKE '%Тест%')); EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM staff_requests WHERE work_id IN (SELECT id FROM works WHERE title ILIKE '%E2E%' OR title ILIKE '%Тест%'); EXCEPTION WHEN undefined_table THEN NULL; END;
  -- Works
  BEGIN DELETE FROM works WHERE title ILIKE '%E2E%' OR title ILIKE '%Тест%'; EXCEPTION WHEN undefined_table THEN NULL; END;
  -- Estimates
  BEGIN DELETE FROM approval_comments WHERE estimate_id IN (SELECT id FROM estimates WHERE tender_id IN (SELECT id FROM tenders WHERE tender_title ILIKE '%E2E%' OR tender_title ILIKE '%Тест%')); EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM estimate_calculation_data WHERE estimate_id IN (SELECT id FROM estimates WHERE tender_id IN (SELECT id FROM tenders WHERE tender_title ILIKE '%E2E%' OR tender_title ILIKE '%Тест%')); EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM estimates WHERE tender_id IN (SELECT id FROM tenders WHERE tender_title ILIKE '%E2E%' OR tender_title ILIKE '%Тест%'); EXCEPTION WHEN undefined_table THEN NULL; END;
  -- Chats
  BEGIN DELETE FROM chat_messages WHERE chat_id IN (SELECT id FROM chats WHERE title ILIKE '%E2E%' OR title ILIKE '%Тест%'); EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM chats WHERE title ILIKE '%E2E%' OR title ILIKE '%Тест%'; EXCEPTION WHEN undefined_table THEN NULL; END;
  -- Tenders
  BEGIN DELETE FROM tenders WHERE tender_title ILIKE '%E2E%' OR tender_title ILIKE '%Тест%'; EXCEPTION WHEN undefined_table THEN NULL; END;
  RAISE NOTICE 'Cleanup done';
END $$;

-- Verification
SELECT 'tenders_e2e' as check, count(*) FROM tenders WHERE tender_title ILIKE '%E2E%'
UNION ALL SELECT 'works_e2e', count(*) FROM works WHERE title ILIKE '%E2E%';

-- Accounts
SELECT login, role, id FROM users WHERE login IN ('test_pm', 'test_director_gen', 'test_hr');

-- Presets
SELECT 'role_presets' as tbl, count(*) FROM role_presets;

-- Employees
SELECT 'employees_with_position' as tbl, count(*) FROM employees WHERE position IS NOT NULL AND position != '';
"""

cmd = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm <<'EOSQL'\n{SQL}\nEOSQL"
_, stdout, stderr = client.exec_command(cmd, timeout=60)
print(stdout.read().decode())
err = stderr.read().decode()
if err:
    # Filter out NOTICE lines
    for line in err.split('\n'):
        if line.strip() and 'NOTICE' not in line:
            print(f"ERR: {line}")
        elif 'NOTICE' in line:
            print(line)

client.close()
