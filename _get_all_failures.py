import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Get all failure lines with context
_, out, _ = ssh.exec_command('grep -n "❌" /tmp/test_results.txt | grep -v "ИТОГО\\|0 pass\\|0 fail"', timeout=10)
lines = out.read().decode('utf-8', errors='replace').strip()
print(lines)
print(f'\nTotal lines: {len(lines.splitlines())}')

ssh.close()
