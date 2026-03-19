import paramiko
import os
import sys
import time

KEY = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
LOCAL = 'C:/Users/Nikita-ASGARD/ASGARD-CRM'
REMOTE = '/var/www/asgard-crm'
SERVER = '92.242.61.184'

FILES = [
    'public/assets/js/mobile_v3/core.js',
    'public/assets/js/mobile_v3/components.js',
    'public/assets/js/mobile_v3/pages/messenger.js',
    'public/assets/js/mobile_v3/pages/cash.js',
    'public/assets/js/mobile_v3/pages/gantt.js',
    'public/assets/js/mobile_v3/pages/meetings.js',
    'public/assets/js/mobile_v3/pages/mimir.js',
    'public/assets/js/mobile_v3/pages/more_menu.js',
    'public/assets/css/mobile-shell.css',
    'public/sw.js',
]

# ========== STEP 1: SFTP UPLOAD ==========
print("=== STEP 1: SFTP UPLOAD ===")
try:
    key = paramiko.Ed25519Key.from_private_key_file(KEY)
    t = paramiko.Transport((SERVER, 22))
    t.banner_timeout = 60
    t.connect(username='root', pkey=key)
    sftp = paramiko.SFTPClient.from_transport(t)

    ok = 0
    fail = 0
    for f in FILES:
        local = os.path.join(LOCAL, f.replace('/', os.sep))
        remote = REMOTE + '/' + f
        try:
            sftp.put(local, remote)
            print(f'  OK: {f}')
            ok += 1
        except Exception as e:
            print(f'  FAIL: {f} - {e}')
            fail += 1

    sftp.close()
    t.close()
    print(f"  Upload: {ok} OK, {fail} FAIL")
except Exception as e:
    print(f"  SFTP CONNECT FAILED: {e}")
    print("  Trying git pull instead...")

# ========== STEP 2: RESTART + VERIFY ==========
print("\n=== STEP 2: RESTART + VERIFY ===")
time.sleep(2)

try:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(SERVER, username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)

    def run(cmd, timeout=30):
        try:
            stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
            out = stdout.read().decode().strip()
            err = stderr.read().decode().strip()
            return out or err
        except Exception as e:
            return f"ERROR: {e}"

    # Git operations on server
    print("  git add+commit:", run("cd /var/www/asgard-crm && git add -A && git commit -m 'server: sync fix-session deploy' 2>/dev/null || echo 'nothing to commit'"))

    # Restart
    print("  restart:", run("systemctl restart asgard-crm"))
    time.sleep(5)

    # Verify
    print("  status:", run("systemctl is-active asgard-crm"))
    print("  http:", run("curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost:3000/"))
    print("  commit:", run("cd /var/www/asgard-crm && git log --oneline -1"))

    client.close()
except Exception as e:
    print(f"  SSH FAILED: {e}")

# ========== STEP 3: MERGE mobile-v3 -> main ==========
print("\n=== STEP 3: MERGE mobile-v3 -> main ===")
time.sleep(2)

try:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(SERVER, username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)

    merge_cmds = [
        ("fetch", "cd /var/www/asgard-crm && git fetch origin"),
        ("checkout main", "cd /var/www/asgard-crm && git checkout main"),
        ("merge", "cd /var/www/asgard-crm && git merge origin/mobile-v3 -X theirs -m 'release: mobile v3 fix-session — Router lifecycle, Cash, Gantt, Safari'"),
        ("push main", "cd /var/www/asgard-crm && git push origin main"),
        ("back to mobile-v3", "cd /var/www/asgard-crm && git checkout mobile-v3"),
        ("restart", "systemctl restart asgard-crm"),
    ]

    for label, cmd in merge_cmds:
        result = run(cmd, timeout=30)
        print(f"  {label}: {result or 'OK'}")

    time.sleep(5)
    client.close()
except Exception as e:
    print(f"  MERGE SSH FAILED: {e}")

# ========== STEP 4: SMOKE TEST ==========
print("\n=== STEP 4: SMOKE TEST ===")
time.sleep(2)

try:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(SERVER, username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)

    checks = [
        ('Service', 'systemctl is-active asgard-crm'),
        ('HTTP', "curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost:3000/"),
        ('Desktop v3=0', "curl -s -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0)' http://localhost:3000/ | grep -c mobile_v3 || echo 0"),
        ('iPhone v3', "curl -s -H 'User-Agent: Mozilla/5.0 (iPhone)' http://localhost:3000/ | grep -c mobile_v3"),
        ('Errors', "journalctl -u asgard-crm --no-pager --since '2 minutes ago' | grep -ci error || echo 0"),
        ('Branch', 'cd /var/www/asgard-crm && git branch --show-current'),
        ('Commit', 'cd /var/www/asgard-crm && git log --oneline -1'),
    ]

    for label, cmd in checks:
        result = run(cmd, timeout=15)
        print(f"  {label}: {result}")

    client.close()
except Exception as e:
    print(f"  SMOKE SSH FAILED: {e}")

print("\n=== DEPLOY COMPLETE ===")
