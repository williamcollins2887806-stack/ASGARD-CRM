import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Approach 1: Use the runner itself to show failures
cmd1 = r"""python3 << 'PYEOF2'
import re
content = open('/tmp/test_results7.txt', 'r', encoding='utf-8', errors='replace').read()
# Strip all ANSI codes
clean = re.sub(r'\x1b\[[0-9;]*m', '', content)
lines = clean.split('\n')

# Find lines with fail count > 0 (like "3 pass, 1 fail")
for i, line in enumerate(lines):
    s = line.strip()
    # Match patterns like "N fail" where N > 0
    m = re.search(r'(\d+)\s+fail', s, re.IGNORECASE)
    if m and int(m.group(1)) > 0:
        # Print surrounding context
        start = max(0, i-3)
        end = min(len(lines), i+2)
        for j in range(start, end):
            marker = '>>>' if j == i else '   '
            print(f'{marker} {j+1}: {lines[j].strip()[:250]}')
        print('---')
PYEOF2"""

_, out, err = ssh.exec_command(cmd1, timeout=30)
r1 = out.read().decode('utf-8', errors='replace').strip()
e1 = err.read().decode('utf-8', errors='replace').strip()
print('=== Lines with fail count > 0 ===')
print(r1 if r1 else '(none)')
if e1:
    print('STDERR:', e1)

# Approach 2: Find test group summaries
cmd2 = r"""python3 << 'PYEOF2'
import re
content = open('/tmp/test_results7.txt', 'r', encoding='utf-8', errors='replace').read()
clean = re.sub(r'\x1b\[[0-9;]*m', '', content)
lines = clean.split('\n')

# Find ИТОГО / summary lines
for i, line in enumerate(lines):
    s = line.strip()
    if any(word in s for word in ['ИТОГО', 'итого', 'Total', 'TOTAL', 'Summary', 'SUMMARY']):
        start = max(0, i-2)
        end = min(len(lines), i+3)
        for j in range(start, end):
            print(f'{j+1}: {lines[j].strip()[:250]}')
        print('---')
PYEOF2"""

_, out, err = ssh.exec_command(cmd2, timeout=30)
r2 = out.read().decode('utf-8', errors='replace').strip()
print('\n=== ИТОГО / Summary lines ===')
print(r2 if r2 else '(none)')

# Approach 3: Search for individual test FAIL markers
cmd3 = r"""python3 << 'PYEOF2'
import re
content = open('/tmp/test_results7.txt', 'rb').read()
# Search for the cross mark emoji bytes: E2 9D 8C
positions = []
idx = 0
while True:
    idx = content.find(b'\xe2\x9d\x8c', idx)
    if idx == -1:
        break
    positions.append(idx)
    idx += 3

print(f'Found {len(positions)} cross marks total')
for pos in positions:
    # Get the line containing this position
    line_start = content.rfind(b'\n', 0, pos)
    line_end = content.find(b'\n', pos)
    if line_start == -1: line_start = 0
    if line_end == -1: line_end = len(content)
    line = content[line_start:line_end]
    clean_line = re.sub(rb'\x1b\[[0-9;]*m', b'', line).decode('utf-8', errors='replace').strip()
    print(f'  pos={pos}: {clean_line[:250]}')
PYEOF2"""

_, out, err = ssh.exec_command(cmd3, timeout=30)
r3 = out.read().decode('utf-8', errors='replace').strip()
print('\n=== Byte-level cross mark positions ===')
print(r3 if r3 else '(none)')

# Approach 4: Look at the runner.js to understand how failures are counted
cmd4 = r"""python3 << 'PYEOF2'
import re
content = open('/tmp/test_results7.txt', 'r', encoding='utf-8', errors='replace').read()
clean = re.sub(r'\x1b\[[0-9;]*m', '', content)
lines = clean.split('\n')

# Find all lines containing "fail" (case insensitive) that aren't 0 fail
for i, line in enumerate(lines):
    s = line.strip().lower()
    if 'fail' in s and '0 fail' not in s and s:
        print(f'{i+1}: {lines[i].strip()[:250]}')
PYEOF2"""

_, out, err = ssh.exec_command(cmd4, timeout=30)
r4 = out.read().decode('utf-8', errors='replace').strip()
print('\n=== Lines with "fail" (not "0 fail") ===')
print(r4 if r4 else '(none)')

ssh.close()
