import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Get git log
_, out, _ = ssh.exec_command('cd /var/www/asgard-crm && git log --oneline -5', timeout=10)
print('GIT LOG:')
print(out.read().decode('utf-8', errors='replace').strip())
print()

# Get first 50 failures
_, out, _ = ssh.exec_command('grep -n "❌" /tmp/test_results2.txt | grep -v "ИТОГО\\|0 pass\\|0 fail" | head -50', timeout=10)
print('FIRST 50 FAILURES:')
print(out.read().decode('utf-8', errors='replace').strip())

ssh.close()
