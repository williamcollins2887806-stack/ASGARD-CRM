import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

commands = [
    'cd /var/www/asgard-crm && git fetch origin',
    'cd /var/www/asgard-crm && git reset --hard origin/mobile-v3',
    'cd /var/www/asgard-crm && git log --oneline -3',
    'cd /var/www/asgard-crm && npm install --production 2>&1 | tail -5',
    'systemctl restart asgard-crm',
    'sleep 2 && systemctl is-active asgard-crm',
    'curl -s -o /dev/null -w "%{http_code}" https://asgard-crm.ru/',
]

for cmd in commands:
    print(f'\n>>> {cmd}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out: print(out)
    if err: print(f'STDERR: {err}')

ssh.close()
print('\n=== DEPLOY COMPLETE ===')
