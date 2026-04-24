import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)

# Check user_permissions structure and HR auth hasPermission logic
cmd = r"""PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user_permissions' ORDER BY ordinal_position;" && echo '===STRUCT===' && PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT * FROM user_permissions LIMIT 5;" && echo '===SAMPLE===' && sed -n '315,340p' /var/www/asgard-crm/public/assets/js/auth.js && echo '===HASPERMS==='"""

_, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))
client.close()
