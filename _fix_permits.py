import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=15)

sql = "INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES ('CHIEF_ENGINEER', 'permits', true, true, false) ON CONFLICT DO NOTHING;"
cmd = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"{sql}\""
_, out, err = ssh.exec_command(cmd, timeout=10)
print('Insert:', out.read().decode('utf-8', errors='replace').strip())
e = err.read().decode('utf-8', errors='replace').strip()
if e:
    print('Err:', e)

# Verify
cmd2 = "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -c \"SELECT role, module_key, can_read, can_write FROM role_presets WHERE role = 'CHIEF_ENGINEER' ORDER BY module_key\""
_, out, _ = ssh.exec_command(cmd2, timeout=10)
print('Verify:', out.read().decode('utf-8', errors='replace').strip())

ssh.close()
