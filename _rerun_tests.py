import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Kill any running tests first
ssh.exec_command('pkill -f "runner.js" 2>/dev/null; sleep 1')
time.sleep(2)

# Restart server fresh
_, out, _ = ssh.exec_command('systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm', timeout=15)
print(f'Service: {out.read().decode("utf-8", errors="replace").strip()}')

# Health check
_, out, _ = ssh.exec_command('curl -s -o /dev/null -w "%{http_code}" https://asgard-crm.ru/api/health', timeout=10)
print(f'Health: {out.read().decode("utf-8", errors="replace").strip()}')

# Launch tests
ssh.exec_command('cd /var/www/asgard-crm && nohup node tests/runner.js --all > /tmp/test_results3.txt 2>&1 &')
time.sleep(1)
print('Tests launched. Check with _check_final.py')

ssh.close()
