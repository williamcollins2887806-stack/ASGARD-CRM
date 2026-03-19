import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Strip ANSI codes and search for failures
cmd = r"sed 's/\x1b\[[0-9;]*m//g' /tmp/test_results7.txt | grep '❌' | grep -v 'ИТОГО\|0 fail\|0 pass'"
_, out, _ = ssh.exec_command(cmd, timeout=15)
r = out.read().decode('utf-8', errors='replace').strip()
if r:
    print('Failures (ANSI stripped):')
    print(r)
else:
    print('No failures found after ANSI stripping')

# Also check the JSON report
_, out, _ = ssh.exec_command("node -e \"const r=require('/var/www/asgard-crm/tests/report.json'||'{}'); const fails=r.filter(t=>t.status==='FAIL'); console.log(JSON.stringify(fails.map(t=>({name:t.name,error:t.error})),null,2))\" 2>/dev/null || echo 'no report.json'", timeout=10)
r2 = out.read().decode('utf-8', errors='replace').strip()
print('\nJSON report failures:')
print(r2)

ssh.close()
