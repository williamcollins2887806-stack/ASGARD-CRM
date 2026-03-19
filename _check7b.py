import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Get all lines with the failure marker, excluding summary and the false positive
_, out, _ = ssh.exec_command(r"grep -n '❌' /tmp/test_results7.txt | grep -v 'ИТОГО\|0 pass'", timeout=15)
fails = out.read().decode('utf-8', errors='replace').strip()
if fails:
    print(f'Failures:\n{fails}')
else:
    print('NO REAL FAILURES!')

# Also get the skips count
_, out, _ = ssh.exec_command(r"grep -c '⏭️' /tmp/test_results7.txt", timeout=10)
print(f'\nSkip count: {out.read().decode("utf-8", errors="replace").strip()}')

ssh.close()
