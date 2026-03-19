import paramiko

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)

def run(cmd, timeout=30):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        return stdout.read().decode().strip() or stderr.read().decode().strip()
    except Exception as e:
        return f"ERROR: {e}"

# Write and execute
sql = r"""cat > /tmp/check_deps.sql << 'SQLEOF'
-- Check all tender FK deps for tenders 22801-22804
SELECT * FROM (
SELECT 'bank_transactions_tender' AS src, COUNT(*) AS cnt FROM bank_transactions WHERE tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'calendar_events_tender', COUNT(*) FROM calendar_events WHERE tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'correspondence_tender', COUNT(*) FROM correspondence WHERE tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'documents_tender', COUNT(*) FROM documents WHERE tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'estimates_tender', COUNT(*) FROM estimates WHERE tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'inbox_applications', COUNT(*) FROM inbox_applications WHERE linked_tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'invoices_tender', COUNT(*) FROM invoices WHERE tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'meetings_tender', COUNT(*) FROM meetings WHERE tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'pass_requests_tender', COUNT(*) FROM pass_requests WHERE tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'tasks_tender', COUNT(*) FROM tasks WHERE tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'tkp_tender', COUNT(*) FROM tkp WHERE tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'tmc_requests_tender', COUNT(*) FROM tmc_requests WHERE tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'site_inspections_tender', COUNT(*) FROM site_inspections WHERE tender_id IN (22801,22802,22803,22804)
UNION ALL SELECT 'estimate_approval_tender', COUNT(*) FROM estimate_approval_requests WHERE tender_id IN (22801,22802,22803,22804)
-- Check work FK deps for work 7936
UNION ALL SELECT 'bank_transactions_work', COUNT(*) FROM bank_transactions WHERE work_id = 7936
UNION ALL SELECT 'calendar_events_work', COUNT(*) FROM calendar_events WHERE work_id = 7936
UNION ALL SELECT 'documents_work', COUNT(*) FROM documents WHERE work_id = 7936
UNION ALL SELECT 'tasks_work', COUNT(*) FROM tasks WHERE work_id = 7936
UNION ALL SELECT 'estimates_work', COUNT(*) FROM estimates WHERE work_id IN (SELECT id FROM estimates WHERE tender_id IN (22801,22802,22803,22804))
) sub WHERE cnt > 0;
SQLEOF"""

print("=== Writing check script ===")
run(sql, timeout=10)

print("=== FK DEPS (non-zero) ===")
result = run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /tmp/check_deps.sql 2>&1", timeout=30)
print(result)

client.close()
