import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Try using the HTML report for failures
_, out, _ = ssh.exec_command("grep -i 'fail\\|error' /var/www/asgard-crm/tests/report.html | grep -i 'test-name\\|<td.*fail' | head -20", timeout=15)
r = out.read().decode('utf-8', errors='replace').strip()
if r:
    print('HTML report failures:')
    print(r)

# Try hex search for the ❌ emoji (U+274C = E2 9D 8C in UTF-8)
_, out, _ = ssh.exec_command("grep -Pn '\\xe2\\x9d\\x8c' /tmp/test_results7.txt | head -10", timeout=15)
r2 = out.read().decode('utf-8', errors='replace').strip()
if r2:
    print('\nHex search for X emoji:')
    print(r2)

# Just count lines that contain the failure count
_, out, _ = ssh.exec_command("python3 -c \"f=open('/tmp/test_results7.txt','rb').read(); import re; matches=re.findall(rb'\\xe2\\x9d\\x8c.*', f); [print(m.decode('utf-8','replace')[:200]) for m in matches]\"", timeout=15)
r3 = out.read().decode('utf-8', errors='replace').strip()
if r3:
    print('\nPython raw search:')
    print(r3)

ssh.close()
