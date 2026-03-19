import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Check if still running
_, out, _ = ssh.exec_command('ps aux | grep "runner.js" | grep -v grep', timeout=10)
ps = out.read().decode('utf-8', errors='replace').strip()
if ps:
    print('Tests still running...')
    # Show last 20 lines of current output
    _, out, _ = ssh.exec_command('tail -20 /tmp/test_results.txt', timeout=10)
    print(out.read().decode('utf-8', errors='replace').strip())
else:
    print('Tests finished! Results:')
    _, out, _ = ssh.exec_command('tail -80 /tmp/test_results.txt', timeout=10)
    print(out.read().decode('utf-8', errors='replace').strip())

ssh.close()
