import paramiko

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=15)

# Run restart in background so it doesn't block the SSH channel
stdin, stdout, stderr = client.exec_command(
    'nohup bash -c "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm > /tmp/asgard_status.txt 2>&1" &',
    timeout=10
)
print('Restart command sent.')

import time
time.sleep(4)

# Check status with new channel
stdin2, stdout2, stderr2 = client.exec_command('cat /tmp/asgard_status.txt; systemctl is-active asgard-crm', timeout=10)
print(stdout2.read().decode().strip())

client.close()
