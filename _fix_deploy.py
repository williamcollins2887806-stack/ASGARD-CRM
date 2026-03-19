import paramiko, sys, io, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stdout.reconfigure(line_buffering=True)

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')

# Poll until tests finish
for attempt in range(30):
    time.sleep(10)
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)
        _, o, _ = ssh.exec_command("pgrep -f 'runner.js' 2>&1 | head -1", timeout=10)
        pid = o.read().decode().strip()
        _, o, _ = ssh.exec_command("wc -l /tmp/test_results9.txt 2>&1", timeout=10)
        wc = o.read().decode().strip()
        ssh.close()
        
        if pid:
            sys.stdout.write(f'[{attempt+1}/30] Still running (PID {pid}), lines: {wc}\n')
            sys.stdout.flush()
        else:
            sys.stdout.write(f'[{attempt+1}/30] Tests FINISHED. Lines: {wc}\n')
            sys.stdout.flush()
            break
    except Exception as e:
        sys.stdout.write(f'[{attempt+1}/30] Connection error: {e}\n')
        sys.stdout.flush()
else:
    sys.stdout.write('Timed out waiting for tests (5 min). Will check results anyway.\n')
    sys.stdout.flush()

# Get results
time.sleep(2)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

_, o, _ = ssh.exec_command("tail -30 /tmp/test_results9.txt | cat -v", timeout=15)
tail = o.read().decode('utf-8', errors='replace').strip()
sys.stdout.write('\n=== Last 30 lines of test_results9.txt ===\n')
sys.stdout.write(tail + '\n')
sys.stdout.flush()

ssh.close()
sys.stdout.write('\nDone.\n')
sys.stdout.flush()
