import paramiko

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=30)

cmds = [
    'systemctl is-active asgard-crm',
    'cd /var/www/asgard-crm && git log --oneline -1',
    'cd /var/www/asgard-crm && git branch --show-current',
    'curl -s -o /dev/null -w "%{http_code}" https://asgard-crm.ru/',
]

for cmd in cmds:
    print(f'>>> {cmd}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out)
    if err and 'warning' not in err.lower(): print(f'STDERR: {err}')
    print()

ssh.close()
print('=== VERIFY DONE ===')
