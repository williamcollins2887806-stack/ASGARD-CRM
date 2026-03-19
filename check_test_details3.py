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

# Works columns
print("=== WORKS COLUMNS ===")
print(run("""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='works' ORDER BY ordinal_position LIMIT 10;" """))

# Works by test users
print("\n=== WORKS BY TEST USERS ===")
print(run("""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT w.id, w.created_by, u.login, w.created_at FROM works w JOIN users u ON u.id = w.created_by WHERE w.created_by BETWEEN 3478 AND 3492;" """))

# Tenders by test users (created_by_user_id)
print("\n=== TENDERS BY TEST USERS ===")
print(run("""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT t.id, t.created_by_user_id, u.login, t.tender_status, t.created_at FROM tenders t JOIN users u ON u.id = t.created_by_user_id WHERE t.created_by_user_id BETWEEN 3478 AND 3492;" """))

client.close()
