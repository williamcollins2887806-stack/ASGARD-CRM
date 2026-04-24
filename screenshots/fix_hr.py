import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)

# Find permission tables and how hasPermission works
cmd = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%perm%' OR table_name ILIKE '%role%' OR table_name ILIKE '%access%' ORDER BY table_name;" && echo '===TABLES===' && grep -rn 'hasPermission' /var/www/asgard-crm/public/assets/js/app.js | head -5 && echo '===AUTH===' && grep -n 'hasPermission' /var/www/asgard-crm/public/assets/js/auth.js 2>/dev/null | head -10 && echo '===DONE==='"""

_, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))
client.close()
