import paramiko

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)

SQL = r"""
DO $$ BEGIN
  BEGIN DELETE FROM staff_request_items WHERE request_id IN (SELECT id FROM staff_requests WHERE work_id IN (SELECT id FROM works WHERE tender_id IN (SELECT id FROM tenders WHERE tender_title ILIKE '%E2E%' OR tender_title ILIKE '%Тест%'))); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM staff_requests WHERE work_id IN (SELECT id FROM works WHERE tender_id IN (SELECT id FROM tenders WHERE tender_title ILIKE '%E2E%' OR tender_title ILIKE '%Тест%')); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM works WHERE tender_id IN (SELECT id FROM tenders WHERE tender_title ILIKE '%E2E%' OR tender_title ILIKE '%Тест%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM approval_comments WHERE estimate_id IN (SELECT id FROM estimates WHERE tender_id IN (SELECT id FROM tenders WHERE tender_title ILIKE '%E2E%' OR tender_title ILIKE '%Тест%')); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM estimate_calculation_data WHERE estimate_id IN (SELECT id FROM estimates WHERE tender_id IN (SELECT id FROM tenders WHERE tender_title ILIKE '%E2E%' OR tender_title ILIKE '%Тест%')); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM estimates WHERE tender_id IN (SELECT id FROM tenders WHERE tender_title ILIKE '%E2E%' OR tender_title ILIKE '%Тест%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM chat_messages WHERE chat_id IN (SELECT id FROM chats WHERE title ILIKE '%E2E%' OR title ILIKE '%Тест%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM chats WHERE title ILIKE '%E2E%' OR title ILIKE '%Тест%'; EXCEPTION WHEN OTHERS THEN NULL; END;
  DELETE FROM tenders WHERE tender_title ILIKE '%E2E%' OR tender_title ILIKE '%Тест%';
  RAISE NOTICE 'Cleanup done';
END $$;

SELECT 'tenders' as tbl, count(*) FROM tenders WHERE tender_title ILIKE '%E2E%';
"""

cmd = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm <<'EOSQL'\n{SQL}\nEOSQL"
_, stdout, stderr = client.exec_command(cmd, timeout=60)
print(stdout.read().decode())
err = stderr.read().decode()
for line in err.split('\n'):
    if line.strip():
        print(f"{'INFO' if 'NOTICE' in line else 'ERR'}: {line}")
client.close()
