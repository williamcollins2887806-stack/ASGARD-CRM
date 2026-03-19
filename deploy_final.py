import paramiko
import sys
import time
import os

os.environ['PYTHONIOENCODING'] = 'utf-8'

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

print("Connecting to server...")
try:
    client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)
    print("Connected OK")
except Exception as e:
    print(f"SSH CONNECT FAILED: {e}")
    sys.exit(1)

def run(label, cmd, timeout=30):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        result = out or err
        print(f"  {label}: {result}")
        return result
    except Exception as e:
        print(f"  {label}: ERROR - {e}")
        return f"ERROR: {e}"

# Step 1: Git pull on server
print("\n--- 1. GIT PULL ---")
run("fetch", "cd /var/www/asgard-crm && git fetch origin", timeout=30)
run("checkout", "cd /var/www/asgard-crm && git checkout mobile-v3", timeout=10)
run("pull", "cd /var/www/asgard-crm && git pull origin mobile-v3", timeout=30)
run("log", "cd /var/www/asgard-crm && git log --oneline -3", timeout=10)

# Step 2: Restart service
print("\n--- 2. RESTART ---")
run("restart", "systemctl restart asgard-crm", timeout=15)
time.sleep(5)

# Step 3: Verify
print("\n--- 3. VERIFY ---")
run("status", "systemctl is-active asgard-crm", timeout=10)
run("http", "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/", timeout=10)
run("errors", "journalctl -u asgard-crm --no-pager --since '30 seconds ago' 2>/dev/null | grep -ci 'error\\|exception\\|crash' || echo 0", timeout=10)

client.close()
print("\nDeploy done.")
