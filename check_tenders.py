import paramiko
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Check tender statuses
cmd = """cd /var/www/asgard-crm && node -e "
const db = require('./src/db');
db.query('SELECT status, COUNT(*) as cnt FROM tenders GROUP BY status ORDER BY cnt DESC')
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); process.exit(); })
  .catch(e => { console.error(e.message); process.exit(1); });
"
"""
stdin, stdout, stderr = client.exec_command(cmd, timeout=20)
print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())

# Also check what /data/tenders returns
cmd2 = """cd /var/www/asgard-crm && node -e "
const db = require('./src/db');
db.query('SELECT id, status, customer_name FROM tenders ORDER BY id DESC LIMIT 10')
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); process.exit(); })
  .catch(e => { console.error(e.message); process.exit(1); });
"
"""
stdin2, stdout2, stderr2 = client.exec_command(cmd2, timeout=20)
print("SAMPLE TENDERS:", stdout2.read().decode())
print("STDERR2:", stderr2.read().decode())

# Check tasks table structure
cmd3 = """cd /var/www/asgard-crm && PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "\d tasks" """
stdin3, stdout3, stderr3 = client.exec_command(cmd3, timeout=20)
print("TASKS TABLE:", stdout3.read().decode())
print("STDERR3:", stderr3.read().decode())

# Check chat-groups endpoint
cmd4 = """curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/chat-groups"""
stdin4, stdout4, stderr4 = client.exec_command(cmd4, timeout=10)
print("CHAT-GROUPS STATUS:", stdout4.read().decode())

client.close()
