import paramiko
import time

KEY_PATH = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
HOST = '92.242.61.184'
USER = 'root'

key = paramiko.Ed25519Key.from_private_key_file(KEY_PATH)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, pkey=key, timeout=30)
ssh.get_transport().set_keepalive(5)

def run(cmd, timeout=15):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    return out, err

# 1. Check server logs for estimate-related activity
print("=" * 60)
print("1. JOURNALCTL LOGS (last 60 min, estimate/chat related)")
print("=" * 60)
out, err = run('journalctl -u asgard-crm --since "60 min ago" --no-pager 2>/dev/null | grep -i "H1\\|createEstimate\\|from-estimate\\|error\\|estimate\\|approval\\|chat" | tail -50')
print(out or "(no matches)")
if err:
    print("STDERR:", err)

time.sleep(1)

# 2. Check ALL logs for POST /estimates and /approval
print("\n" + "=" * 60)
print("2. LOGS: POST requests to estimates/approval")
print("=" * 60)
out, err = run('journalctl -u asgard-crm --since "60 min ago" --no-pager 2>/dev/null | grep -i "POST.*estimat\\|POST.*approval\\|/send\\|/approve" | tail -30')
print(out or "(no matches)")

time.sleep(1)

# 3. Check if estimate exists in DB
print("\n" + "=" * 60)
print("3. DB: Estimates for tender #2")
print("=" * 60)
out, err = run('''PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT id, tender_id, pm_id, approval_status, sent_for_approval_at, created_at FROM estimates WHERE tender_id = 2 ORDER BY id;" 2>/dev/null''')
print(out or "(no estimates)")

time.sleep(1)

# 4. Check if chat was created for estimates
print("\n" + "=" * 60)
print("4. DB: Chats linked to estimates")
print("=" * 60)
out, err = run('''PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT id, title, entity_type, entity_id, auto_created, created_at FROM chats WHERE entity_type = 'estimate' OR title LIKE '%просчёт%' OR title LIKE '%Estimate%' ORDER BY id DESC LIMIT 10;" 2>/dev/null''')
print(out or "(no chats)")

time.sleep(1)

# 5. Check staff requests for work #1
print("\n" + "=" * 60)
print("5. DB: Staff requests for work #1")
print("=" * 60)
out, err = run('''PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT * FROM staff_requests WHERE work_id = 1 ORDER BY id DESC LIMIT 5;" 2>/dev/null''')
print(out or "(no staff_requests table or no rows)")

time.sleep(1)

# 5b. Check if staff_requests table exists
out, err = run('''PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%staff%' OR table_name LIKE '%request%' OR table_name LIKE '%hr%';" 2>/dev/null''')
print("Staff-related tables:", out.strip() or "(none)")

time.sleep(1)

# 6. Check work #1 details
print("\n" + "=" * 60)
print("6. DB: Work #1 details")
print("=" * 60)
out, err = run('''PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT id, tender_id, work_title, work_status, pm_id, customer_name, sr_status, sr_sent_at FROM works WHERE id = 1;" 2>/dev/null''')
print(out or "(no work)")

time.sleep(1)

# 7. Check what columns work has related to staff
print("\n" + "=" * 60)
print("7. DB: Works columns (staff-related)")
print("=" * 60)
out, err = run('''PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'works' AND (column_name LIKE '%sr_%' OR column_name LIKE '%staff%' OR column_name LIKE '%crew%') ORDER BY ordinal_position;" 2>/dev/null''')
print(out or "(none)")

ssh.close()
