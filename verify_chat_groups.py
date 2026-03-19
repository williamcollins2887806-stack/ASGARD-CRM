import paramiko
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)

cmd = """PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
SELECT role, can_read, can_write 
FROM role_presets 
WHERE module_key = 'chat_groups' 
ORDER BY role;
" """
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
stdout.channel.settimeout(30)
print(stdout.read().decode('utf-8', errors='replace'))
err = stderr.read().decode('utf-8', errors='replace')
if err:
    print("ERR:", err)

client.close()
