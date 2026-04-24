import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)

# Check isPM definition on server
cmd = """sed -n '430,445p' /var/www/asgard-crm/public/assets/js/pm_calcs.js && echo '===RENDER===' && grep -n 'function openTender' /var/www/asgard-crm/public/assets/js/pm_calcs.js && echo '===SHOWTENDER===' && grep -n 'showModal' /var/www/asgard-crm/public/assets/js/pm_calcs.js"""

_, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

# Check local git status
cmd2 = """cd /var/www/asgard-crm && git status --short public/assets/js/pm_calcs.js && echo '===DIFF===' && git diff HEAD public/assets/js/pm_calcs.js | head -50"""
_, stdout2, stderr2 = client.exec_command(cmd2, timeout=30)
print("\n--- Git diff ---")
print(stdout2.read().decode('utf-8', errors='replace'))

# Check what scripts load on pm-calcs page
cmd3 = """grep -c 'isPM' /var/www/asgard-crm/public/assets/js/*.js | grep -v ':0$' """
_, stdout3, stderr3 = client.exec_command(cmd3, timeout=15)
print("\n--- Files with isPM ---")
print(stdout3.read().decode('utf-8', errors='replace'))

# Check HR role_permissions more broadly
cmd4 = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c "SELECT DISTINCT page FROM role_permissions WHERE role = 'HR';" """
_, stdout4, stderr4 = client.exec_command(cmd4, timeout=15)
print("\n--- All HR permissions ---")
print(stdout4.read().decode('utf-8', errors='replace'))

client.close()
