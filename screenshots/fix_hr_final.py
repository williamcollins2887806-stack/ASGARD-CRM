import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)

# Insert HR permission + check how permissions are loaded during login
cmd = r"""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_at) VALUES (4406, 'hr_requests', true, true, false, NOW());" && echo '===INSERT-OK===' && PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT user_id, module_key, can_read FROM user_permissions WHERE user_id = 4406;" && echo '===VERIFY===' && grep -n 'permissions' /var/www/asgard-crm/src/routes/auth.js | head -10 && echo '===DONE===' && systemctl is-active asgard-crm"""

_, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))
err = stderr.read().decode('utf-8', errors='replace')
if err.strip():
    for line in err.split('\n'):
        if line.strip():
            print(f"ERR: {line}")
client.close()
