import paramiko
import time

SSH_KEY = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
SSH_HOST = '92.242.61.184'
SSH_USER = 'root'

def get_client():
    key = paramiko.Ed25519Key.from_private_key_file(SSH_KEY)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=15)
    return client

def run_cmd(client, cmd, label, timeout=45):
    print(f"\n{'='*70}")
    print(f"  {label}")
    print(f"{'='*70}")
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode('utf-8', errors='replace')
        err = stderr.read().decode('utf-8', errors='replace')
        if out.strip():
            print(out)
        if err.strip():
            print(f"[STDERR] {err}")
        if not out.strip() and not err.strip():
            print("(no output)")
        return True
    except Exception as e:
        print(f"[ERROR] {e}")
        return False

# Commands 4-6 and bonus, batched into single SSH calls
commands = [
    (
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT DISTINCT role FROM users ORDER BY role;" """,
        "4. Distinct roles in users table"
    ),
    (
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT role, COUNT(*) FROM users GROUP BY role ORDER BY role;" """,
        "5. User count by role"
    ),
    (
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT id, login, role FROM users WHERE role IN ('CHIEF_ENGINEER','HEAD_PM','HR','PROC','WAREHOUSE','TO','BUH','OFFICE_MANAGER','PM','ADMIN') ORDER BY role LIMIT 20;" """,
        "6. Test user IDs for RBAC testing"
    ),
    (
        "ls -la /var/www/asgard-crm/src/middleware/ 2>/dev/null || echo 'No middleware dir'; ls -la /var/www/asgard-crm/src/ | head -30",
        "BONUS: src/ directory structure"
    ),
    (
        r"""grep -rn 'requireRole\|checkRole\|isAdmin\|authorize\|ALLOWED_ROLES\|DIRECTOR_ROLES\|HR_ROLES' /var/www/asgard-crm/src/routes/ | head -40""",
        "BONUS: Role constant/function patterns in routes"
    ),
    (
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "\d user_permissions" """,
        "BONUS: user_permissions table structure"
    ),
    (
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "\d role_presets" """,
        "BONUS: role_presets table structure"
    ),
    (
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT * FROM role_presets LIMIT 10;" """,
        "BONUS: role_presets data sample"
    ),
    (
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT * FROM user_permissions LIMIT 10;" """,
        "BONUS: user_permissions data sample"
    ),
]

for cmd, label in commands:
    for attempt in range(3):
        try:
            client = get_client()
            ok = run_cmd(client, cmd, label)
            client.close()
            if ok:
                break
        except Exception as e:
            print(f"[CONNECT ERROR attempt {attempt+1}] {e}")
            time.sleep(2)

print(f"\n{'='*70}")
print("  Reconnaissance complete.")
print(f"{'='*70}")
