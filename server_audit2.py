import paramiko
import time

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=30)

cmds = [
    'systemctl is-active asgard-crm',
    'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/',
    'curl -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)" http://localhost:3000/ | grep -c mobile_v3',
    'curl -s -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile" http://localhost:3000/ | grep -c mobile_v3',
    'du -sh /var/www/asgard-crm/public/assets/js/mobile_v3/',
    'find /var/www/asgard-crm/public/assets/js/mobile_v3 -name "*.js" | wc -l',
    'ls -la /var/www/asgard-crm/public/assets/css/mobile-shell.css 2>/dev/null && echo "CSS OK" || echo "CSS MISSING"',
    'grep "SHELL_VERSION" /var/www/asgard-crm/public/sw.js | head -1',
    'grep -rn "??????" /var/www/asgard-crm/src/ /var/www/asgard-crm/public/ --include="*.js" --include="*.html" 2>/dev/null | grep -v node_modules | wc -l',
    'journalctl -u asgard-crm --no-pager --since "10 minutes ago" 2>/dev/null | grep -ci "error\|exception\|crash\|FATAL"',
]

labels = [
    'Service status',
    'HTTP status code',
    'Desktop mobile_v3 refs',
    'iPhone mobile_v3 refs',
    'mobile_v3 dir size',
    'JS file count',
    'CSS check',
    'SW version',
    'Encoding errors',
    'Log errors (10min)',
]

for label, cmd in zip(labels, cmds):
    try:
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
        stdout.channel.settimeout(15)
        stderr.channel.settimeout(15)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        print(f"{label}: {out}")
        if err:
            print(f"  stderr: {err}")
    except Exception as e:
        print(f"{label}: TIMEOUT/ERROR ({e})")

ssh.close()
print("\nAudit complete.")
