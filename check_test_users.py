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

# 1. Find all test users
print("=== TEST USERS ===")
print(run("""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
SELECT id, login, name, role, is_active, created_at
FROM users
WHERE login LIKE 'test_%' OR login LIKE 'Test%' OR name LIKE 'Test%' OR email LIKE 'test%'
ORDER BY id;
" """))

client.close()
