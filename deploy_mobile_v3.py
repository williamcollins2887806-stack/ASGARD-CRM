import paramiko
import time

def run_cmd(host, key_path, cmd, timeout=60):
    key = paramiko.Ed25519Key.from_private_key_file(key_path)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username='root', pkey=key, timeout=15)
    print(f"\n=== {cmd[:80]} ===")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out: print(out.strip())
    if err: print("STDERR:", err.strip())
    client.close()
    return out, err

KEY = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
HOST = '92.242.61.184'

# Step 1: Check git log (pull already done)
run_cmd(HOST, KEY, 'cd /var/www/asgard-crm && git log --oneline -5')

# Step 2: Restart service
run_cmd(HOST, KEY, 'systemctl restart asgard-crm && echo "RESTART OK"')

# Step 3: Wait and check status
time.sleep(3)
run_cmd(HOST, KEY, 'systemctl status asgard-crm --no-pager -l | head -25')

print("\n=== Deployment complete ===")
