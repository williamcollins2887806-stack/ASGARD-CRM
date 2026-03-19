import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Check health via localhost
_, out, _ = ssh.exec_command("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health 2>&1", timeout=10)
print('Health (localhost:3000):', out.read().decode('utf-8', errors='replace').strip())

# Check current commit
_, out, _ = ssh.exec_command("cd /var/www/asgard-crm && git log --oneline -3", timeout=10)
print('Recent commits:\n', out.read().decode('utf-8', errors='replace').strip())

# Check if tests are still running
_, out, _ = ssh.exec_command("ps aux | grep 'runner.js' | grep -v grep", timeout=10)
ps = out.read().decode('utf-8', errors='replace').strip()
if ps:
    print('Tests still running:', ps.split()[:5])
else:
    print('Tests finished. Results:')
    _, out, _ = ssh.exec_command("tail -50 /tmp/test_results8.txt 2>&1", timeout=10)
    print(out.read().decode('utf-8', errors='replace').strip())

ssh.close()
