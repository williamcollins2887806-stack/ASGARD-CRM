import paramiko, time

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)

def run(cmd, timeout=20):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        return stdout.read().decode().strip() or stderr.read().decode().strip()
    except Exception as e:
        return f"ERROR: {e}"

print("Service:", run("systemctl is-active asgard-crm"))
print("HTTP:", run("curl -s -m 10 -o /dev/null -w '%{http_code}' http://localhost:3000/"))
print("Branch:", run("cd /var/www/asgard-crm && git branch --show-current"))
print("Commit:", run("cd /var/www/asgard-crm && git log --oneline -1"))
print("Port:", run("ss -tlnp | grep 3000"))
print("Node PID:", run("pgrep -f 'node.*index.js' || echo 'not found'"))
print("Journal:", run("journalctl -u asgard-crm --no-pager -n 5"))
client.close()
