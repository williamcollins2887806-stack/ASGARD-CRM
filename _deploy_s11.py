#!/usr/bin/env python3
"""Deploy HUGINN S11: git pull + npm install + restart + verify"""
import paramiko
import time
import sys

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

print('[1/5] Connecting...')
client.connect('92.242.61.184', username='root', pkey=key, timeout=30)
transport = client.get_transport()
transport.set_keepalive(5)

def run(cmd, timeout=60):
    print(f'  > {cmd}')
    chan = transport.open_session()
    chan.settimeout(timeout)
    chan.exec_command(cmd)
    out = b''
    while True:
        try:
            chunk = chan.recv(4096)
            if not chunk:
                break
            out += chunk
        except Exception:
            break
    exit_code = chan.recv_exit_status()
    return out.decode('utf-8', errors='replace'), exit_code

# Git pull
print('[2/5] Git pull...')
out, code = run('cd /var/www/asgard-crm && git fetch origin && git reset --hard origin/mobile-v3')
print(out[:500])

# npm install (for node-cron)
print('[3/5] npm install...')
out, code = run('cd /var/www/asgard-crm && npm install --production 2>&1 | tail -5', timeout=120)
print(out[:500])

# Restart
print('[4/5] Restarting service...')
out, code = run('systemctl restart asgard-crm && sleep 3 && systemctl is-active asgard-crm')
print(out.strip())

# Verify
print('[5/5] Verifying...')
out, code = run('curl -sk https://localhost:3000/api/health 2>/dev/null || curl -sk http://localhost:3000/api/health 2>/dev/null')
print(out[:300])

# Check git log
out, code = run('cd /var/www/asgard-crm && git log --oneline -1')
print(f'\nServer commit: {out.strip()}')

# Check branch
out, code = run('cd /var/www/asgard-crm && git branch --show-current')
print(f'Branch: {out.strip()}')

client.close()
print('\nDone!')
