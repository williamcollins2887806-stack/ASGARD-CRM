import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Search for FAIL markers or error patterns
_, out, _ = ssh.exec_command("grep -n 'FAIL\\|AssertionError\\|assertion failed\\| fail ' /tmp/test_results7.txt | head -20", timeout=15)
r1 = out.read().decode('utf-8', errors='replace').strip()
if r1:
    print('FAIL patterns:')
    print(r1)

# Search for red color (ANSI codes) around failures
_, out, _ = ssh.exec_command("grep -n 'expected.*got\\|SECURITY HOLE' /tmp/test_results7.txt | head -20", timeout=15)
r2 = out.read().decode('utf-8', errors='replace').strip()
if r2:
    print('\nExpected/got patterns:')
    print(r2)

# Get summary section (last 30 lines)
_, out, _ = ssh.exec_command("tail -30 /tmp/test_results7.txt", timeout=10)
print('\nLast 30 lines:')
print(out.read().decode('utf-8', errors='replace').strip())

ssh.close()
