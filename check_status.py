import paramiko

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)

stdin, stdout, stderr = client.exec_command('systemctl is-active asgard-crm && git -C /var/www/asgard-crm log --oneline -1', timeout=10)
print(stdout.read().decode().strip())
err = stderr.read().decode().strip()
if err:
    print('ERR:', err)

client.close()
