import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Read the entire file and find all test failures from internal data
cmd = r"""python3 << 'PYEOF'
import re
content = open('/tmp/test_results7.txt', 'r', encoding='utf-8', errors='replace').read()
lines = content.split('\n')
for i, line in enumerate(lines):
    stripped = re.sub(r'\x1b\[[0-9;]*m', '', line)
    if '❌' in stripped and '0 fail' not in stripped and 'ИТОГО' not in stripped:
        print(f'{i+1}: {stripped.strip()[:200]}')
PYEOF"""
_, out, _ = ssh.exec_command(cmd, timeout=15)
r = out.read().decode('utf-8', errors='replace').strip()
if r:
    print('ANSI-stripped ❌ lines:')
    print(r)
else:
    print('Still no ❌ lines found. Checking smoke section...')

# Check smoke test summary section
cmd2 = r"""python3 << 'PYEOF'
content = open('/tmp/test_results7.txt', 'r', encoding='utf-8', errors='replace').read()
import re
content_clean = re.sub(r'\x1b\[[0-9;]*m', '', content)
lines = content_clean.split('\n')
in_smoke = False
for i, line in enumerate(lines):
    if 'SMOKE' in line or 'smoke' in line or 'Smoke' in line:
        in_smoke = True
    if in_smoke:
        print(f'{i+1}: {line.strip()[:200]}')
    if in_smoke and ('pass' in line.lower() and 'fail' in line.lower()):
        in_smoke = False
PYEOF"""
_, out, _ = ssh.exec_command(cmd2, timeout=15)
print('\nSmoke section:')
print(out.read().decode('utf-8', errors='replace').strip())

ssh.close()
