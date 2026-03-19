import paramiko
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)
def run(cmd, timeout=30):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        return stdout.read().decode().strip() or stderr.read().decode().strip()
    except Exception as e:
        return f"ERROR: {e}"
print("http:", run("curl -s -m 15 -o /dev/null -w '%{http_code}' http://localhost:3000/"))
print("sizes:", run("wc -c /var/www/asgard-crm/public/assets/js/mobile_v3/core.js /var/www/asgard-crm/public/assets/js/mobile_v3/auth.js /var/www/asgard-crm/public/assets/js/mobile_v3/ds.js /var/www/asgard-crm/public/assets/js/mobile_v3/components.js"))
client.close()
