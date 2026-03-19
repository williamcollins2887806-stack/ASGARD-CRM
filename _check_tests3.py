import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Check process
_, out, _ = ssh.exec_command('ps aux | grep "runner.js" | grep -v grep', timeout=10)
ps = out.read().decode('utf-8', errors='replace').strip()
print(f'Process: {ps or "NOT RUNNING"}')

# Check file size and last line
_, out, _ = ssh.exec_command('wc -l /tmp/test_results2.txt && echo "---" && tail -3 /tmp/test_results2.txt', timeout=10)
print(out.read().decode('utf-8', errors='replace').strip())

# Check if ИТОГО exists
_, out, _ = ssh.exec_command('grep "ИТОГО" /tmp/test_results2.txt', timeout=10)
itogo = out.read().decode('utf-8', errors='replace').strip()
if itogo:
    print(f'\nSUMMARY: {itogo}')
    # Get failures
    _, out, _ = ssh.exec_command('grep "❌" /tmp/test_results2.txt | grep -v "ИТОГО\\|0 pass\\|0 fail"', timeout=10)
    fails = out.read().decode('utf-8', errors='replace').strip()
    if fails:
        print(f'\nFAILURES:\n{fails}')
    else:
        print('\nNO FAILURES!')
else:
    print('\nTests not finished yet (no ИТОГО)')

ssh.close()
