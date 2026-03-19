import paramiko
import sys

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)

commands = [
    'cd /var/www/asgard-crm && git fetch origin mobile-v3',
    'cd /var/www/asgard-crm && git checkout mobile-v3',
    'cd /var/www/asgard-crm && git reset --hard origin/mobile-v3',
    'cd /var/www/asgard-crm && git log --oneline -3',
    'systemctl restart asgard-crm',
    'sleep 2 && systemctl is-active asgard-crm',
]

for cmd in commands:
    print(f'>>> {cmd}')
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(out)
    if err:
        print(f'STDERR: {err}')
    print()

client.close()
print('Deploy complete.')
