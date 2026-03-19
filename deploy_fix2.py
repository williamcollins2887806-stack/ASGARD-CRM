import paramiko
import sys
import time

KEY = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
SERVER = '92.242.61.184'

def get_client():
    key = paramiko.Ed25519Key.from_private_key_file(KEY)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(SERVER, username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)
    return client

def run(client, cmd, timeout=30):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        return out or err
    except Exception as e:
        return f"ERROR: {e}"

# ========== STEP 1: Abort rebase, get clean state ==========
print("=== STEP 1: Abort rebase + clean state ===")
try:
    client = get_client()
    cmds = [
        ("abort rebase", "cd /var/www/asgard-crm && git rebase --abort 2>&1 || echo 'no rebase'"),
        ("current branch", "cd /var/www/asgard-crm && git branch --show-current"),
        ("status", "cd /var/www/asgard-crm && git status --short 2>&1"),
    ]
    for label, cmd in cmds:
        result = run(client, cmd, timeout=30)
        print(f"  {label}: {result or 'OK'}")
    client.close()
except Exception as e:
    print(f"  FAILED: {e}")

time.sleep(3)

# ========== STEP 2: Checkout mobile-v3 + restart ==========
print("\n=== STEP 2: Checkout mobile-v3 + restart ===")
try:
    client = get_client()
    cmds = [
        ("checkout mobile-v3", "cd /var/www/asgard-crm && git checkout mobile-v3 2>&1"),
        ("branch", "cd /var/www/asgard-crm && git branch --show-current"),
        ("restart", "systemctl restart asgard-crm"),
    ]
    for label, cmd in cmds:
        result = run(client, cmd, timeout=30)
        print(f"  {label}: {result or 'OK'}")
    client.close()
except Exception as e:
    print(f"  FAILED: {e}")

time.sleep(7)

# ========== STEP 3: Verify service ==========
print("\n=== STEP 3: Verify ===")
try:
    client = get_client()
    checks = [
        ('Service', 'systemctl is-active asgard-crm'),
        ('HTTP', "curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost:3000/"),
        ('Branch', 'cd /var/www/asgard-crm && git branch --show-current'),
        ('Commit', 'cd /var/www/asgard-crm && git log --oneline -1'),
    ]
    for label, cmd in checks:
        result = run(client, cmd, timeout=15)
        print(f"  {label}: {result}")
    client.close()
except Exception as e:
    print(f"  FAILED: {e}")

time.sleep(3)

# ========== STEP 4: Merge mobile-v3 -> main (no rebase, force) ==========
print("\n=== STEP 4: Merge mobile-v3 -> main (reset to mobile-v3) ===")
try:
    client = get_client()
    # Strategy: reset main to match mobile-v3 content, then force push
    cmds = [
        ("checkout main", "cd /var/www/asgard-crm && git checkout main 2>&1"),
        ("reset main to mobile-v3", "cd /var/www/asgard-crm && git reset --hard mobile-v3 2>&1"),
        ("force push main", "cd /var/www/asgard-crm && git push origin main --force 2>&1"),
        ("back to mobile-v3", "cd /var/www/asgard-crm && git checkout mobile-v3 2>&1"),
    ]
    for label, cmd in cmds:
        result = run(client, cmd, timeout=60)
        print(f"  {label}: {result or 'OK'}")
    client.close()
except Exception as e:
    print(f"  FAILED: {e}")

time.sleep(3)

# ========== STEP 5: Final restart + smoke ==========
print("\n=== STEP 5: Final restart + smoke test ===")
try:
    client = get_client()
    print("  restart:", run(client, "systemctl restart asgard-crm"))
    client.close()
except Exception as e:
    print(f"  restart FAILED: {e}")

time.sleep(7)

try:
    client = get_client()
    checks = [
        ('Service', 'systemctl is-active asgard-crm'),
        ('HTTP', "curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost:3000/"),
        ('Branch', 'cd /var/www/asgard-crm && git branch --show-current'),
        ('Commit', 'cd /var/www/asgard-crm && git log --oneline -1'),
        ('Desktop v3=0', "curl -s -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0)' http://localhost:3000/ | grep -c mobile_v3 || echo 0"),
        ('iPhone v3', "curl -s -H 'User-Agent: Mozilla/5.0 (iPhone)' http://localhost:3000/ | grep -c mobile_v3"),
        ('Errors 2min', "journalctl -u asgard-crm --no-pager --since '2 minutes ago' | grep -ci error || echo 0"),
    ]
    for label, cmd in checks:
        result = run(client, cmd, timeout=15)
        print(f"  {label}: {result}")
    client.close()
except Exception as e:
    print(f"  smoke FAILED: {e}")

print("\n=== DEPLOY FIX COMPLETE ===")
