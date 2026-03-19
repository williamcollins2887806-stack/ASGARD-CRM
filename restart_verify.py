import paramiko
import sys
import time

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

print("Connecting...")
try:
    client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)
    print("Connected OK")
except Exception as e:
    print(f"FAILED: {e}")
    sys.exit(1)

def run(cmd, timeout=20):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        return stdout.read().decode().strip() or stderr.read().decode().strip()
    except Exception as e:
        return f"ERROR: {e}"

# Just restart and verify in one command
result = run("cd /var/www/asgard-crm && systemctl restart asgard-crm && sleep 5 && echo STATUS=$(systemctl is-active asgard-crm) && echo HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/) && echo COMMIT=$(git log --oneline -1)", timeout=30)
print(result)

client.close()
