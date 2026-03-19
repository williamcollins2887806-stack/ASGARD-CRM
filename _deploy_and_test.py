import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Deploy
for cmd in [
    'cd /var/www/asgard-crm && git fetch origin && git reset --hard origin/mobile-v3',
    'cd /var/www/asgard-crm && git log --oneline -2',
    'systemctl restart asgard-crm',
    'sleep 2 && systemctl is-active asgard-crm',
]:
    print(f'>>> {cmd}')
    _, out, err = ssh.exec_command(cmd, timeout=30)
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    if o: print(o)
    if e and 'From https' not in e: print(f'ERR: {e}')

# Launch tests in background
print('\n>>> Launching tests in background...')
ssh.exec_command('cd /var/www/asgard-crm && nohup node tests/runner.js --all > /tmp/test_results2.txt 2>&1 &')
time.sleep(2)
_, out, _ = ssh.exec_command('ps aux | grep "runner.js" | grep -v grep | wc -l', timeout=10)
cnt = out.read().decode('utf-8', errors='replace').strip()
print(f'Test processes: {cnt}')

ssh.close()
print('Deploy done. Tests running. Check with _check_tests2.py')
