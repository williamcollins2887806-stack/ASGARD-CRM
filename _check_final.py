import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

_, out, _ = ssh.exec_command('ps aux | grep "runner.js" | grep -v grep | wc -l', timeout=10)
cnt = out.read().decode('utf-8', errors='replace').strip()

if cnt != '0':
    print('Tests still running...')
    _, out, _ = ssh.exec_command('wc -l /tmp/test_results3.txt', timeout=10)
    print(f'Lines: {out.read().decode("utf-8", errors="replace").strip()}')
    _, out, _ = ssh.exec_command('tail -5 /tmp/test_results3.txt', timeout=10)
    print(out.read().decode('utf-8', errors='replace').strip())
else:
    # Summary
    _, out, _ = ssh.exec_command('grep "ИТОГО" /tmp/test_results3.txt', timeout=10)
    summary = out.read().decode('utf-8', errors='replace').strip()
    print(f'SUMMARY: {summary}')
    # Failures
    _, out, _ = ssh.exec_command('grep "❌" /tmp/test_results3.txt | grep -v "ИТОГО\\|0 pass\\|0 fail" | head -30', timeout=15)
    fails = out.read().decode('utf-8', errors='replace').strip()
    if fails:
        print(f'\nFAILURES:\n{fails}')
    else:
        print('\nNO FAILURES!')

ssh.close()
