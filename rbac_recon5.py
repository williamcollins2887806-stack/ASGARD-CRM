import paramiko
import time
import sys
import io

# Force UTF-8 output
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SSH_KEY = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
SSH_HOST = '92.242.61.184'
SSH_USER = 'root'

def get_client():
    key = paramiko.Ed25519Key.from_private_key_file(SSH_KEY)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=15)
    return client

def run_cmd(cmd, label, timeout=45):
    for attempt in range(3):
        try:
            client = get_client()
            print(f"\n{'='*70}")
            print(f"  {label}")
            print(f"{'='*70}")
            stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            if out.strip():
                print(out)
            if err.strip():
                print(f"[STDERR] {err}")
            if not out.strip() and not err.strip():
                print("(no output)")
            client.close()
            return
        except Exception as e:
            print(f"[ERROR attempt {attempt+1}] {e}")
            time.sleep(2)

# permissions.js route
run_cmd(
    "head -120 /var/www/asgard-crm/src/routes/permissions.js",
    "permissions.js route (first 120 lines)"
)

# Frontend app.js role/nav patterns
run_cmd(
    r"""grep -n 'role\|permission\|menu\|nav\|sidebar' /var/www/asgard-crm/public/assets/js/app.js""",
    "Frontend app.js role/nav patterns"
)

# requirePermission continuation (lines 290-310)
run_cmd(
    "sed -n '285,320p' /var/www/asgard-crm/src/index.js",
    "requirePermission continuation (index.js lines 285-320)"
)

# Check how many routes use requirePermission vs requireRoles
run_cmd(
    r"""grep -rn 'requirePermission' /var/www/asgard-crm/src/routes/""",
    "All requirePermission usage in routes"
)

# Check how the frontend fetches permissions
run_cmd(
    r"""grep -rn 'permission\|/api/permissions\|/api/me' /var/www/asgard-crm/public/assets/js/app.js | head -20""",
    "Frontend permission fetching in app.js"
)

# Check auth route for what /api/me returns
run_cmd(
    r"""grep -n 'me\|profile\|permissions\|role_presets' /var/www/asgard-crm/src/routes/auth.js | head -20""",
    "auth.js /api/me route patterns"
)

# Total role_presets count per role
run_cmd(
    """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT role, COUNT(*) as modules, SUM(CASE WHEN can_read THEN 1 ELSE 0 END) as reads, SUM(CASE WHEN can_write THEN 1 ELSE 0 END) as writes, SUM(CASE WHEN can_delete THEN 1 ELSE 0 END) as deletes FROM role_presets GROUP BY role ORDER BY role;" """,
    "Role presets summary per role"
)

print(f"\n{'='*70}")
print("  Reconnaissance part 5 complete.")
print(f"{'='*70}")
