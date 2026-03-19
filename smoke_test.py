import paramiko

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

print("Desktop v3=0:", run("curl -s -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0)' http://localhost:3000/ | grep -c mobile_v3 || echo 0"))
print("iPhone v3:", run("curl -s -H 'User-Agent: Mozilla/5.0 (iPhone)' http://localhost:3000/ | grep -c mobile_v3"))
print("Errors:", run("journalctl -u asgard-crm --no-pager --since '5 minutes ago' | grep -ci error || echo 0"))

client.close()
