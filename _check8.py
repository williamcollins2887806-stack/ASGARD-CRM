import paramiko, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Check if tests are still running
_, out, _ = ssh.exec_command("pgrep -f 'runner.js' && echo 'STILL RUNNING' || echo 'FINISHED'", timeout=10)
status = out.read().decode('utf-8', errors='replace').strip()
print('Status:', status)

if 'STILL RUNNING' in status:
    print('Tests still running, waiting 120s...')
    ssh.close()
    time.sleep(120)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)
    
    # Check again
    _, out, _ = ssh.exec_command("pgrep -f 'runner.js' && echo 'STILL RUNNING' || echo 'FINISHED'", timeout=10)
    status = out.read().decode('utf-8', errors='replace').strip()
    print('Status after wait:', status)
    
    if 'STILL RUNNING' in status:
        print('Still running, waiting another 120s...')
        ssh.close()
        time.sleep(120)
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)
        
        _, out, _ = ssh.exec_command("pgrep -f 'runner.js' && echo 'STILL RUNNING' || echo 'FINISHED'", timeout=10)
        status = out.read().decode('utf-8', errors='replace').strip()
        print('Status after 2nd wait:', status)
        
        if 'STILL RUNNING' in status:
            print('Still running, waiting another 120s...')
            ssh.close()
            time.sleep(120)
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

            _, out, _ = ssh.exec_command("pgrep -f 'runner.js' && echo 'STILL RUNNING' || echo 'FINISHED'", timeout=10)
            status = out.read().decode('utf-8', errors='replace').strip()
            print('Status after 3rd wait:', status)
            
            if 'STILL RUNNING' in status:
                print('Still running, waiting another 120s...')
                ssh.close()
                time.sleep(120)
                ssh = paramiko.SSHClient()
                ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Get ИТОГО line
cmd1 = r"""python3 << 'PYEOF2'
import re
content = open('/tmp/test_results8.txt', 'r', encoding='utf-8', errors='replace').read()
clean = re.sub(r'\x1b\[[0-9;]*m', '', content)
lines = clean.split('\n')
for line in lines:
    s = line.strip()
    if 'ИТОГО' in s or 'TOTAL' in s:
        print(s)
PYEOF2"""
_, out, _ = ssh.exec_command(cmd1, timeout=15)
print('\n=== ИТОГО ===')
print(out.read().decode('utf-8', errors='replace').strip())

# Get any failure lines
cmd2 = r"""python3 << 'PYEOF3'
import re
content = open('/tmp/test_results8.txt', 'r', encoding='utf-8', errors='replace').read()
clean = re.sub(r'\x1b\[[0-9;]*m', '', content)
lines = clean.split('\n')
for i, line in enumerate(lines):
    s = line.strip()
    # Lines with fail count > 0
    m = re.search(r'(\d+)\s+fail', s, re.IGNORECASE)
    if m and int(m.group(1)) > 0:
        start = max(0, i-3)
        end = min(len(lines), i+2)
        for j in range(start, end):
            marker = '>>>' if j == i else '   '
            print(f'{marker} {j+1}: {lines[j].strip()[:250]}')
        print('---')
    # Also Failed to load lines
    if 'Failed to load' in s or 'Cannot find module' in s:
        print(f'!!! {i+1}: {s[:250]}')
PYEOF3"""
_, out, _ = ssh.exec_command(cmd2, timeout=15)
r = out.read().decode('utf-8', errors='replace').strip()
print('\n=== Failures detail ===')
print(r if r else '(no failures found)')

ssh.close()
