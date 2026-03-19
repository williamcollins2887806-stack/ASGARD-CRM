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

# Find all FK constraints referencing tenders
print("=== FK CONSTRAINTS ON tenders ===")
print(run(r"""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT tc.table_name, kcu.column_name, tc.constraint_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name WHERE ccu.table_name = 'tenders' AND tc.constraint_type = 'FOREIGN KEY';" """))

# Documents linked to test tenders
print("\n=== DOCUMENTS ON TEST TENDERS ===")
print(run("""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT id, tender_id, uploaded_by_user_id FROM documents WHERE tender_id IN (22801,22802,22803,22804);" """))

# Also check: works FK deps (estimates, etc referencing work 7936)
print("\n=== FK CONSTRAINTS ON works ===")
print(run(r"""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT tc.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name WHERE ccu.table_name = 'works' AND tc.constraint_type = 'FOREIGN KEY';" """))

client.close()
