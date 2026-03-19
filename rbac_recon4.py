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

# Get the requireRoles and requirePermission implementations (lines 226-280 of index.js)
run_cmd(
    "sed -n '220,290p' /var/www/asgard-crm/src/index.js",
    "requireRoles & requirePermission implementation (index.js lines 220-290)"
)

# Full role_presets - use a copy approach to avoid timeout
run_cmd(
    """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -F'|' -c "SELECT role, module_key, can_read, can_write, can_delete FROM role_presets ORDER BY role, module_key;" """,
    "Full role_presets (compact format)",
    timeout=60
)

# Check permissions.js route
run_cmd(
    "wc -l /var/www/asgard-crm/src/routes/permissions.js && head -100 /var/www/asgard-crm/src/routes/permissions.js",
    "permissions.js route (first 100 lines)"
)

# Check the router.js frontend for RBAC menu filtering
run_cmd(
    r"""grep -n 'role\|permission\|menu\|nav\|sidebar\|ALLOWED\|PAGE_ACCESS\|canAccess' /var/www/asgard-crm/public/assets/js/router.js | head -40""",
    "Frontend router.js role/permission patterns"
)

# Check app.js for role-based menu/navigation
run_cmd(
    r"""grep -n 'role\|permission\|menu\|nav\|sidebar' /var/www/asgard-crm/public/assets/js/app.js | head -40""",
    "Frontend app.js role/nav patterns"
)

print(f"\n{'='*70}")
print("  Reconnaissance part 4 complete.")
print(f"{'='*70}")
