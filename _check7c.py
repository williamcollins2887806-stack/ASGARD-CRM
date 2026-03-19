import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Get ALL lines with the red X emoji
_, out, _ = ssh.exec_command("grep -n '❌' /tmp/test_results7.txt", timeout=15)
lines = out.read().decode('utf-8', errors='replace').strip()
for line in lines.split('\n'):
    print(line)

ssh.close()
