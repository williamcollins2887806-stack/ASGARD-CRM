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
    return client, key

def run(client, cmd, timeout=30):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        return out or err
    except Exception as e:
        return f"ERROR: {e}"

# ========== STEP 1: Fix push main ==========
print("=== STEP 1: Fix push main ===")
try:
    client, key = get_client()
    cmds = [
        ("current branch", "cd /var/www/asgard-crm && git branch --show-current"),
        ("pull main", "cd /var/www/asgard-crm && git checkout main && git pull origin main --rebase 2>&1"),
        ("push main", "cd /var/www/asgard-crm && git push origin main 2>&1"),
    ]
    for label, cmd in cmds:
        result = run(client, cmd, timeout=60)
        print(f"  {label}: {result or 'OK'}")
    client.close()
except Exception as e:
    print(f"  FAILED: {e}")

time.sleep(3)

# ========== STEP 2: Switch back to mobile-v3 + restart ==========
print("\n=== STEP 2: Switch to mobile-v3 + restart ===")
try:
    client, key = get_client()
    cmds = [
        ("checkout mobile-v3", "cd /var/www/asgard-crm && git checkout mobile-v3"),
        ("restart", "systemctl restart asgard-crm"),
    ]
    for label, cmd in cmds:
        result = run(client, cmd, timeout=30)
        print(f"  {label}: {result or 'OK'}")
    client.close()
except Exception as e:
    print(f"  FAILED: {e}")

time.sleep(7)

# ========== STEP 3: Final smoke test ==========
print("\n=== STEP 3: Final smoke test ===")
try:
    client, key = get_client()
    checks = [
        ('Service', 'systemctl is-active asgard-crm'),
        ('HTTP', "curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost:3000/"),
        ('Branch', 'cd /var/www/asgard-crm && git branch --show-current'),
        ('Commit', 'cd /var/www/asgard-crm && git log --oneline -1'),
        ('Desktop v3=0', "curl -s -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0)' http://localhost:3000/ | grep -c mobile_v3 || echo 0"),
        ('iPhone v3', "curl -s -H 'User-Agent: Mozilla/5.0 (iPhone)' http://localhost:3000/ | grep -c mobile_v3"),
        ('Errors', "journalctl -u asgard-crm --no-pager --since '2 minutes ago' | grep -ci error || echo 0"),
    ]
    for label, cmd in checks:
        result = run(client, cmd, timeout=15)
        print(f"  {label}: {result}")
    client.close()
except Exception as e:
    print(f"  FAILED: {e}")

print("\n=== FIX COMPLETE ===")
