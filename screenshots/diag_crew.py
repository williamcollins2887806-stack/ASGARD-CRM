import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)

# Check server logs for crew save errors and the endpoint code
cmd = r"""echo '===LOGS===' && journalctl -u asgard-crm --since '30 min ago' --no-pager | grep -i 'crew\|field\|assignment\|error' | tail -30 && echo '===ENDPOINT===' && grep -n 'crew\|field_assignments\|/projects' /var/www/asgard-crm/src/routes/field*.js 2>/dev/null | head -30 && echo '===ROUTES===' && grep -rn 'crew' /var/www/asgard-crm/src/routes/*.js | grep -i 'post\|put\|router' | head -20 && echo '===DONE==='"""

_, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))
client.close()
