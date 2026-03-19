import paramiko
import sys

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)
    print("SSH Connected OK")
except Exception as e:
    print(f"SSH CONNECT FAILED: {e}")
    sys.exit(1)

commands = [
    ("СЕРВИС", "systemctl is-active asgard-crm"),
    ("HTTP", "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/"),
    ("UA Desktop", "curl -s -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0)' http://localhost:3000/ | grep -c mobile_v3"),
    ("UA iPhone", "curl -s -H 'User-Agent: Mozilla/5.0 (iPhone)' http://localhost:3000/ | grep -c mobile_v3"),
    ("ОШИБКИ 5мин", "journalctl -u asgard-crm --no-pager --since '5 minutes ago' 2>/dev/null | grep -ci 'error\\|exception\\|crash' || echo 0"),
    ("STORIES", "cd /var/www/asgard-crm && node -e \"const db=require('./src/db');db.query('SELECT count(*) FROM user_stories').then(r=>{console.log('OK: '+r.rows[0].count+' stories');process.exit();}).catch(e=>{console.log('MISSING: '+e.message);process.exit(1);})\""),
    ("AVATAR", "cd /var/www/asgard-crm && node -e \"const db=require('./src/db');db.query(\\\"SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='avatar_url'\\\").then(r=>{console.log(r.rows.length?'OK':'MISSING');process.exit();}).catch(e=>{console.log('ERROR');process.exit(1);})\""),
    ("MEDIA", "cd /var/www/asgard-crm && node -e \"const db=require('./src/db');db.query(\\\"SELECT column_name FROM information_schema.columns WHERE table_name='chat_messages' AND column_name IN ('message_type','file_url','file_duration')\\\").then(r=>{console.log(r.rows.length+'/3 media columns');process.exit();}).catch(e=>{console.log('ERROR');process.exit(1);})\""),
]

for label, cmd in commands:
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=20)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        print(f"{label}: {out or err}")
    except Exception as e:
        print(f"{label}: ERROR - {e}")

client.close()
