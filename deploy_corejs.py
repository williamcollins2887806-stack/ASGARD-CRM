import paramiko, os, time

KEY = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
LOCAL = 'C:/Users/Nikita-ASGARD/ASGARD-CRM'
REMOTE = '/var/www/asgard-crm'
SERVER = '92.242.61.184'

key = paramiko.Ed25519Key.from_private_key_file(KEY)

# SFTP upload
print("=== SFTP ===")
t = paramiko.Transport((SERVER, 22))
t.banner_timeout = 60
t.connect(username='root', pkey=key)
sftp = paramiko.SFTPClient.from_transport(t)

f = 'public/assets/js/mobile_v3/core.js'
sftp.put(os.path.join(LOCAL, f.replace('/', os.sep)), REMOTE + '/' + f)
print(f"  OK: {f}")
sftp.close()
t.close()

time.sleep(2)

# Restart + verify
print("\n=== RESTART ===")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(SERVER, username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)

def run(cmd, timeout=30):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        return stdout.read().decode().strip() or stderr.read().decode().strip()
    except Exception as e:
        return f"ERROR: {e}"

print("  git sync:", run("cd /var/www/asgard-crm && git checkout -- public/assets/js/mobile_v3/core.js && git pull origin mobile-v3 2>&1", timeout=60))
print("  restart:", run("systemctl restart asgard-crm"))
client.close()

time.sleep(10)

print("\n=== VERIFY ===")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(SERVER, username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)
print("  status:", run("systemctl is-active asgard-crm"))
print("  http:", run("curl -s -m 10 -o /dev/null -w '%{http_code}' http://localhost:3000/"))
print("  commit:", run("cd /var/www/asgard-crm && git log --oneline -1"))
print("  init check:", run("grep -n 'DOMContentLoaded.*App.init' /var/www/asgard-crm/public/assets/js/mobile_v3/core.js"))
client.close()
