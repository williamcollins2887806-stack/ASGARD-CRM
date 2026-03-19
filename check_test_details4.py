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

# Tenders created_by (integer?) check
print("=== TENDERS created_by ===")
print(run("""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT id, created_by, created_by_user_id, tender_status, created_at FROM tenders WHERE created_by::text LIKE '34%' OR created_by_user_id BETWEEN 3478 AND 3492 LIMIT 10;" """))

# Work 7936 details + cash_requests linked
print("\n=== WORK 7936 ===")
print(run("""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT id, tender_id, pm_id, work_status, created_by, created_at FROM works WHERE id=7936;" """))

# Cash requests linked to work 7936
print("\n=== CASH LINKED TO WORK 7936 ===")
print(run("""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT id, user_id, purpose, amount, work_id, status FROM cash_requests WHERE work_id=7936;" """))

# Notifications - are they just system notifs?
print("\n=== NOTIF TYPES ===")
print(run("""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT type, COUNT(*) FROM notifications WHERE user_id BETWEEN 3478 AND 3492 GROUP BY type;" """))

client.close()
