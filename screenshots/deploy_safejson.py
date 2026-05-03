import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)

cmd = """cd /var/www/asgard-crm && git pull origin mobile-v3 && echo '===PULL-DONE===' && grep -n 'function safeJson' public/assets/js/works_shared.js public/assets/js/hr_requests.js && echo '===VERIFY===' && systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm && echo '===DONE==='"""

_, stdout, stderr = client.exec_command(cmd, timeout=60)
print(stdout.read().decode('utf-8', errors='replace'))
err = stderr.read().decode('utf-8', errors='replace')
for line in err.split('\n'):
    if line.strip() and 'NOTICE' not in line and 'already exists' not in line.lower():
        print(f"ERR: {line}")
client.close()
print("\nDeploy complete.")
