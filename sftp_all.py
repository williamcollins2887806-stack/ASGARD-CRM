import paramiko, os, time, glob

KEY = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
LOCAL = 'C:/Users/Nikita-ASGARD/ASGARD-CRM'
REMOTE = '/var/www/asgard-crm'
SERVER = '92.242.61.184'

# Collect ALL mobile_v3 JS files
js_files = []
for root, dirs, files in os.walk(os.path.join(LOCAL, 'public', 'assets', 'js', 'mobile_v3')):
    for f in files:
        if f.endswith('.js'):
            full = os.path.join(root, f)
            rel = os.path.relpath(full, LOCAL).replace(os.sep, '/')
            js_files.append(rel)

# Add CSS and index.html
extra = [
    'public/assets/css/mobile-shell.css',
    'public/index.html',
    'public/sw.js',
]

all_files = js_files + extra
print(f"Total files to upload: {len(all_files)}")

key = paramiko.Ed25519Key.from_private_key_file(KEY)

# Upload in batches (reconnect every 20 files to avoid channel exhaustion)
BATCH = 20
ok = 0
fail = 0

for i in range(0, len(all_files), BATCH):
    batch = all_files[i:i+BATCH]
    print(f"\n=== Batch {i//BATCH + 1} ({len(batch)} files) ===")
    t = paramiko.Transport((SERVER, 22))
    t.banner_timeout = 60
    t.connect(username='root', pkey=key)
    sftp = paramiko.SFTPClient.from_transport(t)

    for f in batch:
        local_path = os.path.join(LOCAL, f.replace('/', os.sep))
        remote_path = REMOTE + '/' + f
        try:
            sftp.put(local_path, remote_path)
            print(f"  OK: {f}")
            ok += 1
        except Exception as e:
            print(f"  FAIL: {f} - {e}")
            fail += 1

    sftp.close()
    t.close()
    time.sleep(1)

print(f"\n=== UPLOAD DONE: {ok} OK, {fail} FAIL ===")

# Restart
time.sleep(2)
print("\n=== RESTART ===")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(SERVER, username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)

def run(cmd, timeout=30):
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        return stdout.read().decode().strip() or stderr.read().decode().strip()
    except Exception as e:
        return f"ERROR: {e}"

print("  restart:", run("systemctl restart asgard-crm"))
client.close()

time.sleep(12)

print("\n=== VERIFY ===")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(SERVER, username='root', pkey=key, timeout=60, banner_timeout=60, auth_timeout=60)
print("  status:", run("systemctl is-active asgard-crm"))
print("  http:", run("curl -s -m 15 -o /dev/null -w '%{http_code}' http://localhost:3000/"))
print("  commit:", run("cd /var/www/asgard-crm && git log --oneline -1"))
print("  js count:", run("find /var/www/asgard-crm/public/assets/js/mobile_v3 -name '*.js' | wc -l"))
client.close()
