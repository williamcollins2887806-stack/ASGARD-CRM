import paramiko
import sys

SSH_KEY = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
SSH_HOST = '92.242.61.184'
SSH_USER = 'root'

def run_ssh(client, cmd, label):
    print(f"\n{'='*70}")
    print(f"  {label}")
    print(f"{'='*70}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out.strip():
        print(out)
    if err.strip():
        print(f"[STDERR] {err}")
    if not out.strip() and not err.strip():
        print("(no output)")
    return out

def main():
    key = paramiko.Ed25519Key.from_private_key_file(SSH_KEY)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {SSH_USER}@{SSH_HOST}...")
    client.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=15)
    print("Connected!")

    # 1. Role/permission/access tables
    run_ssh(client,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%role%' OR table_name LIKE '%perm%' OR table_name LIKE '%access%');" """,
        "1. DB tables related to role/permission/access")

    # 2. Role checks in routes
    run_ssh(client,
        r"""grep -rn 'role\|permission\|access.*denied\|403\|forbidden' /var/www/asgard-crm/src/routes/ | head -50""",
        "2. Role/permission checks in src/routes/")

    # 3. Role checks in middleware
    run_ssh(client,
        r"""grep -rn 'role\|permission\|access.*denied\|403\|forbidden' /var/www/asgard-crm/src/middleware/ | head -30""",
        "3. Role/permission checks in src/middleware/")

    # 4. Distinct roles
    run_ssh(client,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT DISTINCT role FROM users ORDER BY role;" """,
        "4. Distinct roles in users table")

    # 5. Users count by role
    run_ssh(client,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT role, COUNT(*) FROM users GROUP BY role ORDER BY role;" """,
        "5. User count by role")

    # 6. Test user IDs
    run_ssh(client,
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT id, login, role FROM users WHERE role IN ('CHIEF_ENGINEER','HEAD_PM','HR','PROC','WAREHOUSE','TO','BUH','OFFICE_MANAGER','PM','ADMIN') ORDER BY role LIMIT 20;" """,
        "6. Test user IDs for RBAC testing")

    # Bonus: list middleware files
    run_ssh(client,
        "ls -la /var/www/asgard-crm/src/middleware/",
        "BONUS: Middleware directory listing")

    # Bonus: check auth middleware structure
    run_ssh(client,
        "cat /var/www/asgard-crm/src/middleware/auth.js 2>/dev/null || echo 'File not found'",
        "BONUS: auth.js middleware content")

    client.close()
    print(f"\n{'='*70}")
    print("  Reconnaisance complete. Connection closed.")
    print(f"{'='*70}")

if __name__ == '__main__':
    main()
