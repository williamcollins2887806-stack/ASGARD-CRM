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
    _, out, _ = ssh.exec_command('tail -15 /tmp/test_results2.txt', timeout=10)
    print(out.read().decode('utf-8', errors='replace').strip())
else:
    print('=== Tests finished ===\n')
    # Show summary
    _, out, _ = ssh.exec_command('grep "ИТОГО" /tmp/test_results2.txt', timeout=10)
    print(out.read().decode('utf-8', errors='replace').strip())
    print()
    # Show all failures
    _, out, _ = ssh.exec_command('grep "❌" /tmp/test_results2.txt | grep -v "ИТОГО\\|0 pass\\|0 fail"', timeout=10)
    fails = out.read().decode('utf-8', errors='replace').strip()
    if fails:
        print('FAILURES:')
        print(fails)
    else:
        print('NO FAILURES!')

ssh.close()
