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

commands = [
    (
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT role, module_key, can_read, can_write, can_delete FROM role_presets ORDER BY role, module_key;" """,
        "Full role_presets data"
    ),
    (
        r"""grep -n 'requireRole\|decorate\|fastify\.decorate' /var/www/asgard-crm/src/index.js | head -30""",
        "requireRoles definition in index.js"
    ),
    (
        r"""grep -n 'requireRole' /var/www/asgard-crm/src/index.js""",
        "All requireRoles references in index.js"
    ),
    (
        "ls /var/www/asgard-crm/src/routes/",
        "All route files"
    ),
    (
        r"""grep -rn 'requireRoles\|preHandler' /var/www/asgard-crm/src/routes/ | grep -v node_modules | head -60""",
        "All preHandler/requireRoles usage in routes"
    ),
    (
        """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "SELECT DISTINCT module_key FROM role_presets ORDER BY module_key;" """,
        "All module_keys in role_presets"
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
print("  Reconnaissance part 3 complete.")
print(f"{'='*70}")
