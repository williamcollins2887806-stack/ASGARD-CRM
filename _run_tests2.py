import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Launch tests in background
cmd = 'cd /var/www/asgard-crm && nohup node tests/runner.js --all > /tmp/test_results.txt 2>&1 &'
print(f'>>> Launching tests in background...')
ssh.exec_command(cmd)
time.sleep(2)

# Check it started
_, out, _ = ssh.exec_command('ps aux | grep "runner.js" | grep -v grep', timeout=10)
ps = out.read().decode('utf-8', errors='replace').strip()
if ps:
    print(f'Tests running: {ps[:120]}')
else:
    print('WARNING: Tests may not have started')

ssh.close()
print('\nTests running in background. Check results in ~60s with _check_tests.py')
