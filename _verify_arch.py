import paramiko
import time

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=30)

commands = [
    'sleep 5 && curl -s -o /dev/null -w "%{http_code}" https://crm.asgard-group.ru/',
    'cd /var/www/asgard-crm && git log --oneline -1',
    'systemctl is-active asgard-crm',
]

for cmd in commands:
    print(f'>>> {cmd}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out)
    if err: print(f'STDERR: {err}')
    print()

ssh.close()
