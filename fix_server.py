import paramiko, time

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)

def run(cmd, timeout=60):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        return stdout.read().decode().strip() or stderr.read().decode().strip()
    except Exception as e:
        return f"ERROR: {e}"

# Restore all files from git (undo any SFTP corruption)
print("=== RESTORE FROM GIT ===")
print(run("cd /var/www/asgard-crm && git checkout -- . && git status --short"))
print("restart:", run("systemctl restart asgard-crm"))
client.close()

time.sleep(12)

print("\n=== VERIFY ===")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)
print("status:", run("systemctl is-active asgard-crm"))
print("http:", run("curl -s -m 15 -o /dev/null -w '%{http_code}' http://localhost:3000/"))
print("commit:", run("cd /var/www/asgard-crm && git log --oneline -1"))
# Check for truncated files
print("components.js size:", run("wc -c < /var/www/asgard-crm/public/assets/js/mobile_v3/components.js"))
print("core.js size:", run("wc -c < /var/www/asgard-crm/public/assets/js/mobile_v3/core.js"))
print("auth.js size:", run("wc -c < /var/www/asgard-crm/public/assets/js/mobile_v3/auth.js"))
print("ds.js size:", run("wc -c < /var/www/asgard-crm/public/assets/js/mobile_v3/ds.js"))
client.close()
