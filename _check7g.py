import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Read the HTML report and find FAIL rows
cmd = r"""python3 -c "
import re
html = open('/var/www/asgard-crm/tests/report.html').read()
# Find rows with tag-fail
rows = re.findall(r'<tr[^>]*class=\"[^\"]*fail[^\"]*\"[^>]*>(.*?)</tr>', html, re.DOTALL)
for row in rows:
    name = re.search(r'<td>(.*?)</td>', row)
    error = re.findall(r'<td>(.*?)</td>', row)
    if name:
        print(' | '.join(e.strip() for e in error[:4]))
" 2>&1"""
_, out, _ = ssh.exec_command(cmd, timeout=15)
print('HTML FAIL rows:')
print(out.read().decode('utf-8', errors='replace').strip())

# Also check for the runner's internal counts
cmd2 = r"""python3 -c "
lines = open('/tmp/test_results7.txt', 'rb').readlines()
for i, line in enumerate(lines):
    if b'\xe2\x9d\x8c' in line and b'0 fail' not in line and b'\xd0\x98\xd0\xa2\xd0\x9e\xd0\x93\xd0\x9e' not in line:
        print(f'{i+1}: {line.decode(\"utf-8\",\"replace\").strip()[:200]}')
" 2>&1"""
_, out, _ = ssh.exec_command(cmd2, timeout=15)
r = out.read().decode('utf-8', errors='replace').strip()
if r:
    print('\nByte-level ❌ search:')
    print(r)
else:
    print('\nNo ❌ lines found at byte level either')

# Check the runner's test-results JSON
cmd3 = r"""node -e "
try {
  const fs = require('fs');
  const data = fs.readFileSync('/var/www/asgard-crm/tests/results.json','utf-8');
  const tests = JSON.parse(data);
  const fails = tests.filter(t => t.status === 'FAIL');
  fails.forEach(f => console.log(f.name + ' | ' + (f.error || '').slice(0,150)));
} catch(e) { console.log('No results.json: ' + e.message); }
" 2>&1"""
_, out, _ = ssh.exec_command(cmd3, timeout=10)
print('\nresults.json:')
print(out.read().decode('utf-8', errors='replace').strip())

ssh.close()
