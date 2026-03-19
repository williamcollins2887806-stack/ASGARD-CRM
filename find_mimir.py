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

print("=== ALL mimir files on server ===")
print(run("find /var/www/asgard-crm/public -name '*mimir*' -not -path '*_deprecated*' -not -path '*node_modules*'"))
print("\n=== mimir in index.html ===")
print(run("grep -n 'mimir' /var/www/asgard-crm/public/index.html"))
print("\n=== Recent git log with 'mimir' ===")
print(run("cd /var/www/asgard-crm && git log --oneline --all --since='7 days ago' | grep -i mimir"))
client.close()
