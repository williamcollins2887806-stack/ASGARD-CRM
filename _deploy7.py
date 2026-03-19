import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Kill old tests
ssh.exec_command('pkill -f runner.js 2>/dev/null')
time.sleep(1)

# Pull
_, out, _ = ssh.exec_command('cd /var/www/asgard-crm && git pull origin mobile-v3 2>&1', timeout=15)
print('Pull:', out.read().decode('utf-8', errors='replace').strip())

# Restart
_, out, _ = ssh.exec_command('systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm', timeout=15)
print('Service:', out.read().decode('utf-8', errors='replace').strip())

# Wait for full init
print('Waiting 45s for full init...')
time.sleep(45)

# Check health
_, out, _ = ssh.exec_command('curl -s -o /dev/null -w "%{http_code}" https://asgard-crm.ru/api/health', timeout=10)
print('Health:', out.read().decode('utf-8', errors='replace').strip())

# Launch tests
ssh.exec_command('cd /var/www/asgard-crm && nohup node tests/runner.js --all > /tmp/test_results7.txt 2>&1 &')
time.sleep(3)

_, out, _ = ssh.exec_command('ps aux | grep runner.js | grep -v grep | wc -l', timeout=10)
print('Test processes:', out.read().decode('utf-8', errors='replace').strip())

ssh.close()
print('Done. Tests running in /tmp/test_results7.txt')
