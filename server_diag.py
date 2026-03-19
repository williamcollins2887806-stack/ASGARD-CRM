import paramiko

key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('92.242.61.184', username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)

def run(cmd, timeout=30):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        return stdout.read().decode().strip() or stderr.read().decode().strip()
    except Exception as e:
        return f"ERROR: {e}"

print("=== 1. core.js tabs/mimir/more ===")
print(run("grep -n 'mimir\\|more\\|tabBar\\|tab_bar' /var/www/asgard-crm/public/assets/js/mobile_v3/core.js | head -20"))

print("\n=== 2. core.js DOMContentLoaded/App.init ===")
print(run("grep -n 'DOMContentLoaded\\|App.init' /var/www/asgard-crm/public/assets/js/mobile_v3/core.js | head -5"))

print("\n=== 3. mimir.js head ===")
print(run("head -5 /var/www/asgard-crm/public/assets/js/mobile_v3/pages/mimir.js"))

print("\n=== 3b. more_menu.js head ===")
print(run("head -5 /var/www/asgard-crm/public/assets/js/mobile_v3/pages/more_menu.js"))

print("\n=== 5. git log ===")
print(run("cd /var/www/asgard-crm && git log --oneline -3"))

print("\n=== 6. ls files ===")
print(run("ls -la /var/www/asgard-crm/public/assets/js/mobile_v3/pages/mimir.js /var/www/asgard-crm/public/assets/js/mobile_v3/pages/more_menu.js"))

client.close()
