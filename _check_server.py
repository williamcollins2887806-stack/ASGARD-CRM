import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

cmds = [
    'systemctl is-active asgard-crm',
    'journalctl -u asgard-crm --no-pager -n 30',
    'curl -s -o /dev/null -w "%{http_code}" https://asgard-crm.ru/api/health',
]

for cmd in cmds:
    print(f'\n>>> {cmd}')
    _, out, err = ssh.exec_command(cmd, timeout=15)
    print(out.read().decode('utf-8', errors='replace').strip())
    e = err.read().decode('utf-8', errors='replace').strip()
    if e: print(f'ERR: {e}')

ssh.close()
