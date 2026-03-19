import paramiko
key = paramiko.Ed25519Key.from_private_key_file('C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('92.242.61.184', username='root', pkey=key, timeout=15)

def run(cmd, t=15):
    try:
        si, so, se = c.exec_command(cmd, timeout=t)
        return so.read().decode().strip(), se.read().decode().strip()
    except Exception as e:
        return "", str(e)

print("--- Nginx gzip config ---")
o,_ = run("grep -rn 'gzip' /etc/nginx/nginx.conf /etc/nginx/sites-enabled/ 2>/dev/null | head -40")
print(o or "(none)")

print("\n--- Nginx version ---")
o,e = run("nginx -v 2>&1")
print(o or e)

print("\n--- Full nginx site config ---")
o,_ = run("cat /etc/nginx/sites-enabled/asgard-crm 2>/dev/null | head -100")
print(o or "(not found)")

print("\n--- Fastify compression ---")
o,_ = run("grep -rn 'compress' /var/www/asgard-crm/src/server.js /var/www/asgard-crm/src/app.js 2>/dev/null")
print(o or "(no compression)")
o,_ = run("grep -i 'compress' /var/www/asgard-crm/package.json 2>/dev/null")
print(o or "(no compress dep)")

print("\n--- Curl version ---")
o,_ = run("curl --version | head -3")
print(o)

print("\n--- Fastify port ---")
o,_ = run("ss -tlnp | grep -E '3000|node'")
print(o or "(not found)")

c.close()
print("\nBATCH 1 DONE")
