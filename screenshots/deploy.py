import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)

cmd = """cd /var/www/asgard-crm && git pull origin mobile-v3 && echo '===PULL-DONE===' && grep -n 'const isPM' public/assets/js/pm_calcs.js && echo '===isPM-OK===' && PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "INSERT INTO role_permissions (role, page, can_read, can_write, can_delete) VALUES ('HR', 'hr_requests', true, true, false) ON CONFLICT DO NOTHING;" && echo '===HR-PERM-OK===' && PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT role, page, can_read FROM role_permissions WHERE role = 'HR' AND page = 'hr_requests';" && echo '===VERIFY-OK===' && systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm && echo '===RESTART-OK==='"""

_, stdout, stderr = client.exec_command(cmd, timeout=60)
print(stdout.read().decode('utf-8', errors='replace'))
err = stderr.read().decode('utf-8', errors='replace')
for line in err.split('\n'):
    if line.strip() and 'NOTICE' not in line and 'already exists' not in line.lower():
        print(f"ERR: {line}")

client.close()
print("\nDeploy complete.")
