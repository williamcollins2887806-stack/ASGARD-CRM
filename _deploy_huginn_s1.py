#!/usr/bin/env python3
"""Deploy HUGINN S1 + DB migration (waveform column + index)"""
import paramiko
import sys
import time

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)
transport = client.get_transport()
transport.set_keepalive(5)

def run(cmd, timeout=60):
    print(f">>> {cmd}")
    chan = transport.open_session()
    chan.settimeout(timeout)
    chan.exec_command(cmd)
    out = b''
    err = b''
    while True:
        if chan.recv_ready():
            out += chan.recv(65536)
        if chan.recv_stderr_ready():
            err += chan.recv_stderr(65536)
        if chan.exit_status_ready():
            # drain remaining
            while chan.recv_ready():
                out += chan.recv(65536)
            while chan.recv_stderr_ready():
                err += chan.recv_stderr(65536)
            break
        time.sleep(0.1)
    code = chan.recv_exit_status()
    out_str = out.decode('utf-8', errors='replace').strip()
    err_str = err.decode('utf-8', errors='replace').strip()
    if out_str:
        print(out_str)
    if err_str:
        print(f"STDERR: {err_str}")
    print(f"Exit code: {code}")
    return code, out_str, err_str

# Step 1: Git pull
print("\n=== STEP 1: Git pull ===")
code, out, _ = run("cd /var/www/asgard-crm && git fetch origin && git reset --hard origin/mobile-v3")
if code != 0:
    print("FAILED git pull!")
    sys.exit(1)

# Step 2: DB migration - waveform column + index
print("\n=== STEP 2: DB migration ===")
sql = """
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS waveform JSONB;
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_last ON chat_messages (chat_id, created_at DESC) WHERE deleted_at IS NULL;
"""
code, out, _ = run(f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"{sql.strip()}\"")
if code != 0:
    print("WARNING: DB migration may have failed, check output")

# Step 3: Verify waveform column
print("\n=== STEP 3: Verify waveform column ===")
run("PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='waveform';\"")

# Step 4: Restart service
print("\n=== STEP 4: Restart service ===")
code, out, _ = run("systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm")
if 'active' in out:
    print("Service is ACTIVE!")
else:
    print("WARNING: Service may not be running!")
    run("journalctl -u asgard-crm --no-pager -n 20")

# Step 5: Verify deployment
print("\n=== STEP 5: Verify deployment ===")
run("cd /var/www/asgard-crm && git log --oneline -1")
run("curl -s -o /dev/null -w '%{http_code}' https://asgard-crm.ru")

# Step 6: Check huginn.css accessible
print("\n=== STEP 6: Verify huginn.css ===")
run("curl -s -o /dev/null -w '%{http_code}' https://asgard-crm.ru/assets/css/huginn.css")

client.close()
print("\n=== DEPLOYMENT COMPLETE ===")
