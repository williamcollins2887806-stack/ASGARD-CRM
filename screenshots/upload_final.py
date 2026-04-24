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

# Read, compress, encode
with open(LOCAL_HTML, 'rb') as f:
    raw = f.read()
compressed = gzip.compress(raw, compresslevel=9)
b64 = base64.b64encode(compressed).decode()
print(f'Raw: {len(raw)//1024}KB, Compressed: {len(compressed)//1024}KB, B64: {len(b64)//1024}KB')

# Split into 8KB chunks (smaller to avoid timeouts)
CHUNK = 8000
chunks = [b64[i:i+CHUNK] for i in range(0, len(b64), CHUNK)]
print(f'Chunks: {len(chunks)}')

def connect():
    key = paramiko.Ed25519Key.from_private_key_file(KEY_PATH)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, pkey=key, timeout=30)
    ssh.get_transport().set_keepalive(5)
    return ssh

def run_cmd(ssh, cmd, retries=3):
    for attempt in range(retries):
        try:
            stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
            exit_code = stdout.channel.recv_exit_status()
            return exit_code
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
                continue
            raise e

# Connect and prepare
ssh = connect()
run_cmd(ssh, f'mkdir -p {REMOTE_DIR}')
run_cmd(ssh, 'rm -f /tmp/_e2e.b64')
print('Prepared')

# Upload chunks with reconnection
uploaded = 0
batch_size = 10  # reconnect every N chunks

for i, chunk in enumerate(chunks):
    if i > 0 and i % batch_size == 0:
        # Reconnect to avoid timeout
        try:
            ssh.close()
        except:
            pass
        time.sleep(1)
        ssh = connect()

    op = '>' if i == 0 else '>>'
    try:
        run_cmd(ssh, f'printf "%s" "{chunk}" {op} /tmp/_e2e.b64')
        uploaded += 1
        print(f'\r{uploaded}/{len(chunks)}', end='', flush=True)
    except Exception as e:
        print(f'\nChunk {i} failed: {e}, reconnecting...')
        try:
            ssh.close()
        except:
            pass
        time.sleep(3)
        ssh = connect()
        # Retry
        try:
            run_cmd(ssh, f'printf "%s" "{chunk}" >> /tmp/_e2e.b64')
            uploaded += 1
            print(f'\r{uploaded}/{len(chunks)} (retried)', end='', flush=True)
        except Exception as e2:
            print(f'\nChunk {i} FAILED permanently: {e2}')
            break

print(f'\nUploaded {uploaded}/{len(chunks)} chunks')

# Reconnect and decode
try:
    ssh.close()
except:
    pass
time.sleep(2)
ssh = connect()

# Decode
run_cmd(ssh, f'base64 -d /tmp/_e2e.b64 | gunzip > {REMOTE_DIR}/index.html', retries=3)
run_cmd(ssh, 'rm -f /tmp/_e2e.b64')
run_cmd(ssh, f'chmod 644 {REMOTE_DIR}/index.html')

# Verify
stdin, stdout, stderr = ssh.exec_command(f'wc -c < {REMOTE_DIR}/index.html', timeout=10)
remote_size = stdout.read().decode().strip()
print(f'Remote size: {remote_size} (expected: {len(raw)})')

stdin, stdout, stderr = ssh.exec_command(f'head -c 50 {REMOTE_DIR}/index.html', timeout=10)
first = stdout.read().decode()
print(f'First: {first}')

ssh.close()
print(f'\n✅ https://asgard-crm.ru/e2e-screenshots/')
