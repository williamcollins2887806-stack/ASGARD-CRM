import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)

cmd = r"""PGPASSWORD=123456789 psql -U asgard -d asgard_crm <<'EOSQL'
DO $$
DECLARE
  del_tenders INT := 0;
  del_works INT := 0;
  del_estimates INT := 0;
  del_staff INT := 0;
BEGIN
  -- Delete staff_requests linked to E2E works
  DELETE FROM staff_requests WHERE work_id IN (
    SELECT id FROM works WHERE tender_id IN (
      SELECT id FROM tenders WHERE tender_title LIKE '%E2E v7%'
    )
  );
  GET DIAGNOSTICS del_staff = ROW_COUNT;

  -- Delete estimates linked to E2E tenders
  DELETE FROM estimates WHERE tender_id IN (
    SELECT id FROM tenders WHERE tender_title LIKE '%E2E v7%'
  );
  GET DIAGNOSTICS del_estimates = ROW_COUNT;

  -- Delete works linked to E2E tenders
  DELETE FROM works WHERE tender_id IN (
    SELECT id FROM tenders WHERE tender_title LIKE '%E2E v7%'
  );
  GET DIAGNOSTICS del_works = ROW_COUNT;

  -- Delete E2E tenders
  DELETE FROM tenders WHERE tender_title LIKE '%E2E v7%';
  GET DIAGNOSTICS del_tenders = ROW_COUNT;

  RAISE NOTICE 'Cleaned: tenders=%, works=%, estimates=%, staff_requests=%',
    del_tenders, del_works, del_estimates, del_staff;
END $$;

-- Verify clean state
SELECT 'tenders' as tbl, count(*) as cnt FROM tenders WHERE tender_title LIKE '%E2E v7%'
UNION ALL
SELECT 'works', count(*) FROM works WHERE tender_id IN (SELECT id FROM tenders WHERE tender_title LIKE '%E2E v7%')
UNION ALL
SELECT 'estimates', count(*) FROM estimates WHERE tender_id IN (SELECT id FROM tenders WHERE tender_title LIKE '%E2E v7%');

-- Verify test accounts
SELECT id, login, role FROM users WHERE login IN ('test_pm','test_director_gen','test_hr') ORDER BY login;

-- Verify HR permissions
SELECT user_id, module_key, can_read FROM user_permissions WHERE user_id = 4406;
EOSQL
echo '===CLEANUP-DONE==='
systemctl is-active asgard-crm
"""

_, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))
err = stderr.read().decode('utf-8', errors='replace')
for line in err.split('\n'):
    if line.strip() and 'NOTICE' not in line:
        print(f"ERR: {line}")
    elif 'NOTICE' in line:
        print(line.strip())
client.close()
print("\nCleanup complete.")
