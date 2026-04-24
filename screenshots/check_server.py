import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)

cmd = """grep -n 'isPM' /var/www/asgard-crm/public/assets/js/pm_calcs.js | head -5 && echo '---LINE-COUNT---' && wc -l /var/www/asgard-crm/public/assets/js/pm_calcs.js && echo '---GIT---' && cd /var/www/asgard-crm && git log --oneline -3 && git branch --show-current && echo '---HR-PERMS---' && PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT page, can_read FROM role_permissions WHERE role = 'HR' AND page ILIKE '%hr%' LIMIT 10;" """

_, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))
client.close()
