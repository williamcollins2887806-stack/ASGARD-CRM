import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Pull latest
_, out, err = ssh.exec_command("cd /var/www/asgard-crm && git pull origin mobile-v3 2>&1", timeout=30)
print('Pull:', out.read().decode('utf-8', errors='replace').strip())

# Restart service
_, out, _ = ssh.exec_command("systemctl restart asgard-crm && echo 'Restarted OK'", timeout=15)
print(out.read().decode('utf-8', errors='replace').strip())

# Wait for service to be ready
print('Waiting 45s for service init...')
time.sleep(45)

# Health check
_, out, _ = ssh.exec_command("curl -s -o /dev/null -w '%{http_code}' https://crm.asgard-industrial.ru/api/health", timeout=10)
print('Health:', out.read().decode('utf-8', errors='replace').strip())

# Run tests in background
_, out, _ = ssh.exec_command("cd /var/www/asgard-crm && nohup node tests/runner.js --all > /tmp/test_results8.txt 2>&1 &", timeout=10)
print('Tests launched (results → /tmp/test_results8.txt)')

ssh.close()
