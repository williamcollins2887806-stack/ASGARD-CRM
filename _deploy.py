import paramiko
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)
for cmd in ['cd /var/www/asgard-crm && git pull origin mobile-v3 && git log --oneline -1', 'systemctl restart asgard-crm', 'sleep 2 && systemctl is-active asgard-crm']:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out: print(out)
    if err: print('STDERR:', err)
client.close()
print('Done.')
