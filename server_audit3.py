import paramiko

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.242.61.184', username='root', pkey=key, timeout=30)

# Run everything as a single command block
script = r"""
echo "=== ASGARD CRM SERVER AUDIT ==="
echo ""
echo "1. Service status: $(systemctl is-active asgard-crm)"
echo "2. HTTP status: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)"
echo "3. Desktop mobile_v3 refs: $(curl -s -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)' http://localhost:3000/ | grep -c mobile_v3)"
echo "4. iPhone mobile_v3 refs: $(curl -s -H 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile' http://localhost:3000/ | grep -c mobile_v3)"
echo "5. mobile_v3 dir size: $(du -sh /var/www/asgard-crm/public/assets/js/mobile_v3/ 2>/dev/null | awk '{print $1}')"
echo "6. JS file count: $(find /var/www/asgard-crm/public/assets/js/mobile_v3 -name '*.js' 2>/dev/null | wc -l)"
echo "7. CSS check: $(ls /var/www/asgard-crm/public/assets/css/mobile-shell.css 2>/dev/null && echo 'OK' || echo 'MISSING')"
echo "8. SW version: $(grep 'SHELL_VERSION' /var/www/asgard-crm/public/sw.js 2>/dev/null | head -1)"
echo "9. Encoding errors: $(grep -rn '??????' /var/www/asgard-crm/src/ /var/www/asgard-crm/public/ --include='*.js' --include='*.html' 2>/dev/null | grep -v node_modules | wc -l)"
echo "10. Log errors (10min): $(journalctl -u asgard-crm --no-pager --since '10 minutes ago' 2>/dev/null | grep -ciE 'error|exception|crash|FATAL')"
echo ""
echo "=== AUDIT COMPLETE ==="
"""

stdin, stdout, stderr = ssh.exec_command(script, timeout=60)
stdout.channel.settimeout(60)
print(stdout.read().decode())
err = stderr.read().decode().strip()
if err:
    print("STDERR:", err)

ssh.close()
