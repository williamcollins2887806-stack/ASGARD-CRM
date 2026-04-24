import paramiko
import os
import base64
import gzip
import time

KEY_PATH = 'C:/Users/Nikita-ASGARD/.ssh/asgard_crm_deploy'
HOST = '92.242.61.184'
USER = 'root'
LOCAL_HTML = 'C:/Users/Nikita-ASGARD/ASGARD-CRM/screenshots/gallery.html'
REMOTE_DIR = '/var/www/asgard-crm/public/e2e-screenshots'
REMOTE_FILE = f'{REMOTE_DIR}/index.html'

# Read and compress HTML
with open(LOCAL_HTML, 'rb') as f:
    raw = f.read()
print(f'Raw size: {len(raw)//1024}KB')

compressed = gzip.compress(raw, compresslevel=9)
print(f'Compressed: {len(compressed)//1024}KB')

b64 = base64.b64encode(compressed).decode()
print(f'Base64: {len(b64)//1024}KB')

# Split into 20KB chunks
CHUNK = 20000
chunks = [b64[i:i+CHUNK] for i in range(0, len(b64), CHUNK)]
print(f'Chunks: {len(chunks)}')

# Connect
key = paramiko.Ed25519Key.from_private_key_file(KEY_PATH)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, pkey=key, timeout=30)

def run(cmd, timeout=15):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    return out, err

# Create dir and clean
run(f'mkdir -p {REMOTE_DIR}')
run(f'rm -f /tmp/_e2e_upload.b64')
print('Prepared remote')

# Upload chunks
for i, chunk in enumerate(chunks):
    # Write chunk to a temp file, append
    op = '>' if i == 0 else '>>'
    out, err = run(f'printf "%s" "{chunk}" {op} /tmp/_e2e_upload.b64')
    if err:
        print(f'Chunk {i} error: {err}')
    else:
        print(f'Chunk {i+1}/{len(chunks)} OK', end='\r')
    time.sleep(0.1)

print(f'\nAll chunks uploaded')

# Verify b64 size
out, _ = run('wc -c < /tmp/_e2e_upload.b64')
print(f'Remote b64 size: {out.strip()} (expected: {len(b64)})')

# Decode and decompress
run(f'base64 -d /tmp/_e2e_upload.b64 | gunzip > {REMOTE_FILE}', timeout=30)
run('rm -f /tmp/_e2e_upload.b64')

# Verify
out, _ = run(f'wc -c < {REMOTE_FILE}')
print(f'Remote HTML size: {out.strip()} (expected: {len(raw)})')

out, _ = run(f'head -1 {REMOTE_FILE}')
print(f'First line: {out.strip()[:50]}')

run(f'chmod 644 {REMOTE_FILE}')

ssh.close()
print(f'\n✅ https://asgard-crm.ru/e2e-screenshots/')
