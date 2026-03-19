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

# First check tenders columns
print("=== TENDERS COLUMNS ===")
print(run("""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='tenders' AND column_name LIKE '%id%' OR (table_name='tenders' AND column_name LIKE '%user%') ORDER BY ordinal_position;" """))

# Check all foreign key columns across tables
print("\n=== ALL TABLES WITH user_id or similar ===")
print(run("""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT table_name, column_name FROM information_schema.columns WHERE (column_name LIKE '%user_id%' OR column_name LIKE '%creator_id%' OR column_name LIKE '%sender_id%' OR column_name LIKE '%assignee_id%' OR column_name LIKE '%responsible%' OR column_name LIKE '%pm_id%' OR column_name LIKE '%to_id%' OR column_name LIKE '%author_id%' OR column_name LIKE '%owner_id%' OR column_name LIKE '%created_by%') AND table_schema='public' ORDER BY table_name, column_name;" """))

client.close()
