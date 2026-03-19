import paramiko, time

KEY = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
SERVER = '92.242.61.184'

def get_client():
    key = paramiko.Ed25519Key.from_private_key_file(KEY)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(SERVER, username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)
    return client

def run(client, cmd, timeout=30):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        return stdout.read().decode().strip() or stderr.read().decode().strip()
    except Exception as e:
        return f"ERROR: {e}"

# Step 1: git pull + restart
print("=== PULL + RESTART ===")
client = get_client()
print("pull:", run(client, "cd /var/www/asgard-crm && git pull origin mobile-v3 2>&1", timeout=60))
print("restart:", run(client, "systemctl restart asgard-crm"))
client.close()

time.sleep(8)

# Step 2: verify
print("\n=== VERIFY ===")
client = get_client()
print("status:", run(client, "systemctl is-active asgard-crm"))
print("http:", run(client, "curl -s -m 10 -o /dev/null -w '%{http_code}' http://localhost:3000/"))
print("branch:", run(client, "cd /var/www/asgard-crm && git branch --show-current"))
print("commit:", run(client, "cd /var/www/asgard-crm && git log --oneline -1"))
print("version:", run(client, "grep ASGARD_SHELL_VERSION /var/www/asgard-crm/public/index.html | head -1"))
client.close()
