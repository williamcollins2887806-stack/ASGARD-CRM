import paramiko, sys

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)
except Exception as e:
    print(f"FAILED: {e}")
    sys.exit(1)

def run(cmd, timeout=20):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        return stdout.read().decode().strip() or stderr.read().decode().strip()
    except Exception as e:
        return f"ERROR: {e}"

# Check if the port is listening and try curl verbose
r = run("echo STATUS=$(systemctl is-active asgard-crm) && echo PORT=$(ss -tlnp | grep 3000 | head -1) && curl -s -m 5 -o /dev/null -w 'HTTP=%{http_code}' http://localhost:3000/ && echo '' && echo COMMIT=$(cd /var/www/asgard-crm && git log --oneline -1)")
print(r)
client.close()
