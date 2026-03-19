#!/usr/bin/env python3
"""Deploy HUGINN S10 to server"""
import paramiko, time

KEY = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
HOST = '92.242.61.184'
USER = 'root'

def run(ssh, cmd, timeout=30):
    print(f'  > {cmd}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(f'    {out[:500]}')
    if err and 'warning' not in err.lower(): print(f'    ERR: {err[:300]}')
    return out

def main():
    key = paramiko.Ed25519Key.from_private_key_file(KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print('Connecting...')
    ssh.connect(HOST, username=USER, pkey=key, timeout=15)
    print('Connected!\n')

    print('=== 1. Git pull ===')
    run(ssh, 'cd /var/www/asgard-crm && git fetch origin && git reset --hard origin/mobile-v3')

    print('\n=== 2. Verify commit ===')
    out = run(ssh, 'cd /var/www/asgard-crm && git log --oneline -1')
    print(f'  Commit: {out}')

    print('\n=== 3. Check chat.js deleted ===')
    out = run(ssh, 'ls -la /var/www/asgard-crm/public/assets/js/chat.js 2>&1 || echo DELETED')
    print(f'  Result: {out}')

    print('\n=== 4. Restart service ===')
    run(ssh, 'systemctl restart asgard-crm')
    time.sleep(3)

    print('\n=== 5. Check service ===')
    out = run(ssh, 'systemctl is-active asgard-crm')
    print(f'  Status: {out}')

    print('\n=== 6. HTTP check ===')
    out = run(ssh, 'curl -s -o /dev/null -w "%{http_code}" https://asgard-crm.ru/')
    print(f'  HTTP: {out}')

    print('\n=== 7. Check chat_groups.js size ===')
    out = run(ssh, 'wc -l /var/www/asgard-crm/public/assets/js/chat_groups.js')
    print(f'  Lines: {out}')

    print('\n=== 8. Check huginn.css size ===')
    out = run(ssh, 'wc -l /var/www/asgard-crm/public/assets/css/huginn.css')
    print(f'  Lines: {out}')

    ssh.close()
    print('\n=== DEPLOY COMPLETE ===')

if __name__ == '__main__':
    main()
