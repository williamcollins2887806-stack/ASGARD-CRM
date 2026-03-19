import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

_, out, _ = ssh.exec_command('ps aux | grep runner.js | grep -v grep | wc -l', timeout=10)
running = out.read().decode('utf-8', errors='replace').strip()
print(f'Running: {running}')

_, out, _ = ssh.exec_command('grep ИТОГО /tmp/test_results7.txt 2>/dev/null || echo NONE', timeout=10)
summary = out.read().decode('utf-8', errors='replace').strip()
print(f'Summary: {summary}')

if 'NONE' not in summary:
    _, out, _ = ssh.exec_command("grep -n '❌' /tmp/test_results7.txt | grep -v ИТОГО | head -20", timeout=15)
    fails = out.read().decode('utf-8', errors='replace').strip()
    if fails:
        print(f'Failures:\n{fails}')
    else:
        print('NO FAILURES!')

ssh.close()
